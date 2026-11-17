import type { FeedbackComment, FeedbackItem, FeedbackItemKind, PrRef } from '@shared/types'
import { isBot, pendingConversation, threadAcknowledged } from './acknowledgment'
import { github, timeoutRequest } from './client'
import {
  prCommentsField,
  reviewSummariesField,
  THREAD_COMMENTS_FIELD,
  threadsField,
  type RawAuthor,
  type RawComment,
  type RawConnection,
  type RawPrComment,
  type RawReviewSummary,
  type RawThread,
} from './feedbackFields'

const PAGE_LIMIT = 20

const pullRequestQuery = (fields: string) => `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) { pullRequest(number: $number) { ${fields} } }
  }
`

const THREADS = threadsField('first: 50, after: $cursor', '', THREAD_COMMENTS_FIELD)
const PR_COMMENTS = prCommentsField('last: 100, before: $cursor')
const REVIEWS = reviewSummariesField('last: 100, before: $cursor')

interface FeedbackPage {
  reviewThreads: RawConnection<RawThread>
  comments: RawConnection<RawPrComment>
  reviews: RawConnection<RawReviewSummary>
}

interface PageResponse<K extends keyof FeedbackPage> {
  repository: { pullRequest: Pick<FeedbackPage, K> }
}

function feedbackComment(comment: { url: string; body: string; author: RawAuthor | null }, createdAt: string): FeedbackComment {
  return { author: comment.author?.login ?? null, avatarUrl: comment.author?.avatarUrl ?? null, body: comment.body, createdAt, url: comment.url }
}

/** Returns the thread's opening comments plus its newest comment when that falls past the first page. */
function threadComments(thread: RawThread): RawComment[] {
  const opening = thread.comments?.nodes ?? []
  const [newest] = thread.latest.nodes
  return newest && !opening.some((c) => c.id === newest.id) ? [...opening, newest] : opening
}

function threadItem(thread: RawThread, viewer: string): FeedbackItem | null {
  const comments = threadComments(thread)
  const [first] = comments
  const [newest] = thread.latest.nodes
  if (!first || !newest) return null
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
    answered: threadAcknowledged(newest, viewer),
    comments: comments.map((c) => feedbackComment(c, c.createdAt)),
    replyToCommentId: first.databaseId,
    reactionSubjectId: newest.id,
  }
}

function conversationItem(kind: FeedbackItemKind, node: { id: string; url: string; body: string; author: RawAuthor | null }, createdAt: string): FeedbackItem {
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
export function feedbackItems(threads: RawThread[], comments: RawPrComment[], reviews: RawReviewSummary[], viewer: string): FeedbackItem[] {
  const pending = pendingConversation(comments, reviews, viewer)
  const items = [
    ...threads.filter((t) => !t.isResolved).flatMap((t) => threadItem(t, viewer) ?? []),
    ...pending.comments.map((c) => conversationItem('comment', c, c.createdAt)),
    ...pending.reviews.map((r) => conversationItem('review', r, r.submittedAt ?? '')),
  ]
  return items.sort((a, b) => Number(a.answered) - Number(b.answered) || lastActivity(b).localeCompare(lastActivity(a)))
}

const pullVariables = (pr: PrRef) => ({ owner: pr.owner, repo: pr.repo, number: pr.number })

const afterCursor = (c: RawConnection<unknown>) => (c.pageInfo.hasNextPage ? (c.pageInfo.endCursor ?? null) : null)
const beforeCursor = (c: RawConnection<unknown>) => (c.pageInfo.hasPreviousPage ? (c.pageInfo.startCursor ?? null) : null)

/** Follows a connection's cursor from its first page until no pages remain, up to PAGE_LIMIT pages. */
async function allNodes<T>(
  first: RawConnection<T>,
  nextCursor: (page: RawConnection<T>) => string | null,
  fetchPage: (cursor: string) => Promise<RawConnection<T>>,
): Promise<T[]> {
  const nodes = [...first.nodes]
  let cursor = nextCursor(first)
  for (let page = 1; cursor && page < PAGE_LIMIT; page++) {
    const connection = await fetchPage(cursor)
    nodes.push(...connection.nodes)
    cursor = nextCursor(connection)
  }
  return nodes
}

/** Returns every open thread and unacknowledged PR comment and review body, paging through each. */
export async function fetchFeedbackItems(pr: PrRef): Promise<FeedbackItem[]> {
  const gh = await github()
  const page = async <K extends keyof FeedbackPage>(key: K, fields: string, cursor: string | null) => {
    const response = await gh.graphql<PageResponse<K>>(pullRequestQuery(fields), { ...pullVariables(pr), cursor, request: timeoutRequest() })
    return response.repository.pullRequest
  }
  const first = await page<keyof FeedbackPage>('reviewThreads', `${THREADS} ${PR_COMMENTS} ${REVIEWS}`, null)
  const [threads, comments, reviews] = await Promise.all([
    allNodes(first.reviewThreads, afterCursor, async (cursor) => (await page('reviewThreads', THREADS, cursor)).reviewThreads),
    allNodes(first.comments, beforeCursor, async (cursor) => (await page('comments', PR_COMMENTS, cursor)).comments),
    allNodes(first.reviews, beforeCursor, async (cursor) => (await page('reviews', REVIEWS, cursor)).reviews),
  ])
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
