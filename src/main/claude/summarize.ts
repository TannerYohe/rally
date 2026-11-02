import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Pr } from '@shared/types'

const MAX_BODY_CHARS = 2000
const MAX_FILES = 40

const SYSTEM_PROMPT =
  'You summarize GitHub pull requests for a reviewer dashboard. Reply with one plain sentence under 20 words ' +
  'describing what the change does. No preamble, no markdown, no PR number.'

export function summaryCacheKey(pr: Pr): string {
  return `${pr.id}:${pr.headRefOid}`
}

function summaryPrompt(pr: Pr): string {
  return [
    `Title: ${pr.title}`,
    `Repo: ${pr.owner}/${pr.repo}  +${pr.additions} -${pr.deletions} in ${pr.changedFiles} files`,
    `Files:\n${pr.files.slice(0, MAX_FILES).join('\n')}`,
    `Description:\n${(pr.body || '(empty)').slice(0, MAX_BODY_CHARS)}`,
  ].join('\n\n')
}

export async function summarizePr(pr: Pr): Promise<string> {
  const stream = query({
    prompt: summaryPrompt(pr),
    options: {
      model: 'haiku',
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      settingSources: [],
      maxTurns: 1,
      persistSession: false,
    },
  })
  for await (const message of stream) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') throw new Error(`Summary failed: ${message.subtype}`)
      if (message.is_error) throw new Error(`Summary failed: ${message.result}`)
      return message.result.trim()
    }
  }
  throw new Error('Summary stream ended without a result')
}
