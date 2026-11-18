import { plural } from './format'
import type { AuthorSession, CheckoutKind, CloneInfo, FeedbackItem, ItemResponse, PostedReply, PrDescription, SessionCore } from './types'

/** Where a fix reply names its commit; Rally replaces it with the short sha once it commits. */
export const COMMIT_PLACEHOLDER = '{commit}'

export const shortSha = (oid: string) => oid.slice(0, 7)

/** Where Rally adds worktrees for PR branches. */
export const RALLY_WORKTREES_FOLDER = '~/rally-worktrees'

/** Returns the checkout kind of a clone, treating a clone without one as a temp clone. */
export const checkoutKind = (clone: CloneInfo): CheckoutKind => clone.kind ?? 'temp_clone'

/** Returns whether the checkout is a worktree of a local clone rather than Rally's temp clone. */
export const isWorktree = (clone: CloneInfo | null): boolean => !!clone && checkoutKind(clone) !== 'temp_clone'

/** Names the checkout in UI text: a worktree, or Rally's clone. */
export const checkoutNoun = (clone: CloneInfo | null): string => (isWorktree(clone) ? 'worktree' : 'clone')

const DISCARD_LISTED_FILES = 10

/** Returns the Discard confirmation; for a worktree it names the folder and the files, since Discard resets and cleans that whole worktree. */
export function discardQuestion(clone: CloneInfo | null, files: string[]): string {
  if (!isWorktree(clone)) return `Discard ${plural(files.length, 'uncommitted file')} in the clone?`
  const listed = files.slice(0, DISCARD_LISTED_FILES).map((file) => `  ${file}`)
  const more = files.length > DISCARD_LISTED_FILES ? [`  and ${files.length - DISCARD_LISTED_FILES} more`] : []
  return [`Discard ${plural(files.length, 'uncommitted file')} in the worktree at ${clone!.path}? Git can't bring them back.`, '', ...listed, ...more].join('\n')
}

/** Returns the Start over confirmation, naming what discarding the session deletes and what it keeps. */
export function startOverQuestion(clone: CloneInfo | null): string {
  if (!clone) return 'Discard this session, its unposted replies, and description update?'
  switch (checkoutKind(clone)) {
    case 'temp_clone':
      return 'Discard this session, its clone, unpushed commits, unposted replies, and description update?'
    case 'local_worktree':
      return `Discard this session, its unposted replies, and description update? Your worktree at ${clone.path} keeps its edits and commits.`
    case 'rally_worktree':
      return clone.createdBranch
        ? `Discard this session, its unposted replies and description update, and the worktree Rally added at ${clone.path} with its edits and unpushed commits?`
        : `Discard this session, its unposted replies and description update, and the worktree Rally added at ${clone.path} with its edits? Commits stay on ${clone.branch}.`
  }
}

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
    description: null,
    descriptionUpdatedAt: null,
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

type WorkState = Pick<AuthorSession, 'commits' | 'uncommitted' | 'responses' | 'posted' | 'items' | 'description'>

/** Returns whether the session holds work GitHub doesn't have yet: uncommitted edits, unpushed commits, unposted replies, or a description update. */
export function hasUnsharedWork(session: WorkState): boolean {
  return session.uncommitted.length > 0 || session.commits.length > 0 || pendingReplies(session).length > 0 || session.description !== null
}

/** Returns whether the session has a running turn, an error, or work GitHub doesn't have yet. */
export function hasPendingWork(session: WorkState & Pick<AuthorSession, 'status'>): boolean {
  return session.status !== 'awaiting_feedback' || hasUnsharedWork(session)
}

/** Returns the uncommitted files the author can commit, or none while a merge is open. */
export function committableFiles(session: Pick<AuthorSession, 'uncommitted' | 'mergeConflicts'>): string[] {
  return session.mergeConflicts.length > 0 ? [] : session.uncommitted
}

/** Returns how many committable files and unpushed commits the clone holds that GitHub doesn't. */
export function cloneChangeCount(session: Pick<AuthorSession, 'commits' | 'uncommitted' | 'mergeConflicts'>): number {
  return session.commits.length + committableFiles(session).length
}

/** Returns how many changes Push would send to GitHub or leaves behind: committable files, unpushed commits, and a description update. */
export function pendingChangeCount(session: Pick<AuthorSession, 'commits' | 'uncommitted' | 'mergeConflicts' | 'description'>): number {
  return cloneChangeCount(session) + (session.description ? 1 : 0)
}

/** Returns whether there are commits or a description update to push, and no merge open. */
export function canPush(session: Pick<AuthorSession, 'commits' | 'mergeConflicts' | 'description'>): boolean {
  return (session.commits.length > 0 || session.description !== null) && session.mergeConflicts.length === 0
}

/** Returns the description with line endings normalized and outer whitespace trimmed. */
export function normalizedDescription(description: PrDescription): PrDescription {
  return { title: description.title.trim(), body: description.body.replaceAll('\r\n', '\n').trim() }
}

export function sameDescription(a: PrDescription, b: PrDescription): boolean {
  const [left, right] = [normalizedDescription(a), normalizedDescription(b)]
  return left.title === right.title && left.body === right.body
}

/** Returns whether GitHub's title and description are exactly the ones a draft was proposed against. */
export function unchangedSince(current: PrDescription, base: PrDescription): boolean {
  return current.title === base.title && current.body === base.body
}

/** Returns the items Run can act on: those open on GitHub, then the session's self-review findings. */
export function actionableItems(open: FeedbackItem[], session: Pick<AuthorSession, 'selfReview'> | null): FeedbackItem[] {
  return [...open, ...(session?.selfReview?.findings ?? [])]
}

export function canReplyTo(item: Pick<FeedbackItem, 'kind'>): boolean {
  return item.kind !== 'finding'
}

/** Returns whether Claude finished an action on a self-review finding without a commit failure, so the author can resolve it. */
export function isFindingHandled(response: ItemResponse | null | undefined): boolean {
  return response !== null && response !== undefined && !response.pendingCommit && response.commitError === null
}

/** Returns the ids of the self-review findings Claude finished an action on. */
export function handledFindingIds(session: Pick<AuthorSession, 'selfReview' | 'responses'>): string[] {
  return (session.selfReview?.findings ?? []).filter((finding) => isFindingHandled(session.responses[finding.id])).map((finding) => finding.id)
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
