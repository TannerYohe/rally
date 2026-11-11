import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftComment, Drafts, PrRef, ReplyTarget } from '@shared/types'
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
import { commentNodeId, threadsPage } from './reviewThreads.fixture'

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
      .mockResolvedValueOnce(threadsPage({ threads: [{ id: 'PRRT_1', commentIds: [100, null] }], endCursor: 'c1' }))
      .mockResolvedValueOnce(threadsPage({ threads: [{ id: 'PRRT_2', commentIds: [501, 502] }] }))

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
    expect(needsReplyTargets(drafts([draft({ replyTarget: null as unknown as ReplyTarget })]))).toBe(true)
  })
})

describe('attachReplyTargets', () => {
  it('attaches each reply its target and leaves replies with no target and inline comments alone', () => {
    const found = { found: true as const, comment: repliedComment(raw()) }
    const inline = draft({ id: '4', kind: 'inline', path: 'a.rb', line: 1, replyToCommentId: null })
    const targets = new Map<number, ReplyTarget>([
      [501, found],
      [999, { found: false }],
    ])
    const result = attachReplyTargets(drafts([draft(), draft({ id: '2', replyToCommentId: 999 }), draft({ id: '3', replyToCommentId: 502 }), inline]), targets)
    expect(result.comments.map((c) => c.replyTarget)).toEqual([found, { found: false }, undefined, undefined])
  })
})

describe('describeReplies', () => {
  it('looks up only the comments the replies answer and attaches each reply its own comment', async () => {
    const rawFor = (id: string) => raw({ url: `https://github.com/acme/api/pull/12#discussion_${id}`, bodyText: `Comment ${id}` })
    mocks.graphql.mockImplementation(async (query: string, variables: { ids?: string[] }) => {
      if (query.includes('reviewThreads')) return threadsPage({ threads: [{ id: 'PRRT_1', commentIds: [500, 501, 502] }] })
      return { nodes: (variables.ids ?? []).map(rawFor) }
    })
    const input = drafts([draft(), draft({ id: '2', replyToCommentId: 500 }), draft({ id: '3' }), draft({ id: '4', replyToCommentId: 999 })])

    const result = await describeReplies(pr, input)

    const nodeLookups = mocks.graphql.mock.calls.filter(([query]) => !(query as string).includes('reviewThreads'))
    expect(nodeLookups.map(([, variables]) => (variables as { ids: string[] }).ids)).toEqual([[commentNodeId(501), commentNodeId(500)]])
    expect(result.comments.map((c) => c.replyTarget)).toEqual([
      { found: true, comment: repliedComment(rawFor(commentNodeId(501))) },
      { found: true, comment: repliedComment(rawFor(commentNodeId(500))) },
      { found: true, comment: repliedComment(rawFor(commentNodeId(501))) },
      { found: false },
    ])
  })

  it("leaves a reply's target unset for a later retry when its comment's details can't be fetched", async () => {
    mocks.graphql.mockImplementation(async (query: string) => {
      if (query.includes('reviewThreads')) return threadsPage({ threads: [{ id: 'PRRT_1', commentIds: [501] }] })
      return { nodes: [null] }
    })

    const result = await describeReplies(pr, drafts([draft()]))

    expect(result.comments[0].replyTarget).toBeUndefined()
    expect(needsReplyTargets(result)).toBe(true)
  })
})
