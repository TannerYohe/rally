import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { Drafts, SubmittedReview } from '@shared/types'

export interface RallyToolHandlers {
  onDrafts(drafts: Drafts): void
  onSubmitted(review: SubmittedReview): void
}

const commentSchema = z.object({
  id: z.string().describe('Draft number as shown to the user, e.g. "1"'),
  kind: z.enum(['inline', 'reply']).describe('inline = new review comment; reply = reply on an existing thread'),
  path: z.string().nullable().describe('Repo-relative file path; null for replies or summary-only points'),
  line: z.number().int().nullable(),
  start_line: z.number().int().nullable().describe('First line of a multi-line range, else null'),
  side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'),
  severity: z.enum(['blocker', 'high', 'medium', 'nit']),
  body: z.string().describe('The comment text exactly as it would be posted'),
  reply_to_comment_id: z.number().int().nullable().describe('Comment id being replied to, for kind=reply'),
})

const PUBLISH_DRAFTS = 'publish_drafts'
const REVIEW_SUBMITTED = 'review_submitted'

export const RALLY_SERVER = 'rally'
export const RALLY_TOOL_PREFIX = `mcp__${RALLY_SERVER}__`
export const PUBLISH_DRAFTS_TOOL = `${RALLY_TOOL_PREFIX}${PUBLISH_DRAFTS}`
export const REVIEW_SUBMITTED_TOOL = `${RALLY_TOOL_PREFIX}${REVIEW_SUBMITTED}`

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })

export function createRallyServer(handlers: RallyToolHandlers) {
  const publishDrafts = tool(
    PUBLISH_DRAFTS,
    'Publish the current review report and the complete set of draft comments to the Rally app. Call every time you present or revise drafts, always with the full set.',
    {
      mode: z.enum(['full', 'followup']),
      verdict: z.string().describe('Looks good / Minor changes / Needs changes / Blocking issues'),
      report_markdown: z.string().describe('The review report exactly as presented to the user'),
      summary_body: z.string().describe('Top-level review body, or empty string for none'),
      comments: z.array(commentSchema),
      prior_concerns: z
        .array(z.object({ id: z.string(), location: z.string(), gist: z.string(), verdict: z.string() }))
        .default([])
        .describe('Follow-up mode ledger of my earlier comments and their verdicts'),
    },
    async (args) => {
      handlers.onDrafts({
        mode: args.mode,
        verdict: args.verdict,
        reportMarkdown: args.report_markdown,
        summaryBody: args.summary_body,
        priorConcerns: args.prior_concerns,
        comments: args.comments.map((c) => ({
          id: c.id,
          kind: c.kind,
          path: c.path,
          line: c.line,
          startLine: c.start_line,
          side: c.side,
          severity: c.severity,
          body: c.body,
          replyToCommentId: c.reply_to_comment_id,
        })),
      })
      return ok(`Rally received ${args.comments.length} draft comments.`)
    },
  )

  const reviewSubmitted = tool(
    REVIEW_SUBMITTED,
    'Tell Rally the review was posted and submitted on GitHub. Call once at the end of a SUBMIT turn.',
    {
      review_id: z.number().int(),
      html_url: z.string(),
      event: z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']),
    },
    async (args) => {
      handlers.onSubmitted({ reviewId: args.review_id, url: args.html_url, event: args.event })
      return ok('Rally recorded the submitted review.')
    },
  )

  return createSdkMcpServer({ name: RALLY_SERVER, version: '1.0.0', tools: [publishDrafts, reviewSubmitted] })
}
