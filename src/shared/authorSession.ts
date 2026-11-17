import type { AuthorSession, FeedbackItem, ItemResponse, PostedReply } from './types'

/** Where a fix reply names its commit; Rally replaces it with the short sha once it commits. */
export const COMMIT_PLACEHOLDER = '{commit}'

export const PUSH_BEFORE_POSTING_ERROR = 'Push your commits before posting replies, so the replies point at code reviewers can see.'

/** Returns whether a response has a reply that hasn't been posted since Claude last wrote it. */
export function isReplyPending(response: ItemResponse, posted: PostedReply | null | undefined): boolean {
  if (!response.reply.trim()) return false
  return !posted || posted.error !== null || posted.at < response.at
}

/** Returns the responses with an unposted reply on an item Rally can post to, leaving out self-review findings. */
export function pendingReplies(session: Pick<AuthorSession, 'responses' | 'posted' | 'items'>): ItemResponse[] {
  const replyable = new Set(session.items.filter(canReplyTo).map((item) => item.id))
  return Object.values(session.responses).filter(
    (response) => replyable.has(response.itemId) && isReplyPending(response, session.posted[response.itemId]),
  )
}

/** Returns whether the session has a running turn, an error, unpushed commits, or unposted replies. */
export function hasPendingWork(session: Pick<AuthorSession, 'status' | 'commits' | 'responses' | 'posted' | 'items'>): boolean {
  return session.status !== 'awaiting_feedback' || session.commits.length > 0 || pendingReplies(session).length > 0
}

export function canReplyTo(item: Pick<FeedbackItem, 'kind'>): boolean {
  return item.kind !== 'finding'
}

export function itemLocation(item: Pick<FeedbackItem, 'path' | 'line' | 'kind'>): string {
  if (item.path) return item.line === null ? item.path : `${item.path}:${item.line}`
  switch (item.kind) {
    case 'review':
      return 'Review summary'
    case 'comment':
      return 'PR comment'
    default:
      return 'General'
  }
}
