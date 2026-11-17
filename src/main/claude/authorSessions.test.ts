import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUSH_BEFORE_POSTING_ERROR } from '@shared/authorSession'
import type { AuthorSession, Drafts, FeedbackItem, ItemResponse, PrRef } from '@shared/types'
import type { AuthorToolHandlers } from './authorTools'

const CLONE = { path: join(tmpdir(), 'rally-author-test-clone'), branch: 'feature', baseRef: 'origin/main' }

mkdirSync(CLONE.path, { recursive: true })

const pr = (number: number): PrRef => ({ owner: 'acme', repo: 'api', number, url: `https://github.com/acme/api/pull/${number}` })

const thread = (id: string): FeedbackItem => ({
  id,
  kind: 'thread',
  author: 'bob',
  authorIsBot: false,
  avatarUrl: null,
  path: 'a.ts',
  line: 3,
  url: 'https://github.com/acme/api/pull/1#discussion_r1',
  severity: null,
  outdated: false,
  answered: false,
  comments: [{ author: 'bob', avatarUrl: null, body: 'Rename this', createdAt: '2026-11-01T00:00:00Z', url: '' }],
  replyToCommentId: 1,
  reactionSubjectId: 'C1',
})

const response = (itemId: string, reply: string): ItemResponse => ({
  itemId,
  action: 'push_back',
  verdict: null,
  summary: '',
  reply,
  commits: [],
  at: '2026-11-02T00:00:00Z',
})

function stored(number: number, overrides: Partial<AuthorSession> = {}): AuthorSession {
  return {
    id: `author-${number}`,
    pr: pr(number),
    prKey: `acme/api#${number}`,
    sdkSessionId: null,
    status: 'awaiting_feedback',
    error: null,
    timeline: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    clone: null,
    items: [],
    responses: {},
    posted: {},
    selfReview: null,
    commits: [],
    uncommitted: [],
    lastPush: null,
    remoteMoved: false,
    reviewersToReRequest: [],
    lastReRequest: null,
    ...overrides,
  }
}

const mocks = vi.hoisted(() => ({
  stored: [] as AuthorSession[],
  query: vi.fn(),
  fetchFeedbackItems: vi.fn(),
  acknowledgeFeedbackItem: vi.fn(),
  requestReview: vi.fn(),
  fetchApprovers: vi.fn(),
  fetchCloneSource: vi.fn(),
  postAuthorReply: vi.fn(),
  resolveFeedbackThread: vi.fn(),
  cloneBranch: vi.fn(),
  syncClone: vi.fn(),
  localCommits: vi.fn(),
  uncommittedPaths: vi.fn(),
  pushClone: vi.fn(),
  refreshOne: vi.fn(async () => {}),
  handlers: null as AuthorToolHandlers | null,
}))

vi.mock('../store', () => ({
  configFile: { get: () => ({ reviewSkill: 'review-pr' }) },
  authorSessionsDir: { readAll: () => mocks.stored, write: vi.fn(), remove: vi.fn() },
}))
vi.mock('../prList', () => ({ authoredPrList: { refreshOne: mocks.refreshOne, get: () => ({ viewer: 'me' }) } }))
vi.mock('../github/authorFeedback', () => ({ fetchFeedbackItems: mocks.fetchFeedbackItems, acknowledgeFeedbackItem: mocks.acknowledgeFeedbackItem }))
vi.mock('../github/reviewRequests', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/reviewRequests')>()),
  requestReview: mocks.requestReview,
  fetchApprovers: mocks.fetchApprovers,
}))
vi.mock('../github/authorReplies', () => ({
  fetchCloneSource: mocks.fetchCloneSource,
  postAuthorReply: mocks.postAuthorReply,
  resolveFeedbackThread: mocks.resolveFeedbackThread,
}))
vi.mock('../git/prClone', async (importOriginal) => ({
  RemoteMovedError: (await importOriginal<typeof import('../git/prClone')>()).RemoteMovedError,
  cloneBranch: mocks.cloneBranch,
  syncClone: mocks.syncClone,
  localCommits: mocks.localCommits,
  uncommittedPaths: mocks.uncommittedPaths,
  pushClone: mocks.pushClone,
  cloneDiff: vi.fn(async () => ''),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('./executable', () => ({ claudeExecutable: () => 'claude' }))
vi.mock('./modelOptions', () => ({ reviewModelOptions: () => ({}) }))
vi.mock('./timeline', () => ({ reduceTimeline: (timeline: unknown) => timeline, closeOpenEntries: (timeline: unknown) => timeline }))
vi.mock('./authorTools', () => ({
  PUBLISH_RESPONSES_TOOL: 'mcp__rally__publish_responses',
  createAuthorServer: (handlers: AuthorToolHandlers) => {
    mocks.handlers = handlers
    return {}
  },
}))

mocks.stored = [
  stored(1, { status: 'running' }),
  stored(2, { status: 'submitting' }),
  stored(3, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }] }),
  stored(4, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }] }),
  stored(5, { items: [thread('T1'), thread('T2')], responses: { T1: response('T1', 'Done'), T2: response('T2', 'Nope') } }),
  stored(7, {
    items: [thread('T1'), { ...thread('T2'), author: 'carol' }, { ...thread('T3'), author: 'carol' }, { ...thread('B1'), authorIsBot: true, author: 'scanner' }],
    responses: { T1: response('T1', 'Done'), T2: response('T2', 'Yes'), B1: response('B1', 'False positive') },
  }),
  stored(8, { reviewersToReRequest: ['carol'] }),
  stored(9, {}),
  stored(10, { reviewersToReRequest: ['dan', 'gina'] }),
  stored(12, {
    items: [thread('T1'), { ...thread('M1'), author: 'me' }],
    responses: { T1: response('T1', 'Done'), M1: response('M1', 'Following up on my own note') },
  }),
  stored(13, { items: [thread('T1')], responses: { T1: response('T1', 'Done') } }),
  stored(11, { reviewersToReRequest: ['erin', 'frank'] }),
  stored(31, {
    items: [thread('T1'), { ...thread('self-1'), kind: 'finding' }],
    responses: { T1: response('T1', 'Done'), 'self-1': { ...response('self-1', ''), action: 'fix' } },
    selfReview: { verdict: 'Minor', reportMarkdown: '', findings: [{ ...thread('self-1'), kind: 'finding' }] },
  }),
  stored(6, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }], items: [thread('T1')], responses: { T1: response('T1', 'Done') } }),
]

const { authorSessions, findingsFromDrafts } = await import('./authorSessions')
const { RemoteMovedError } = await import('../git/prClone')

const session = (number: number) => authorSessions.getByPr(`acme/api#${number}`)!

function finishTurn(during: () => void = () => {}) {
  mocks.query.mockImplementation(async function* () {
    during()
    yield { type: 'result', subtype: 'success', is_error: false }
  })
}

beforeEach(() => {
  for (const mock of [
    mocks.query,
    mocks.fetchFeedbackItems,
    mocks.postAuthorReply,
    mocks.resolveFeedbackThread,
    mocks.pushClone,
    mocks.requestReview,
    mocks.acknowledgeFeedbackItem,
  ])
    mock.mockReset()
  mocks.fetchApprovers.mockResolvedValue([])
  mocks.fetchCloneSource.mockResolvedValue({ headUrl: 'u', branch: 'feature', baseUrl: 'u', baseBranch: 'main' })
  mocks.cloneBranch.mockResolvedValue(CLONE)
  mocks.localCommits.mockResolvedValue([])
  mocks.uncommittedPaths.mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(() => {
  rmSync(CLONE.path, { recursive: true, force: true })
  for (const s of mocks.stored) rmSync(join(tmpdir(), 'rally', s.id), { recursive: true, force: true })
})

describe('restoring sessions', () => {
  it('marks interrupted turns and pushes as errors', () => {
    expect(session(1)).toMatchObject({ status: 'error', error: expect.stringContaining('Interrupted') })
    expect(session(2)).toMatchObject({ status: 'error', error: expect.stringContaining('pushing or posting') })
  })
})

describe('runActions', () => {
  it('clones the branch, runs a turn, and keeps responses only for known items', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([thread('T1'), thread('T9')])
    mocks.localCommits.mockResolvedValue([{ oid: 'def', subject: 'rename' }])
    finishTurn(() => mocks.handlers!.onResponses([{ ...response('T1', 'Fixed in def'), action: 'fix' }, response('nope', 'x')]))

    await authorSessions.runActions(pr(20), [{ itemId: 'T1', action: 'fix', note: 'use camelCase' }], '')
    await vi.waitFor(() => expect(session(20).status).toBe('awaiting_feedback'))

    expect(mocks.cloneBranch).toHaveBeenCalledWith(join(tmpdir(), 'rally', session(20).id), expect.objectContaining({ branch: 'feature' }))
    const prompt = mocks.query.mock.calls[0][0].prompt as string
    expect(prompt).toContain('## Item T1: Fix')
    expect(prompt).toContain('Note from me: use camelCase')
    expect(session(20).items.map((i) => i.id)).toEqual(['T1'])
    expect(Object.keys(session(20).responses)).toEqual(['T1'])
    expect(session(20).commits).toEqual([{ oid: 'def', subject: 'rename' }])
    expect(authorSessions.sessionState('acme/api#20')).toEqual({ status: 'awaiting_feedback', active: true })
  })

  it('refuses items that are no longer open on GitHub without starting a turn', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([thread('T1')])
    await expect(authorSessions.runActions(pr(21), [{ itemId: 'gone', action: 'fix', note: '' }], '')).rejects.toThrow('resolved or removed')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(session(21).status).toBe('awaiting_feedback')
  })

  it('records a clone failure on the session', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([thread('T1')])
    mocks.fetchCloneSource.mockRejectedValue(new Error('Rally only changes code on PRs you opened.'))
    await expect(authorSessions.runActions(pr(22), [{ itemId: 'T1', action: 'fix', note: '' }], '')).rejects.toThrow('PRs you opened')
    expect(session(22)).toMatchObject({ status: 'error', error: 'Rally only changes code on PRs you opened.' })
  })
})

describe('push', () => {
  it('clears local commits after a push', async () => {
    const lastPush = { at: '2026-11-16T00:00:00Z', oid: 'abc', commits: [{ oid: 'abc', subject: 'fix' }] }
    mocks.pushClone.mockResolvedValue(lastPush)
    await authorSessions.push('author-3')
    expect(session(3)).toMatchObject({ status: 'awaiting_feedback', commits: [], lastPush, remoteMoved: false })
    expect(mocks.refreshOne).toHaveBeenCalledWith('acme', 'api', 3)
  })

  it('flags a branch that moved on GitHub', async () => {
    mocks.pushClone.mockRejectedValue(new RemoteMovedError('feature'))
    mocks.localCommits.mockResolvedValue([{ oid: 'abc', subject: 'fix' }])
    await expect(authorSessions.push('author-4')).rejects.toBeInstanceOf(RemoteMovedError)
    expect(session(4)).toMatchObject({ status: 'error', remoteMoved: true, commits: [{ oid: 'abc', subject: 'fix' }] })
  })
})

describe('postReplies', () => {
  it('posts each reply, resolves when asked, and records failures', async () => {
    mocks.postAuthorReply.mockImplementation(async (_pr, item: FeedbackItem) => {
      if (item.id === 'T2') throw new Error('rate limited')
      return 'https://github.com/acme/api/pull/5#discussion_r2'
    })
    await authorSessions.postReplies('author-5', [
      { itemId: 'T1', body: ' Done ', resolve: true },
      { itemId: 'T2', body: 'Nope', resolve: false },
    ], false)
    expect(mocks.postAuthorReply).toHaveBeenCalledWith(pr(5), expect.objectContaining({ id: 'T1' }), 'Done')
    expect(mocks.resolveFeedbackThread).toHaveBeenCalledWith('T1')
    expect(session(5).posted.T1).toMatchObject({ body: 'Done', resolved: true, error: null })
    expect(session(5).posted.T2).toMatchObject({ url: null, error: 'rate limited' })
    expect(session(5)).toMatchObject({ status: 'error', error: '1 of 2 replies failed to post.' })
  })

  it('refuses to post while commits are unpushed', async () => {
    await expect(authorSessions.postReplies('author-6', [{ itemId: 'T1', body: 'Done', resolve: false }], true)).rejects.toThrow(PUSH_BEFORE_POSTING_ERROR)
    expect(mocks.postAuthorReply).not.toHaveBeenCalled()
  })
})

describe('re-requesting reviews', () => {
  const answered = (id: string, author: string) => ({ ...thread(id), author, answered: true })

  it('re-requests people I replied to once none of their comments are left unanswered', async () => {
    mocks.postAuthorReply.mockResolvedValue('https://github.com/acme/api/pull/7#r')
    mocks.fetchFeedbackItems.mockResolvedValue([answered('T1', 'bob'), answered('T2', 'carol'), { ...thread('T3'), author: 'carol', answered: false }])
    await authorSessions.postReplies(
      'author-7',
      ['T1', 'T2', 'B1'].map((itemId) => ({ itemId, body: 'reply', resolve: false })),
      true,
    )
    expect(mocks.requestReview.mock.calls).toEqual([[pr(7), 'bob']])
    expect(session(7)).toMatchObject({ reviewersToReRequest: ['carol'], lastReRequest: { reviewers: ['bob'], error: null } })
  })

  it('never queues me when I reply in a thread I started', async () => {
    mocks.postAuthorReply.mockResolvedValue('https://github.com/acme/api/pull/12#r')
    mocks.fetchFeedbackItems.mockResolvedValue([answered('T1', 'bob'), answered('M1', 'me')])
    await authorSessions.postReplies(
      'author-12',
      ['T1', 'M1'].map((itemId) => ({ itemId, body: 'reply', resolve: false })),
      true,
    )
    expect(mocks.requestReview.mock.calls).toEqual([[pr(12), 'bob']])
    expect(session(12).reviewersToReRequest).toEqual([])
  })

  it('queues and requests nothing when posting without re-requesting', async () => {
    mocks.postAuthorReply.mockResolvedValue('https://github.com/acme/api/pull/13#r')
    mocks.fetchFeedbackItems.mockResolvedValue([answered('T1', 'bob')])
    await authorSessions.postReplies('author-13', [{ itemId: 'T1', body: 'Done', resolve: false }], false)
    expect(mocks.requestReview).not.toHaveBeenCalled()
    expect(session(13)).toMatchObject({ reviewersToReRequest: [], lastReRequest: null, posted: { T1: { error: null } } })
  })

  it('re-requests a queued reviewer when an acknowledgment answers their last comment', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([answered('T3', 'carol')])
    await authorSessions.acknowledge(pr(8), 'T3')
    expect(mocks.acknowledgeFeedbackItem).toHaveBeenCalledWith(pr(8), 'T3')
    expect(mocks.requestReview.mock.calls).toEqual([[pr(8), 'carol']])
    expect(session(8).reviewersToReRequest).toEqual([])
  })

  it('never queues anyone from an acknowledgment alone', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([answered('T9', 'bob')])
    await authorSessions.acknowledge(pr(9), 'T9')
    expect(mocks.acknowledgeFeedbackItem).toHaveBeenCalledWith(pr(9), 'T9')
    expect(mocks.requestReview).not.toHaveBeenCalled()
    expect(session(9)).toMatchObject({ reviewersToReRequest: [], lastReRequest: null })
  })

  it('drops reviewers who already approved instead of re-requesting them', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([])
    mocks.fetchApprovers.mockResolvedValue(['Erin'])
    await authorSessions.acknowledge(pr(11), 'T5')
    expect(mocks.requestReview.mock.calls).toEqual([[pr(11), 'frank']])
    expect(session(11).reviewersToReRequest).toEqual([])
  })

  it('drops a reviewer GitHub rejects, keeps one that failed for another reason, and still requests the rest', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([])
    mocks.requestReview.mockImplementation(async (_pr, login: string) => {
      if (login === 'dan') throw Object.assign(new Error('Reviews may only be requested from collaborators'), { status: 422 })
      throw new Error('socket hang up')
    })
    await authorSessions.acknowledge(pr(10), 'T4')
    expect(mocks.requestReview.mock.calls).toEqual([
      [pr(10), 'dan'],
      [pr(10), 'gina'],
    ])
    expect(session(10)).toMatchObject({
      reviewersToReRequest: ['gina'],
      lastReRequest: { reviewers: [], error: '@dan: Reviews may only be requested from collaborators; @gina: socket hang up' },
    })
  })
})

describe('self-review', () => {
  const drafts: Drafts = {
    mode: 'full',
    verdict: 'Minor changes',
    reportMarkdown: '# Report',
    summaryBody: '',
    priorConcerns: [],
    comments: [{ id: '1', kind: 'inline', path: 'a.ts', line: 4, startLine: null, side: 'RIGHT', severity: 'high', body: 'Null check', replyToCommentId: null }],
  }

  it('turns published drafts into private findings that can be dismissed', async () => {
    finishTurn(() => mocks.handlers!.onSelfReview(drafts))
    await authorSessions.selfReview(pr(30))
    await vi.waitFor(() => expect(session(30).status).toBe('awaiting_feedback'))
    expect(mocks.query.mock.calls[0][0].prompt).toBe('/review-pr https://github.com/acme/api/pull/30')
    expect(session(30).selfReview).toMatchObject({ verdict: 'Minor changes', findings: [{ id: 'self-1', kind: 'finding', severity: 'high' }] })

    authorSessions.dismissFinding(session(30).id, 'self-1')
    expect(session(30).selfReview?.findings).toEqual([])
  })

  it('drops the earlier self-review findings and their responses when a new one publishes', async () => {
    const sessionId = session(31).id
    finishTurn(() => mocks.handlers!.onSelfReview({ ...drafts, comments: [{ ...drafts.comments[0], body: 'Different problem' }] }))
    await authorSessions.feedback(sessionId, 'review again')
    await vi.waitFor(() => expect(session(31).status).toBe('awaiting_feedback'))
    expect(session(31).items.map((i) => i.id)).toEqual(['T1'])
    expect(Object.keys(session(31).responses)).toEqual(['T1'])
    expect(session(31).selfReview?.findings[0]).toMatchObject({ id: 'self-1', comments: [{ body: 'Different problem' }] })
  })

  it('maps draft comments to findings', () => {
    expect(findingsFromDrafts(drafts, 'now')[0]).toMatchObject({ path: 'a.ts', line: 4, comments: [{ body: 'Null check', createdAt: 'now' }] })
  })
})
