import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftComment, Drafts, PrRef } from '@shared/types'
import type { GithubClient } from './client'
import {
  attachReplyTargets,
  describeReplies,
  EXCERPT_LENGTH,
  excerpt,
  fetchThreadComments,
  needsReplyTargets,
  repliedComment,
  threadCommentFor,
  type RawRepliedComment,
  type ThreadComment,
} from './reviewComments'

const mocks = vi.hoisted(() => ({ graphql: vi.fn() }))

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  github: async () => ({ graphql: mocks.graphql }),
}))

const pr: PrRef = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }

const gh = { graphql: mocks.graphql } as unknown as GithubClient

const raw = (overrides: Partial<RawRepliedComment> = {}): RawRepliedComment => ({
  url: 'https://github.com/acme/api/pull/12#discussion_r501',
  path: 'app/models/loan.rb',
  line: 42,
  originalLine: 40,
  bodyText: 'Should this be memoized?',
  author: { login: 'octocat' },
  ...overrides,
})

const draft = (overrides: Partial<DraftComment> = {}): DraftComment => ({
  id: '1',
  kind: 'reply',
  path: null,
  line: null,
  startLine: null,
  side: 'RIGHT',
  severity: 'medium',
  body: 'Done?',
  replyToCommentId: 501,
  ...overrides,
})

const drafts = (comments: DraftComment[]): Drafts => ({ mode: 'followup', verdict: '', reportMarkdown: '', summaryBody: '', comments, priorConcerns: [] })

const nodeId = (databaseId: number) => `PRRC_${databaseId}`

const threadsPage = (threads: { id: string; databaseIds: (number | null)[] }[], endCursor?: string) => ({
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: Boolean(endCursor), endCursor: endCursor ?? null },
        nodes: threads.map((t) => ({
          id: t.id,
          comments: { nodes: t.databaseIds.map((databaseId, i) => ({ id: databaseId === null ? `PRRC_null_${i}` : nodeId(databaseId), databaseId })) },
        })),
      },
    },
  },
})

beforeEach(() => {
  mocks.graphql.mockReset()
})

describe('excerpt', () => {
  it('collapses whitespace onto one line', () => {
    expect(excerpt('  First line.\n\n  Second   line. ')).toBe('First line. Second line.')
  })

  it('keeps text at the limit and truncates anything longer to exactly the limit', () => {
    expect(excerpt('x'.repeat(EXCERPT_LENGTH))).toBe('x'.repeat(EXCERPT_LENGTH))
    expect(excerpt('x'.repeat(EXCERPT_LENGTH + 1))).toBe(`${'x'.repeat(EXCERPT_LENGTH - 1)}…`)
    expect(excerpt('word '.repeat(100))).toHaveLength(EXCERPT_LENGTH)
  })
})

describe('repliedComment', () => {
  it('describes the comment being replied to', () => {
    expect(repliedComment(raw())).toEqual({
      author: 'octocat',
      path: 'app/models/loan.rb',
      line: 42,
      excerpt: 'Should this be memoized?',
      url: 'https://github.com/acme/api/pull/12#discussion_r501',
    })
  })

  it('falls back to the original line on an outdated comment and tolerates a deleted author', () => {
    expect(repliedComment(raw({ line: null, author: null }))).toMatchObject({ author: null, line: 40 })
  })
})

describe('fetchThreadComments', () => {
  it('maps every comment id across pages to its thread, skipping comments with no database id', async () => {
    mocks.graphql
      .mockResolvedValueOnce(threadsPage([{ id: 'PRRT_1', databaseIds: [100, null] }], 'c1'))
      .mockResolvedValueOnce(threadsPage([{ id: 'PRRT_2', databaseIds: [501, 502] }]))

    const comments = await fetchThreadComments(gh, pr)

    expect([...comments.keys()]).toEqual([100, 501, 502])
    expect(comments.get(501)).toEqual({ databaseId: 501, nodeId: 'PRRC_501', threadId: 'PRRT_2' })
    expect(mocks.graphql.mock.calls.map(([, variables]) => (variables as { cursor: string | null }).cursor)).toEqual([null, 'c1'])
  })
})

describe('threadCommentFor', () => {
  const threadComments = new Map<number, ThreadComment>([[501, { databaseId: 501, nodeId: 'PRRC_501', threadId: 'PRRT_1' }]])

  it('finds the thread comment a reply answers', () => {
    expect(threadCommentFor(threadComments, draft())?.threadId).toBe('PRRT_1')
  })

  it('finds nothing for a reply with no id, an unknown id, or an inline comment', () => {
    expect(threadCommentFor(threadComments, draft({ replyToCommentId: null }))).toBeUndefined()
    expect(threadCommentFor(threadComments, draft({ replyToCommentId: 999 }))).toBeUndefined()
    expect(threadCommentFor(threadComments, draft({ kind: 'inline', path: 'a.rb', line: 1 }))).toBeUndefined()
  })
})

describe('needsReplyTargets', () => {
  it('is true only while a reply with a comment id has not been looked up', () => {
    expect(needsReplyTargets(drafts([draft({ replyToCommentId: null })]))).toBe(false)
    expect(needsReplyTargets(drafts([draft()]))).toBe(true)
    expect(needsReplyTargets(drafts([draft({ replyTarget: { found: false } })]))).toBe(false)
  })
})

describe('attachReplyTargets', () => {
  it('describes replies and marks ones whose comment is not in a review thread', () => {
    const replied = repliedComment(raw())
    const inline = draft({ id: '3', kind: 'inline', path: 'a.rb', line: 1, replyToCommentId: null })
    const result = attachReplyTargets(drafts([draft(), draft({ id: '2', replyToCommentId: 999 }), inline]), new Map([[501, replied]]))
    expect(result.comments.map((c) => c.replyTarget)).toEqual([{ found: true, comment: replied }, { found: false }, undefined])
  })
})

describe('describeReplies', () => {
  it('looks up only the comments the replies answer and attaches them', async () => {
    mocks.graphql.mockImplementation(async (query: string, variables: { ids?: string[] }) => {
      if (query.includes('reviewThreads')) return threadsPage([{ id: 'PRRT_1', databaseIds: [500, 501] }])
      return { nodes: (variables.ids ?? []).map(() => raw()) }
    })
    const input = drafts([draft(), draft({ id: '2' }), draft({ id: '3', replyToCommentId: 999 })])

    const result = await describeReplies(pr, input)

    const nodeLookups = mocks.graphql.mock.calls.filter(([query]) => !(query as string).includes('reviewThreads'))
    expect(nodeLookups.map(([, variables]) => (variables as { ids: string[] }).ids)).toEqual([['PRRC_501']])
    expect(result.comments.map((c) => c.replyTarget)).toEqual([
      { found: true, comment: repliedComment(raw()) },
      { found: true, comment: repliedComment(raw()) },
      { found: false },
    ])
  })

  it('marks a reply as not found when its comment was deleted between lookups', async () => {
    mocks.graphql.mockImplementation(async (query: string) => {
      if (query.includes('reviewThreads')) return threadsPage([{ id: 'PRRT_1', databaseIds: [501] }])
      return { nodes: [null] }
    })

    const result = await describeReplies(pr, drafts([draft()]))

    expect(result.comments[0].replyTarget).toEqual({ found: false })
  })
})
