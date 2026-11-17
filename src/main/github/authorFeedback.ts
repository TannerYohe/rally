import type { FeedbackComment, FeedbackItem, FeedbackItemKind, PrRef } from '@shared/types'
import {
  isBot,
  pendingConversation,
  threadAcknowledged,
  type RawActor,
  type RawConversationComment,
  type RawReviewBody,
  type RawThreadTail,
} from './acknowledgment'
import { github, timeoutRequest } from './client'

const REACTIONS = 'reactionGroups { viewerHasReacted }'
const AUTHOR = 'author { __typename login avatarUrl(size: 40) }'

const FEEDBACK_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String, $first: Boolean!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id isResolved isOutdated path line originalLine
            comments(first: 50) { nodes { id databaseId url body createdAt ${AUTHOR} ${REACTIONS} } }
          }
        }
        comments(last: 100) @include(if: $first) { nodes { id url body createdAt isMinimized ${AUTHOR} ${REACTIONS} } }
        reviews(last: 100) @include(if: $first) { nodes { id url body state submittedAt ${AUTHOR} ${REACTIONS} } }
      }
    }
  }
`

type WithAvatar<T> = Omit<T, 'author'> & { id: string; author: (RawActor & { avatarUrl: string }) | null }

type RawThreadComment = WithAvatar<RawThreadTail & { url: string; body: string; createdAt: string }> & { databaseId: number | null }

export interface RawFeedbackThread {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  originalLine: number | null
  comments: { nodes: RawThreadComment[] }
}

export type RawFeedbackComment = WithAvatar<RawConversationComment>

export type RawFeedbackReview = WithAvatar<RawReviewBody>

interface FeedbackResponse {
  repository: {
    pullRequest: {
      reviewThreads: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawFeedbackThread[] }
      comments?: { nodes: RawFeedbackComment[] }
      reviews?: { nodes: RawFeedbackReview[] }
    }
  }
}

type RawCommentLike = { url: string; body: string; author: (RawActor & { avatarUrl: string }) | null }

function feedbackComment(comment: RawCommentLike, createdAt: string): FeedbackComment {
  return { author: comment.author?.login ?? null, avatarUrl: comment.author?.avatarUrl ?? null, body: comment.body, createdAt, url: comment.url }
}

function threadItem(thread: RawFeedbackThread, viewer: string): FeedbackItem | null {
  const [first] = thread.comments.nodes
  const last = thread.comments.nodes.at(-1)
  if (!first || !last) return null
  return {
    id: thread.id,
    kind: 'thread',
    author: first.author?.login ?? null,
    authorIsBot: isBot(first.author),
    avatarUrl: first.author?.avatarUrl ?? null,
    path: thread.path,
    line: thread.line ?? thread.originalLine,
    url: first.url,
    severity: null,
    outdated: thread.isOutdated,
    answered: threadAcknowledged(last, viewer),
    comments: thread.comments.nodes.map((c) => feedbackComment(c, c.createdAt)),
    replyToCommentId: first.databaseId,
    reactionSubjectId: last.id,
  }
}

function conversationItem(kind: FeedbackItemKind, node: RawCommentLike & { id: string }, createdAt: string): FeedbackItem {
  return {
    id: node.id,
    kind,
    author: node.author?.login ?? null,
    authorIsBot: isBot(node.author),
    avatarUrl: node.author?.avatarUrl ?? null,
    path: null,
    line: null,
    url: node.url,
    severity: null,
    outdated: false,
    answered: false,
    comments: [feedbackComment(node, createdAt)],
    replyToCommentId: null,
    reactionSubjectId: node.id,
  }
}

const lastActivity = (item: FeedbackItem) => item.comments.at(-1)?.createdAt ?? ''

/** Returns open threads plus unacknowledged PR comments and review bodies, unanswered first, then newest activity first. */
export function feedbackItems(threads: RawFeedbackThread[], comments: RawFeedbackComment[], reviews: RawFeedbackReview[], viewer: string): FeedbackItem[] {
  const pending = pendingConversation(comments, reviews, viewer)
  const items = [
    ...threads.filter((t) => !t.isResolved).flatMap((t) => threadItem(t, viewer) ?? []),
    ...pending.comments.map((c) => conversationItem('comment', c, c.createdAt)),
    ...pending.reviews.map((r) => conversationItem('review', r, r.submittedAt ?? '')),
  ]
  return items.sort((a, b) => Number(a.answered) - Number(b.answered) || lastActivity(b).localeCompare(lastActivity(a)))
}

export async function fetchFeedbackItems(pr: PrRef): Promise<FeedbackItem[]> {
  const gh = await github()
  const threads: RawFeedbackThread[] = []
  let comments: RawFeedbackComment[] = []
  let reviews: RawFeedbackReview[] = []
  let cursor: string | null = null
  do {
    const response: FeedbackResponse = await gh.graphql<FeedbackResponse>(FEEDBACK_QUERY, {
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      cursor,
      first: cursor === null,
      request: timeoutRequest(),
    })
    const pull = response.repository.pullRequest
    threads.push(...pull.reviewThreads.nodes)
    if (cursor === null) {
      comments = pull.comments?.nodes ?? []
      reviews = pull.reviews?.nodes ?? []
    }
    cursor = pull.reviewThreads.pageInfo.hasNextPage ? pull.reviewThreads.pageInfo.endCursor : null
  } while (cursor)
  return feedbackItems(threads, comments, reviews, gh.login)
}

const ADD_REACTION_MUTATION = `
  mutation($subjectId: ID!) {
    addReaction(input: { subjectId: $subjectId, content: THUMBS_UP }) { reaction { content } }
  }
`

/** Adds my 👍 to the comment an open feedback item on my PR ends with, which marks it acknowledged. */
export async function acknowledgeFeedbackItem(pr: PrRef, itemId: string): Promise<void> {
  const item = (await fetchFeedbackItems(pr)).find((i) => i.id === itemId)
  if (!item?.reactionSubjectId) throw new Error('This comment is no longer open on GitHub. Refresh and try again.')
  const gh = await github()
  await gh.graphql(ADD_REACTION_MUTATION, { subjectId: item.reactionSubjectId, request: timeoutRequest() })
}
