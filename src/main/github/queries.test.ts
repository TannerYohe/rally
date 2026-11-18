import { GraphqlResponseError } from '@octokit/graphql'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const graphql = vi.hoisted(() => vi.fn())
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  github: async () => ({ graphql, login: 'me' }),
}))

const { fetchPrs, isReplyOnly, SEARCH_PAGES, searchPrs } = await import('./queries')

const single = (raw: object) => ({ p0: { pullRequest: { ...raw, state: 'OPEN' } } })

async function fetchOne(number: number, kind: 'reviewing' | 'authored') {
  const { lookups } = await fetchPrs([{ owner: 'acme', repo: 'api', number }], kind)
  if (lookups[0].status !== 'found') throw new Error(`PR ${number} was ${lookups[0].status}`)
  return lookups[0].pr
}

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

describe('fetching one PR', () => {
  beforeEach(() => graphql.mockReset())

  it('carries each review database id and reply-only flag into myReviews', async () => {
    const raw = rawPr([
      realReview({ id: 'PRR_1', databaseId: 101, state: 'APPROVED', body: 'ok' }),
      { ...replyReview(0), id: 'PRR_2', databaseId: 5787412470, submittedAt: '2026-11-05T15:24:38Z' },
    ])
    graphql.mockResolvedValueOnce(single(raw))
    graphql.mockResolvedValueOnce({ nodes: [{ id: 'PRR_2', comments: { nodes: [reply] } }] })

    const pr = await fetchOne(12, 'reviewing')

    expect(pr.myReviews).toEqual([
      { databaseId: 101, state: 'APPROVED', submittedAt: '2026-11-04T00:00:00Z', commitOid: 'old', replyOnly: false },
      { databaseId: 5787412470, state: 'COMMENTED', submittedAt: '2026-11-05T15:24:38Z', commitOid: 'head', replyOnly: true },
    ])
    expect(graphql.mock.calls[0][0]).toMatch(/reviews\(author: \$viewer[^)]*\) \{ pageInfo \{ hasPreviousPage startCursor \} nodes \{ id databaseId /)
    expect(graphql.mock.calls[0][1]).toMatchObject({ authored: false })
    expect(pr.feedback).toBeNull()
  })

  it('pages back past a window of thread replies to my last real review', async () => {
    const newest = Array.from({ length: 20 }, (_, i) => replyReview(i + 20))
    const olderReplies = Array.from({ length: 5 }, (_, i) => replyReview(i + 10))
    const real = realReview()
    graphql.mockResolvedValueOnce(single(rawPr(newest, { hasPreviousPage: true, startCursor: 'c20' })))
    graphql.mockResolvedValueOnce(commentsFor(newest))
    graphql.mockResolvedValueOnce(olderPage([real, ...olderReplies], 'c0'))

    const pr = await fetchOne(12, 'reviewing')

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
    graphql.mockResolvedValueOnce(single(rawPr(newest, { hasPreviousPage: true, startCursor: 'c40' })))
    graphql.mockResolvedValueOnce(commentsFor(newest))
    graphql.mockResolvedValueOnce(olderPage(middle, 'c20'))
    graphql.mockResolvedValueOnce(olderPage([real], 'c0'))

    const pr = await fetchOne(12, 'reviewing')

    expect(graphql.mock.calls.slice(2).map((call) => call[1].before)).toEqual(['c40', 'c20'])
    expect(pr.myReviews).toHaveLength(41)
    expect(pr.myReviews[0]).toMatchObject({ databaseId: 7, state: 'APPROVED', replyOnly: false })
  })

  it('stops paging after 10 pages when every page is replies', async () => {
    const newest = [replyReview(0)]
    graphql.mockResolvedValueOnce(single(rawPr(newest, { hasPreviousPage: true, startCursor: 'c0' })))
    graphql.mockResolvedValueOnce(commentsFor(newest))
    for (let page = 1; page <= 10; page++) graphql.mockResolvedValueOnce(olderPage([replyReview(page)], `c${page}`))

    const pr = await fetchOne(12, 'reviewing')

    expect(graphql).toHaveBeenCalledTimes(2 + 9)
    expect(pr.myReviews).toHaveLength(10)
    expect(pr.myReviews.every((r) => r.replyOnly)).toBe(true)
  })

  it('keeps paging when the window holds only replies and reviews that do not count', async () => {
    const pending = { id: 'PRR_pending', databaseId: 8, state: 'PENDING', submittedAt: null, body: '', commit: { oid: 'head' } }
    const dismissed = { id: 'PRR_dismissed', databaseId: 9, state: 'DISMISSED', submittedAt: '2026-11-04T12:00:00Z', body: 'x', commit: { oid: 'old' } }
    const real = realReview()
    const replies = [replyReview(1), replyReview(2)]
    graphql.mockResolvedValueOnce(single(rawPr([dismissed, ...replies, pending], { hasPreviousPage: true, startCursor: 'c1' })))
    graphql.mockResolvedValueOnce(commentsFor(replies))
    graphql.mockResolvedValueOnce(olderPage([real], 'c0', false))

    const pr = await fetchOne(12, 'reviewing')

    expect(graphql.mock.calls[2][1]).toMatchObject({ before: 'c1' })
    expect(pr.myReviews.map((r) => r.databaseId)).toEqual([7, 9, 1001, 1002, 8])
  })

  it('stops paging without a warning when the newest page of replies is my whole history', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const newest = [replyReview(1), replyReview(2)]
    graphql.mockResolvedValueOnce(single(rawPr(newest, { hasPreviousPage: false, startCursor: 'c1' })))
    graphql.mockResolvedValueOnce(commentsFor(newest))

    const pr = await fetchOne(12, 'reviewing')

    expect(graphql).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()
    expect(pr.myReviews.map((r) => r.databaseId)).toEqual([1001, 1002])
    warn.mockRestore()
  })

  it('does not page back when the window holds a real review', async () => {
    const reviews = [realReview({ state: 'APPROVED', body: '' }), replyReview(1)]
    graphql.mockResolvedValueOnce(single(rawPr(reviews, { hasPreviousPage: true, startCursor: 'c1' })))
    graphql.mockResolvedValueOnce(commentsFor([replyReview(1)]))

    const pr = await fetchOne(12, 'reviewing')

    expect(graphql).toHaveBeenCalledTimes(2)
    expect(pr.myReviews).toHaveLength(2)
  })

  it('keeps the reviews fetched so far when an older page fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const newest = [replyReview(1), replyReview(2)]
    graphql.mockResolvedValueOnce(single(rawPr(newest, { hasPreviousPage: true, startCursor: 'c1' })))
    graphql.mockResolvedValueOnce(commentsFor(newest))
    graphql.mockRejectedValueOnce(new Error('socket hang up'))

    const pr = await fetchOne(12, 'reviewing')

    expect(pr.myReviews.map((r) => r.databaseId)).toEqual([1001, 1002])
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ pr: 'https://github.com/acme/api/pull/12' }))
    warn.mockRestore()
  })

  it('keeps the reviews fetched so far when the PR is gone on an older page', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const newest = [replyReview(1)]
    graphql.mockResolvedValueOnce(single(rawPr(newest, { hasPreviousPage: true, startCursor: 'c1' })))
    graphql.mockResolvedValueOnce(commentsFor(newest))
    graphql.mockResolvedValueOnce({ node: null })

    const pr = await fetchOne(12, 'reviewing')

    expect(pr.myReviews.map((r) => r.databaseId)).toEqual([1001])
    expect(warn).toHaveBeenCalledWith(expect.any(String), { pr: 'https://github.com/acme/api/pull/12' })
    warn.mockRestore()
  })
  it('reads author feedback for an authored PR', async () => {
    const raw = {
      id: 'PR_2', number: 13, url: 'https://github.com/acme/api/pull/13', title: 't', body: '', createdAt: '', updatedAt: '',
      isDraft: false, additions: 1, deletions: 0, changedFiles: 1, headRefOid: 'head', baseRefName: 'main', headRefName: 'f',
      author: { login: 'me', avatarUrl: '' },
      repository: { name: 'api', owner: { login: 'acme' } },
      files: { nodes: [] },
      reviewRequests: { nodes: [{ requestedReviewer: { login: 'carol' } }] },
      reviews: { pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [] },
      timelineItems: { nodes: [] },
      reviewDecision: 'CHANGES_REQUESTED',
      latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'bob' } }] },
      reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ isResolved: false, latest: { nodes: [{ author: { login: 'bob' }, reactionGroups: [] }] } }] },
      comments: { pageInfo: { hasPreviousPage: false }, nodes: [{ url: 'https://github.com/acme/api/pull/13#issuecomment-1', body: 'Why?', createdAt: '', author: { login: 'carol', __typename: 'User' }, reactionGroups: [] }] },
      allReviews: { pageInfo: { hasPreviousPage: true }, nodes: [] },
    }
    graphql.mockResolvedValueOnce(single(raw))

    const pr = await fetchOne(13, 'authored')

    expect(graphql.mock.calls.at(-1)![1]).toMatchObject({ authored: true })
    expect(pr.feedback).toEqual({
      reviewDecision: 'CHANGES_REQUESTED',
      openThreads: 1,
      unacknowledged: 2,
      changesRequestedBy: ['bob'],
      approvedBy: [],
      truncated: true,
    })
  })
})

describe('searchPrs', () => {
  beforeEach(() => graphql.mockReset())

  it('pages authored searches in small pages with a timeout', async () => {
    graphql.mockResolvedValueOnce({ search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } })
    await searchPrs(['is:pr author:@me'], 'authored')
    const variables = graphql.mock.calls.at(-1)![1]
    expect(variables).toMatchObject({ authored: true, pageSize: SEARCH_PAGES.authored.size })
    expect(variables.request.signal).toBeInstanceOf(AbortSignal)
  })

  it('never pages back through my reviews on PRs I opened', async () => {
    const replies = [replyReview(1), replyReview(2)]
    graphql.mockResolvedValueOnce({ search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [rawPr(replies, { hasPreviousPage: true, startCursor: 'c1' })] } })
    graphql.mockResolvedValueOnce(commentsFor(replies))

    const { prs } = await searchPrs(['query'], 'authored')

    expect(graphql).toHaveBeenCalledTimes(2)
    expect(prs[0].myReviews.map((r) => r.databaseId)).toEqual([1001, 1002])
  })

  it('pages back only for the PR whose newest reviews are all replies', async () => {
    const replies = [replyReview(1), replyReview(2)]
    const real = realReview()
    const reviewed = rawPr([real], { hasPreviousPage: true, startCursor: 'r1' }, 12)
    const repliesOnly = rawPr(replies, { hasPreviousPage: true, startCursor: 'c1' }, 13)
    graphql.mockResolvedValueOnce({ search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [reviewed, repliesOnly] } })
    graphql.mockResolvedValueOnce(commentsFor(replies))
    graphql.mockResolvedValueOnce(olderPage([realReview({ id: 'PRR_old', databaseId: 6 })], 'c0', false))

    const { prs } = await searchPrs(['query'], 'reviewing')

    expect(graphql).toHaveBeenCalledTimes(3)
    expect(graphql.mock.calls[2][1]).toMatchObject({ id: 'PR_13', before: 'c1' })
    expect(prs.map((pr) => pr.myReviews.map((r) => r.databaseId))).toEqual([[7], [6, 1001, 1002]])
  })
})

function lookupError(data: unknown, errors: { type: string; path: string[] }[]) {
  const full = errors.map((e) => ({ ...e, message: e.type, extensions: {}, locations: [{ line: 1, column: 1 }] }))
  return new GraphqlResponseError({ method: 'POST', url: '/graphql' }, {}, { data, errors: full } as never)
}

const open = (number: number) => ({ pullRequest: { ...rawPr([], undefined, number), state: 'OPEN' } })
const coord = (number: number) => ({ owner: 'acme', repo: 'api', number })

describe('fetchPrs', () => {
  beforeEach(() => graphql.mockReset())

  it('looks up each PR under its own alias with variables', async () => {
    graphql.mockResolvedValueOnce({ p0: open(1), p1: open(2) })

    const { viewer, lookups } = await fetchPrs([coord(1), { owner: 'acme', repo: 'web', number: 2 }], 'reviewing')

    const [query, variables] = graphql.mock.calls[0]
    expect(query).toMatch(/p0: repository\(owner: \$o0, name: \$r0\) \{ pullRequest\(number: \$n0\) \{ state \.\.\.PrFields \} \}/)
    expect(query).toMatch(/p1: repository/)
    expect(variables).toMatchObject({ o0: 'acme', r0: 'api', n0: 1, o1: 'acme', r1: 'web', n1: 2, viewer: 'me', authored: false })
    expect(viewer).toBe('me')
    expect(lookups.map((l) => (l.status === 'found' ? l.pr.number : l.status))).toEqual([1, 2])
  })

  it('splits more than 20 PRs across requests', async () => {
    const coords = Array.from({ length: 21 }, (_, i) => coord(i + 1))
    graphql.mockResolvedValueOnce(Object.fromEntries(coords.slice(0, 20).map((c, i) => [`p${i}`, open(c.number)])))
    graphql.mockResolvedValueOnce({ p0: open(21) })

    const { lookups } = await fetchPrs(coords, 'reviewing')

    expect(graphql).toHaveBeenCalledTimes(2)
    expect(graphql.mock.calls[1][1]).toMatchObject({ n0: 21 })
    expect(lookups).toHaveLength(21)
    expect(lookups.every((l) => l.status === 'found')).toBe(true)
  })

  it('reports closed and merged PRs as gone', async () => {
    graphql.mockResolvedValueOnce({ p0: { pullRequest: { ...open(1).pullRequest, state: 'MERGED' } }, p1: { pullRequest: { ...open(2).pullRequest, state: 'CLOSED' } } })
    const { lookups } = await fetchPrs([coord(1), coord(2)], 'reviewing')
    expect(lookups).toEqual([{ status: 'gone' }, { status: 'gone' }])
  })

  it('tells gone PRs from lookups that failed for another reason, warning about all but missing PRs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const data = { p0: open(1), p1: { pullRequest: null }, p2: null, p3: null }
    graphql.mockRejectedValueOnce(
      lookupError(data, [
        { type: 'NOT_FOUND', path: ['p1', 'pullRequest'] },
        { type: 'FORBIDDEN', path: ['p2'] },
        { type: 'SERVICE_UNAVAILABLE', path: ['p3'] },
      ]),
    )

    const { lookups } = await fetchPrs([1, 2, 3, 4].map(coord), 'reviewing')

    expect(lookups.map((l) => l.status)).toEqual(['found', 'gone', 'gone', 'unknown'])
    expect(warn).toHaveBeenCalledWith('GitHub PR lookup returned partial errors', {
      errors: [expect.objectContaining({ type: 'FORBIDDEN' }), expect.objectContaining({ type: 'SERVICE_UNAVAILABLE' })],
    })
  })

  it('does not warn when every failed lookup is a missing PR', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    graphql.mockRejectedValueOnce(lookupError({ p0: { pullRequest: null } }, [{ type: 'NOT_FOUND', path: ['p0', 'pullRequest'] }]))
    const { lookups } = await fetchPrs([coord(1)], 'reviewing')
    expect(lookups).toEqual([{ status: 'gone' }])
    expect(warn).not.toHaveBeenCalled()
  })

  it('rethrows a failure that returned no data', async () => {
    graphql.mockRejectedValueOnce(lookupError(null, [{ type: 'RATE_LIMITED', path: [] }]))
    await expect(fetchPrs([coord(1)], 'reviewing')).rejects.toThrow('RATE_LIMITED')
    graphql.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(fetchPrs([coord(1)], 'reviewing')).rejects.toThrow('socket hang up')
  })

  it('makes no request for no PRs', async () => {
    expect(await fetchPrs([], 'reviewing')).toEqual({ viewer: 'me', lookups: [] })
    expect(graphql).not.toHaveBeenCalled()
  })
})
