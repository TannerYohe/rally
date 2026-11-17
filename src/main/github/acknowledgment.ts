import { sameLogin } from './threads'

export interface RawReactionGroup {
  viewerHasReacted: boolean
}

export interface RawActor {
  login: string
  __typename?: string
}

export interface RawThreadTail {
  author: RawActor | null
  reactionGroups?: RawReactionGroup[] | null
}

export interface RawConversationComment {
  url: string
  body: string
  createdAt: string
  isMinimized?: boolean
  author: RawActor | null
  reactionGroups?: RawReactionGroup[] | null
}

export interface RawReviewBody {
  url: string
  body: string
  state: string
  submittedAt: string | null
  author: RawActor | null
  reactionGroups?: RawReactionGroup[] | null
}

export const isViewer = (author: RawActor | null, viewer: string) => Boolean(author && sameLogin(author.login, viewer))

export const isBot = (author: RawActor | null) => author?.__typename === 'Bot'

const viewerReacted = (groups: RawReactionGroup[] | null | undefined) => groups?.some((g) => g.viewerHasReacted) ?? false

/** Returns whether a thread waits on the reviewer: its latest comment is mine or carries my reaction. */
export function threadAcknowledged(last: RawThreadTail | undefined, viewer: string): boolean {
  return Boolean(last && (isViewer(last.author, viewer) || viewerReacted(last.reactionGroups)))
}

function anchorOf(url: string): string | null {
  return URL.parse(url)?.hash.slice(1) || null
}

/** Returns whether I reacted to a comment or a comment of mine links to it. */
function conversationAcknowledged(target: { url: string; reactionGroups?: RawReactionGroup[] | null }, mine: RawConversationComment[]): boolean {
  if (viewerReacted(target.reactionGroups)) return true
  const anchor = anchorOf(target.url)
  return mine.some((comment) => comment.body.includes(target.url) || (anchor !== null && comment.body.includes(anchor)))
}

function needsAcknowledgment(item: { body: string; author: RawActor | null }, viewer: string): boolean {
  return Boolean(item.body.trim()) && !isViewer(item.author, viewer) && !isBot(item.author)
}

export interface PendingConversation<C extends RawConversationComment, R extends RawReviewBody> {
  comments: C[]
  reviews: R[]
}

/** Returns the PR comments and review bodies from people, not bots, that I haven't acknowledged. */
export function pendingConversation<C extends RawConversationComment, R extends RawReviewBody>(
  comments: C[],
  reviews: R[],
  viewer: string,
): PendingConversation<C, R> {
  const mine = comments.filter((c) => isViewer(c.author, viewer))
  return {
    comments: comments.filter((c) => !c.isMinimized && needsAcknowledgment(c, viewer) && !conversationAcknowledged(c, mine)),
    reviews: reviews.filter((r) => r.state !== 'PENDING' && needsAcknowledgment(r, viewer) && !conversationAcknowledged(r, mine)),
  }
}
