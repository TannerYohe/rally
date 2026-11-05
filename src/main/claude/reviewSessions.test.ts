import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Drafts, ReviewSession, SubmittedReview } from '@shared/types'

const SUBMITTED: SubmittedReview = { reviewId: 1, url: 'https://github.com/acme/api/pull/1#review-1', event: 'COMMENT' }

const drafts = (threadIds: string[]): Drafts => ({
  mode: 'followup',
  verdict: 'Looks good',
  reportMarkdown: '',
  summaryBody: '',
  comments: [],
  priorConcerns: threadIds.map((threadId, i) => ({ id: `C${i + 1}`, location: 'a.rb:1', gist: '', verdict: '', status: 'addressed', threadId })),
})

function storedSession(number: number, overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    id: `test-session-${number}`,
    pr: { owner: 'acme', repo: 'api', number, url: `https://github.com/acme/api/pull/${number}` },
    prKey: `acme/api#${number}`,
    sdkSessionId: null,
    status: 'awaiting_feedback',
    error: null,
    timeline: [],
    drafts: drafts(['T1']),
    submitted: null,
    createdAt: '2026-11-04T18:00:00.000Z',
    updatedAt: '2026-11-04T18:00:00.000Z',
    ...overrides,
  }
}

const mocks = vi.hoisted(() => ({
  stored: [] as ReviewSession[],
  resolveOwnThreads: vi.fn(),
  query: vi.fn(),
  handlers: null as null | { onSubmitted(review: SubmittedReview): void },
}))

vi.mock('../store', () => ({
  configFile: { get: () => ({ reviewSkill: 'review-pr' }) },
  sessionsDir: { readAll: () => mocks.stored, write: vi.fn(), remove: vi.fn() },
}))
vi.mock('../prList', () => ({ prList: { refreshOne: vi.fn(async () => {}) } }))
vi.mock('../github/threads', () => ({ fetchOwnThreads: vi.fn(), resolveOwnThreads: mocks.resolveOwnThreads }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('./executable', () => ({ claudeExecutable: () => 'claude' }))
vi.mock('./modelOptions', () => ({ reviewModelOptions: () => ({}) }))
vi.mock('./timeline', () => ({ reduceTimeline: (timeline: unknown) => timeline, closeOpenEntries: (timeline: unknown) => timeline }))
vi.mock('./rallyTools', () => ({
  RALLY_SERVER: 'rally',
  RALLY_TOOL_PREFIX: 'mcp__rally__',
  PUBLISH_DRAFTS_TOOL: 'mcp__rally__publish_drafts',
  REVIEW_SUBMITTED_TOOL: 'mcp__rally__review_submitted',
  createRallyServer: (handlers: { onSubmitted(review: SubmittedReview): void }) => {
    mocks.handlers = handlers
    return {}
  },
}))

mocks.stored = [
  storedSession(1),
  storedSession(2),
  storedSession(3),
  storedSession(4),
  storedSession(5),
  storedSession(6, { status: 'submitted', submitted: SUBMITTED, resolvingThreads: true, threadsToResolveOnSubmit: ['T1'] }),
  storedSession(7, { status: 'error', resolvingThreads: true, threadsToResolveOnSubmit: ['T1'] }),
  storedSession(8),
  storedSession(9),
]

const { reviewSessions } = await import('./reviewSessions')

const session = (number: number) => reviewSessions.getByPr(`acme/api#${number}`)!

function turn(options: { submits: boolean }) {
  return async function* () {
    if (options.submits) mocks.handlers?.onSubmitted(SUBMITTED)
    yield { type: 'result', subtype: 'success', is_error: false }
  }
}

beforeEach(() => {
  mocks.resolveOwnThreads.mockReset()
  mocks.query.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(() => {
  for (const stored of mocks.stored) rmSync(join(tmpdir(), 'rally', stored.id), { recursive: true, force: true })
})

describe('resolveThreads', () => {
  it('sets resolvingThreads while running and clears it on success', async () => {
    let finish: (value: unknown) => void = () => {}
    mocks.resolveOwnThreads.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const pending = reviewSessions.resolveThreads('test-session-1', ['T1'])
    expect(session(1).resolvingThreads).toBe(true)
    finish({ resolved: ['T1'], failed: [] })
    await pending
    expect(session(1).resolvingThreads).toBe(false)
    expect(session(1).threadResolution).toMatchObject({ resolved: ['T1'], failed: [] })
  })

  it('clears resolvingThreads and records every thread as failed when resolving throws', async () => {
    mocks.resolveOwnThreads.mockRejectedValue(new Error('network down'))
    await reviewSessions.resolveThreads('test-session-2', ['T1'])
    expect(session(2).resolvingThreads).toBe(false)
    expect(session(2).threadResolution).toMatchObject({ resolved: [], failed: [{ threadId: 'T1', error: 'network down' }] })
  })

  it("refuses ids outside the session's prior concerns", async () => {
    mocks.resolveOwnThreads.mockResolvedValue({ resolved: ['T1'], failed: [] })
    await reviewSessions.resolveThreads('test-session-3', ['T1', 'TX'])
    expect(mocks.resolveOwnThreads).toHaveBeenCalledWith(expect.anything(), ['T1'])
    expect(session(3).threadResolution?.failed).toEqual([{ threadId: 'TX', error: "Not one of this review's earlier comments" }])
  })
})

describe('discard', () => {
  it('refuses while threads are resolving', async () => {
    let finish: (value: unknown) => void = () => {}
    mocks.resolveOwnThreads.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const pending = reviewSessions.resolveThreads('test-session-4', ['T1'])
    expect(() => reviewSessions.discard('test-session-4')).toThrow('Wait for Rally to finish resolving threads')
    finish({ resolved: ['T1'], failed: [] })
    await pending
    expect(session(4)).toBeDefined()
  })
})

describe('submit', () => {
  it('does not resolve threads when the submit turn ends without a submitted review', async () => {
    mocks.query.mockImplementation(turn({ submits: false }))
    await reviewSessions.submit('test-session-5', 'COMMENT', '', ['T1'])
    await vi.waitFor(() => expect(session(5).status).toBe('error'))
    expect(mocks.resolveOwnThreads).not.toHaveBeenCalled()
    expect(session(5).threadsToResolveOnSubmit).toBeUndefined()
  })

  it('keeps the selection saved until the post-submit resolve settles', async () => {
    let finish: (value: unknown) => void = () => {}
    mocks.query.mockImplementation(turn({ submits: true }))
    mocks.resolveOwnThreads.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    await reviewSessions.submit('test-session-9', 'COMMENT', '', ['T1'])
    await vi.waitFor(() => expect(session(9).status).toBe('submitted'))
    await vi.waitFor(() => expect(mocks.resolveOwnThreads).toHaveBeenCalled())
    const midResolve = { resolvingThreads: true, threadsToResolveOnSubmit: ['T1'], submitted: SUBMITTED }
    expect(session(9)).toMatchObject(midResolve)
    expect(mocks.stored.find((stored) => stored.id === 'test-session-6')).toMatchObject(midResolve)
    finish({ resolved: ['T1'], failed: [] })
    await vi.waitFor(() => expect(session(9).threadsToResolveOnSubmit).toBeUndefined())
    expect(session(9).resolvingThreads).toBe(false)
  })

  it('resolves the selected threads once the review is submitted', async () => {
    mocks.query.mockImplementation(turn({ submits: true }))
    mocks.resolveOwnThreads.mockResolvedValue({ resolved: ['T1'], failed: [] })
    await reviewSessions.submit('test-session-8', 'COMMENT', '', ['T1'])
    await vi.waitFor(() => expect(session(8).threadResolution?.resolved).toEqual(['T1']))
    expect(session(8).status).toBe('submitted')
    expect(mocks.resolveOwnThreads).toHaveBeenCalledWith(expect.anything(), ['T1'])
  })
})

describe('restoring sessions', () => {
  it('reports the selection of a session saved mid-resolve after submit and clears the thread flags', () => {
    expect(session(6).resolvingThreads).toBe(false)
    expect(session(6).threadsToResolveOnSubmit).toBeUndefined()
    expect(session(6).threadResolution?.failed).toEqual([{ threadId: 'T1', error: expect.stringContaining('Rally closed before resolving') }])
  })

  it('drops a pending selection when the review was never submitted', () => {
    expect(session(7).threadsToResolveOnSubmit).toBeUndefined()
    expect(session(7).threadResolution).toBeUndefined()
  })
})
