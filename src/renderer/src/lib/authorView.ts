import { actionableItems, canReplyTo, isFindingId, isReplyPending, pendingReplies } from '@shared/authorSession'
import type { ActionRequest, AuthorSession, FeedbackItem, ItemResponse, PostedReply, ReplyPost, ResponseAction, SessionStatus } from '@shared/types'

export interface ActionPick {
  action: ResponseAction
  note: string
}

export interface FeedbackRow {
  item: FeedbackItem
  response: ItemResponse | null
  posted: PostedReply | null
  closedOnGithub: boolean
}

export const NO_CHANGES_MESSAGE = 'Nothing to commit or push. Pick Fix on a comment, or message Claude, to change the code.'

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
  const closed = session.items.filter((item) => canReplyTo(item) && !openIds.has(item.id) && pendingIds.has(item.id))
  return [...open.map((item) => row(item, false)), ...closed.map((item) => row(item, true)), ...(session.selfReview?.findings ?? []).map((item) => row(item, false))]
}

/** Returns the picked actions Run sends, skipping picks on items that are closed on GitHub or no longer listed. */
export function actionRequests(picks: Record<string, ActionPick>, open: FeedbackItem[], session: SessionView | null): ActionRequest[] {
  const actionable = new Set(actionableItems(open, session).map((item) => item.id))
  return Object.entries(picks)
    .filter(([itemId]) => actionable.has(itemId))
    .map(([itemId, pick]) => ({ itemId, action: pick.action, note: pick.note }))
}

/** Returns the picks without those on self-review findings. */
export function withoutFindingPicks<T>(picks: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(picks).filter(([itemId]) => !isFindingId(itemId)))
}

export interface SplitRows {
  open: FeedbackRow[]
  waiting: FeedbackRow[]
}

/** Separates threads that wait on the reviewer, because my reply or reaction is last and no new reply is pending, from the rest. */
export function splitWaitingRows(rows: FeedbackRow[]): SplitRows {
  const isWaiting = (row: FeedbackRow) => row.item.answered && !(row.response && isReplyPending(row.response, row.posted))
  return { open: rows.filter((row) => !isWaiting(row)), waiting: rows.filter(isWaiting) }
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
