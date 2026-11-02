import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import type { TimelineEntry } from '@shared/types'
import { reduceTimeline } from './timeline'

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
    expect(timeline).toEqual([{ kind: 'agent', id: 'lens1', label: 'Security lens', done: false, activity: 2, at: AT }])
    expect(run([...[assistant([{ type: 'tool_use', id: 'lens1', name: 'Agent', input: { description: 'S' } }])], toolResult('lens1')])[0]).toMatchObject({ done: true })
  })

  it('records main-thread text and skips quiet tools', () => {
    const timeline = run([assistant([{ type: 'text', text: 'Fetching the PR.' }, { type: 'tool_use', id: 'r', name: 'Read', input: {} }])])
    expect(timeline).toEqual([{ kind: 'text', id: 'a1:0', text: 'Fetching the PR.', at: AT }])
  })

  it('closes open rows and appends a result entry', () => {
    const timeline = run([
      assistant([{ type: 'tool_use', id: 'lens1', name: 'Agent', input: { description: 'Tests lens' } }]),
      { type: 'result', subtype: 'success', is_error: false, uuid: 'r1', total_cost_usd: 1.5, duration_ms: 1000, result: 'done' } as unknown as SDKMessage,
    ])
    expect(timeline[0]).toMatchObject({ done: true })
    expect(timeline[1]).toEqual({ kind: 'result', id: 'r1', ok: true, text: '', costUsd: 1.5, durationMs: 1000, at: AT })
  })
})
