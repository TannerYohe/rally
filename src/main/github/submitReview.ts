import { GraphqlResponseError } from '@octokit/graphql'
import { foldIntoBody, type FinalReview } from '@shared/feedback'
import { errorMessage } from '@shared/errors'
import type { DraftComment, PrRef, ReviewEvent, SubmittedReview } from '@shared/types'
import { github, GITHUB_TIMEOUT_MS } from './client'
import { sameLogin } from './threads'

type GithubClient = Awaited<ReturnType<typeof github>>

export interface ListedReview {
  id: number
  user: { login: string } | null
  state: string
  submitted_at?: string | null
  html_url: string
}

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id comments(first: 100) { nodes { databaseId } } }
        }
      }
    }
  }
`

interface ReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: { id: string; comments: { nodes: { databaseId: number | null }[] } }[]
      }
    }
  }
}

const ADD_THREAD_MUTATION = `
  mutation($review: ID!, $path: String!, $line: Int!, $side: DiffSide!, $startLine: Int, $startSide: DiffSide, $body: String!) {
    addPullRequestReviewThread(input: {
      pullRequestReviewId: $review, path: $path, line: $line, side: $side, startLine: $startLine, startSide: $startSide, body: $body
    }) { thread { id } }
  }
`

const THREAD_REPLY_MUTATION = `
  mutation($review: ID!, $thread: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: { pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body }) { comment { id } }
  }
`

const timeout = () => ({ signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) })

function submittedEvent(state: string): ReviewEvent | null {
  switch (state) {
    case 'COMMENTED':
      return 'COMMENT'
    case 'APPROVED':
      return 'APPROVE'
    case 'CHANGES_REQUESTED':
      return 'REQUEST_CHANGES'
    default:
      return null
  }
}

export function reviewSubmittedSince(reviews: ListedReview[], viewer: string, since: string): SubmittedReview | null {
  const ownSubmitted = reviews.filter((r) => r.user && sameLogin(r.user.login, viewer) && r.submitted_at && r.submitted_at >= since)
  for (const review of ownSubmitted.reverse()) {
    const event = submittedEvent(review.state)
    if (event) return { reviewId: review.id, url: review.html_url, event }
  }
  return null
}

async function step<T>(pr: PrRef, name: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    console.error('Submitting review failed', { pr: pr.url, step: name, error })
    throw new Error(`Submitting the review failed while ${name}: ${errorMessage(error)}`)
  }
}

const pullParams = (pr: PrRef) => ({ owner: pr.owner, repo: pr.repo, pull_number: pr.number })

async function listReviews(gh: GithubClient, pr: PrRef): Promise<ListedReview[]> {
  return gh.rest.paginate(gh.rest.pulls.listReviews, { ...pullParams(pr), per_page: 100, request: timeout() })
}

async function deletePendingReview(gh: GithubClient, pr: PrRef, reviewId: number): Promise<void> {
  await gh.rest.pulls.deletePendingReview({ ...pullParams(pr), review_id: reviewId, request: timeout() })
}

async function addInlineComment(gh: GithubClient, reviewNodeId: string, comment: DraftComment): Promise<void> {
  await gh.graphql(ADD_THREAD_MUTATION, {
    review: reviewNodeId,
    path: comment.path,
    line: comment.line,
    side: comment.side,
    startLine: comment.startLine,
    startSide: comment.startLine === null ? null : comment.side,
    body: comment.body,
    request: timeout(),
  })
}

async function addInlineComments(gh: GithubClient, pr: PrRef, reviewNodeId: string, comments: DraftComment[]): Promise<DraftComment[]> {
  const rejected: DraftComment[] = []
  for (const comment of comments) {
    try {
      await addInlineComment(gh, reviewNodeId, comment)
    } catch (error) {
      if (!(error instanceof GraphqlResponseError)) throw error
      console.warn('GitHub rejected an inline comment, folding it into the review body', {
        pr: pr.url,
        draftId: comment.id,
        path: comment.path,
        line: comment.line,
        error: errorMessage(error),
      })
      rejected.push(comment)
    }
  }
  return rejected
}

async function threadIdsByCommentId(gh: GithubClient, pr: PrRef): Promise<Map<number, string>> {
  const threads = new Map<number, string>()
  let cursor: string | null = null
  do {
    const response: ReviewThreadsResponse = await gh.graphql<ReviewThreadsResponse>(REVIEW_THREADS_QUERY, {
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      cursor,
      request: timeout(),
    })
    const { nodes, pageInfo } = response.repository.pullRequest.reviewThreads
    for (const thread of nodes) {
      for (const comment of thread.comments.nodes) if (comment.databaseId !== null) threads.set(comment.databaseId, thread.id)
    }
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null
  } while (cursor)
  return threads
}

async function addReplies(gh: GithubClient, pr: PrRef, reviewNodeId: string, replies: DraftComment[]): Promise<void> {
  if (replies.length === 0) return
  const threads = await threadIdsByCommentId(gh, pr)
  for (const reply of replies) {
    const thread = reply.replyToCommentId === null ? undefined : threads.get(reply.replyToCommentId)
    if (!thread) throw new Error(`draft #${reply.id} replies to a comment that is not in a review thread on this PR`)
    await gh.graphql(THREAD_REPLY_MUTATION, { review: reviewNodeId, thread, body: reply.body, request: timeout() })
  }
}

export interface SubmitOptions {
  earlierAttemptAt: string | null
}

export async function submitReview(pr: PrRef, event: ReviewEvent, review: FinalReview, options: SubmitOptions): Promise<SubmittedReview> {
  const gh = await github()
  const reviews = await step(pr, 'listing your reviews', () => listReviews(gh, pr))
  if (options.earlierAttemptAt) {
    const earlier = reviewSubmittedSince(reviews, gh.login, options.earlierAttemptAt)
    if (earlier) return earlier
  }
  const pending = reviews.filter((r) => r.state === 'PENDING' && r.user && sameLogin(r.user.login, gh.login))
  await step(pr, 'deleting your pending review', async () => {
    for (const r of pending) await deletePendingReview(gh, pr, r.id)
  })
  const { data: pull } = await step(pr, 'reading the PR head', () => gh.rest.pulls.get({ ...pullParams(pr), request: timeout() }))
  const body = foldIntoBody(review.body, review.folded)
  const { data: created } = await step(pr, 'creating the pending review', () =>
    gh.rest.pulls.createReview({ ...pullParams(pr), commit_id: pull.head.sha, body, request: timeout() }),
  )
  try {
    const rejected = await step(pr, 'adding inline comments', () => addInlineComments(gh, pr, created.node_id, review.inline))
    await step(pr, 'adding thread replies', () => addReplies(gh, pr, created.node_id, review.replies))
    if (rejected.length > 0) {
      await step(pr, 'updating the review body', () =>
        gh.rest.pulls.updateReview({ ...pullParams(pr), review_id: created.id, body: foldIntoBody(body, rejected), request: timeout() }),
      )
    }
    const { data: submitted } = await step(pr, 'submitting the review', () =>
      gh.rest.pulls.submitReview({ ...pullParams(pr), review_id: created.id, event, request: timeout() }),
    )
    return { reviewId: submitted.id, url: submitted.html_url, event }
  } catch (error) {
    await deletePendingReview(gh, pr, created.id).catch((deleteError) => {
      console.error('Deleting the pending review after a failed submit failed', { pr: pr.url, reviewId: created.id, error: deleteError })
    })
    throw error
  }
}
