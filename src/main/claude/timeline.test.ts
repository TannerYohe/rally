import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import type { TimelineEntry } from '@shared/types'
import { closeOpenEntries, reduceTimeline } from './timeline'

const AT = '2026-11-02T00:00:00Z'

function assistant(content: unknown[], parent: string | null = null, uuid = 'a1'): SDKMessage {
  return { type: 'assistant', uuid, session_id: 's', parent_tool_use_id: parent, message: { content } } as unknown as SDKMessage
}

function toolResult(toolUseId: string, parent: string | null = null): SDKMessage {
  return {
    type: 'user',
    session_id: 's',
    parent_tool_use_id: parent,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId }] },
  } as unknown as SDKMessage
}

function system(fields: Record<string, unknown>): SDKMessage {
  return { type: 'system', uuid: 'sys', session_id: 's', ...fields } as unknown as SDKMessage
}

function result(): SDKMessage {
  return { type: 'result', subtype: 'success', is_error: false, uuid: 'r1', total_cost_usd: 1.5, duration_ms: 1000, result: 'done' } as unknown as SDKMessage
}

function run(messages: SDKMessage[]): TimelineEntry[] {
  return messages.reduce<TimelineEntry[]>((timeline, m) => reduceTimeline(timeline, m, AT), [])
}

describe('reduceTimeline', () => {
  it('labels known bash commands and marks them done on result', () => {
    const timeline = run([
      assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'gh pr view 1 -R a/b --json title' } }]),
      toolResult('t1'),
    ])
    expect(timeline).toEqual([
      { kind: 'step', id: 't1', label: 'Fetching PR metadata', detail: 'gh pr view 1 -R a/b --json title', done: true, at: AT },
    ])
  })

  it('falls back to the bash description for unknown commands', () => {
    const [entry] = run([assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'wc -l x', description: 'Count lines' } }])])
    expect(entry).toMatchObject({ label: 'Count lines', done: false })
  })

  it('tracks subagents and counts their tool calls', () => {
    const timeline = run([
      assistant([{ type: 'tool_use', id: 'lens1', name: 'Agent', input: { description: 'Security lens' } }]),
      assistant([{ type: 'tool_use', id: 'x', name: 'Read', input: {} }, { type: 'tool_use', id: 'y', name: 'Grep', input: {} }], 'lens1', 'a2'),
      toolResult('x', 'lens1'),
    ])
    expect(timeline).toEqual([{ kind: 'agent', id: 'lens1', label: 'Security lens', done: false, activity: 2, background: true, at: AT }])
  })

  it('marks a foreground subagent done on its tool result', () => {
    const timeline = run([
      assistant([{ type: 'tool_use', id: 'lens1', name: 'Agent', input: { description: 'S', run_in_background: false } }]),
      toolResult('lens1'),
    ])
    expect(timeline[0]).toMatchObject({ done: true })
  })

  it('keeps a background subagent open until its task notification', () => {
    const launched = run([
      assistant([{ type: 'tool_use', id: 'lens1', name: 'Agent', input: { description: 'Delta reviewer' } }]),
      system({ subtype: 'task_started', task_id: 't1', tool_use_id: 'lens1', description: 'Delta reviewer', is_backgrounded: true }),
      toolResult('lens1'),
      system({ subtype: 'task_progress', task_id: 't1', tool_use_id: 'lens1', description: 'Delta reviewer', usage: { total_tokens: 1, tool_uses: 9, duration_ms: 1 } }),
      result(),
    ])
    expect(launched[0]).toMatchObject({ done: false, activity: 9, background: true })
    const finished = reduceTimeline(launched, system({ subtype: 'task_notification', task_id: 't1', tool_use_id: 'lens1', status: 'completed', output_file: '', summary: '' }), AT)
    expect(finished[0]).toMatchObject({ done: true })
  })

  it('treats an agent as foreground when task_started says so', () => {
    const timeline = run([
      assistant([{ type: 'tool_use', id: 'lens1', name: 'Agent', input: { description: 'Tests lens' } }]),
      system({ subtype: 'task_started', task_id: 't1', tool_use_id: 'lens1', description: 'Tests lens', is_backgrounded: false }),
      toolResult('lens1'),
    ])
    expect(timeline[0]).toMatchObject({ done: true, background: false })
  })

  it('records main-thread text and skips quiet tools', () => {
    const timeline = run([assistant([{ type: 'text', text: 'Fetching the PR.' }, { type: 'tool_use', id: 'r', name: 'Read', input: {} }])])
    expect(timeline).toEqual([{ kind: 'text', id: 'a1:0', text: 'Fetching the PR.', at: AT }])
  })

  it('closes open steps, leaves background agents running, and appends a result entry', () => {
    const timeline = run([
      assistant([
        { type: 'tool_use', id: 'lens1', name: 'Agent', input: { description: 'Tests lens' } },
        { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'gh pr view 1' } },
      ]),
      result(),
    ])
    expect(timeline[0]).toMatchObject({ kind: 'agent', done: false })
    expect(timeline[1]).toMatchObject({ kind: 'step', done: true })
    expect(timeline[2]).toEqual({ kind: 'result', id: 'r1', ok: true, text: '', costUsd: 1.5, durationMs: 1000, at: AT })
    expect(closeOpenEntries(timeline)[0]).toMatchObject({ done: true })
  })

  it('returns the same timeline when a message changes nothing', () => {
    const timeline = run([
      assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
      assistant([{ type: 'tool_use', id: 'agent1', name: 'Agent', input: { description: 'Lens' } }], null, 'a2'),
      system({ subtype: 'task_progress', tool_use_id: 'agent1', usage: { tool_uses: 0 } }),
    ])
    expect(reduceTimeline(timeline, toolResult('unknown'), AT)).toBe(timeline)
    expect(reduceTimeline(timeline, system({ subtype: 'task_progress', tool_use_id: 'agent1', usage: { tool_uses: 0 } }), AT)).toBe(timeline)
    expect(reduceTimeline(timeline, system({ subtype: 'task_progress', tool_use_id: 'other', usage: { tool_uses: 3 } }), AT)).toBe(timeline)
    const done = reduceTimeline(timeline, toolResult('t1'), AT)
    expect(done).not.toBe(timeline)
    expect(reduceTimeline(done, toolResult('t1'), AT)).toBe(done)
  })
})
