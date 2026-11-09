import { GraphqlResponseError } from '@octokit/graphql'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FinalReview } from '@shared/feedback'
import type { DraftComment, PrRef } from '@shared/types'
import type { ListedReview } from './submitReview'

const mocks = vi.hoisted(() => ({
  graphql: vi.fn(),
  paginate: vi.fn(),
  get: vi.fn(),
  createReview: vi.fn(),
  updateReview: vi.fn(),
  submitReview: vi.fn(),
  deletePendingReview: vi.fn(),
}))

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  github: async () => ({
    login: 'me',
    graphql: mocks.graphql,
    rest: {
      paginate: mocks.paginate,
      pulls: {
        listReviews: 'listReviews',
        get: mocks.get,
        createReview: mocks.createReview,
        updateReview: mocks.updateReview,
        submitReview: mocks.submitReview,
        deletePendingReview: mocks.deletePendingReview,
      },
    },
  }),
}))

const { reviewSubmittedSince, submitReview } = await import('./submitReview')

const pr: PrRef = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }
const params = { owner: 'acme', repo: 'api', pull_number: 12 }

const comment = (overrides: Partial<DraftComment>): DraftComment => ({
  id: '1',
  kind: 'inline',
  path: 'a.rb',
  line: 10,
  startLine: null,
  side: 'RIGHT',
  severity: 'medium',
  body: 'Inline note.',
  replyToCommentId: null,
  ...overrides,
})

const review = (overrides: Partial<FinalReview> = {}): FinalReview => ({ body: 'Summary.', inline: [], replies: [], folded: [], ...overrides })

const listed = (overrides: Partial<ListedReview>): ListedReview => ({
  id: 1,
  user: { login: 'me' },
  state: 'COMMENTED',
  submitted_at: '2026-11-09T10:00:00Z',
  html_url: 'https://github.com/acme/api/pull/12#pullrequestreview-1',
  ...overrides,
})

const threadsPage = (threads: { id: string; commentIds: number[] }[]) => ({
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: threads.map((t) => ({ id: t.id, comments: { nodes: t.commentIds.map((databaseId) => ({ databaseId })) } })),
      },
    },
  },
})

const rejection = () =>
  new GraphqlResponseError({ method: 'POST', url: '/graphql' }, {}, { data: undefined, errors: [{ type: 'UNPROCESSABLE', message: 'Line could not be resolved' }] } as never)

const mutationCalls = (name: string) => mocks.graphql.mock.calls.filter(([query]) => (query as string).includes(name))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.paginate.mockResolvedValue([])
  mocks.get.mockResolvedValue({ data: { head: { sha: 'abc123' } } })
  mocks.createReview.mockResolvedValue({ data: { id: 77, node_id: 'PRR_77' } })
  mocks.submitReview.mockResolvedValue({ data: { id: 77, html_url: 'https://github.com/acme/api/pull/12#pullrequestreview-77' } })
  mocks.graphql.mockResolvedValue({})
})

describe('submitReview', () => {
  it('creates a pending review on the head, adds comments and replies, then submits it', async () => {
    mocks.graphql.mockImplementation(async (query: string) => (query.includes('reviewThreads') ? threadsPage([{ id: 'PRRT_9', commentIds: [500, 501] }]) : {}))
    const inline = comment({ startLine: 8 })
    const reply = comment({ id: '2', kind: 'reply', path: null, line: null, body: 'Thanks.', replyToCommentId: 501 })

    const result = await submitReview(pr, 'APPROVE', review({ inline: [inline], replies: [reply] }), { earlierAttemptAt: null })

    expect(result).toEqual({ reviewId: 77, url: 'https://github.com/acme/api/pull/12#pullrequestreview-77', event: 'APPROVE' })
    expect(mocks.createReview).toHaveBeenCalledWith(expect.objectContaining({ ...params, commit_id: 'abc123', body: 'Summary.' }))
    expect(mocks.createReview.mock.calls[0][0]).not.toHaveProperty('event')
    expect(mutationCalls('addPullRequestReviewThread(')[0][1]).toMatchObject({
      review: 'PRR_77',
      path: 'a.rb',
      line: 10,
      side: 'RIGHT',
      startLine: 8,
      startSide: 'RIGHT',
      body: 'Inline note.',
    })
    expect(mutationCalls('addPullRequestReviewThreadReply')[0][1]).toMatchObject({ review: 'PRR_77', thread: 'PRRT_9', body: 'Thanks.' })
    expect(mocks.updateReview).not.toHaveBeenCalled()
    expect(mocks.submitReview).toHaveBeenCalledWith(expect.objectContaining({ ...params, review_id: 77, event: 'APPROVE' }))
  })

  it('folds summary-only points into the body it creates the review with', async () => {
    await submitReview(pr, 'COMMENT', review({ folded: [comment({ path: null, line: null, body: 'General point.' })] }), { earlierAttemptAt: null })

    expect(mocks.createReview).toHaveBeenCalledWith(expect.objectContaining({ body: 'Summary.\n\nGeneral point.' }))
  })

  it('folds an inline comment GitHub rejects into the body and still submits', async () => {
    mocks.graphql.mockRejectedValueOnce(rejection())
    const outOfDiff = comment({ path: 'b.rb', line: 400, body: 'Out of diff.' })

    await submitReview(pr, 'COMMENT', review({ inline: [outOfDiff, comment({ id: '2' })] }), { earlierAttemptAt: null })

    expect(mutationCalls('addPullRequestReviewThread(')).toHaveLength(2)
    expect(mocks.updateReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 77, body: 'Summary.\n\n**`b.rb:400`**\n\nOut of diff.' }))
    expect(mocks.submitReview).toHaveBeenCalled()
  })

  it('fails without folding when the inline comment request itself fails', async () => {
    mocks.graphql.mockRejectedValueOnce(new Error('socket hang up'))

    await expect(submitReview(pr, 'COMMENT', review({ inline: [comment({})] }), { earlierAttemptAt: null })).rejects.toThrow(
      'Submitting the review failed while adding inline comments: socket hang up',
    )
    expect(mocks.deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 77 }))
    expect(mocks.submitReview).not.toHaveBeenCalled()
  })

  it('deletes your pending reviews before creating a new one', async () => {
    mocks.paginate.mockResolvedValue([
      listed({ id: 5, state: 'PENDING', submitted_at: null }),
      listed({ id: 6, state: 'PENDING', user: { login: 'teammate' }, submitted_at: null }),
      listed({ id: 7 }),
    ])

    await submitReview(pr, 'COMMENT', review(), { earlierAttemptAt: null })

    expect(mocks.deletePendingReview).toHaveBeenCalledTimes(1)
    expect(mocks.deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ ...params, review_id: 5 }))
    expect(mocks.deletePendingReview.mock.invocationCallOrder[0]).toBeLessThan(mocks.createReview.mock.invocationCallOrder[0])
  })

  it('reports a review submitted since an earlier attempt and posts nothing', async () => {
    mocks.paginate.mockResolvedValue([listed({ id: 3, state: 'APPROVED', submitted_at: '2026-11-09T10:05:00Z' })])

    const result = await submitReview(pr, 'COMMENT', review(), { earlierAttemptAt: '2026-11-09T10:04:00Z' })

    expect(result).toEqual({ reviewId: 3, url: listed({}).html_url, event: 'APPROVE' })
    expect(mocks.createReview).not.toHaveBeenCalled()
    expect(mocks.deletePendingReview).not.toHaveBeenCalled()
  })

  it('deletes the pending review and fails when a reply has no thread', async () => {
    mocks.graphql.mockResolvedValue(threadsPage([]))
    const reply = comment({ id: '4', kind: 'reply', path: null, line: null, replyToCommentId: 999 })

    await expect(submitReview(pr, 'COMMENT', review({ replies: [reply] }), { earlierAttemptAt: null })).rejects.toThrow(
      'draft #4 replies to a comment that is not in a review thread on this PR',
    )
    expect(mocks.deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 77 }))
    expect(mocks.submitReview).not.toHaveBeenCalled()
  })

  it('deletes the pending review when submitting fails', async () => {
    mocks.submitReview.mockRejectedValue(new Error('Validation Failed'))

    await expect(submitReview(pr, 'REQUEST_CHANGES', review(), { earlierAttemptAt: null })).rejects.toThrow('while submitting the review')
    expect(mocks.deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 77 }))
  })
})

describe('reviewSubmittedSince', () => {
  const since = '2026-11-09T10:00:00Z'

  it('picks your latest submitted review at or after the time', () => {
    const reviews = [listed({ id: 1, submitted_at: since }), listed({ id: 2, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-09T10:01:00Z' })]
    expect(reviewSubmittedSince(reviews, 'Me', since)).toMatchObject({ reviewId: 2, event: 'REQUEST_CHANGES' })
  })

  it('ignores earlier, pending, dismissed, and other reviewers', () => {
    const reviews = [
      listed({ submitted_at: '2026-11-09T09:59:59Z' }),
      listed({ state: 'PENDING', submitted_at: null }),
      listed({ state: 'DISMISSED' }),
      listed({ user: { login: 'teammate' } }),
    ]
    expect(reviewSubmittedSince(reviews, 'me', since)).toBeNull()
  })
})
