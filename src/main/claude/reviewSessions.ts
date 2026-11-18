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
  type MemberSubmit,
  type MemberVerdict,
  prKey,
  type PrRef,
  type ReviewEvent,
  type ReviewSession,
  type ReviewThread,
  type SubmittedReview,
  type ThreadResolution,
} from '@shared/types'
import { errorMessage } from '@shared/errors'
import { keyOf } from '@shared/prUnit'
import { changesForPr, draftsForPr, isUnitSession, sessionMembers, unitDraftProblems, withMemberComments } from '@shared/unitDrafts'
import { describeReplies, needsReplyTargets } from '../github/reviewComments'
import { submitReview } from '../github/submitReview'
import { fetchOwnThreads, resolveOwnThreads } from '../github/threads'
import { prList, type SessionState } from '../prList'
import { configFile, sessionsDir } from '../store'
import { ClaudeSessions, now, removeSessionDir, type TurnSetup } from './claudeSessions'
import { APP_PROTOCOL, reviewPrompt } from './prompts'
import { createRallyServer } from './rallyTools'

const ACTIVE_STATUSES = new Set(['running', 'submitting'])

const SUBMIT_ORDER: ReviewEvent[] = ['REQUEST_CHANGES', 'COMMENT', 'APPROVE']

export const PARTLY_POSTED_ERROR =
  'Some PRs in this review already posted, so Claude can no longer change its drafts. Submit again to post the rest, or skip them.'

interface MemberPost {
  member: PrRef
  event: ReviewEvent
  review: FinalReview
}

/** Checks every PR still to post before anything posts, and returns the posts in submit order. */
function submitPlan(session: ReviewSession, drafts: Drafts, verdicts: MemberVerdict[], changes: DraftChanges): MemberPost[] {
  const unit = isUnitSession(session)
  const members = sessionMembers(session)
  if (unit) {
    const problems = unitDraftProblems(drafts, members.map(keyOf))
    if (problems.length > 0) throw new Error(`Ask Claude to fix its drafts before submitting: ${problems.join(' ')}`)
  }
  const remaining = members.filter((member) => !session.memberSubmits?.[keyOf(member)]?.submitted)
  const posts = remaining.flatMap((member): MemberPost[] => {
    const key = keyOf(member)
    const event = verdicts.find((v) => v.prKey === key)?.event
    if (!event) throw new Error(`Pick a verdict for ${key}.`)
    if (event === 'SKIP') {
      if (!unit) throw new Error('Pick Comment, Approve, or Request changes.')
      return []
    }
    const memberDrafts = draftsForPr(drafts, key)
    const memberChanges = changesForPr(changes, key)
    if (isEmptyCommentReview(event, memberDrafts, memberChanges)) throw new Error(unit ? `${key}: ${EMPTY_COMMENT_REVIEW_ERROR}` : EMPTY_COMMENT_REVIEW_ERROR)
    return [{ member, event, review: finalReview(memberDrafts, memberChanges) }]
  })
  const anyPosted = remaining.length < members.length
  if (posts.length === 0 && !anyPosted) throw new Error('Pick Comment, Approve, or Request changes for at least one PR.')
  return posts.sort((a, b) => SUBMIT_ORDER.indexOf(a.event) - SUBMIT_ORDER.indexOf(b.event))
}

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
    return session ? { status: session.status, active: session.status !== 'submitted' } : null
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

  /**
   * Posts a review to each PR that hasn't posted yet, Request changes first, then Comment, then Approve, stopping at the
   * first failure so an approval never lands without its blocking sibling. A retry posts only the PRs still missing.
   */
  async submit(sessionId: string, verdicts: MemberVerdict[], changes: DraftChanges, resolveThreadIds: string[]): Promise<void> {
    this.assertIdle(sessionId)
    const session = this.byId(sessionId)
    if (session.submitted) throw new Error('This review was already submitted. Start a follow-up review instead.')
    if (!session.drafts) throw new Error('Claude has not drafted this review yet.')
    const blocked = submitBlockedReason(changes.instructions)
    if (blocked) throw new Error(blocked)
    const posts = submitPlan(session, session.drafts, verdicts, changes)
    await this.whilePublishing(sessionId, async () => {
      this.patch(sessionId, () => ({ status: 'submitting', error: null, threadsToResolveOnSubmit: resolveThreadIds }), true)
      for (const post of posts) await this.postMember(sessionId, post)
      this.finishSubmit(sessionId)
    })
  }

  private async postMember(sessionId: string, { member, event, review }: MemberPost): Promise<void> {
    const key = keyOf(member)
    const session = this.byId(sessionId)
    const isPrimary = key === session.prKey
    const attemptReviewId = session.memberSubmits?.[key]?.attemptReviewId ?? (isPrimary ? session.submitAttemptReviewId : undefined) ?? null
    const setMember = (result: MemberSubmit) =>
      this.patch(
        sessionId,
        (s) => ({ memberSubmits: { ...s.memberSubmits, [key]: result }, ...(isPrimary && { submitAttemptReviewId: undefined }) }),
        true,
      )
    const onPendingReview = (reviewId: number | null) => setMember({ submitted: null, attemptReviewId: reviewId ?? undefined })
    let submitted: SubmittedReview
    try {
      submitted = await submitReview(member, event, review, { attemptReviewId, onPendingReview })
    } catch (error) {
      const message = errorMessage(error)
      const pending = this.find(sessionId)?.memberSubmits?.[key]?.attemptReviewId
      setMember({ submitted: null, attemptReviewId: pending, error: message })
      const sessionError = isUnitSession(session) ? `${key}: ${message}` : message
      this.patch(sessionId, () => ({ status: 'error', error: sessionError, threadsToResolveOnSubmit: undefined }), true)
      throw error
    }
    setMember({ submitted })
    prList.recordRallyReview(key, submitted.reviewId)
  }

  async threads(sessionId: string): Promise<ReviewThread[]> {
    const session = this.byId(sessionId)
    const perMember = await Promise.all(
      sessionMembers(session).map((member) => fetchOwnThreads(member, priorConcernThreadIds(this.memberDrafts(session, member)))),
    )
    return perMember.flat()
  }

  /** Resolves each thread on the PR whose earlier comment it is, refusing threads outside the session's earlier comments. */
  async resolveThreads(sessionId: string, threadIds: string[]): Promise<ThreadResolution> {
    const session = this.byId(sessionId)
    if (session.resolvingThreads) throw new Error('Rally is already resolving threads for this review')
    const concernThreadIds = new Set(priorConcernThreadIds(session.drafts))
    const outside = threadIds.filter((id) => !concernThreadIds.has(id))
    this.patch(sessionId, () => ({ resolvingThreads: true }), true)
    const resolved: string[] = []
    const failed: ThreadResolution['failed'] = []
    for (const member of sessionMembers(session)) {
      const owned = new Set(priorConcernThreadIds(this.memberDrafts(session, member)))
      const ids = threadIds.filter((id) => owned.has(id))
      if (ids.length === 0) continue
      try {
        const resolution = await resolveOwnThreads(member, ids)
        resolved.push(...resolution.resolved)
        failed.push(...resolution.failed)
      } catch (error) {
        console.error('Resolving review threads failed', { pr: member.url, error })
        failed.push(...failedResolution(ids, errorMessage(error)).failed)
      }
    }
    const refused = outside.map((threadId) => ({ threadId, error: "Not one of this review's earlier comments" }))
    const result: ThreadResolution = { at: now(), resolved, failed: [...failed, ...refused] }
    this.patch(sessionId, () => ({ threadResolution: result, resolvingThreads: false }), true)
    return result
  }

  /** Returns one PR's share of the session's drafts. */
  private memberDrafts(session: ReviewSession, member: PrRef): Drafts | null {
    return session.drafts && draftsForPr(session.drafts, keyOf(member))
  }

  /** Blocks Claude turns once some PRs of a unit posted, so the drafts behind those posts can't change before the rest post. */
  protected assertCanStartTurn(sessionId: string): void {
    super.assertCanStartTurn(sessionId)
    const session = this.byId(sessionId)
    const anyPosted = Object.values(session.memberSubmits ?? {}).some((result) => result.submitted)
    if (anyPosted && !session.submitted) throw new Error(PARTLY_POSTED_ERROR)
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
      const shares = sessionMembers(session).map((member) => ({ member, share: draftsForPr(drafts, keyOf(member)) }))
      const described = await Promise.all(
        shares.map(({ member, share }) => (needsReplyTargets(share) ? describeReplies(member, share) : share)),
      )
      if (this.find(sessionId)?.drafts === drafts) this.patch(sessionId, () => ({ drafts: withMemberComments(drafts, described) }), true)
    } catch (error) {
      console.warn('Looking up the comments that draft replies answer failed', { sessionId, pr: session.pr.url, error })
    } finally {
      this.replyLookups.delete(drafts)
    }
  }

  /** Marks the session submitted once every PR posted or was skipped, then resolves the selected threads and refreshes the PRs. */
  private finishSubmit(sessionId: string): void {
    const session = this.byId(sessionId)
    const members = sessionMembers(session)
    const posted = members.flatMap((member) => session.memberSubmits?.[keyOf(member)]?.submitted ?? [])
    const submitted = session.memberSubmits?.[session.prKey]?.submitted ?? posted[0]
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
    prList.refreshMany(members).catch((error) => {
      console.error('PR refresh after submit failed', { prs: members.map((m) => m.url), error })
    })
  }
}

export const reviewSessions = new ReviewSessions()
