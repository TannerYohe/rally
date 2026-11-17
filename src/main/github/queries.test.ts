import { beforeEach, describe, expect, it, vi } from 'vitest'

const graphql = vi.hoisted(() => vi.fn())
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  github: async () => ({ graphql, login: 'me' }),
}))

const { fetchPr, isReplyOnly } = await import('./queries')

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

function rawPr(reviews: unknown[], pageInfo = { hasPreviousPage: false, startCursor: null as string | null }) {
  return {
    id: 'PR_1', number: 12, url: 'https://github.com/acme/api/pull/12', title: 't', body: '', createdAt: '', updatedAt: '',
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

function commentsFor(reviews: { id: string }[]) {
  return { nodes: reviews.map((r) => ({ id: r.id, comments: { nodes: [reply] } })) }
}

describe('fetchPr', () => {
  beforeEach(() => graphql.mockReset())

  it('carries each review database id and reply-only flag into myReviews', async () => {
    const replyReview = { id: 'PRR_2', databaseId: 5787412470, state: 'COMMENTED', submittedAt: '2026-11-05T15:24:38Z', body: '', commit: { oid: 'head' } }
    const raw = rawPr([
      { id: 'PRR_1', databaseId: 101, state: 'APPROVED', submittedAt: '2026-11-04T00:00:00Z', body: 'ok', commit: { oid: 'old' } },
      replyReview,
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
    const real = { id: 'PRR_real', databaseId: 7, state: 'COMMENTED', submittedAt: '2026-11-04T00:00:00Z', body: 'nits', commit: { oid: 'old' } }
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr(newest, { hasPreviousPage: true, startCursor: 'c20' }) } })
    graphql.mockResolvedValueOnce(commentsFor(newest))
    graphql.mockResolvedValueOnce({ node: { reviews: { pageInfo: { hasPreviousPage: true, startCursor: 'c0' }, nodes: [real, ...olderReplies] } } })
    graphql.mockResolvedValueOnce(commentsFor(olderReplies))

    const pr = await fetchPr('acme', 'api', 12)

    expect(graphql.mock.calls[2][1]).toMatchObject({ id: 'PR_1', viewer: 'me', before: 'c20' })
    expect(graphql).toHaveBeenCalledTimes(4)
    expect(pr.myReviews).toHaveLength(26)
    expect(pr.myReviews[0]).toEqual({ databaseId: 7, state: 'COMMENTED', submittedAt: '2026-11-04T00:00:00Z', commitOid: 'old', replyOnly: false })
    expect(pr.myReviews.slice(1).every((r) => r.replyOnly)).toBe(true)
  })

  it('keeps paging when the window holds only replies and reviews that do not count', async () => {
    const pending = { id: 'PRR_pending', databaseId: 8, state: 'PENDING', submittedAt: null, body: '', commit: { oid: 'head' } }
    const dismissed = { id: 'PRR_dismissed', databaseId: 9, state: 'DISMISSED', submittedAt: '2026-11-04T12:00:00Z', body: 'x', commit: { oid: 'old' } }
    const real = { id: 'PRR_real', databaseId: 7, state: 'COMMENTED', submittedAt: '2026-11-04T00:00:00Z', body: 'nits', commit: { oid: 'old' } }
    const replies = [replyReview(1), replyReview(2)]
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr([dismissed, ...replies, pending], { hasPreviousPage: true, startCursor: 'c1' }) } })
    graphql.mockResolvedValueOnce(commentsFor(replies))
    graphql.mockResolvedValueOnce({ node: { reviews: { pageInfo: { hasPreviousPage: false, startCursor: 'c0' }, nodes: [real] } } })

    const pr = await fetchPr('acme', 'api', 12)

    expect(graphql.mock.calls[2][1]).toMatchObject({ before: 'c1' })
    expect(pr.myReviews.map((r) => r.databaseId)).toEqual([7, 9, 1001, 1002, 8])
  })

  it('does not page back when the window holds a real review', async () => {
    const reviews = [{ id: 'PRR_real', databaseId: 7, state: 'APPROVED', submittedAt: '2026-11-04T00:00:00Z', body: '', commit: { oid: 'old' } }, replyReview(1)]
    graphql.mockResolvedValueOnce({ repository: { pullRequest: rawPr(reviews, { hasPreviousPage: true, startCursor: 'c1' }) } })
    graphql.mockResolvedValueOnce(commentsFor([replyReview(1)]))

    const pr = await fetchPr('acme', 'api', 12)

    expect(graphql).toHaveBeenCalledTimes(2)
    expect(pr.myReviews).toHaveLength(2)
  })
})
