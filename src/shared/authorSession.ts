import type { AuthorSession, FeedbackItem, ItemResponse, PostedReply, SessionCore } from './types'

/** Where a fix reply names its commit; Rally replaces it with the short sha once it commits. */
export const COMMIT_PLACEHOLDER = '{commit}'

export const shortSha = (oid: string) => oid.slice(0, 7)

/** Returns a new author session with nothing cloned, answered, or queued yet. */
export function newAuthorSession(core: SessionCore): AuthorSession {
  return {
    ...core,
    clone: null,
    items: [],
    responses: {},
    posted: {},
    selfReview: null,
    commits: [],
    uncommitted: [],
    lastPush: null,
    mergeConflicts: [],
    reviewersToReRequest: [],
    lastReRequest: null,
  }
}

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

type WorkState = Pick<AuthorSession, 'commits' | 'uncommitted' | 'responses' | 'posted' | 'items'>

/** Returns whether the session holds work GitHub doesn't have yet: uncommitted edits, unpushed commits, or unposted replies. */
export function hasUnsharedWork(session: WorkState): boolean {
  return session.uncommitted.length > 0 || session.commits.length > 0 || pendingReplies(session).length > 0
}

/** Returns whether the session has a running turn, an error, uncommitted edits, unpushed commits, or unposted replies. */
export function hasPendingWork(session: WorkState & Pick<AuthorSession, 'status'>): boolean {
  return session.status !== 'awaiting_feedback' || hasUnsharedWork(session)
}

/** Returns the uncommitted files the author can commit, or none while a merge is open and git also lists the files it staged. */
export function committableFiles(session: Pick<AuthorSession, 'uncommitted' | 'mergeConflicts'>): string[] {
  return session.mergeConflicts.length > 0 ? [] : session.uncommitted
}

/** Returns how many committable files and unpushed commits the clone holds that GitHub doesn't. */
export function cloneChangeCount(session: Pick<AuthorSession, 'commits' | 'uncommitted' | 'mergeConflicts'>): number {
  return session.commits.length + committableFiles(session).length
}

/** Returns whether the clone has commits to push and no merge open; uncommitted files stay behind. */
export function canPush(session: Pick<AuthorSession, 'commits' | 'mergeConflicts'>): boolean {
  return session.commits.length > 0 && session.mergeConflicts.length === 0
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
