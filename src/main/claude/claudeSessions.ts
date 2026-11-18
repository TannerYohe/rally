import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type CanUseTool, type HookCallback, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { keyOf, type PrRef, type SessionCore, type SessionStatus, type TimelineEntry, type TurnMode } from '@shared/types'
import { errorMessage } from '@shared/errors'
import type { JsonDir } from '../jsonFile'
import { configFile } from '../store'
import { claudeExecutable } from './executable'
import { reviewModelOptions } from './modelOptions'
import { RALLY_SERVER } from './rallyTools'
import { closeOpenEntries, reduceTimeline } from './timeline'
import { decideToolUse } from './toolPolicy'

const FLUSH_INTERVAL_MS = 200

export const now = () => new Date().toISOString()

export const sessionDir = (sessionId: string) => join(tmpdir(), 'rally', sessionId)

export function removeSessionDir(sessionId: string): void {
  rm(sessionDir(sessionId), { recursive: true, force: true }).catch((error) => {
    console.error('Removing session directory failed', { sessionId, error })
  })
}

export interface TurnSetup {
  systemPromptAppend: string
  mcpServer: McpSdkServerConfigWithInstance
  readOnlyGitRepos?: string[]
}

/** Persists one Claude session per PR and runs its turns through the Agent SDK under Rally's tool policy. */
export abstract class ClaudeSessions<S extends SessionCore> extends EventEmitter {
  protected sessions: Map<string, S>
  protected controllers = new Map<string, AbortController>()
  /** Sessions Rally is writing to GitHub for, outside a Claude turn. */
  protected publishing = new Set<string>()
  private pendingFlush: NodeJS.Timeout | null = null
  private dirty = new Set<string>()

  constructor(
    private readonly store: JsonDir<S>,
    restore: (stored: S) => S,
  ) {
    super()
    const stored = store.readAll().map(restore)
    this.sessions = new Map(stored.map((s) => [s.prKey, s]))
  }

  getByPr(key: string): S | null {
    return this.sessions.get(key) ?? null
  }

  cancel(sessionId: string): void {
    this.controllers.get(sessionId)?.abort()
  }

  async feedback(sessionId: string, message: string): Promise<void> {
    this.assertCanStartTurn(sessionId)
    void this.runTurn(sessionId, message, 'refine')
  }

  protected abstract turnSetup(sessionId: string): TurnSetup

  protected assertIdle(sessionId: string): void {
    this.byId(sessionId)
    if (this.isTurnRunning(sessionId)) throw new Error('Claude is already working on this PR')
    if (this.publishing.has(sessionId)) throw new Error('Rally is already posting to GitHub for this PR. Try again when it finishes.')
  }

  /** Throws unless a new Claude turn may start; sessions add their own conditions. */
  protected assertCanStartTurn(sessionId: string): void {
    this.assertIdle(sessionId)
  }

  /** Runs a GitHub write for the session, marking it busy so no turn or other write starts meanwhile. */
  protected async whilePublishing<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    this.publishing.add(sessionId)
    try {
      return await action()
    } finally {
      this.publishing.delete(sessionId)
    }
  }

  protected newSessionCore(pr: PrRef, status: SessionStatus): SessionCore {
    const at = now()
    return { id: randomUUID(), pr, prKey: keyOf(pr), sdkSessionId: null, status, error: null, timeline: [], createdAt: at, updatedAt: at }
  }

  protected isTurnRunning(sessionId: string): boolean {
    return this.controllers.has(sessionId)
  }

  protected find(sessionId: string): S | undefined {
    return [...this.sessions.values()].find((s) => s.id === sessionId)
  }

  protected byId(sessionId: string): S {
    const session = this.find(sessionId)
    if (!session) throw new Error(`Unknown session ${sessionId}`)
    return session
  }

  protected add(session: S): S {
    this.sessions.set(session.prKey, session)
    return session
  }

  protected remove(session: S): void {
    this.cancel(session.id)
    this.sessions.delete(session.prKey)
    this.store.remove(session.prKey)
    removeSessionDir(session.id)
    this.emit('removed', session.prKey)
  }

  protected patch(sessionId: string, update: (session: S) => Partial<S>, immediate = false): void {
    const session = this.find(sessionId)
    if (!session) return
    const next = { ...session, ...update(session), updatedAt: now() }
    this.sessions.set(next.prKey, next)
    this.dirty.add(next.prKey)
    if (immediate) this.flush()
    else this.pendingFlush ??= setTimeout(() => this.flush(), FLUSH_INTERVAL_MS)
  }

  private patchCore(sessionId: string, update: (session: S) => Partial<SessionCore>, immediate = false): void {
    this.patch(sessionId, (session) => update(session) as Partial<S>, immediate)
  }

  protected append(sessionId: string, entry: TimelineEntry): void {
    this.patchCore(sessionId, (s) => ({ timeline: [...s.timeline, entry] }))
  }

  private updateTimeline(sessionId: string, reduce: (timeline: TimelineEntry[]) => TimelineEntry[]): void {
    const session = this.find(sessionId)
    if (!session) return
    const timeline = reduce(session.timeline)
    if (timeline !== session.timeline) this.patchCore(sessionId, () => ({ timeline }))
  }

  protected flush(): void {
    if (this.pendingFlush) clearTimeout(this.pendingFlush)
    this.pendingFlush = null
    for (const key of this.dirty) {
      const session = this.sessions.get(key)
      if (!session) continue
      this.store.write(key, session)
      this.emit('changed', session)
    }
    this.dirty.clear()
  }

  /** Runs after every turn, whether it succeeded, failed, or was cancelled, while the session still counts as busy. */
  protected async turnEnded(_sessionId: string, _succeeded: boolean, _mode: TurnMode): Promise<void> {}

  private finishTurn(sessionId: string, resultOk: boolean): void {
    this.patchCore(
      sessionId,
      () => (resultOk ? { status: 'awaiting_feedback' } : { status: 'error', error: 'The Claude turn ended with an error.' }),
      true,
    )
  }

  protected async runTurn(sessionId: string, prompt: string, mode: TurnMode): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    let resultOk = false

    this.patchCore(
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

    const setup = this.turnSetup(sessionId)
    const decide = (toolName: string, input: unknown) =>
      decideToolUse(toolName, (input ?? {}) as Record<string, unknown>, { cwd, readOnlyGitRepos: setup.readOnlyGitRepos })

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

    let failure: unknown = null
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
          systemPrompt: { type: 'preset', preset: 'claude_code', append: setup.systemPromptAppend },
          mcpServers: { [RALLY_SERVER]: setup.mcpServer },
          hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
          canUseTool,
          ...reviewModelOptions(configFile.get(), { ...process.env, TMPDIR: cwd }),
        },
      })
      for await (const message of stream) {
        if (message.type === 'system' && message.subtype === 'init') {
          this.patchCore(sessionId, () => ({ sdkSessionId: message.session_id }), true)
        }
        if (message.type === 'result') resultOk = message.subtype === 'success' && !message.is_error
        this.updateTimeline(sessionId, (timeline) => reduceTimeline(timeline, message, now()))
      }
    } catch (error) {
      failure = error
    }
    try {
      await this.turnEnded(sessionId, failure === null && resultOk, mode)
    } catch (error) {
      console.error('Finishing a turn failed', { sessionId, error })
      failure ??= error
    } finally {
      if (failure === null) this.finishTurn(sessionId, resultOk)
      else {
        const cancelled = controller.signal.aborted
        this.patchCore(sessionId, () => ({ status: cancelled ? 'cancelled' : 'error', error: cancelled ? null : errorMessage(failure) }), true)
      }
      this.controllers.delete(sessionId)
      this.patchCore(sessionId, (s) => ({ timeline: closeOpenEntries(s.timeline) }))
      this.flush()
    }
  }
}
