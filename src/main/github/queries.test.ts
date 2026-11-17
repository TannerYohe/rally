import { describe, expect, it, vi } from 'vitest'

const graphql = vi.hoisted(() => vi.fn())
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  github: async () => ({ graphql, login: 'me' }),
}))

const { fetchPr, isReplyOnly, SEARCH_PAGES, searchPrs } = await import('./queries')

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

describe('fetchPr', () => {
  it('carries each review database id and reply-only flag into myReviews', async () => {
    const replyReview = { id: 'PRR_2', databaseId: 5787412470, state: 'COMMENTED', submittedAt: '2026-11-05T15:24:38Z', body: '', commit: { oid: 'head' } }
    const raw = {
      id: 'PR_1', number: 12, url: 'https://github.com/acme/api/pull/12', title: 't', body: '', createdAt: '', updatedAt: '',
      isDraft: false, additions: 1, deletions: 0, changedFiles: 1, headRefOid: 'head', baseRefName: 'main', headRefName: 'f',
      author: { login: 'author', avatarUrl: '' },
      repository: { name: 'api', owner: { login: 'acme' } },
      files: { nodes: [] },
      reviewRequests: { nodes: [] },
      reviews: {
        nodes: [
          { id: 'PRR_1', databaseId: 101, state: 'APPROVED', submittedAt: '2026-11-04T00:00:00Z', body: 'ok', commit: { oid: 'old' } },
          replyReview,
        ],
      },
      timelineItems: { nodes: [] },
    }
    graphql.mockResolvedValueOnce({ repository: { pullRequest: raw } })
    graphql.mockResolvedValueOnce({ nodes: [{ id: 'PRR_2', comments: { nodes: [reply] } }] })

    const pr = await fetchPr('acme', 'api', 12, 'reviewing')

    expect(pr.myReviews).toEqual([
      { databaseId: 101, state: 'APPROVED', submittedAt: '2026-11-04T00:00:00Z', commitOid: 'old', replyOnly: false },
      { databaseId: 5787412470, state: 'COMMENTED', submittedAt: '2026-11-05T15:24:38Z', commitOid: 'head', replyOnly: true },
    ])
    expect(graphql.mock.calls[0][0]).toMatch(/reviews\(author: \$viewer[^)]*\) \{ nodes \{ id databaseId /)
    expect(graphql.mock.calls[0][1]).toMatchObject({ authored: false })
    expect(pr.feedback).toBeNull()
  })

  it('reads author feedback for an authored PR', async () => {
    const raw = {
      id: 'PR_2', number: 13, url: 'https://github.com/acme/api/pull/13', title: 't', body: '', createdAt: '', updatedAt: '',
      isDraft: false, additions: 1, deletions: 0, changedFiles: 1, headRefOid: 'head', baseRefName: 'main', headRefName: 'f',
      author: { login: 'me', avatarUrl: '' },
      repository: { name: 'api', owner: { login: 'acme' } },
      files: { nodes: [] },
      reviewRequests: { nodes: [{ requestedReviewer: { login: 'carol' } }] },
      reviews: { nodes: [] },
      timelineItems: { nodes: [] },
      reviewDecision: 'CHANGES_REQUESTED',
      latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'bob' } }] },
      reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ isResolved: false, latest: { nodes: [{ author: { login: 'bob' }, reactionGroups: [] }] } }] },
      comments: { pageInfo: { hasPreviousPage: false }, nodes: [{ url: 'https://github.com/acme/api/pull/13#issuecomment-1', body: 'Why?', createdAt: '', author: { login: 'carol', __typename: 'User' }, reactionGroups: [] }] },
      allReviews: { pageInfo: { hasPreviousPage: true }, nodes: [] },
    }
    graphql.mockResolvedValueOnce({ repository: { pullRequest: raw } })

    const pr = await fetchPr('acme', 'api', 13, 'authored')

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
  it('pages authored searches in small pages with a timeout', async () => {
    graphql.mockResolvedValueOnce({ search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } })
    await searchPrs(['is:pr author:@me'], 'authored')
    const variables = graphql.mock.calls.at(-1)![1]
    expect(variables).toMatchObject({ authored: true, pageSize: SEARCH_PAGES.authored.size })
    expect(variables.request.signal).toBeInstanceOf(AbortSignal)
  })
})
