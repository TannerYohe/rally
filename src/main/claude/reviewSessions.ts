import { randomUUID } from 'node:crypto'
import {
  EMPTY_COMMENT_REVIEW_ERROR,
  finalReview,
  isEmptyCommentReview,
  submitBlockedReason,
  type DraftChanges,
  type FinalReview,
} from '@shared/feedback'
import {
  priorConcernThreadIds,
  type Drafts,
  prKey,
  type PrRef,
  type ReviewEvent,
  type ReviewSession,
  type ReviewThread,
  type SubmittedReview,
  type ThreadResolution,
} from '@shared/types'
import { errorMessage } from '@shared/errors'
import { describeReplies, needsReplyTargets } from '../github/reviewComments'
import { submitReview } from '../github/submitReview'
import { fetchOwnThreads, resolveOwnThreads } from '../github/threads'
import { prList, type SessionState } from '../prList'
import { configFile, sessionsDir } from '../store'
import { ClaudeSessions, now, removeSessionDir, type TurnSetup } from './claudeSessions'
import { APP_PROTOCOL, reviewPrompt } from './prompts'
import { createRallyServer } from './rallyTools'

const ACTIVE_STATUSES = new Set(['running', 'submitting'])

function failedResolution(threadIds: string[], error: string): ThreadResolution {
  return { at: now(), resolved: [], failed: threadIds.map((threadId) => ({ threadId, error })) }
}

const INTERRUPTED_RESOLVE_ERROR = 'Rally closed before resolving this thread. Select it and use Resolve selected to retry.'

function restoreThreadState(stored: ReviewSession): ReviewSession {
  const pending = stored.threadsToResolveOnSubmit ?? []
  if (!stored.resolvingThreads && pending.length === 0) return stored
  const session = { ...stored, resolvingThreads: false, threadsToResolveOnSubmit: undefined }
  return stored.submitted && pending.length > 0 ? { ...session, threadResolution: failedResolution(pending, INTERRUPTED_RESOLVE_ERROR) } : session
}

const INTERRUPTED_SUBMIT_ERROR =
  'Rally closed while submitting this review. Submit again; Rally checks whether the earlier attempt went through first.'

function restoreSession(stored: ReviewSession): ReviewSession {
  const session = restoreThreadState(stored)
  if (!ACTIVE_STATUSES.has(session.status)) return session
  if (session.submitted) return { ...session, status: 'submitted', error: null }
  if (session.status === 'submitting') return { ...session, status: 'error', error: INTERRUPTED_SUBMIT_ERROR }
  return { ...session, status: 'error', error: 'Interrupted when Rally closed. Send feedback to resume.' }
}

class ReviewSessions extends ClaudeSessions<ReviewSession> {
  private replyLookups = new WeakSet<Drafts>()

  constructor() {
    super(sessionsDir, restoreSession)
  }

  open(key: string): ReviewSession | null {
    const session = this.getByPr(key)
    if (session?.drafts && !session.submitted) void this.lookUpReplyTargets(session.id, session.drafts)
    return session
  }

  sessionState(key: string): SessionState | null {
    const session = this.sessions.get(key)
    return session ? { status: session.status, active: session.status !== 'submitted', openFindings: 0 } : null
  }

  async start(pr: PrRef): Promise<ReviewSession> {
    const key = prKey(pr.owner, pr.repo, pr.number)
    const existing = this.sessions.get(key)
    if (existing && this.isTurnRunning(existing.id)) return existing
    this.add({ ...this.newSessionCore(pr, 'running'), drafts: null, submitted: null })
    const session = this.sessions.get(key)!
    void this.runTurn(session.id, reviewPrompt(pr, configFile.get().reviewSkill), 'review')
    return this.sessions.get(key)!
  }

  async submit(sessionId: string, event: ReviewEvent, changes: DraftChanges, resolveThreadIds: string[]): Promise<void> {
    this.assertIdle(sessionId)
    const { drafts, pr, submitted, submitAttemptReviewId } = this.byId(sessionId)
    if (submitted) throw new Error('This review was already submitted. Start a follow-up review instead.')
    if (!drafts) throw new Error('Claude has not drafted this review yet.')
    const blocked = submitBlockedReason(changes.instructions)
    if (blocked) throw new Error(blocked)
    if (isEmptyCommentReview(event, drafts, changes)) throw new Error(EMPTY_COMMENT_REVIEW_ERROR)
    await this.whilePublishing(sessionId, async () => {
      this.patch(sessionId, () => ({ status: 'submitting', error: null, threadsToResolveOnSubmit: resolveThreadIds }), true)
      await this.post(sessionId, pr, event, finalReview(drafts, changes), submitAttemptReviewId ?? null)
    })
  }

  private async post(sessionId: string, pr: PrRef, event: ReviewEvent, review: FinalReview, attemptReviewId: number | null): Promise<void> {
    const onPendingReview = (reviewId: number | null) => this.patch(sessionId, () => ({ submitAttemptReviewId: reviewId ?? undefined }), true)
    let submitted: SubmittedReview
    try {
      submitted = await submitReview(pr, event, review, { attemptReviewId, onPendingReview })
    } catch (error) {
      this.patch(sessionId, () => ({ status: 'error', error: errorMessage(error), threadsToResolveOnSubmit: undefined }), true)
      throw error
    }
    this.completeSubmit(sessionId, submitted)
  }

  async threads(sessionId: string): Promise<ReviewThread[]> {
    const session = this.byId(sessionId)
    return fetchOwnThreads(session.pr, priorConcernThreadIds(session.drafts))
  }

  async resolveThreads(sessionId: string, threadIds: string[]): Promise<ThreadResolution> {
    const { pr, resolvingThreads, drafts } = this.byId(sessionId)
    if (resolvingThreads) throw new Error('Rally is already resolving threads for this review')
    const concernThreadIds = new Set(priorConcernThreadIds(drafts))
    const outside = threadIds.filter((id) => !concernThreadIds.has(id))
    this.patch(sessionId, () => ({ resolvingThreads: true }), true)
    let result: ThreadResolution
    try {
      const resolution = await resolveOwnThreads(
        pr,
        threadIds.filter((id) => concernThreadIds.has(id)),
      )
      const refused = outside.map((threadId) => ({ threadId, error: "Not one of this review's earlier comments" }))
      result = { at: now(), resolved: resolution.resolved, failed: [...resolution.failed, ...refused] }
    } catch (error) {
      const message = errorMessage(error)
      console.error('Resolving review threads failed', { pr: pr.url, error })
      result = failedResolution(threadIds, message)
    }
    this.patch(sessionId, () => ({ threadResolution: result, resolvingThreads: false }), true)
    return result
  }

  discard(sessionId: string): void {
    const session = this.byId(sessionId)
    if (session.resolvingThreads) throw new Error('Wait for Rally to finish resolving threads before discarding this review')
    if (this.publishing.has(sessionId)) throw new Error('Wait for Rally to finish submitting this review before discarding it')
    this.remove(session)
  }


  protected turnSetup(sessionId: string): TurnSetup {
    const mcpServer = createRallyServer({
      onDrafts: (drafts) => {
        this.patch(sessionId, () => ({ drafts }), true)
        void this.lookUpReplyTargets(sessionId, drafts)
      },
    })
    return { systemPromptAppend: APP_PROTOCOL, mcpServer }
  }

  private async lookUpReplyTargets(sessionId: string, drafts: Drafts): Promise<void> {
    const session = this.find(sessionId)
    if (!session || !needsReplyTargets(drafts) || this.replyLookups.has(drafts)) return
    this.replyLookups.add(drafts)
    try {
      const described = await describeReplies(session.pr, drafts)
      if (this.find(sessionId)?.drafts === drafts) this.patch(sessionId, () => ({ drafts: described }), true)
    } catch (error) {
      console.warn('Looking up the comments that draft replies answer failed', { sessionId, pr: session.pr.url, error })
    } finally {
      this.replyLookups.delete(drafts)
    }
  }

  private completeSubmit(sessionId: string, submitted: SubmittedReview): void {
    const session = this.find(sessionId)
    if (session) prList.recordRallyReview(session.prKey, submitted.reviewId)
    this.patch(sessionId, () => ({ status: 'submitted', submitted, submitAttemptReviewId: undefined }), true)
    const threadIds = this.find(sessionId)?.threadsToResolveOnSubmit ?? []
    const clearPending = () => this.patch(sessionId, () => ({ threadsToResolveOnSubmit: undefined }), true)
    if (threadIds.length === 0) clearPending()
    else {
      this.resolveThreads(sessionId, threadIds)
        .catch((error) => {
          const message = errorMessage(error)
          console.error('Resolving review threads after submit failed', { sessionId, error })
          this.patch(sessionId, () => ({ threadResolution: failedResolution(threadIds, message) }), true)
        })
        .finally(clearPending)
    }
    removeSessionDir(sessionId)
    const pr = this.find(sessionId)?.pr
    if (!pr) return
    prList.refreshOne(pr.owner, pr.repo, pr.number).catch((error) => {
      console.error('PR refresh after submit failed', { pr: pr.url, error })
    })
  }
}

export const reviewSessions = new ReviewSessions()
