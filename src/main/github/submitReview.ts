import { GraphqlResponseError } from '@octokit/graphql'
import { foldIntoBody, type FinalReview } from '@shared/feedback'
import { errorMessage } from '@shared/errors'
import type { DraftComment, PrRef, ReviewEvent, SubmittedReview } from '@shared/types'
import { github, timeoutRequest, type GithubClient } from './client'
import { fetchReviewComments } from './reviewComments'
import { sameLogin } from './threads'

export interface ListedReview {
  id: number
  user: { login: string } | null
  state: string
  submitted_at?: string | null
  html_url: string
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

export function submittedAttempt(reviews: ListedReview[], attemptReviewId: number): SubmittedReview | null {
  const review = reviews.find((r) => r.id === attemptReviewId)
  const event = review ? submittedEvent(review.state) : null
  return review && event ? { reviewId: review.id, url: review.html_url, event } : null
}

export function isValidationError(error: unknown): boolean {
  if (!(error instanceof GraphqlResponseError)) return false
  const errors = error.errors ?? []
  return errors.length > 0 && errors.every((e) => e.type === 'UNPROCESSABLE')
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
  return gh.rest.paginate(gh.rest.pulls.listReviews, { ...pullParams(pr), per_page: 100, request: timeoutRequest() })
}

async function deletePendingReview(gh: GithubClient, pr: PrRef, reviewId: number): Promise<void> {
  await gh.rest.pulls.deletePendingReview({ ...pullParams(pr), review_id: reviewId, request: timeoutRequest() })
}

interface AddThreadResponse {
  addPullRequestReviewThread: { thread: { id: string } | null } | null
}

interface AddReplyResponse {
  addPullRequestReviewThreadReply: { comment: { id: string } | null } | null
}

async function addInlineComment(gh: GithubClient, reviewNodeId: string, comment: DraftComment): Promise<boolean> {
  const response = await gh.graphql<AddThreadResponse>(ADD_THREAD_MUTATION, {
    review: reviewNodeId,
    path: comment.path,
    line: comment.line,
    side: comment.side,
    startLine: comment.startLine,
    startSide: comment.startLine === null ? null : comment.side,
    body: comment.body,
    request: timeoutRequest(),
  })
  return Boolean(response.addPullRequestReviewThread?.thread)
}

async function addPlaced(add: () => Promise<boolean>): Promise<string | null> {
  try {
    return (await add()) ? null : 'GitHub returned no comment'
  } catch (error) {
    if (!isValidationError(error)) throw error
    return errorMessage(error)
  }
}

async function addOrFold(pr: PrRef, comments: DraftComment[], add: (comment: DraftComment) => Promise<boolean>): Promise<DraftComment[]> {
  const rejected: DraftComment[] = []
  for (const comment of comments) {
    const rejection = await addPlaced(() => add(comment))
    if (rejection === null) continue
    console.warn('GitHub did not place a review comment, folding it into the review body', {
      pr: pr.url,
      draftId: comment.id,
      kind: comment.kind,
      path: comment.path,
      line: comment.line,
      replyToCommentId: comment.replyToCommentId,
      error: rejection,
    })
    rejected.push(comment)
  }
  return rejected
}

async function addReplies(gh: GithubClient, pr: PrRef, reviewNodeId: string, replies: DraftComment[]): Promise<DraftComment[]> {
  if (replies.length === 0) return []
  const reviewComments = await fetchReviewComments(gh, pr)
  const orphans = replies.filter((reply) => reply.replyToCommentId === null || !reviewComments.has(reply.replyToCommentId))
  if (orphans.length > 0) {
    console.warn('Folding thread replies whose comment is not in a review thread', { pr: pr.url, draftIds: orphans.map((r) => r.id) })
  }
  const threaded = replies.filter((reply) => !orphans.includes(reply))
  const rejected = await addOrFold(pr, threaded, async (reply) => {
    const thread = reviewComments.get(reply.replyToCommentId as number)?.threadId
    const response = await gh.graphql<AddReplyResponse>(THREAD_REPLY_MUTATION, { review: reviewNodeId, thread, body: reply.body, request: timeoutRequest() })
    return Boolean(response.addPullRequestReviewThreadReply?.comment)
  })
  return [...orphans, ...rejected]
}

export interface SubmitOptions {
  attemptReviewId: number | null
  onPendingReview(reviewId: number | null): void
}

export async function submitReview(pr: PrRef, event: ReviewEvent, review: FinalReview, options: SubmitOptions): Promise<SubmittedReview> {
  const gh = await github()
  const reviews = await step(pr, 'listing your reviews', () => listReviews(gh, pr))
  if (options.attemptReviewId !== null) {
    const earlier = submittedAttempt(reviews, options.attemptReviewId)
    if (earlier) return earlier
  }
  const pending = reviews.filter((r) => r.state === 'PENDING' && r.user && sameLogin(r.user.login, gh.login))
  await step(pr, 'deleting your pending review', async () => {
    for (const r of pending) await deletePendingReview(gh, pr, r.id)
  })
  const { data: pull } = await step(pr, 'reading the PR head', () => gh.rest.pulls.get({ ...pullParams(pr), request: timeoutRequest() }))
  const body = foldIntoBody(review.body, review.folded, pr.url)
  const { data: created } = await step(pr, 'creating the pending review', () =>
    gh.rest.pulls.createReview({ ...pullParams(pr), commit_id: pull.head.sha, body, request: timeoutRequest() }),
  )
  options.onPendingReview(created.id)
  try {
    const rejectedInline = await step(pr, 'adding inline comments', () =>
      addOrFold(pr, review.inline, (comment) => addInlineComment(gh, created.node_id, comment)),
    )
    const rejectedReplies = await step(pr, 'adding thread replies', () => addReplies(gh, pr, created.node_id, review.replies))
    const rejected = [...rejectedInline, ...rejectedReplies]
    if (rejected.length > 0) {
      await step(pr, 'updating the review body', () =>
        gh.rest.pulls.updateReview({ ...pullParams(pr), review_id: created.id, body: foldIntoBody(body, rejected, pr.url), request: timeoutRequest() }),
      )
    }
    const { data: submitted } = await step(pr, 'submitting the review', () =>
      gh.rest.pulls.submitReview({ ...pullParams(pr), review_id: created.id, event, request: timeoutRequest() }),
    )
    const unplaced = [...review.folded.filter((c) => c.kind === 'reply'), ...rejected]
    const foldedDraftIds = unplaced.map((c) => c.id)
    return { reviewId: submitted.id, url: submitted.html_url, event, foldedDraftIds }
  } catch (error) {
    try {
      await deletePendingReview(gh, pr, created.id)
      options.onPendingReview(null)
    } catch (deleteError) {
      console.error('Deleting the pending review after a failed submit failed', { pr: pr.url, reviewId: created.id, error: deleteError })
    }
    throw error
  }
}
