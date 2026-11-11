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
  onPendingReview: vi.fn(),
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

const { submittedAttempt, submitReview } = await import('./submitReview')

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

const reply = (overrides: Partial<DraftComment>): DraftComment =>
  comment({ kind: 'reply', path: null, line: null, body: 'Thanks.', replyToCommentId: 501, ...overrides })

const review = (overrides: Partial<FinalReview> = {}): FinalReview => ({ body: 'Summary.', inline: [], replies: [], folded: [], ...overrides })

const options = (attemptReviewId: number | null = null) => ({ attemptReviewId, onPendingReview: mocks.onPendingReview })

const listed = (overrides: Partial<ListedReview>): ListedReview => ({
  id: 1,
  user: { login: 'me' },
  state: 'COMMENTED',
  submitted_at: '2026-11-09T10:00:00Z',
  html_url: 'https://github.com/acme/api/pull/12#pullrequestreview-1',
  ...overrides,
})

interface ThreadsPage {
  threads: { id: string; commentIds: number[] }[]
  endCursor?: string
}

const threadComment = (databaseId: number) => ({ id: `PRRC_${databaseId}`, databaseId })

const threadsPage = ({ threads, endCursor }: ThreadsPage) => ({
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: Boolean(endCursor), endCursor: endCursor ?? null },
        nodes: threads.map((t) => ({ id: t.id, comments: { nodes: t.commentIds.map(threadComment) } })),
      },
    },
  },
})

function graphqlError(type: string, message: string) {
  return new GraphqlResponseError({ method: 'POST', url: '/graphql' }, {}, { data: undefined, errors: [{ type, message }] } as never)
}

const rejection = () => graphqlError('UNPROCESSABLE', 'Line could not be resolved')

function serveThreads(...pages: ThreadsPage[]) {
  const byCursor = new Map<string | null, ThreadsPage>(pages.map((page, i) => [i === 0 ? null : (pages[i - 1].endCursor ?? null), page]))
  mocks.graphql.mockImplementation(async (query: string, variables: { cursor?: string | null }) =>
    query.includes('reviewThreads') ? threadsPage(byCursor.get(variables.cursor ?? null)!) : placed(query),
  )
}

function placed(query: string) {
  if (query.includes('addPullRequestReviewThreadReply(')) return { addPullRequestReviewThreadReply: { comment: { id: 'PRRC_new' } } }
  if (query.includes('addPullRequestReviewThread(')) return { addPullRequestReviewThread: { thread: { id: 'PRRT_new' } } }
  return {}
}

const callsTo = (field: string) => mocks.graphql.mock.calls.filter(([query]) => (query as string).includes(`${field}(`))

function declaredVariables(query: string): string[] {
  const signature = query.match(/^\s*(?:query|mutation)\s*\(([^)]*)\)/)?.[1] ?? ''
  return [...signature.matchAll(/\$(\w+)\s*:/g)].map((m) => m[1])
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.paginate.mockResolvedValue([])
  mocks.get.mockResolvedValue({ data: { head: { sha: 'abc123' } } })
  mocks.createReview.mockResolvedValue({ data: { id: 77, node_id: 'PRR_77' } })
  mocks.submitReview.mockResolvedValue({ data: { id: 77, html_url: 'https://github.com/acme/api/pull/12#pullrequestreview-77' } })
  mocks.deletePendingReview.mockResolvedValue({})
  mocks.graphql.mockImplementation(async (query: string) => placed(query))
})

describe('submitReview', () => {
  it('creates a pending review on the head, adds comments and replies, then submits it', async () => {
    serveThreads({ threads: [{ id: 'PRRT_9', commentIds: [500, 501] }] })

    const result = await submitReview(pr, 'APPROVE', review({ inline: [comment({ startLine: 8 })], replies: [reply({ id: '2' })] }), options())

    expect(result).toEqual({ reviewId: 77, url: 'https://github.com/acme/api/pull/12#pullrequestreview-77', event: 'APPROVE', foldedDraftIds: [] })
    expect(mocks.createReview).toHaveBeenCalledWith(expect.objectContaining({ ...params, commit_id: 'abc123', body: 'Summary.' }))
    expect(mocks.createReview.mock.calls[0][0]).not.toHaveProperty('event')
    expect(mocks.onPendingReview).toHaveBeenCalledWith(77)
    expect(callsTo('addPullRequestReviewThread')[0][1]).toMatchObject({
      review: 'PRR_77',
      path: 'a.rb',
      line: 10,
      side: 'RIGHT',
      startLine: 8,
      startSide: 'RIGHT',
      body: 'Inline note.',
    })
    expect(callsTo('addPullRequestReviewThreadReply')[0][1]).toMatchObject({ review: 'PRR_77', thread: 'PRRT_9', body: 'Thanks.' })
    expect(mocks.updateReview).not.toHaveBeenCalled()
    expect(mocks.submitReview).toHaveBeenCalledWith(expect.objectContaining({ ...params, review_id: 77, event: 'APPROVE' }))
  })

  it('passes exactly the variables each graphql call declares', async () => {
    serveThreads({ threads: [], endCursor: 'c1' }, { threads: [{ id: 'PRRT_9', commentIds: [501] }] })

    await submitReview(pr, 'COMMENT', review({ inline: [comment({}), comment({ id: '2', startLine: 8 })], replies: [reply({ id: '3' })] }), options())

    expect(mocks.graphql).toHaveBeenCalledTimes(5)
    for (const [query, variables] of mocks.graphql.mock.calls as [string, Record<string, unknown>][]) {
      const passed = Object.keys(variables).filter((name) => name !== 'request')
      expect(passed.sort()).toEqual(declaredVariables(query).sort())
    }
  })

  it('pages through review threads to find a reply target on a later page', async () => {
    serveThreads({ threads: [{ id: 'PRRT_1', commentIds: [100] }], endCursor: 'c1' }, { threads: [{ id: 'PRRT_2', commentIds: [501] }] })

    await submitReview(pr, 'COMMENT', review({ replies: [reply({})] }), options())

    expect(callsTo('reviewThreads').map(([, variables]) => (variables as { cursor: string | null }).cursor)).toEqual([null, 'c1'])
    expect(callsTo('addPullRequestReviewThreadReply')[0][1]).toMatchObject({ thread: 'PRRT_2' })
  })

  it('folds summary-only points and replies with no target into the body, reporting only the replies', async () => {
    const folded = [comment({ id: '5', path: null, line: null, body: 'General point.' }), reply({ id: '6', replyToCommentId: null, body: 'Orphan.' })]

    const result = await submitReview(pr, 'COMMENT', review({ folded }), options())

    expect(mocks.createReview).toHaveBeenCalledWith(expect.objectContaining({ body: 'Summary.\n\nGeneral point.\n\nOrphan.' }))
    expect(result.foldedDraftIds).toEqual(['6'])
  })

  it('folds a comment or reply GitHub accepts without returning it', async () => {
    mocks.graphql.mockImplementation(async (query: string) => {
      if (query.includes('reviewThreads')) return threadsPage({ threads: [{ id: 'PRRT_9', commentIds: [501] }] })
      if (query.includes('addPullRequestReviewThreadReply(')) return { addPullRequestReviewThreadReply: { comment: null } }
      if (query.includes('addPullRequestReviewThread(')) return { addPullRequestReviewThread: { thread: null } }
      return {}
    })

    const result = await submitReview(pr, 'COMMENT', review({ inline: [comment({ id: '1' })], replies: [reply({ id: '2' })] }), options())

    expect(result.foldedDraftIds).toEqual(['1', '2'])
    expect(mocks.updateReview).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('**`a.rb:10`**\n\nInline note.') }))
    expect(mocks.submitReview).toHaveBeenCalled()
  })

  it('folds an inline comment GitHub rejects as invalid into the body and still submits', async () => {
    mocks.graphql.mockRejectedValueOnce(rejection())
    const outOfDiff = comment({ id: '1', path: 'b.rb', line: 400, body: 'Out of diff.' })

    const result = await submitReview(pr, 'COMMENT', review({ inline: [outOfDiff, comment({ id: '2' })] }), options())

    expect(callsTo('addPullRequestReviewThread')).toHaveLength(2)
    expect(mocks.updateReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 77, body: 'Summary.\n\n**`b.rb:400`**\n\nOut of diff.' }))
    expect(mocks.submitReview).toHaveBeenCalled()
    expect(result.foldedDraftIds).toEqual(['1'])
  })

  it('fails instead of folding on a GraphQL error that is not a validation error', async () => {
    mocks.graphql.mockRejectedValueOnce(graphqlError('RATE_LIMITED', 'API rate limit exceeded'))

    await expect(submitReview(pr, 'COMMENT', review({ inline: [comment({}), comment({ id: '2' })] }), options())).rejects.toThrow(
      /while adding inline comments: [\s\S]*API rate limit exceeded/,
    )
    expect(callsTo('addPullRequestReviewThread')).toHaveLength(1)
    expect(mocks.deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 77 }))
    expect(mocks.submitReview).not.toHaveBeenCalled()
  })

  it('fails without folding when the inline comment request itself fails', async () => {
    mocks.graphql.mockRejectedValueOnce(new Error('socket hang up'))

    await expect(submitReview(pr, 'COMMENT', review({ inline: [comment({})] }), options())).rejects.toThrow(
      'Submitting the review failed while adding inline comments: socket hang up',
    )
    expect(mocks.deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 77 }))
    expect(mocks.onPendingReview).toHaveBeenLastCalledWith(null)
  })

  it('folds a reply whose comment is not in a review thread, and one GitHub rejects', async () => {
    mocks.graphql.mockImplementation(async (query: string) => {
      if (query.includes('reviewThreads')) return threadsPage({ threads: [{ id: 'PRRT_9', commentIds: [501] }] })
      if (query.includes('addPullRequestReviewThreadReply(')) throw rejection()
      return placed(query)
    })

    const result = await submitReview(pr, 'COMMENT', review({ replies: [reply({ id: '4', replyToCommentId: 999 }), reply({ id: '5' })] }), options())

    expect(callsTo('addPullRequestReviewThreadReply')).toHaveLength(1)
    expect(mocks.updateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        body:
          'Summary.\n\n**Reply to [this comment](https://github.com/acme/api/pull/12#discussion_r999)**\n\nThanks.' +
          '\n\n**Reply to [this comment](https://github.com/acme/api/pull/12#discussion_r501)**\n\nThanks.',
      }),
    )
    expect(result.foldedDraftIds).toEqual(['4', '5'])
  })

  it('deletes your pending reviews before creating a new one', async () => {
    mocks.paginate.mockResolvedValue([
      listed({ id: 5, state: 'PENDING', submitted_at: null }),
      listed({ id: 6, state: 'PENDING', user: { login: 'teammate' }, submitted_at: null }),
      listed({ id: 7 }),
    ])

    await submitReview(pr, 'COMMENT', review(), options())

    expect(mocks.deletePendingReview).toHaveBeenCalledTimes(1)
    expect(mocks.deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ ...params, review_id: 5 }))
    expect(mocks.deletePendingReview.mock.invocationCallOrder[0]).toBeLessThan(mocks.createReview.mock.invocationCallOrder[0])
  })

  it('reports the earlier attempt and posts nothing when that review was submitted', async () => {
    mocks.paginate.mockResolvedValue([listed({ id: 3, state: 'APPROVED' })])

    const result = await submitReview(pr, 'COMMENT', review(), options(3))

    expect(result).toEqual({ reviewId: 3, url: listed({}).html_url, event: 'APPROVE' })
    expect(mocks.createReview).not.toHaveBeenCalled()
    expect(mocks.deletePendingReview).not.toHaveBeenCalled()
  })

  it('posts again when the earlier attempt is still pending, ignoring other reviews you submitted since', async () => {
    mocks.paginate.mockResolvedValue([listed({ id: 3, state: 'PENDING', submitted_at: null }), listed({ id: 4, submitted_at: '2026-11-09T11:00:00Z' })])

    const result = await submitReview(pr, 'COMMENT', review(), options(3))

    expect(mocks.deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 3 }))
    expect(mocks.createReview).toHaveBeenCalled()
    expect(result.reviewId).toBe(77)
  })

  it('deletes the pending review when submitting fails', async () => {
    mocks.submitReview.mockRejectedValue(new Error('Validation Failed'))

    await expect(submitReview(pr, 'REQUEST_CHANGES', review(), options())).rejects.toThrow('while submitting the review')
    expect(mocks.deletePendingReview).toHaveBeenCalledWith(expect.objectContaining({ review_id: 77 }))
    expect(mocks.onPendingReview).toHaveBeenLastCalledWith(null)
  })

  it('surfaces the original error and keeps the attempt id when the cleanup delete fails', async () => {
    mocks.submitReview.mockRejectedValue(new Error('timeout'))
    mocks.deletePendingReview.mockRejectedValue(new Error('Can not delete a submitted review'))

    await expect(submitReview(pr, 'COMMENT', review(), options())).rejects.toThrow('while submitting the review: timeout')
    expect(mocks.onPendingReview.mock.calls).toEqual([[77]])
  })

  it('runs no cleanup when creating the pending review fails', async () => {
    mocks.createReview.mockRejectedValue(new Error('Unprocessable Entity'))

    await expect(submitReview(pr, 'COMMENT', review(), options())).rejects.toThrow('while creating the pending review')
    expect(mocks.deletePendingReview).not.toHaveBeenCalled()
    expect(mocks.onPendingReview).not.toHaveBeenCalled()
  })
})

describe('submittedAttempt', () => {
  it('returns the attempt review once it is submitted', () => {
    expect(submittedAttempt([listed({ id: 2, state: 'CHANGES_REQUESTED' })], 2)).toMatchObject({ reviewId: 2, event: 'REQUEST_CHANGES' })
  })

  it('ignores the attempt while pending or dismissed, and every other review', () => {
    expect(submittedAttempt([listed({ id: 2, state: 'PENDING' })], 2)).toBeNull()
    expect(submittedAttempt([listed({ id: 2, state: 'DISMISSED' })], 2)).toBeNull()
    expect(submittedAttempt([listed({ id: 3 })], 2)).toBeNull()
  })
})
