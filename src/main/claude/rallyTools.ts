import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { parsePrRef } from '@shared/linkedPrs'
import { CONCERN_STATUSES, isSamePr, keyOf, type Drafts, type PrRef } from '@shared/types'
import { unitDraftProblems } from '@shared/unitDrafts'

export interface RallyToolHandlers {
  onDrafts(drafts: Drafts): void
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
  pr: z.string().optional().describe('In a review of several PRs: the PR this comment is on, as owner/repo#N. Omit for a single PR.'),
})

const PUBLISH_DRAFTS = 'publish_drafts'

export const RALLY_SERVER = 'rally'
export const RALLY_TOOL_PREFIX = `mcp__${RALLY_SERVER}__`
export const PUBLISH_DRAFTS_TOOL = `${RALLY_TOOL_PREFIX}${PUBLISH_DRAFTS}`

export const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] })

const publishDraftsShape = {
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
        pr: z.string().optional().describe('In a review of several PRs: the PR the earlier comment is on, as owner/repo#N. Omit for a single PR.'),
      }),
    )
    .default([])
    .describe('Follow-up mode ledger of my earlier comments and their verdicts'),
  pr_reviews: z
    .array(
      z.object({
        pr: z.string().describe('The PR, as owner/repo#N'),
        verdict: z.string().describe('Looks good / Minor changes / Needs changes / Blocking issues, for this PR'),
        summary_body: z.string().describe("This PR's top-level review body, or empty string for none"),
      }),
    )
    .optional()
    .describe('In a review of several PRs: one entry per PR. Rally posts a separate review to each PR. Omit for a single PR.'),
}

export type PublishDraftsArgs = Parameters<Parameters<typeof tool<typeof publishDraftsShape>>[3]>[0]

/** Returns the member key a PR reference names, or the reference itself when it names no member. */
function memberKeyOf(ref: string | undefined, members: PrRef[]): string | undefined {
  const text = ref?.trim()
  if (!text) return undefined
  const coords = parsePrRef(text)
  const member = coords && members.find((m) => isSamePr(m, coords))
  return member ? keyOf(member) : text
}

/** Converts published drafts to Rally's shape, tagging each comment, concern, and verdict with its member PR in a review of several PRs. */
export function toDrafts(args: PublishDraftsArgs, members: PrRef[]): Drafts {
  const unit = members.length > 1
  const prKeyOf = (ref: string | undefined) => (unit ? { prKey: memberKeyOf(ref, members) } : {})
  return {
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
      ...prKeyOf(c.pr),
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
      ...prKeyOf(c.pr),
    })),
    ...(unit && {
      prReviews: (args.pr_reviews ?? []).map((r) => ({
        prKey: memberKeyOf(r.pr, members) ?? r.pr,
        verdict: r.verdict,
        summaryBody: r.summary_body,
      })),
    }),
  }
}

export interface PublishDraftsOptions {
  /** Every PR the review covers; drafts for several PRs must tag each comment with its PR. */
  members: PrRef[]
}

export function publishDraftsTool(handlers: RallyToolHandlers, options: PublishDraftsOptions = { members: [] }) {
  return tool(
    PUBLISH_DRAFTS,
    'Publish the current review report and the complete set of draft comments to the Rally app. Call every time you present or revise drafts, always with the full set.',
    publishDraftsShape,
    async (args) => {
      const drafts = toDrafts(args, options.members)
      if (options.members.length > 1) {
        const problems = unitDraftProblems(drafts, options.members.map(keyOf))
        if (problems.length > 0) {
          return {
            content: [{ type: 'text' as const, text: `Rally did not accept these drafts. Fix the following and publish the full set again:\n${problems.map((p) => `- ${p}`).join('\n')}` }],
            isError: true,
          }
        }
      }
      handlers.onDrafts(drafts)
      return ok(`Rally received ${args.comments.length} draft comments.`)
    },
  )
}

export function createRallyServer(handlers: RallyToolHandlers, options?: PublishDraftsOptions) {
  return createSdkMcpServer({ name: RALLY_SERVER, version: '1.0.0', tools: [publishDraftsTool(handlers, options)] })
}
