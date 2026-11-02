import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type CanUseTool, type HookCallback } from '@anthropic-ai/claude-agent-sdk'
import {
  prKey,
  type PrRef,
  type ReviewEvent,
  type ReviewSession,
  type SessionStatus,
  type SubmittedReview,
  type TimelineEntry,
} from '@shared/types'
import { prList } from '../prList'
import { sessionsFile } from '../store'
import { APP_PROTOCOL, reviewPrompt, submitPrompt } from './prompts'
import { createRallyServer } from './rallyTools'
import { closeOpenEntries, reduceTimeline } from './timeline'
import { decideToolUse } from './toolPolicy'

type TurnMode = 'review' | 'refine' | 'submit'

const FLUSH_INTERVAL_MS = 200
const ACTIVE_STATUSES = new Set(['running', 'submitting'])

const now = () => new Date().toISOString()

class ReviewSessions extends EventEmitter {
  private sessions: Map<string, ReviewSession>
  private controllers = new Map<string, AbortController>()
  private pendingFlush: NodeJS.Timeout | null = null
  private dirty = new Set<string>()

  constructor() {
    super()
    const stored = Object.values(sessionsFile.get()).map((session) =>
      ACTIVE_STATUSES.has(session.status)
        ? { ...session, status: 'error' as const, error: 'Interrupted when Rally closed. Send feedback to resume.' }
        : session,
    )
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
    void this.runTurn(session.id, reviewPrompt(pr), 'review')
    return this.sessions.get(key)!
  }

  async feedback(sessionId: string, message: string): Promise<void> {
    this.assertIdle(sessionId)
    void this.runTurn(sessionId, message, 'refine')
  }

  async submit(sessionId: string, event: ReviewEvent, notes: string): Promise<void> {
    this.assertIdle(sessionId)
    void this.runTurn(sessionId, submitPrompt(this.byId(sessionId).pr, event, notes), 'submit')
  }

  cancel(sessionId: string): void {
    this.controllers.get(sessionId)?.abort()
  }

  discard(sessionId: string): void {
    this.cancel(sessionId)
    const session = this.byId(sessionId)
    this.sessions.delete(session.prKey)
    this.persist()
    this.emit('removed', session.prKey)
  }

  private assertIdle(sessionId: string): void {
    this.byId(sessionId)
    if (this.controllers.has(sessionId)) throw new Error('A turn is already running for this review')
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

  private append(sessionId: string, entry: TimelineEntry): void {
    this.patch(sessionId, (s) => ({ timeline: [...s.timeline, entry] }))
  }

  private flush(): void {
    if (this.pendingFlush) clearTimeout(this.pendingFlush)
    this.pendingFlush = null
    for (const key of this.dirty) {
      const session = this.sessions.get(key)
      if (session) this.emit('changed', session)
    }
    this.dirty.clear()
    this.persist()
  }

  private persist(): void {
    sessionsFile.set(Object.fromEntries(this.sessions))
  }

  private async runTurn(sessionId: string, prompt: string, mode: TurnMode): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    const submitting = mode === 'submit'
    let submitted: SubmittedReview | null = null
    let resultOk = false

    this.patch(
      sessionId,
      (s) => ({
        status: submitting ? 'submitting' : 'running',
        error: null,
        timeline: [...s.timeline, { kind: 'user', id: randomUUID(), text: prompt, at: now() }],
      }),
      true,
    )

    const decide = (toolName: string, input: unknown) =>
      decideToolUse(toolName, (input ?? {}) as Record<string, unknown>, { submitting })

    const preToolUse: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return {}
      const decision = decide(input.tool_name, input.tool_input)
      if (decision.allow) {
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
      }
      this.append(sessionId, { kind: 'denied', id: input.tool_use_id, label: decision.reason, at: now() })
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
      onDrafts: (drafts) => this.patch(sessionId, () => ({ drafts }), true),
      onSubmitted: (review) => {
        submitted = review
      },
    })

    const cwd = join(tmpdir(), 'rally', sessionId)
    mkdirSync(cwd, { recursive: true })

    try {
      const stream = query({
        prompt,
        options: {
          resume: this.find(sessionId)?.sdkSessionId ?? undefined,
          cwd,
          abortController: controller,
          settingSources: ['user'],
          skills: 'all',
          systemPrompt: { type: 'preset', preset: 'claude_code', append: APP_PROTOCOL },
          mcpServers: { rally: rallyServer },
          hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
          canUseTool,
        },
      })
      for await (const message of stream) {
        if (message.type === 'system' && message.subtype === 'init') {
          this.patch(sessionId, () => ({ sdkSessionId: message.session_id }), true)
        }
        if (message.type === 'result') resultOk = message.subtype === 'success' && !message.is_error
        this.patch(sessionId, (s) => ({ timeline: reduceTimeline(s.timeline, message, now()) }))
      }
      this.finishTurn(sessionId, mode, resultOk, submitted)
    } catch (error) {
      const cancelled = controller.signal.aborted
      this.patch(
        sessionId,
        () => ({
          status: cancelled ? 'cancelled' : 'error',
          error: cancelled ? null : error instanceof Error ? error.message : String(error),
        }),
        true,
      )
    } finally {
      this.controllers.delete(sessionId)
      this.patch(sessionId, (s) => ({ timeline: closeOpenEntries(s.timeline) }))
      this.flush()
    }
  }

  private finishTurn(sessionId: string, mode: TurnMode, resultOk: boolean, submitted: SubmittedReview | null): void {
    if (mode !== 'submit') {
      this.patch(
        sessionId,
        () => (resultOk ? { status: 'awaiting_feedback' } : { status: 'error', error: 'The Claude turn ended with an error.' }),
        true,
      )
      return
    }
    if (!submitted) {
      this.patch(
        sessionId,
        () => ({
          status: 'error',
          error: 'Claude finished the submit turn without confirming the review was submitted. Check GitHub, then retry or send feedback.',
        }),
        true,
      )
      return
    }
    this.patch(sessionId, () => ({ status: 'submitted', submitted }), true)
    const pr = this.find(sessionId)?.pr
    if (!pr) return
    prList.refreshOne(pr.owner, pr.repo, pr.number).catch((error) => {
      console.error('PR refresh after submit failed', { pr: pr.url, error })
    })
  }
}

export const reviewSessions = new ReviewSessions()
