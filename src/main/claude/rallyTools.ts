import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { CONCERN_STATUSES, type Drafts, type SubmittedReview } from '@shared/types'

export interface RallyToolHandlers {
  onDrafts(drafts: Drafts): void
  onPendingReview(reviewId: number): void
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
const PENDING_REVIEW_CREATED = 'pending_review_created'

export const RALLY_SERVER = 'rally'
export const RALLY_TOOL_PREFIX = `mcp__${RALLY_SERVER}__`
export const PUBLISH_DRAFTS_TOOL = `${RALLY_TOOL_PREFIX}${PUBLISH_DRAFTS}`
export const REVIEW_SUBMITTED_TOOL = `${RALLY_TOOL_PREFIX}${REVIEW_SUBMITTED}`
export const PENDING_REVIEW_CREATED_TOOL = `${RALLY_TOOL_PREFIX}${PENDING_REVIEW_CREATED}`

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
        .array(
          z.object({
            id: z.string(),
            location: z.string(),
            gist: z.string(),
            verdict: z.string().describe('One-line verdict with evidence, e.g. "addressed in abc1234"'),
            status: z
              .enum(CONCERN_STATUSES)
              .describe(
                'addressed: a later commit fixes it. partly: some of it is still missing. not_addressed: the code still has the problem. ' +
                  'pushed_back_accept: the author disagreed and their argument holds against the code, so the thread can be resolved. ' +
                  'pushed_back_hold: the author disagreed and the concern still stands. moot: the code it was about is gone.',
              ),
            thread_id: z
              .string()
              .nullable()
              .describe('GraphQL node id of the review thread (PRRT_...) for inline comments; null for review bodies and conversation comments'),
          }),
        )
        .default([])
        .describe('Follow-up mode ledger of my earlier comments and their verdicts'),
    },
    async (args) => {
      handlers.onDrafts({
        mode: args.mode,
        verdict: args.verdict,
        reportMarkdown: args.report_markdown,
        summaryBody: args.summary_body,
        priorConcerns: args.prior_concerns.map((c) => ({
          id: c.id,
          location: c.location,
          gist: c.gist,
          verdict: c.verdict,
          status: c.status,
          threadId: c.thread_id,
        })),
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

  const pendingReviewCreated = tool(
    PENDING_REVIEW_CREATED,
    'Tell Rally the id of the pending review you just created in a SUBMIT turn, so Rally can clean it up if the turn is interrupted.',
    { review_id: z.number().int() },
    async (args) => {
      handlers.onPendingReview(args.review_id)
      return ok('Rally recorded the pending review.')
    },
  )

  return createSdkMcpServer({ name: RALLY_SERVER, version: '1.0.0', tools: [publishDrafts, pendingReviewCreated, reviewSubmitted] })
}
