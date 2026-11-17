import type { AuthorSession, FeedbackItem, ItemResponse, PostedReply } from './types'

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

/** Returns the turn message asking Claude to rebase its commits after the branch moved on GitHub. */
export function rebaseMessage(branch: string): string {
  return (
    `The branch moved on GitHub after you committed, so Rally couldn't push. In the clone, fetch origin, rebase your commits onto origin/${branch}, ` +
    'resolve any conflicts, and rerun the checks you ran before. Then call publish_responses again for every item you fixed, with the new commit shas and replies that name them.'
  )
}
