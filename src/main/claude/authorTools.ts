import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { RESPONSE_ACTIONS, RESPONSE_VERDICTS, type Drafts, type ItemResponse } from '@shared/types'
import { ok, publishDraftsTool, RALLY_SERVER, RALLY_TOOL_PREFIX } from './rallyTools'

const PUBLISH_RESPONSES = 'publish_responses'

export const PUBLISH_RESPONSES_TOOL = `${RALLY_TOOL_PREFIX}${PUBLISH_RESPONSES}`

export interface AuthorToolHandlers {
  onResponses(responses: Omit<ItemResponse, 'at'>[]): void
  onSelfReview(drafts: Drafts): void
}

const responseSchema = z.object({
  item_id: z.string().describe('The item id exactly as given in the request'),
  action: z.enum(RESPONSE_ACTIONS),
  verdict: z
    .enum(RESPONSE_VERDICTS)
    .nullable()
    .describe('For investigate: whether the comment holds against the code. Null for every action except investigate.'),
  summary: z.string().describe('Markdown: what you found or changed, with file:line evidence'),
  reply_body: z.string().describe('The reply to post on the thread as the author, or an empty string for none'),
  commits: z.array(z.string()).describe('Full shas of the commits made for this item, oldest first; empty when none'),
})

export function createAuthorServer(handlers: AuthorToolHandlers) {
  const publishResponses = tool(
    PUBLISH_RESPONSES,
    'Publish your results for the feedback items in the request to the Rally app. Call once per request, after handling every item, with one entry per item.',
    { responses: z.array(responseSchema) },
    async (args) => {
      handlers.onResponses(
        args.responses.map((r) => ({
          itemId: r.item_id,
          action: r.action,
          verdict: r.verdict,
          summary: r.summary,
          reply: r.reply_body,
          commits: r.commits,
        })),
      )
      return ok(`Rally received ${args.responses.length} responses.`)
    },
  )
  return createSdkMcpServer({
    name: RALLY_SERVER,
    version: '1.0.0',
    tools: [publishResponses, publishDraftsTool({ onDrafts: handlers.onSelfReview })],
  })
}
