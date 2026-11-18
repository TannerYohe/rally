import { describe, expect, it, vi } from 'vitest'

const graphql = vi.hoisted(() => vi.fn())
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  github: async () => ({ graphql, login: 'me' }),
}))

const { feedbackItems, fetchFeedbackItems, PAGE_LIMIT } = await import('./authorFeedback')
import type { ReviewState } from '@shared/types'
import type { RawPrComment, RawReviewSummary, RawThread } from './feedbackFields'

const PR = 'https://github.com/acme/api/pull/1'

const actor = (login: string, __typename = 'User') => ({ login, __typename, avatarUrl: '' })

const threadComment = (login: string, createdAt: string, databaseId = 1, reacted = false) => ({
  id: `C${databaseId}`,
  databaseId,
  url: `${PR}#discussion_r${databaseId}`,
  body: `from ${login}`,
  createdAt,
  author: actor(login),
  reactionGroups: [{ viewerHasReacted: reacted }],
})

function thread(id: string, overrides: Partial<RawThread> = {}, ...comments: ReturnType<typeof threadComment>[]): RawThread {
  return {
    id,
    isResolved: false,
    isOutdated: false,
    path: 'a.ts',
    line: 3,
    originalLine: 2,
    latest: { nodes: comments.slice(-1) },
    comments: { pageInfo: {}, nodes: comments },
    ...overrides,
  }
}

const prComment = (id: number, login: string, body: string, kind = 'User'): RawPrComment => ({
  id: `IC${id}`,
  databaseId: id,
  isMinimized: false,
  url: `${PR}#issuecomment-${id}`,
  body,
  createdAt: `2026-11-0${id}T00:00:00Z`,
  author: actor(login, kind),
  reactionGroups: [],
})

const review = (id: number, state: ReviewState, login: string, body = 'Please fix'): RawReviewSummary => ({
  id: `R${id}`,
  url: `${PR}#pullrequestreview-${id}`,
  body,
  state,
  submittedAt: '2026-11-03T00:00:00Z',
  author: actor(login),
  reactionGroups: [],
})

describe('feedbackItems', () => {
  it('keeps open threads and marks ones I replied to or reacted to last as answered', () => {
    const items = feedbackItems(
      [
        thread('T1', {}, threadComment('bob', '2026-11-01T00:00:00Z', 11)),
        thread('T2', {}, threadComment('bob', '2026-11-01T00:00:00Z', 21), threadComment('Me', '2026-11-02T00:00:00Z', 22)),
        thread('T3', {}, threadComment('bob', '2026-11-01T00:00:00Z', 31, true)),
        thread('T4', { isResolved: true }, threadComment('bob', '2026-11-01T00:00:00Z')),
      ],
      [],
      [],
      'me',
    )
    expect(items.map((i) => [i.id, i.answered])).toEqual([
      ['T1', false],
      ['T2', true],
      ['T3', true],
    ])
    expect(items[0]).toMatchObject({ kind: 'thread', author: 'bob', path: 'a.ts', line: 3, replyToCommentId: 11, reactionSubjectId: 'C11' })
    expect(items[1].reactionSubjectId).toBe('C22')
  })

  it('judges a long thread by its newest comment and shows it after the opening page', () => {
    const opening = Array.from({ length: 50 }, (_, i) => threadComment(i % 2 ? 'Me' : 'bob', '2026-11-01T00:00:00Z', i + 1))
    const newest = threadComment('bob', '2026-11-09T00:00:00Z', 99)
    const long = thread('T1', { latest: { nodes: [newest] }, comments: { pageInfo: {}, nodes: opening } })
    const [item] = feedbackItems([long], [], [], 'me')
    expect(item).toMatchObject({ answered: false, reactionSubjectId: 'C99', replyToCommentId: 1 })
    expect(item.comments).toHaveLength(51)
    expect(item.comments.at(-1)?.url).toBe(newest.url)
  })

  it('falls back to the original line on outdated threads', () => {
    const [item] = feedbackItems([thread('T1', { line: null, isOutdated: true }, threadComment('bob', '2026-11-01T00:00:00Z'))], [], [], 'me')
    expect(item).toMatchObject({ line: 2, outdated: true })
  })

  it('lists unacknowledged PR comments and review bodies, leaving out approvals', () => {
    const items = feedbackItems(
      [],
      [prComment(1, 'bob', 'Why not reuse the helper?'), prComment(2, 'codecov', 'Coverage', 'Bot')],
      [review(10, 'CHANGES_REQUESTED', 'carol'), review(11, 'APPROVED', 'dan', 'LGTM, one nit'), review(12, 'COMMENTED', 'erin', '')],
      'me',
    )
    expect(items.map((i) => [i.id, i.kind])).toEqual([
      ['R10', 'review'],
      ['IC1', 'comment'],
    ])
    expect(items[1]).toMatchObject({ author: 'bob', path: null, reactionSubjectId: 'IC1', url: `${PR}#issuecomment-1` })
  })

  it('orders unanswered items by newest activity', () => {
    const items = feedbackItems(
      [thread('old', {}, threadComment('bob', '2026-11-01T00:00:00Z')), thread('new', {}, threadComment('bob', '2026-11-05T00:00:00Z'))],
      [],
      [],
      'me',
    )
    expect(items.map((i) => i.id)).toEqual(['new', 'old'])
  })
})

describe('fetchFeedbackItems', () => {
  const connection = <T>(nodes: T[], pageInfo = {}) => ({ pageInfo, nodes })

  it('pages threads forward, comments and reviews backward, and long threads forward, stopping at the page limit', async () => {
    const t1Comments = [threadComment('bob', '2026-11-01T00:00:00Z', 1)]
    const t1More = [threadComment('carol', '2026-11-02T00:00:00Z', 2)]
    const firstThread = { ...thread('T1', {}, ...t1Comments), comments: connection(t1Comments, { hasNextPage: true, endCursor: 'TC2' }) }
    let older = 100
    graphql.mockImplementation(async (query: string, variables: { cursor: string | null }) => {
      if (query.includes('node(id: $id)')) return { node: { comments: connection(t1More) } }
      if (variables.cursor === null) {
        return {
          repository: {
            pullRequest: {
              reviewThreads: connection([firstThread], { hasNextPage: true, endCursor: 'T2' }),
              comments: connection([prComment(1, 'dan', 'Newest question')], { hasPreviousPage: true, startCursor: 'C2' }),
              reviews: connection([review(10, 'COMMENTED', 'erin', 'Overall')]),
            },
          },
        }
      }
      if (query.includes('reviewThreads')) return { repository: { pullRequest: { reviewThreads: connection([thread('T2', {}, threadComment('bob', '2026-11-03T00:00:00Z', 5))]) } } }
      if (query.includes('comments(last: 100')) {
        return { repository: { pullRequest: { comments: connection([prComment(++older, 'dan', `Older ${variables.cursor}`)], { hasPreviousPage: true, startCursor: `${variables.cursor}+` }) } } }
      }
      throw new Error(`unexpected query with cursor ${variables.cursor}`)
    })

    const items = await fetchFeedbackItems({ owner: 'acme', repo: 'api', number: 1, url: PR })

    const calls = graphql.mock.calls.map(([query, variables]) => ({ query: query as string, cursor: variables.cursor as string | null, id: variables.id }))
    expect(calls.find((c) => c.query.includes('node(id: $id)'))).toMatchObject({ id: 'T1', cursor: 'TC2' })
    expect(calls.filter((c) => c.query.includes('reviewThreads') && c.cursor !== null).map((c) => c.cursor)).toEqual(['T2'])
    const commentCursors = calls.filter((c) => c.query.includes('comments(last: 100') && !c.query.includes('reviewThreads')).map((c) => c.cursor)
    expect(commentCursors).toHaveLength(PAGE_LIMIT - 1)
    expect(commentCursors[0]).toBe('C2')
    expect(items.filter((i) => i.kind === 'comment')).toHaveLength(PAGE_LIMIT)
    expect(items.filter((i) => i.kind !== 'comment').map((i) => i.id).sort()).toEqual(['R10', 'T1', 'T2'])
    expect(items.find((i) => i.id === 'T1')?.comments.map((c) => c.author)).toEqual(['bob', 'carol'])
  })
})
