import { beforeEach, describe, expect, it, vi } from 'vitest'

const graphql = vi.hoisted(() => vi.fn())
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  github: async () => ({ graphql, login: 'me' }),
}))

const { fetchPr, isReplyOnly, searchPrs } = await import('./queries')

const reply = { replyTo: { id: 'c1' } }
const inline = { replyTo: null }

describe('isReplyOnly', () => {
  it('is true for an empty-body Comment review made only of thread replies', () => {
    expect(isReplyOnly({ state: 'COMMENTED', body: '' }, [reply])).toBe(true)
  })

  it('is false for an inline-only Comment review, which also has an empty body', () => {
    expect(isReplyOnly({ state: 'COMMENTED', body: '' }, [inline, inline])).toBe(false)
    expect(isReplyOnly({ state: 'COMMENTED', body: '' }, [reply, inline])).toBe(false)
  })

  it('is false for reviews with a body, other states, or no comments', () => {
    expect(isReplyOnly({ state: 'COMMENTED', body: 'Looks good' }, [reply])).toBe(false)
    expect(isReplyOnly({ state: 'APPROVED', body: '' }, [reply])).toBe(false)
    expect(isReplyOnly({ state: 'COMMENTED', body: '  ' }, [])).toBe(false)
  })
})

function rawPr(reviews: unknown[], pageInfo = { hasPreviousPage: false, startCursor: null as string | null }, number = 12) {
  return {
    id: `PR_${number}`, number, url: `https://github.com/acme/api/pull/${number}`, title: 't', body: '', createdAt: '', updatedAt: '',
    isDraft: false, additions: 1, deletions: 0, changedFiles: 1, headRefOid: 'head', baseRefName: 'main', headRefName: 'f',
    author: { login: 'author', avatarUrl: '' },
    repository: { name: 'api', owner: { login: 'acme' } },
    files: { nodes: [] },
    reviewRequests: { nodes: [] },
    reviews: { pageInfo, nodes: reviews },
    timelineItems: { nodes: [] },
  }
}

function replyReview(n: number) {
  return { id: `PRR_reply_${n}`, databaseId: 1000 + n, state: 'COMMENTED', submittedAt: `2026-11-05T00:00:${String(n).padStart(2, '0')}Z`, body: '', commit: { oid: 'head' } }
}

function realReview(overrides: Partial<ReturnType<typeof replyReview>> = {}) {
  return { id: 'PRR_real', databaseId: 7, state: 'COMMENTED', submittedAt: '2026-11-04T00:00:00Z', body: 'nits', commit: { oid: 'old' }, ...overrides }
}

function commentsFor(reviews: { id: string }[]) {
  return { nodes: reviews.map((r) => ({ id: r.id, comments: { nodes: [reply] } })) }
}

function olderPage<T extends { id: string; body: string }>(reviews: T[], startCursor: string, hasPreviousPage = true) {
  const nodes = reviews.map((r) => ({ ...r, comments: { nodes: r.body ? [] : [reply] } }))
  return { node: { reviews: { pageInfo: { hasPreviousPage, startCursor }, nodes } } }
}

describe('fetchPr', () => {
  beforeEach(() => graphql.mockReset())

  it('carries each review database id and reply-only flag into myReviews', async () => {
    const raw = rawPr([
      realReview({ id: 'PRR_1', databaseId: 101, state: 'APPROVED', body: 'ok' }),
      { ...replyReview(0), id: 'PRR_2', databaseId: 5787412470, submittedAt: '2026-11-05T15:24:38Z' },
    ])
    graphql.mockResolvedValueOnce({ repository: { pullRequest: raw } })
    graphql.mockResolvedValueOnce({ nodes: [{ id: 'PRR_2', comments: { nodes: [reply] } }] })

    const pr = await fetchPr('acme', 'api', 12)

    expect(pr.myReviews).toEqual([
      { databaseId: 101, state: 'APPROVED', submittedAt: '2026-11-04T00:00:00Z', commitOid: 'old', replyOnly: false },
      { databaseId: 5787412470, state: 'COMMENTED', submittedAt: '2026-11-05T15:24:38Z', commitOid: 'head', replyOnly: true },
    ])
    expect(graphql.mock.calls[0][0]).toMatch(/reviews\(author: \$viewer[^)]*\) \{ pageInfo \{ hasPreviousPage startCursor \} nodes \{ id databaseId /)
  })

  it('pages back past a window of thread replies to my last real review', async () => {
    const newest = Array.from({ length: 20 }, (_, i) => replyReview(i + 20))
    const olderReplies = Array.from({ length: 5 }, (_, i) => replyReview(i + 10))
    const real = realReview()
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr(newest, { hasPreviousPage: true, startCursor: 'c20' }) } })
    graphql.mockResolvedValueOnce(commentsFor(newest))
    graphql.mockResolvedValueOnce(olderPage([real, ...olderReplies], 'c0'))

    const pr = await fetchPr('acme', 'api', 12)

    expect(graphql.mock.calls[2][1]).toMatchObject({ id: 'PR_12', viewer: 'me', before: 'c20' })
    expect(graphql.mock.calls[2][0]).toMatch(/reviews\(author: \$viewer, last: 20, before: \$before\)/)
    expect(graphql.mock.calls[2][0]).toMatch(/comments\(first: 20\)/)
    expect(graphql.mock.calls[2][1].request.signal).toBeInstanceOf(AbortSignal)
    expect(graphql).toHaveBeenCalledTimes(3)
    expect(pr.myReviews).toHaveLength(26)
    expect(pr.myReviews[0]).toEqual({ databaseId: 7, state: 'COMMENTED', submittedAt: '2026-11-04T00:00:00Z', commitOid: 'old', replyOnly: false })
    expect(pr.myReviews.slice(1).every((r) => r.replyOnly)).toBe(true)
  })

  it('pages back through two pages of replies to my last real review', async () => {
    const newest = Array.from({ length: 20 }, (_, i) => replyReview(i + 40))
    const middle = Array.from({ length: 20 }, (_, i) => replyReview(i + 20))
    const real = realReview({ state: 'APPROVED', body: '' })
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr(newest, { hasPreviousPage: true, startCursor: 'c40' }) } })
    graphql.mockResolvedValueOnce(commentsFor(newest))
    graphql.mockResolvedValueOnce(olderPage(middle, 'c20'))
    graphql.mockResolvedValueOnce(olderPage([real], 'c0'))

    const pr = await fetchPr('acme', 'api', 12)

    expect(graphql.mock.calls.slice(2).map((call) => call[1].before)).toEqual(['c40', 'c20'])
    expect(pr.myReviews).toHaveLength(41)
    expect(pr.myReviews[0]).toMatchObject({ databaseId: 7, state: 'APPROVED', replyOnly: false })
  })

  it('stops paging after 10 pages when every page is replies', async () => {
    const newest = [replyReview(0)]
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr(newest, { hasPreviousPage: true, startCursor: 'c0' }) } })
    graphql.mockResolvedValueOnce(commentsFor(newest))
    for (let page = 1; page <= 10; page++) graphql.mockResolvedValueOnce(olderPage([replyReview(page)], `c${page}`))

    const pr = await fetchPr('acme', 'api', 12)

    expect(graphql).toHaveBeenCalledTimes(2 + 9)
    expect(pr.myReviews).toHaveLength(10)
    expect(pr.myReviews.every((r) => r.replyOnly)).toBe(true)
  })

  it('keeps paging when the window holds only replies and reviews that do not count', async () => {
    const pending = { id: 'PRR_pending', databaseId: 8, state: 'PENDING', submittedAt: null, body: '', commit: { oid: 'head' } }
    const dismissed = { id: 'PRR_dismissed', databaseId: 9, state: 'DISMISSED', submittedAt: '2026-11-04T12:00:00Z', body: 'x', commit: { oid: 'old' } }
    const real = realReview()
    const replies = [replyReview(1), replyReview(2)]
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr([dismissed, ...replies, pending], { hasPreviousPage: true, startCursor: 'c1' }) } })
    graphql.mockResolvedValueOnce(commentsFor(replies))
    graphql.mockResolvedValueOnce(olderPage([real], 'c0', false))

    const pr = await fetchPr('acme', 'api', 12)

    expect(graphql.mock.calls[2][1]).toMatchObject({ before: 'c1' })
    expect(pr.myReviews.map((r) => r.databaseId)).toEqual([7, 9, 1001, 1002, 8])
  })

  it('stops paging without a warning when the newest page of replies is my whole history', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const newest = [replyReview(1), replyReview(2)]
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr(newest, { hasPreviousPage: false, startCursor: 'c1' }) } })
    graphql.mockResolvedValueOnce(commentsFor(newest))

    const pr = await fetchPr('acme', 'api', 12)

    expect(graphql).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()
    expect(pr.myReviews.map((r) => r.databaseId)).toEqual([1001, 1002])
    warn.mockRestore()
  })

  it('does not page back when the window holds a real review', async () => {
    const reviews = [realReview({ state: 'APPROVED', body: '' }), replyReview(1)]
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr(reviews, { hasPreviousPage: true, startCursor: 'c1' }) } })
    graphql.mockResolvedValueOnce(commentsFor([replyReview(1)]))

    const pr = await fetchPr('acme', 'api', 12)

    expect(graphql).toHaveBeenCalledTimes(2)
    expect(pr.myReviews).toHaveLength(2)
  })

  it('keeps the reviews fetched so far when an older page fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const newest = [replyReview(1), replyReview(2)]
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr(newest, { hasPreviousPage: true, startCursor: 'c1' }) } })
    graphql.mockResolvedValueOnce(commentsFor(newest))
    graphql.mockRejectedValueOnce(new Error('socket hang up'))

    const pr = await fetchPr('acme', 'api', 12)

    expect(pr.myReviews.map((r) => r.databaseId)).toEqual([1001, 1002])
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ pr: 'https://github.com/acme/api/pull/12' }))
    warn.mockRestore()
  })

  it('keeps the reviews fetched so far when the PR is gone on an older page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const newest = [replyReview(1)]
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr(newest, { hasPreviousPage: true, startCursor: 'c1' }) } })
    graphql.mockResolvedValueOnce(commentsFor(newest))
    graphql.mockResolvedValueOnce({ node: null })

    const pr = await fetchPr('acme', 'api', 12)

    expect(pr.myReviews.map((r) => r.databaseId)).toEqual([1001])
    expect(warn).toHaveBeenCalledWith(expect.any(String), { pr: 'https://github.com/acme/api/pull/12' })
    warn.mockRestore()
  })
})

describe('searchPrs', () => {
  beforeEach(() => graphql.mockReset())

  it('pages back only for the PR whose newest reviews are all replies', async () => {
    const replies = [replyReview(1), replyReview(2)]
    const real = realReview()
    const reviewed = rawPr([real], { hasPreviousPage: true, startCursor: 'r1' }, 12)
    const repliesOnly = rawPr(replies, { hasPreviousPage: true, startCursor: 'c1' }, 13)
    graphql.mockResolvedValueOnce({ search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [reviewed, repliesOnly] } })
    graphql.mockResolvedValueOnce(commentsFor(replies))
    graphql.mockResolvedValueOnce(olderPage([realReview({ id: 'PRR_old', databaseId: 6 })], 'c0', false))

    const { prs } = await searchPrs(['query'])

    expect(graphql).toHaveBeenCalledTimes(3)
    expect(graphql.mock.calls[2][1]).toMatchObject({ id: 'PR_13', before: 'c1' })
    expect(prs.map((pr) => pr.myReviews.map((r) => r.databaseId))).toEqual([[7], [6, 1001, 1002]])
  })
})
