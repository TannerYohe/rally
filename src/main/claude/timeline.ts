import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { TimelineEntry } from '@shared/types'

const QUIET_TOOLS = new Set(['Read', 'Grep', 'Glob', 'ToolSearch', 'TodoWrite'])

const BASH_STEPS: [RegExp, string][] = [
  [/gh pr view/, 'Fetching PR metadata'],
  [/gh repo clone/, 'Cloning repository'],
  [/gh pr checkout/, 'Checking out PR'],
  [/\/reviews\/\d+\/events/, 'Submitting review'],
  [/\/replies\b/, 'Posting thread reply'],
  [/\/reviews\b.*(--method\s+POST|-X\s*POST|--input)/, 'Posting pending review'],
  [/gh api graphql/, 'Querying review threads'],
  [/gh api \S*\/(comments|reviews)/, 'Reading PR conversation'],
  [/git .*range-diff|git .*merge-base/, 'Building delta since last review'],
  [/git .*diff/, 'Building diff'],
  [/git .*(fetch|log)/, 'Reading history'],
  [/rm -rf/, 'Cleaning up'],
]

const TOOL_LABELS: Record<string, string> = {
  Skill: 'Loading skill',
  Write: 'Writing file',
  mcp__rally__publish_drafts: 'Publishing drafts to Rally',
  mcp__rally__review_submitted: 'Confirming submission',
  mcp__claude_ai_Atlassian__getJiraIssue: 'Fetching Jira ticket',
}

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

interface TextBlock {
  type: 'text'
  text: string
}

interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  is_error?: boolean
}

export function bashStepLabel(command: string, description: unknown): string {
  const match = BASH_STEPS.find(([pattern]) => pattern.test(command))
  if (match) return match[1]
  return typeof description === 'string' && description ? description : 'Running command'
}

function toolEntry(block: ToolUseBlock, at: string): TimelineEntry | null {
  if (QUIET_TOOLS.has(block.name)) return null
  if (block.name === 'Agent' || block.name === 'Task') {
    const label = String(block.input.description ?? block.input.subagent_type ?? 'Subagent')
    return { kind: 'agent', id: block.id, label, done: false, activity: 0, at }
  }
  if (block.name === 'Bash') {
    const command = String(block.input.command ?? '')
    return { kind: 'step', id: block.id, label: bashStepLabel(command, block.input.description), detail: command, done: false, at }
  }
  const detail = block.name === 'Skill' ? String(block.input.skill ?? '') : ''
  return { kind: 'step', id: block.id, label: TOOL_LABELS[block.name] ?? block.name, detail, done: false, at }
}

function markDone(timeline: TimelineEntry[], toolUseIds: Set<string>): TimelineEntry[] {
  return timeline.map((entry) =>
    (entry.kind === 'step' || entry.kind === 'agent') && toolUseIds.has(entry.id) ? { ...entry, done: true } : entry,
  )
}

function bumpActivity(timeline: TimelineEntry[], parentId: string, count: number): TimelineEntry[] {
  return timeline.map((entry) =>
    entry.kind === 'agent' && entry.id === parentId ? { ...entry, activity: entry.activity + count } : entry,
  )
}

export function reduceTimeline(timeline: TimelineEntry[], message: SDKMessage, at: string): TimelineEntry[] {
  switch (message.type) {
    case 'assistant': {
      const blocks = message.message.content as unknown as (TextBlock | ToolUseBlock | { type: string })[]
      if (message.parent_tool_use_id) {
        const toolCalls = blocks.filter((b) => b.type === 'tool_use').length
        return toolCalls ? bumpActivity(timeline, message.parent_tool_use_id, toolCalls) : timeline
      }
      const added: TimelineEntry[] = []
      blocks.forEach((block, index) => {
        if (block.type === 'text' && (block as TextBlock).text.trim()) {
          added.push({ kind: 'text', id: `${message.uuid}:${index}`, text: (block as TextBlock).text, at })
        } else if (block.type === 'tool_use') {
          const entry = toolEntry(block as ToolUseBlock, at)
          if (entry) added.push(entry)
        }
      })
      return added.length ? [...timeline, ...added] : timeline
    }
    case 'user': {
      if (message.parent_tool_use_id || typeof message.message.content === 'string') return timeline
      const results = (message.message.content as { type: string }[]).filter(
        (b): b is ToolResultBlock => b.type === 'tool_result',
      )
      return results.length ? markDone(timeline, new Set(results.map((r) => r.tool_use_id))) : timeline
    }
    case 'result': {
      const ok = message.subtype === 'success' && !message.is_error
      const text = message.subtype === 'success' ? '' : message.subtype.replaceAll('_', ' ')
      const finished = timeline.map((entry) =>
        (entry.kind === 'step' || entry.kind === 'agent') && !entry.done ? { ...entry, done: true } : entry,
      )
      return [
        ...finished,
        { kind: 'result', id: message.uuid, ok, text, costUsd: message.total_cost_usd, durationMs: message.duration_ms, at },
      ]
    }
    default:
      return timeline
  }
}
