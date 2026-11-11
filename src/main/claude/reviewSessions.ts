import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type CanUseTool, type HookCallback } from '@anthropic-ai/claude-agent-sdk'
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
  type SessionStatus,
  type SubmittedReview,
  type ThreadResolution,
  type TimelineEntry,
  type TurnMode,
} from '@shared/types'
import { errorMessage } from '@shared/errors'
import { describeReplies, needsReplyTargets } from '../github/reviewComments'
import { submitReview } from '../github/submitReview'
import { fetchOwnThreads, resolveOwnThreads } from '../github/threads'
import { prList } from '../prList'
import { configFile, sessionsDir } from '../store'
import { claudeExecutable } from './executable'
import { APP_PROTOCOL, reviewPrompt } from './prompts'
import { reviewModelOptions } from './modelOptions'
import { createRallyServer, RALLY_SERVER } from './rallyTools'
import { closeOpenEntries, reduceTimeline } from './timeline'
import { decideToolUse } from './toolPolicy'

const FLUSH_INTERVAL_MS = 200
const ACTIVE_STATUSES = new Set(['running', 'submitting'])

const now = () => new Date().toISOString()

const sessionDir = (sessionId: string) => join(tmpdir(), 'rally', sessionId)

function removeSessionDir(sessionId: string): void {
  try {
    rmSync(sessionDir(sessionId), { recursive: true, force: true })
  } catch (error) {
    console.error('Removing review session directory failed', { sessionId, error })
  }
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

class ReviewSessions extends EventEmitter {
  private sessions: Map<string, ReviewSession>
  private controllers = new Map<string, AbortController>()
  private posting = new Set<string>()
  private pendingFlush: NodeJS.Timeout | null = null
  private dirty = new Set<string>()

  constructor() {
    super()
    const stored = sessionsDir.readAll().map(restoreSession)
    this.sessions = new Map(stored.map((s) => [s.prKey, s]))
  }

  getByPr(key: string): ReviewSession | null {
    return this.sessions.get(key) ?? null
  }

  statusOf(key: string): SessionStatus | null {
    return this.sessions.get(key)?.status ?? null
  }

  async start(pr: PrRef): Promise<ReviewSession> {
    const key = prKey(pr.owner, pr.repo, pr.number)
    const existing = this.sessions.get(key)
    if (existing && this.controllers.has(existing.id)) return existing
    const session: ReviewSession = {
      id: randomUUID(),
      pr,
      prKey: key,
      sdkSessionId: null,
      status: 'running',
      error: null,
      timeline: [],
      drafts: null,
      submitted: null,
      createdAt: now(),
      updatedAt: now(),
    }
    this.sessions.set(key, session)
    void this.runTurn(session.id, reviewPrompt(pr, configFile.get().reviewSkill), 'review')
    return this.sessions.get(key)!
  }

  async feedback(sessionId: string, message: string): Promise<void> {
    this.assertIdle(sessionId)
    void this.runTurn(sessionId, message, 'refine')
  }

  async submit(sessionId: string, event: ReviewEvent, changes: DraftChanges, resolveThreadIds: string[]): Promise<void> {
    this.assertIdle(sessionId)
    const { drafts, pr, submitted, submitAttemptReviewId } = this.byId(sessionId)
    if (submitted) throw new Error('This review was already submitted. Start a follow-up review instead.')
    if (!drafts) throw new Error('Claude has not drafted this review yet.')
    const blocked = submitBlockedReason(changes.instructions)
    if (blocked) throw new Error(blocked)
    if (isEmptyCommentReview(event, drafts, changes)) throw new Error(EMPTY_COMMENT_REVIEW_ERROR)
    this.posting.add(sessionId)
    try {
      this.patch(sessionId, () => ({ status: 'submitting', error: null, threadsToResolveOnSubmit: resolveThreadIds }), true)
      await this.post(sessionId, pr, event, finalReview(drafts, changes), submitAttemptReviewId ?? null)
    } finally {
      this.posting.delete(sessionId)
    }
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

  cancel(sessionId: string): void {
    this.controllers.get(sessionId)?.abort()
  }

  discard(sessionId: string): void {
    const session = this.byId(sessionId)
    if (session.resolvingThreads) throw new Error('Wait for Rally to finish resolving threads before discarding this review')
    if (this.posting.has(sessionId)) throw new Error('Wait for Rally to finish submitting this review before discarding it')
    this.cancel(sessionId)
    this.sessions.delete(session.prKey)
    sessionsDir.remove(session.prKey)
    removeSessionDir(sessionId)
    this.emit('removed', session.prKey)
  }

  private assertIdle(sessionId: string): void {
    this.byId(sessionId)
    if (this.controllers.has(sessionId)) throw new Error('A turn is already running for this review')
    if (this.posting.has(sessionId)) throw new Error('Rally is already submitting this review')
  }

  private find(sessionId: string): ReviewSession | undefined {
    return [...this.sessions.values()].find((s) => s.id === sessionId)
  }

  private byId(sessionId: string): ReviewSession {
    const session = this.find(sessionId)
    if (!session) throw new Error(`Unknown review session ${sessionId}`)
    return session
  }

  private patch(sessionId: string, update: (session: ReviewSession) => Partial<ReviewSession>, immediate = false): void {
    const session = this.find(sessionId)
    if (!session) return
    const next = { ...session, ...update(session), updatedAt: now() }
    this.sessions.set(next.prKey, next)
    this.dirty.add(next.prKey)
    if (immediate) this.flush()
    else this.pendingFlush ??= setTimeout(() => this.flush(), FLUSH_INTERVAL_MS)
  }

  private updateTimeline(sessionId: string, reduce: (timeline: TimelineEntry[]) => TimelineEntry[]): void {
    const session = this.find(sessionId)
    if (!session) return
    const timeline = reduce(session.timeline)
    if (timeline !== session.timeline) this.patch(sessionId, () => ({ timeline }))
  }

  private append(sessionId: string, entry: TimelineEntry): void {
    this.patch(sessionId, (s) => ({ timeline: [...s.timeline, entry] }))
  }

  private flush(): void {
    if (this.pendingFlush) clearTimeout(this.pendingFlush)
    this.pendingFlush = null
    for (const key of this.dirty) {
      const session = this.sessions.get(key)
      if (!session) continue
      sessionsDir.write(key, session)
      this.emit('changed', session)
    }
    this.dirty.clear()
  }

  private async runTurn(sessionId: string, prompt: string, mode: TurnMode): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    let resultOk = false

    this.patch(
      sessionId,
      (s) => ({
        status: 'running',
        error: null,
        timeline: [...s.timeline, { kind: 'user', id: randomUUID(), text: prompt, at: now(), turn: mode }],
      }),
      true,
    )

    const cwd = sessionDir(sessionId)
    mkdirSync(cwd, { recursive: true })

    const decide = (toolName: string, input: unknown) =>
      decideToolUse(toolName, (input ?? {}) as Record<string, unknown>, { cwd })

    const preToolUse: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return {}
      const decision = decide(input.tool_name, input.tool_input)
      if (decision.allow) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
      }
      this.append(sessionId, { kind: 'denied', id: `${input.tool_use_id}:denied`, label: decision.reason, at: now() })
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason,
        },
      }
    }

    const canUseTool: CanUseTool = async (toolName, input) => {
      const decision = decide(toolName, input)
      return decision.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: decision.reason }
    }

    const rallyServer = createRallyServer({
      onDrafts: (drafts) => {
        this.patch(sessionId, () => ({ drafts }), true)
        void this.describeReplies(sessionId, drafts)
      },
    })

    try {
      const stream = query({
        prompt,
        options: {
          resume: this.find(sessionId)?.sdkSessionId ?? undefined,
          cwd,
          pathToClaudeCodeExecutable: claudeExecutable(),
          abortController: controller,
          settingSources: ['user'],
          skills: 'all',
          systemPrompt: { type: 'preset', preset: 'claude_code', append: APP_PROTOCOL },
          mcpServers: { [RALLY_SERVER]: rallyServer },
          hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
          canUseTool,
          ...reviewModelOptions(configFile.get(), { ...process.env, TMPDIR: cwd }),
        },
      })
      for await (const message of stream) {
        if (message.type === 'system' && message.subtype === 'init') {
          this.patch(sessionId, () => ({ sdkSessionId: message.session_id }), true)
        }
        if (message.type === 'result') resultOk = message.subtype === 'success' && !message.is_error
        this.updateTimeline(sessionId, (timeline) => reduceTimeline(timeline, message, now()))
      }
      this.finishTurn(sessionId, resultOk)
    } catch (error) {
      const cancelled = controller.signal.aborted
      this.patch(
        sessionId,
        () => ({
          status: cancelled ? 'cancelled' : 'error',
          error: cancelled ? null : errorMessage(error),
        }),
        true,
      )
    } finally {
      this.controllers.delete(sessionId)
      this.patch(sessionId, (s) => ({ timeline: closeOpenEntries(s.timeline) }))
      this.flush()
    }
  }

  private async describeReplies(sessionId: string, drafts: Drafts): Promise<void> {
    if (!needsReplyTargets(drafts)) return
    const { pr } = this.byId(sessionId)
    try {
      const described = await describeReplies(pr, drafts)
      if (this.find(sessionId)?.drafts === drafts) this.patch(sessionId, () => ({ drafts: described }), true)
    } catch (error) {
      console.warn('Looking up the comments that draft replies answer failed', { pr: pr.url, error: errorMessage(error) })
    }
  }

  private finishTurn(sessionId: string, resultOk: boolean): void {
    this.patch(
      sessionId,
      () => (resultOk ? { status: 'awaiting_feedback' } : { status: 'error', error: 'The Claude turn ended with an error.' }),
      true,
    )
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
