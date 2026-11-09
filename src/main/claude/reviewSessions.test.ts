import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_COMMENT_REVIEW_ERROR, SUBMIT_WITH_INSTRUCTIONS_ERROR, type DraftChanges } from '@shared/feedback'
import type { DraftComment, Drafts, ReviewSession, SubmittedReview } from '@shared/types'
import type { SubmitOptions } from '../github/submitReview'

const SUBMITTED: SubmittedReview = { reviewId: 1, url: 'https://github.com/acme/api/pull/1#review-1', event: 'COMMENT' }

const NO_CHANGES: DraftChanges = { edits: {}, summaryBodyEdit: undefined, instructions: '' }

const THREAD_REPLY: DraftComment = {
  id: '1',
  kind: 'reply',
  path: null,
  line: null,
  startLine: null,
  side: 'RIGHT',
  severity: 'medium',
  body: 'Were you able to run that check?',
  replyToCommentId: 4460089612,
}

const drafts = (threadIds: string[]): Drafts => ({
  mode: 'followup',
  verdict: 'Looks good',
  reportMarkdown: '',
  summaryBody: 'Thanks for the fixes.',
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
  submitReview: vi.fn(),
  recordRallyReview: vi.fn(),
}))

vi.mock('../store', () => ({
  configFile: { get: () => ({ reviewSkill: 'review-pr' }) },
  sessionsDir: { readAll: () => mocks.stored, write: vi.fn(), remove: vi.fn() },
}))
vi.mock('../prList', () => ({
  prList: { refreshOne: vi.fn(async () => {}), recordRallyReview: mocks.recordRallyReview, get: () => ({ viewer: 'me' }) },
}))
vi.mock('../github/threads', () => ({ fetchOwnThreads: vi.fn(), resolveOwnThreads: mocks.resolveOwnThreads }))
vi.mock('../github/submitReview', () => ({ submitReview: mocks.submitReview }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('./executable', () => ({ claudeExecutable: () => 'claude' }))
vi.mock('./modelOptions', () => ({ reviewModelOptions: () => ({}) }))
vi.mock('./timeline', () => ({ reduceTimeline: (timeline: unknown) => timeline, closeOpenEntries: (timeline: unknown) => timeline }))
vi.mock('./rallyTools', () => ({
  RALLY_SERVER: 'rally',
  RALLY_TOOL_PREFIX: 'mcp__rally__',
  PUBLISH_DRAFTS_TOOL: 'mcp__rally__publish_drafts',
  createRallyServer: () => ({}),
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
  storedSession(10, { drafts: { ...drafts(['T1']), summaryBody: '  ' } }),
  storedSession(11, { drafts: { ...drafts(['T1']), summaryBody: '', comments: [THREAD_REPLY] } }),
  storedSession(12, { drafts: { ...drafts(['T1']), comments: [THREAD_REPLY] } }),
  storedSession(13, { status: 'submitting', submitAttemptReviewId: 55 }),
  storedSession(14),
  storedSession(15),
  storedSession(16),
]

const { reviewSessions } = await import('./reviewSessions')

const session = (number: number) => reviewSessions.getByPr(`acme/api#${number}`)!

beforeEach(() => {
  mocks.resolveOwnThreads.mockReset()
  mocks.query.mockReset()
  mocks.submitReview.mockReset()
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
  it('reports the failure and does not resolve threads when posting fails', async () => {
    mocks.submitReview.mockRejectedValue(new Error('Submitting the review failed while submitting the review: Validation Failed'))
    await expect(reviewSessions.submit('test-session-5', 'COMMENT', NO_CHANGES, ['T1'])).rejects.toThrow('Validation Failed')
    expect(session(5)).toMatchObject({ status: 'error', error: expect.stringContaining('Validation Failed'), submitted: null })
    expect(session(5).threadsToResolveOnSubmit).toBeUndefined()
    expect(mocks.resolveOwnThreads).not.toHaveBeenCalled()
  })

  it('keeps the selection saved until the post-submit resolve settles', async () => {
    let finish: (value: unknown) => void = () => {}
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    mocks.resolveOwnThreads.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    await reviewSessions.submit('test-session-9', 'COMMENT', NO_CHANGES, ['T1'])
    expect(session(9).status).toBe('submitted')
    await vi.waitFor(() => expect(mocks.resolveOwnThreads).toHaveBeenCalled())
    const midResolve = { resolvingThreads: true, threadsToResolveOnSubmit: ['T1'], submitted: SUBMITTED }
    expect(session(9)).toMatchObject(midResolve)
    expect(mocks.stored.find((stored) => stored.id === 'test-session-6')).toMatchObject(midResolve)
    finish({ resolved: ['T1'], failed: [] })
    await vi.waitFor(() => expect(session(9).threadsToResolveOnSubmit).toBeUndefined())
    expect(session(9).resolvingThreads).toBe(false)
  })

  it('records the submitted review id for the PR', async () => {
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    await reviewSessions.submit('test-session-4', 'COMMENT', NO_CHANGES, [])
    expect(session(4).status).toBe('submitted')
    expect(mocks.recordRallyReview).toHaveBeenCalledWith('acme/api#4', SUBMITTED.reviewId)
  })

  it('rejects a Comment review with nothing to post before posting', async () => {
    await expect(reviewSessions.submit('test-session-10', 'COMMENT', NO_CHANGES, ['T1'])).rejects.toThrow(EMPTY_COMMENT_REVIEW_ERROR)
    expect(mocks.submitReview).not.toHaveBeenCalled()
    expect(session(10).status).toBe('awaiting_feedback')
  })

  it('rejects free-text instructions, which only Claude can apply', async () => {
    const changes = { ...NO_CHANGES, instructions: 'Add a thank-you body.' }
    await expect(reviewSessions.submit('test-session-12', 'COMMENT', changes, [])).rejects.toThrow(SUBMIT_WITH_INSTRUCTIONS_ERROR)
    expect(mocks.submitReview).not.toHaveBeenCalled()
    expect(session(12).status).toBe('awaiting_feedback')
  })

  it('rejects a Comment review once the user drops every draft and clears the body', async () => {
    const dropAll: DraftChanges = { edits: { '1': { dropped: true } }, summaryBodyEdit: '', instructions: '' }
    await expect(reviewSessions.submit('test-session-12', 'COMMENT', dropAll, [])).rejects.toThrow(EMPTY_COMMENT_REVIEW_ERROR)
    expect(mocks.submitReview).not.toHaveBeenCalled()
  })

  it('posts the drafts with the user edits applied', async () => {
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    const changes: DraftChanges = { edits: { '1': { body: 'Rewritten.' } }, summaryBodyEdit: 'New body', instructions: '' }
    await reviewSessions.submit('test-session-12', 'REQUEST_CHANGES', changes, [])
    expect(mocks.submitReview).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'api', number: 12 }),
      'REQUEST_CHANGES',
      { body: 'New body', inline: [], replies: [{ ...THREAD_REPLY, body: 'Rewritten.' }], folded: [] },
      expect.objectContaining({ attemptReviewId: null }),
    )
  })

  it('posts an empty review when the event is not Comment, and a Comment whose only content is a thread reply', async () => {
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    await reviewSessions.submit('test-session-10', 'APPROVE', NO_CHANGES, [])
    await reviewSessions.submit('test-session-11', 'COMMENT', NO_CHANGES, [])
    expect(mocks.submitReview).toHaveBeenCalledTimes(2)
    expect(session(10).status).toBe('submitted')
    expect(session(11).status).toBe('submitted')
  })

  it('checks the saved attempt when a submit was interrupted by Rally closing', async () => {
    expect(session(13)).toMatchObject({ status: 'error', error: expect.stringContaining('Rally closed while submitting') })
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    await reviewSessions.submit('test-session-13', 'COMMENT', NO_CHANGES, [])
    expect(mocks.submitReview.mock.calls[0][3]).toMatchObject({ attemptReviewId: 55 })
    expect(session(13).submitAttemptReviewId).toBeUndefined()
  })

  it('saves the pending review id while posting and checks it on retry when cleanup failed', async () => {
    mocks.submitReview.mockImplementationOnce(async (_pr, _event, _review, options: SubmitOptions) => {
      options.onPendingReview(88)
      throw new Error('timeout')
    })
    await expect(reviewSessions.submit('test-session-14', 'COMMENT', NO_CHANGES, [])).rejects.toThrow('timeout')
    expect(mocks.submitReview.mock.calls[0][3]).toMatchObject({ attemptReviewId: null })
    expect(session(14).submitAttemptReviewId).toBe(88)

    mocks.submitReview.mockResolvedValue(SUBMITTED)
    await reviewSessions.submit('test-session-14', 'COMMENT', NO_CHANGES, [])
    expect(mocks.submitReview.mock.calls[1][3]).toMatchObject({ attemptReviewId: 88 })
  })

  it('forgets the attempt once cleanup deleted its pending review', async () => {
    mocks.submitReview.mockImplementationOnce(async (_pr, _event, _review, options: SubmitOptions) => {
      options.onPendingReview(89)
      options.onPendingReview(null)
      throw new Error('Validation Failed')
    })
    await expect(reviewSessions.submit('test-session-16', 'COMMENT', NO_CHANGES, [])).rejects.toThrow('Validation Failed')
    expect(session(16).submitAttemptReviewId).toBeUndefined()
  })

  it('blocks another submit, a feedback turn, and discarding while posting', async () => {
    let finish: (value: SubmittedReview) => void = () => {}
    mocks.submitReview.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const pending = reviewSessions.submit('test-session-15', 'COMMENT', NO_CHANGES, [])
    expect(session(15).status).toBe('submitting')
    await expect(reviewSessions.submit('test-session-15', 'COMMENT', NO_CHANGES, [])).rejects.toThrow('already submitting')
    await expect(reviewSessions.feedback('test-session-15', 'one more thing')).rejects.toThrow('already submitting')
    expect(() => reviewSessions.discard('test-session-15')).toThrow('Wait for Rally to finish submitting')
    finish(SUBMITTED)
    await pending
    expect(session(15).status).toBe('submitted')
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('resolves the selected threads once the review is submitted', async () => {
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    mocks.resolveOwnThreads.mockResolvedValue({ resolved: ['T1'], failed: [] })
    await reviewSessions.submit('test-session-8', 'COMMENT', NO_CHANGES, ['T1'])
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
