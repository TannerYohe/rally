import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { COMMIT_PLACEHOLDER } from '@shared/authorSession'
import { errorMessage } from '@shared/errors'
import { RESPONSE_ACTIONS, RESPONSE_VERDICTS, type Drafts, type ItemResponse, type PrDescription } from '@shared/types'
import { ok, publishDraftsTool, RALLY_SERVER, RALLY_TOOL_PREFIX } from './rallyTools'

const PUBLISH_RESPONSES = 'publish_responses'

const PUBLISH_DESCRIPTION = 'publish_description'

export const PUBLISH_RESPONSES_TOOL = `${RALLY_TOOL_PREFIX}${PUBLISH_RESPONSES}`

export const PUBLISH_DESCRIPTION_TOOL = `${RALLY_TOOL_PREFIX}${PUBLISH_DESCRIPTION}`

export type PublishedResponse = Pick<ItemResponse, 'itemId' | 'action' | 'verdict' | 'summary' | 'reply' | 'files' | 'commitMessage'>

export interface AuthorToolHandlers {
  onResponses(responses: PublishedResponse[]): void
  onSelfReview(drafts: Drafts): void
  /** Saves a proposed title and description and returns what Rally tells Claude about it. */
  onDescription(description: PrDescription): Promise<string>
}

const responseSchema = z.object({
  item_id: z.string().describe('The item id exactly as given in the request'),
  action: z.enum(RESPONSE_ACTIONS),
  verdict: z
    .enum(RESPONSE_VERDICTS)
    .nullable()
    .describe('For investigate: whether the comment holds against the code. Null for every action except investigate.'),
  summary: z.string().describe('Markdown: what you found or changed, with file:line evidence'),
  reply_body: z
    .string()
    .describe(`The reply to post as the author, or an empty string for none. For fix, write ${COMMIT_PLACEHOLDER} where the commit's short sha goes.`),
  files: z.array(z.string()).describe('For fix: repo-relative paths you changed, added, or deleted for this item. Empty for other actions.'),
  commit_message: z.string().describe('For fix: the commit message for these files. Empty for other actions.'),
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
          files: r.files,
          commitMessage: r.commit_message,
        })),
      )
      return ok(`Rally received ${args.responses.length} responses.`)
    },
  )
  const publishDescription = tool(
    PUBLISH_DESCRIPTION,
    'Propose a new PR title and description to the Rally app. Rally shows the user the change and updates GitHub when they push. Send the complete title and description, not a diff.',
    {
      title: z.string().describe('The full PR title; repeat the current one when it still fits'),
      body: z.string().describe('The full PR description in markdown'),
    },
    async (args) => {
      try {
        return ok(await handlers.onDescription({ title: args.title, body: args.body }))
      } catch (error) {
        return { ...ok(`Rally couldn't save the description: ${errorMessage(error)}`), isError: true }
      }
    },
  )
  return createSdkMcpServer({
    name: RALLY_SERVER,
    version: '1.0.0',
    tools: [publishResponses, publishDescription, publishDraftsTool({ onDrafts: handlers.onSelfReview })],
  })
}
