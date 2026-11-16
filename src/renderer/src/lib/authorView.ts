import { canReplyTo, pendingReplies } from '@shared/authorSession'
import type { AuthorSession, FeedbackItem, ItemResponse, PostedReply, ReplyPost, SessionStatus } from '@shared/types'

export interface FeedbackRow {
  item: FeedbackItem
  response: ItemResponse | null
  posted: PostedReply | null
  closedOnGithub: boolean
}

type SessionView = Pick<AuthorSession, 'items' | 'responses' | 'posted' | 'selfReview'>

/** Returns the open items from GitHub, then items closed on GitHub that still have an unposted reply, then self-review findings. */
export function feedbackRows(open: FeedbackItem[], session: SessionView | null): FeedbackRow[] {
  const row = (item: FeedbackItem, closedOnGithub: boolean): FeedbackRow => ({
    item,
    response: session?.responses[item.id] ?? null,
    posted: session?.posted[item.id] ?? null,
    closedOnGithub,
  })
  if (!session) return open.map((item) => row(item, false))
  const openIds = new Set(open.map((item) => item.id))
  const pendingIds = new Set(pendingReplies(session).map((r) => r.itemId))
  const closed = session.items.filter((item) => !openIds.has(item.id) && pendingIds.has(item.id))
  return [...open.map((item) => row(item, false)), ...closed.map((item) => row(item, true)), ...(session.selfReview?.findings ?? []).map((item) => row(item, false))]
}

/** Returns the replies Post replies sends: every pending reply on a thread or review, with the user's edits and resolve choices. */
export function replyPosts(session: AuthorSession, edits: Record<string, string>, resolve: Record<string, boolean>): ReplyPost[] {
  const items = new Map(session.items.map((item) => [item.id, item]))
  return pendingReplies(session)
    .filter((response) => {
      const item = items.get(response.itemId)
      return item !== undefined && canReplyTo(item)
    })
    .map((response) => ({
      itemId: response.itemId,
      body: edits[response.itemId] ?? response.reply,
      resolve: resolve[response.itemId] ?? false,
    }))
    .filter((post) => post.body.trim())
}

export const AUTHOR_TABS = ['feedback', 'activity', 'changes', 'report'] as const

export type AuthorTab = (typeof AUTHOR_TABS)[number]

export const AUTHOR_TAB_LABELS: Record<AuthorTab, string> = {
  feedback: 'Comments',
  activity: 'Activity',
  changes: 'Changes',
  report: 'Self-review',
}

export const AUTHOR_STATUS_LABELS: Record<SessionStatus, string> = {
  running: 'Claude is working…',
  submitting: 'Pushing or posting…',
  awaiting_feedback: 'Ready',
  submitted: 'Done',
  error: 'Error',
  cancelled: 'Cancelled',
}
