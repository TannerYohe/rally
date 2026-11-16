import type { FeedbackComment, FeedbackItem, PrRef } from '@shared/types'
import { github, timeoutRequest } from './client'
import { sameLogin } from './threads'

const FEEDBACK_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id isResolved isOutdated path line originalLine
            comments(first: 50) { nodes { databaseId url body createdAt author { login avatarUrl(size: 40) } } }
          }
        }
        latestOpinionatedReviews(first: 50, writersOnly: true) {
          nodes { id url body state submittedAt author { login avatarUrl(size: 40) } }
        }
      }
    }
  }
`

interface RawAuthor {
  login: string
  avatarUrl: string
}

interface RawThreadComment {
  databaseId: number | null
  url: string
  body: string
  createdAt: string
  author: RawAuthor | null
}

export interface RawFeedbackThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  originalLine: number | null
  comments: { nodes: RawThreadComment[] }
}

export interface RawOpinionatedReview {
  id: string
  url: string
  body: string
  state: string
  submittedAt: string | null
  author: RawAuthor | null
}

interface FeedbackResponse {
  repository: {
    pullRequest: {
      reviewThreads: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawFeedbackThread[] }
      latestOpinionatedReviews: { nodes: RawOpinionatedReview[] }
    }
  }
}

function feedbackComment(comment: Pick<RawThreadComment, 'author' | 'body' | 'url'>, createdAt: string): FeedbackComment {
  return { author: comment.author?.login ?? null, avatarUrl: comment.author?.avatarUrl ?? null, body: comment.body, createdAt, url: comment.url }
}

const isMine = (author: RawAuthor | null, viewer: string) => Boolean(author && sameLogin(author.login, viewer))

function threadItem(thread: RawFeedbackThread, viewer: string): FeedbackItem | null {
  const [first] = thread.comments.nodes
  if (!first) return null
  return {
    id: thread.id,
    kind: 'thread',
    author: first.author?.login ?? null,
    avatarUrl: first.author?.avatarUrl ?? null,
    path: thread.path,
    line: thread.line ?? thread.originalLine,
    url: first.url,
    severity: null,
    outdated: thread.isOutdated,
    answered: isMine(thread.comments.nodes.at(-1)!.author, viewer),
    comments: thread.comments.nodes.map((c) => feedbackComment(c, c.createdAt)),
    replyToCommentId: first.databaseId,
  }
}

function reviewItem(review: RawOpinionatedReview): FeedbackItem {
  return {
    id: review.id,
    kind: 'review',
    author: review.author?.login ?? null,
    avatarUrl: review.author?.avatarUrl ?? null,
    path: null,
    line: null,
    url: review.url,
    severity: null,
    outdated: false,
    answered: false,
    comments: [feedbackComment(review, review.submittedAt ?? '')],
    replyToCommentId: null,
  }
}

const lastActivity = (item: FeedbackItem) => item.comments.at(-1)?.createdAt ?? ''

/** Returns the open threads on the PR and the bodies of change requests that still stand, unanswered first, then newest activity first. */
export function feedbackItems(threads: RawFeedbackThread[], reviews: RawOpinionatedReview[], viewer: string): FeedbackItem[] {
  const threadItems = threads.filter((t) => !t.isResolved).flatMap((t) => threadItem(t, viewer) ?? [])
  const reviewItems = reviews
    .filter((r) => r.state === 'CHANGES_REQUESTED' && r.body.trim() && !isMine(r.author, viewer))
    .map(reviewItem)
  return [...threadItems, ...reviewItems].sort(
    (a, b) => Number(a.answered) - Number(b.answered) || lastActivity(b).localeCompare(lastActivity(a)),
  )
}

export async function fetchFeedbackItems(pr: PrRef): Promise<FeedbackItem[]> {
  const gh = await github()
  const threads: RawFeedbackThread[] = []
  let reviews: RawOpinionatedReview[] = []
  let cursor: string | null = null
  do {
    const response: FeedbackResponse = await gh.graphql<FeedbackResponse>(FEEDBACK_QUERY, {
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      cursor,
      request: timeoutRequest(),
    })
    const { reviewThreads, latestOpinionatedReviews } = response.repository.pullRequest
    threads.push(...reviewThreads.nodes)
    if (!cursor) reviews = latestOpinionatedReviews.nodes
    cursor = reviewThreads.pageInfo.hasNextPage ? reviewThreads.pageInfo.endCursor : null
  } while (cursor)
  return feedbackItems(threads, reviews, gh.login)
}
