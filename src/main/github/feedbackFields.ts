import { isViewer } from './acknowledgment'

/** Selects each reviewer's latest approval or change request on a PR, with an optional directive such as `@include(if: $authored)`. */
export const decisionsField = (directive = '') =>
  `latestOpinionatedReviews(first: 100, writersOnly: true) ${directive} { nodes { state author { login } } }`

export interface RawDecision {
  state: string
  author: { login: string } | null
}

export type DecisionState = 'APPROVED' | 'CHANGES_REQUESTED'

/** Returns the reviewers other than me whose latest decision has the given state. */
export function reviewersWithDecision(decisions: RawDecision[], state: DecisionState, viewer: string): string[] {
  return decisions.flatMap((d) => (d.state === state && d.author && !isViewer(d.author, viewer) ? [d.author.login] : []))
}

const ACTOR = 'author { __typename login avatarUrl(size: 40) }'
const REACTIONS = 'reactionGroups { viewerHasReacted }'
const COMMENT = `id databaseId url body createdAt ${ACTOR} ${REACTIONS}`

export interface RawPageInfo {
  hasNextPage?: boolean
  endCursor?: string | null
  hasPreviousPage?: boolean
  startCursor?: string | null
}

export interface RawConnection<T> {
  pageInfo: RawPageInfo
  nodes: T[]
}

export interface RawAuthor {
  __typename?: string
  login: string
  avatarUrl?: string
}

export interface RawComment {
  id: string
  databaseId: number | null
  url: string
  body: string
  createdAt: string
  author: RawAuthor | null
  reactionGroups: { viewerHasReacted: boolean }[] | null
}

export interface RawThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  originalLine: number | null
  latest: { nodes: RawComment[] }
  comments?: { totalCount: number; nodes: RawComment[] }
}

export type RawPrComment = RawComment & { isMinimized: boolean }

export interface RawReviewSummary {
  id: string
  url: string
  body: string
  state: string
  submittedAt: string | null
  author: RawAuthor | null
  reactionGroups: { viewerHasReacted: boolean }[] | null
}

/** Selects review threads with each one's newest comment, which decides whether it is acknowledged; `extra` adds fields per thread. */
export const threadsField = (args: string, directive = '', extra = '') =>
  `reviewThreads(${args}) ${directive} {
    pageInfo { hasNextPage endCursor }
    nodes { id isResolved isOutdated path line originalLine latest: comments(last: 1) { nodes { ${COMMENT} } } ${extra} }
  }`

/** Selects the opening comments of a thread, for display and for the comment a reply answers. */
export const THREAD_COMMENTS_FIELD = `comments(first: 50) { totalCount nodes { ${COMMENT} } }`

/** Selects PR conversation comments, newest page first. */
export const prCommentsField = (args: string, directive = '') =>
  `comments(${args}) ${directive} { pageInfo { hasPreviousPage startCursor } nodes { isMinimized ${COMMENT} } }`

/** Selects submitted review bodies, newest page first. */
export const reviewSummariesField = (args: string, directive = '', alias = 'reviews') =>
  `${alias}: reviews(${args}) ${directive} {
    pageInfo { hasPreviousPage startCursor }
    nodes { id url body state submittedAt ${ACTOR} ${REACTIONS} }
  }`
