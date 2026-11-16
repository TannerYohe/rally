import type { AuthorSession, FeedbackItem, ItemResponse } from './types'

export const PUSH_BEFORE_POSTING_ERROR = 'Push your commits before posting replies, so the replies point at code reviewers can see.'

/** Returns the responses whose reply draft hasn't been posted since Claude last wrote it. */
export function pendingReplies(session: Pick<AuthorSession, 'responses' | 'posted'>): ItemResponse[] {
  return Object.values(session.responses).filter((response) => {
    if (!response.reply.trim()) return false
    const posted = session.posted[response.itemId]
    return !posted || posted.error !== null || posted.at < response.at
  })
}

/** Returns whether the session has a running turn, an error, unpushed commits, or unposted replies. */
export function hasPendingWork(session: Pick<AuthorSession, 'status' | 'commits' | 'responses' | 'posted'>): boolean {
  return session.status !== 'awaiting_feedback' || session.commits.length > 0 || pendingReplies(session).length > 0
}

export function canReplyTo(item: Pick<FeedbackItem, 'kind'>): boolean {
  return item.kind !== 'finding'
}

export function itemLocation(item: Pick<FeedbackItem, 'path' | 'line' | 'kind'>): string {
  if (item.path) return item.line === null ? item.path : `${item.path}:${item.line}`
  return item.kind === 'review' ? 'Review comment' : 'General'
}

/** Returns the turn message asking Claude to rebase its commits after the branch moved on GitHub. */
export function rebaseMessage(branch: string): string {
  return (
    `The branch moved on GitHub after you committed, so Rally couldn't push. In the clone, fetch origin, rebase your commits onto origin/${branch}, ` +
    'resolve any conflicts, and rerun the checks you ran before. Then call publish_responses again for every item you fixed, with the new commit shas and replies that name them.'
  )
}
