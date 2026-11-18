import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_COMMENT_REVIEW_ERROR, SUBMIT_WITH_INSTRUCTIONS_ERROR, type DraftChanges } from '@shared/feedback'
import type { DraftComment, Drafts, MemberVerdict, ReviewEvent, ReviewSession, SubmitEvent, SubmittedReview } from '@shared/types'
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

const WEB = { owner: 'acme', repo: 'web', number: 2, url: 'https://github.com/acme/web/pull/2' }

function unitDrafts(number: number): Drafts {
  return {
    mode: 'followup',
    verdict: 'Needs changes',
    reportMarkdown: '',
    summaryBody: '',
    comments: [
      { ...THREAD_REPLY, id: '1', prKey: `acme/api#${number}` },
      { ...THREAD_REPLY, id: '2', replyToCommentId: 77, prKey: 'acme/web#2' },
    ],
    priorConcerns: [
      { id: 'C1', location: 'a.rb:1', gist: '', verdict: '', status: 'addressed', threadId: 'T-api', prKey: `acme/api#${number}` },
      { id: 'C2', location: 'b.ts:1', gist: '', verdict: '', status: 'addressed', threadId: 'T-web', prKey: 'acme/web#2' },
    ],
    prReviews: [
      { prKey: `acme/api#${number}`, verdict: 'Looks good', summaryBody: 'API body' },
      { prKey: 'acme/web#2', verdict: 'Needs changes', summaryBody: 'Web body' },
    ],
  }
}

function storedUnit(number: number, overrides: Partial<ReviewSession> = {}): ReviewSession {
  const base = storedSession(number)
  return { ...base, members: [base.pr, WEB], drafts: unitDrafts(number), ...overrides }
}

const docs = (number: number) => ({ owner: 'acme', repo: 'docs', number, url: `https://github.com/acme/docs/pull/${number}` })

function storedDocs(number: number, overrides: Partial<ReviewSession> = {}): ReviewSession {
  return storedSession(number, { id: `test-docs-${number}`, pr: docs(number), prKey: `acme/docs#${number}`, ...overrides })
}

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
  fetchOwnThreads: vi.fn(),
  query: vi.fn(),
  submitReview: vi.fn(),
  recordRallyReview: vi.fn(),
  describeReplies: vi.fn(),
  refreshMany: vi.fn(async () => {}),
  onDrafts: (_drafts: Drafts) => {},
}))

vi.mock('../store', () => ({
  configFile: { get: () => ({ reviewSkill: 'review-pr' }) },
  sessionsDir: { readAll: () => mocks.stored, write: vi.fn(), remove: vi.fn() },
}))
vi.mock('../prList', () => ({
  prList: { refreshMany: mocks.refreshMany, recordRallyReview: mocks.recordRallyReview, get: () => ({ viewer: 'me' }) },
}))
vi.mock('../github/threads', () => ({ fetchOwnThreads: mocks.fetchOwnThreads, resolveOwnThreads: mocks.resolveOwnThreads }))
vi.mock('../github/reviewComments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../github/reviewComments')>()),
  describeReplies: mocks.describeReplies,
}))
vi.mock('../github/submitReview', () => ({ submitReview: mocks.submitReview }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('./executable', () => ({ claudeExecutable: () => 'claude' }))
vi.mock('./modelOptions', () => ({ reviewModelOptions: () => ({}) }))
vi.mock('./timeline', () => ({ reduceTimeline: (timeline: unknown) => timeline, closeOpenEntries: (timeline: unknown) => timeline }))
vi.mock('./rallyTools', () => ({
  RALLY_SERVER: 'rally',
  RALLY_TOOL_PREFIX: 'mcp__rally__',
  PUBLISH_DRAFTS_TOOL: 'mcp__rally__publish_drafts',
  createRallyServer: (handlers: { onDrafts(drafts: Drafts): void }) => {
    mocks.onDrafts = handlers.onDrafts
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
  storedSession(10, { drafts: { ...drafts(['T1']), summaryBody: '  ' } }),
  storedSession(11, { drafts: { ...drafts(['T1']), summaryBody: '', comments: [THREAD_REPLY] } }),
  storedSession(12, { drafts: { ...drafts(['T1']), comments: [THREAD_REPLY] } }),
  storedSession(13, { status: 'submitting', submitAttemptReviewId: 55 }),
  storedSession(14),
  storedSession(15),
  storedSession(16),
  storedSession(17),
  storedSession(18),
  storedSession(19),
  storedSession(20),
  storedSession(21),
  storedSession(22, { drafts: { ...drafts([]), comments: [THREAD_REPLY] } }),
  storedSession(23, { status: 'submitted', submitted: SUBMITTED, drafts: { ...drafts([]), comments: [THREAD_REPLY] } }),
  storedSession(24, { drafts: { ...drafts([]), comments: [THREAD_REPLY] } }),
  storedUnit(30),
  storedUnit(31),
  storedUnit(32),
  storedUnit(33),
  storedUnit(34),
  storedUnit(35),
  storedUnit(36),
  storedUnit(37, { drafts: { ...unitDrafts(37), comments: [{ ...THREAD_REPLY, id: '9' }] } }),
  storedUnit(38, {
    status: 'submitting',
    memberSubmits: { 'acme/web#2': { submitted: SUBMITTED }, 'acme/api#38': { submitted: null, attemptReviewId: 66 } },
  }),
  storedUnit(39),
  storedUnit(41, { members: [storedSession(41).pr, docs(7)], drafts: null }),
  storedSession(42),
  storedDocs(8),
  storedDocs(9),
  storedSession(43),
  storedUnit(44, { status: 'error', memberSubmits: { 'acme/web#2': { submitted: { ...SUBMITTED, reviewId: 2 } } } }),
  storedUnit(45),
  storedUnit(46),
  storedUnit(47),
  storedSession(50),
  storedDocs(10),
  storedSession(51),
  storedDocs(11),
  storedSession(52, { status: 'error', members: [storedSession(52).pr, docs(12)], memberSubmits: { 'acme/docs#12': { submitted: SUBMITTED } } }),
]

const { PARTLY_POSTED_ERROR, reviewSessions } = await import('./reviewSessions')

const verdict = (number: number, event: SubmitEvent): MemberVerdict[] => [{ prKey: `acme/api#${number}`, event }]

const session = (number: number) => reviewSessions.getByPr(`acme/api#${number}`)!

beforeEach(() => {
  mocks.resolveOwnThreads.mockReset()
  mocks.query.mockReset()
  mocks.submitReview.mockReset()
  mocks.describeReplies.mockReset()
  mocks.fetchOwnThreads.mockReset()
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
    await expect(reviewSessions.submit('test-session-5', verdict(5, 'COMMENT'), NO_CHANGES, ['T1'])).rejects.toThrow('Validation Failed')
    expect(session(5)).toMatchObject({ status: 'error', error: expect.stringContaining('Validation Failed'), submitted: null })
    expect(session(5).threadsToResolveOnSubmit).toBeUndefined()
    expect(mocks.resolveOwnThreads).not.toHaveBeenCalled()
  })

  it('keeps the selection saved until the post-submit resolve settles', async () => {
    let finish: (value: unknown) => void = () => {}
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    mocks.resolveOwnThreads.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    await reviewSessions.submit('test-session-9', verdict(9, 'COMMENT'), NO_CHANGES, ['T1'])
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
    await reviewSessions.submit('test-session-4', verdict(4, 'COMMENT'), NO_CHANGES, [])
    expect(session(4).status).toBe('submitted')
    expect(mocks.recordRallyReview).toHaveBeenCalledWith('acme/api#4', SUBMITTED.reviewId)
  })

  it('rejects a Comment review with nothing to post before posting', async () => {
    await expect(reviewSessions.submit('test-session-10', verdict(10, 'COMMENT'), NO_CHANGES, ['T1'])).rejects.toThrow(EMPTY_COMMENT_REVIEW_ERROR)
    expect(mocks.submitReview).not.toHaveBeenCalled()
    expect(session(10).status).toBe('awaiting_feedback')
  })

  it('rejects free-text instructions, which only Claude can apply', async () => {
    const changes = { ...NO_CHANGES, instructions: 'Add a thank-you body.' }
    await expect(reviewSessions.submit('test-session-12', verdict(12, 'COMMENT'), changes, [])).rejects.toThrow(SUBMIT_WITH_INSTRUCTIONS_ERROR)
    expect(mocks.submitReview).not.toHaveBeenCalled()
    expect(session(12).status).toBe('awaiting_feedback')
  })

  it('rejects a Comment review once the user drops every draft and clears the body', async () => {
    const dropAll: DraftChanges = { edits: { '1': { dropped: true } }, summaryBodyEdit: '', instructions: '' }
    await expect(reviewSessions.submit('test-session-12', verdict(12, 'COMMENT'), dropAll, [])).rejects.toThrow(EMPTY_COMMENT_REVIEW_ERROR)
    expect(mocks.submitReview).not.toHaveBeenCalled()
  })

  it('posts the drafts with the user edits applied', async () => {
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    const changes: DraftChanges = { edits: { '1': { body: 'Rewritten.' } }, summaryBodyEdit: 'New body', instructions: '' }
    await reviewSessions.submit('test-session-12', verdict(12, 'REQUEST_CHANGES'), changes, [])
    expect(mocks.submitReview).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'api', number: 12 }),
      'REQUEST_CHANGES',
      { body: 'New body', inline: [], replies: [{ ...THREAD_REPLY, body: 'Rewritten.' }], folded: [] },
      expect.objectContaining({ attemptReviewId: null }),
    )
  })

  it('posts an empty review when the event is not Comment, and a Comment whose only content is a thread reply', async () => {
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    await reviewSessions.submit('test-session-10', verdict(10, 'APPROVE'), NO_CHANGES, [])
    await reviewSessions.submit('test-session-11', verdict(11, 'COMMENT'), NO_CHANGES, [])
    expect(mocks.submitReview).toHaveBeenCalledTimes(2)
    expect(session(10).status).toBe('submitted')
    expect(session(11).status).toBe('submitted')
  })

  it('checks the saved attempt when a submit was interrupted by Rally closing', async () => {
    expect(session(13)).toMatchObject({ status: 'error', error: expect.stringContaining('Rally closed while submitting') })
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    await reviewSessions.submit('test-session-13', verdict(13, 'COMMENT'), NO_CHANGES, [])
    expect(mocks.submitReview.mock.calls[0][3]).toMatchObject({ attemptReviewId: 55 })
    expect(session(13).submitAttemptReviewId).toBeUndefined()
  })

  it('saves the pending review id while posting and checks it on retry when cleanup failed', async () => {
    mocks.submitReview.mockImplementationOnce(async (_pr, _event, _review, options: SubmitOptions) => {
      options.onPendingReview(88)
      throw new Error('timeout')
    })
    await expect(reviewSessions.submit('test-session-14', verdict(14, 'COMMENT'), NO_CHANGES, [])).rejects.toThrow('timeout')
    expect(mocks.submitReview.mock.calls[0][3]).toMatchObject({ attemptReviewId: null })
    expect(session(14).memberSubmits?.['acme/api#14']).toEqual({ submitted: null, attemptReviewId: 88, error: 'timeout' })

    mocks.submitReview.mockResolvedValue(SUBMITTED)
    await reviewSessions.submit('test-session-14', verdict(14, 'COMMENT'), NO_CHANGES, [])
    expect(mocks.submitReview.mock.calls[1][3]).toMatchObject({ attemptReviewId: 88 })
  })

  it('forgets the attempt once cleanup deleted its pending review', async () => {
    mocks.submitReview.mockImplementationOnce(async (_pr, _event, _review, options: SubmitOptions) => {
      options.onPendingReview(89)
      options.onPendingReview(null)
      throw new Error('Validation Failed')
    })
    await expect(reviewSessions.submit('test-session-16', verdict(16, 'COMMENT'), NO_CHANGES, [])).rejects.toThrow('Validation Failed')
    expect(session(16).memberSubmits?.['acme/api#16']?.attemptReviewId).toBeUndefined()
  })

  it('blocks another submit, a feedback turn, and discarding while posting', async () => {
    let finish: (value: SubmittedReview) => void = () => {}
    mocks.submitReview.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const pending = reviewSessions.submit('test-session-15', verdict(15, 'COMMENT'), NO_CHANGES, [])
    expect(session(15).status).toBe('submitting')
    await expect(reviewSessions.submit('test-session-15', verdict(15, 'COMMENT'), NO_CHANGES, [])).rejects.toThrow('already posting')
    await expect(reviewSessions.feedback('test-session-15', 'one more thing')).rejects.toThrow('already posting')
    expect(() => reviewSessions.discard('test-session-15')).toThrow('Wait for Rally to finish submitting')
    finish(SUBMITTED)
    await pending
    expect(session(15).status).toBe('submitted')
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('resolves the selected threads once the review is submitted', async () => {
    mocks.submitReview.mockResolvedValue(SUBMITTED)
    mocks.resolveOwnThreads.mockResolvedValue({ resolved: ['T1'], failed: [] })
    await reviewSessions.submit('test-session-8', verdict(8, 'COMMENT'), NO_CHANGES, ['T1'])
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

describe('publishing drafts', () => {
  const TARGET = {
    found: true,
    comment: { author: 'octocat', path: 'a.rb', line: 3, excerpt: 'Should this be memoized?', url: 'https://github.com/acme/api/pull/17#discussion_r1' },
  }

  const withTargets = (d: Drafts): Drafts => ({ ...d, comments: d.comments.map((c) => ({ ...c, replyTarget: TARGET })) })

  function publishOnTurn(...published: Drafts[]) {
    mocks.query.mockImplementation(async function* () {
      for (const d of published) mocks.onDrafts(d)
      yield { type: 'result', subtype: 'success', is_error: false }
    })
  }

  function deferredLookup(): (described: Drafts) => void {
    let finish: (described: Drafts) => void = () => {}
    mocks.describeReplies.mockReturnValueOnce(new Promise<Drafts>((resolve) => (finish = resolve)))
    return (described) => finish(described)
  }

  it('describes the comment each reply answers', async () => {
    const published = { ...drafts([]), comments: [THREAD_REPLY] }
    mocks.describeReplies.mockImplementation(async (_pr, d: Drafts) => withTargets(d))
    publishOnTurn(published)
    await reviewSessions.feedback('test-session-17', 'go')
    await vi.waitFor(() => expect(session(17).drafts?.comments[0].replyTarget).toEqual(TARGET))
    expect(mocks.describeReplies).toHaveBeenCalledWith(expect.objectContaining({ number: 17 }), published)
  })

  it('keeps the published drafts when the lookup fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const published = { ...drafts([]), comments: [THREAD_REPLY] }
    mocks.describeReplies.mockRejectedValue(new Error('rate limited'))
    publishOnTurn(published)
    await reviewSessions.feedback('test-session-18', 'go')
    await vi.waitFor(() => expect(session(18).status).toBe('awaiting_feedback'))
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ sessionId: 'test-session-18', error: expect.any(Error) }))
    expect(session(18).drafts).toEqual(published)
  })

  it('drops a lookup that finishes after Claude published newer drafts', async () => {
    const first = { ...drafts([]), comments: [{ ...THREAD_REPLY, body: 'First.' }] }
    const second = { ...drafts([]), comments: [{ ...THREAD_REPLY, body: 'Second.' }] }
    const finishFirst = deferredLookup()
    mocks.describeReplies.mockImplementationOnce(async (_pr, d: Drafts) => withTargets(d))
    publishOnTurn(first, second)
    await reviewSessions.feedback('test-session-20', 'go')
    await vi.waitFor(() => expect(session(20).drafts).toEqual(withTargets(second)))
    finishFirst(withTargets(first))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session(20).drafts).toEqual(withTargets(second))
  })

  it('drops a late lookup when the newer drafts have no replies to look up', async () => {
    const first = { ...drafts([]), comments: [THREAD_REPLY] }
    const second = { ...drafts([]), comments: [] }
    const finishFirst = deferredLookup()
    publishOnTurn(first, second)
    await reviewSessions.feedback('test-session-21', 'go')
    await vi.waitFor(() => expect(session(21).status).toBe('awaiting_feedback'))
    finishFirst(withTargets(first))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session(21).drafts).toEqual(second)
    expect(mocks.describeReplies).toHaveBeenCalledTimes(1)
  })

  it('looks up reply targets missing from a restored review when it is opened, once at a time', async () => {
    const finish = deferredLookup()
    reviewSessions.open('acme/api#22')
    reviewSessions.open('acme/api#22')
    expect(mocks.describeReplies).toHaveBeenCalledTimes(1)
    finish(withTargets(session(22).drafts!))
    await vi.waitFor(() => expect(session(22).drafts?.comments[0].replyTarget).toEqual(TARGET))
    reviewSessions.open('acme/api#22')
    expect(mocks.describeReplies).toHaveBeenCalledTimes(1)
  })

  it('retries a failed lookup the next time the review is opened', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.describeReplies.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async (_pr, d: Drafts) => withTargets(d))
    reviewSessions.open('acme/api#24')
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
    reviewSessions.open('acme/api#24')
    await vi.waitFor(() => expect(session(24).drafts?.comments[0].replyTarget).toEqual(TARGET))
    expect(mocks.describeReplies).toHaveBeenCalledTimes(2)
  })

  it('does not look up reply targets for a submitted review', () => {
    reviewSessions.open('acme/api#23')
    expect(mocks.describeReplies).not.toHaveBeenCalled()
  })

  it('ignores drafts published after the session was discarded', async () => {
    publishOnTurn({ ...drafts([]), comments: [] })
    await reviewSessions.feedback('test-session-19', 'go')
    await vi.waitFor(() => expect(session(19).status).toBe('awaiting_feedback'))
    reviewSessions.discard('test-session-19')
    mocks.onDrafts({ ...drafts([]), comments: [THREAD_REPLY] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.describeReplies).not.toHaveBeenCalled()
  })
})

describe('a review of several PRs', () => {
  const thread = (id: string) => ({ id, url: `https://github.com/t/${id}`, isResolved: false, isOutdated: false })

  it('reads each PR threads from the earlier comments on that PR', async () => {
    mocks.fetchOwnThreads.mockImplementation(async (pr: { repo: string }, ids: string[]) => ids.map(thread))
    const threads = await reviewSessions.threads('test-session-30')
    expect(mocks.fetchOwnThreads.mock.calls).toEqual([
      [expect.objectContaining({ repo: 'api', number: 30 }), ['T-api']],
      [expect.objectContaining({ repo: 'web', number: 2 }), ['T-web']],
    ])
    expect(threads.map((t) => t.id)).toEqual(['T-api', 'T-web'])
  })

  it('resolves each thread on the PR that owns it and keeps going when one PR fails', async () => {
    mocks.resolveOwnThreads.mockImplementation(async (pr: { repo: string }, ids: string[]) => {
      if (pr.repo === 'web') throw new Error('forbidden')
      return { resolved: ids, failed: [] }
    })
    const result = await reviewSessions.resolveThreads('test-session-31', ['T-web', 'T-api', 'TX'])
    expect(mocks.resolveOwnThreads.mock.calls).toEqual([
      [expect.objectContaining({ repo: 'api' }), ['T-api']],
      [expect.objectContaining({ repo: 'web' }), ['T-web']],
    ])
    expect(result.resolved).toEqual(['T-api'])
    expect(result.failed).toEqual([
      { threadId: 'T-web', error: 'forbidden' },
      { threadId: 'TX', error: "Not one of this review's earlier comments" },
    ])
  })

  it('looks up reply targets on the PR each reply is on and merges them back', async () => {
    const found = (url: string) => ({ found: true as const, comment: { author: 'octocat', path: 'a', line: 1, excerpt: '', url } })
    mocks.describeReplies.mockImplementation(async (pr: { repo: string }, d: Drafts) => ({
      ...d,
      comments: d.comments.map((c) => ({ ...c, replyTarget: found(pr.repo) })),
    }))
    reviewSessions.open('acme/api#32')
    await vi.waitFor(() => expect(session(32).drafts?.comments.map((c) => c.replyTarget)).toEqual([found('api'), found('web')]))
    expect(mocks.describeReplies.mock.calls.map(([pr, d]) => [pr.repo, d.comments.map((c: DraftComment) => c.id)])).toEqual([
      ['api', ['1']],
      ['web', ['2']],
    ])
    expect(session(32).drafts?.prReviews).toHaveLength(2)
  })
})

describe('submitting a review of several PRs', () => {
  const unitVerdicts = (number: number, api: SubmitEvent, web: SubmitEvent): MemberVerdict[] => [
    { prKey: `acme/api#${number}`, event: api },
    { prKey: 'acme/web#2', event: web },
  ]
  const review = (id: number, event: ReviewEvent): SubmittedReview => ({ reviewId: id, url: `https://github.com/r/${id}`, event })
  const postedRepos = () => mocks.submitReview.mock.calls.map(([pr, event]) => `${pr.repo}:${event}`)

  beforeEach(() => mocks.refreshMany.mockClear())

  it('posts each PR its own review, Request changes before Approve, then refreshes every PR', async () => {
    mocks.submitReview.mockImplementation(async (pr: { repo: string }, event: ReviewEvent) => review(pr.repo === 'web' ? 2 : 1, event))
    await reviewSessions.submit('test-session-33', unitVerdicts(33, 'APPROVE', 'REQUEST_CHANGES'), NO_CHANGES, [])
    expect(postedRepos()).toEqual(['web:REQUEST_CHANGES', 'api:APPROVE'])
    expect(mocks.submitReview.mock.calls[0][2]).toEqual({ body: 'Web body', inline: [], replies: [unitDrafts(33).comments[1]], folded: [] })
    expect(mocks.submitReview.mock.calls[1][2]).toMatchObject({ body: 'API body', replies: [unitDrafts(33).comments[0]] })
    expect(mocks.recordRallyReview).toHaveBeenCalledWith('acme/web#2', 2)
    expect(mocks.recordRallyReview).toHaveBeenCalledWith('acme/api#33', 1)
    expect(session(33)).toMatchObject({ status: 'submitted', submitted: review(1, 'APPROVE') })
    expect(session(33).memberSubmits).toEqual({ 'acme/web#2': { submitted: review(2, 'REQUEST_CHANGES') }, 'acme/api#33': { submitted: review(1, 'APPROVE') } })
    expect(mocks.refreshMany).toHaveBeenCalledWith([expect.objectContaining({ number: 33 }), expect.objectContaining({ repo: 'web' })])
  })

  it('stops at the first failure, blocks Claude turns, and retries only the PRs still missing', async () => {
    mocks.submitReview.mockImplementationOnce(async () => review(2, 'REQUEST_CHANGES')).mockRejectedValueOnce(new Error('rate limited'))
    await expect(reviewSessions.submit('test-session-34', unitVerdicts(34, 'APPROVE', 'REQUEST_CHANGES'), NO_CHANGES, [])).rejects.toThrow('rate limited')
    expect(session(34)).toMatchObject({ status: 'error', error: 'acme/api#34: rate limited', submitted: null })
    expect(session(34).memberSubmits?.['acme/api#34']).toMatchObject({ submitted: null, error: 'rate limited' })
    await expect(reviewSessions.feedback('test-session-34', 'tweak 1')).rejects.toThrow(PARTLY_POSTED_ERROR)

    mocks.submitReview.mockResolvedValueOnce(review(1, 'APPROVE'))
    await reviewSessions.submit('test-session-34', unitVerdicts(34, 'APPROVE', 'COMMENT'), NO_CHANGES, [])
    expect(postedRepos()).toEqual(['web:REQUEST_CHANGES', 'api:APPROVE', 'api:APPROVE'])
    expect(session(34)).toMatchObject({ status: 'submitted', submitted: review(1, 'APPROVE') })
  })

  it('stops at a failed first post without posting the rest', async () => {
    mocks.submitReview.mockRejectedValueOnce(new Error('rate limited'))
    await expect(reviewSessions.submit('test-session-46', unitVerdicts(46, 'APPROVE', 'REQUEST_CHANGES'), NO_CHANGES, [])).rejects.toThrow('rate limited')
    expect(postedRepos()).toEqual(['web:REQUEST_CHANGES'])
    expect(session(46).memberSubmits?.['acme/api#46']).toBeUndefined()
    expect(mocks.recordRallyReview).not.toHaveBeenCalledWith('acme/api#46', expect.anything())
  })

  it('finishes a partly posted unit when every remaining PR is skipped', async () => {
    await reviewSessions.submit('test-session-44', [{ prKey: 'acme/api#44', event: 'SKIP' }], NO_CHANGES, [])
    expect(mocks.submitReview).not.toHaveBeenCalled()
    expect(session(44)).toMatchObject({ status: 'submitted', submitted: { ...SUBMITTED, reviewId: 2 } })
  })

  it('records the posted sibling as the submitted review when the session PR is skipped', async () => {
    mocks.submitReview.mockResolvedValue(review(2, 'COMMENT'))
    await reviewSessions.submit('test-session-45', unitVerdicts(45, 'SKIP', 'COMMENT'), NO_CHANGES, [])
    expect(postedRepos()).toEqual(['web:COMMENT'])
    expect(session(45)).toMatchObject({ status: 'submitted', submitted: review(2, 'COMMENT') })
  })

  it('resolves selected threads only on the PRs that posted', async () => {
    mocks.submitReview.mockResolvedValue(review(1, 'COMMENT'))
    mocks.resolveOwnThreads.mockImplementation(async (_pr, ids: string[]) => ({ resolved: ids, failed: [] }))
    await reviewSessions.submit('test-session-47', unitVerdicts(47, 'COMMENT', 'SKIP'), NO_CHANGES, ['T-api', 'T-web'])
    await vi.waitFor(() => expect(session(47).threadResolution?.resolved).toEqual(['T-api']))
    expect(mocks.resolveOwnThreads).toHaveBeenCalledTimes(1)
    expect(mocks.resolveOwnThreads.mock.calls[0][0]).toMatchObject({ repo: 'api' })
  })

  it('skips a PR and refuses to skip every PR', async () => {
    await expect(reviewSessions.submit('test-session-35', unitVerdicts(35, 'SKIP', 'SKIP'), NO_CHANGES, [])).rejects.toThrow('at least one PR')
    mocks.submitReview.mockResolvedValue(review(1, 'COMMENT'))
    await reviewSessions.submit('test-session-35', unitVerdicts(35, 'COMMENT', 'SKIP'), NO_CHANGES, [])
    expect(postedRepos()).toEqual(['api:COMMENT'])
    expect(session(35).status).toBe('submitted')
  })

  it('checks every PR before anything posts', async () => {
    const emptyWeb: DraftChanges = { edits: { '2': { dropped: true } }, summaryBodyEdit: undefined, summaryBodyEdits: { 'acme/web#2': '' }, instructions: '' }
    await expect(reviewSessions.submit('test-session-36', unitVerdicts(36, 'APPROVE', 'COMMENT'), emptyWeb, [])).rejects.toThrow(
      `acme/web#2: ${EMPTY_COMMENT_REVIEW_ERROR}`,
    )
    await expect(reviewSessions.submit('test-session-36', [{ prKey: 'acme/api#36', event: 'APPROVE' }], NO_CHANGES, [])).rejects.toThrow(
      'Pick a verdict for acme/web#2.',
    )
    await expect(reviewSessions.submit('test-session-37', unitVerdicts(37, 'APPROVE', 'APPROVE'), NO_CHANGES, [])).rejects.toThrow('Draft #9 names no PR')
    expect(mocks.submitReview).not.toHaveBeenCalled()
    expect(session(36).status).toBe('awaiting_feedback')
  })

  it('resumes a unit Rally closed while posting, checking the saved attempt and posting nothing twice', async () => {
    expect(session(38)).toMatchObject({ status: 'error', error: expect.stringContaining('Rally closed while submitting') })
    mocks.submitReview.mockResolvedValue(review(1, 'COMMENT'))
    await reviewSessions.submit('test-session-38', unitVerdicts(38, 'COMMENT', 'COMMENT'), NO_CHANGES, [])
    expect(postedRepos()).toEqual(['api:COMMENT'])
    expect(mocks.submitReview.mock.calls[0][3]).toMatchObject({ attemptReviewId: 66 })
    expect(session(38).status).toBe('submitted')
  })

  it('resolves each selected thread on its own PR once every PR posted', async () => {
    mocks.submitReview.mockImplementation(async (_pr, event: ReviewEvent) => review(1, event))
    mocks.resolveOwnThreads.mockImplementation(async (_pr, ids: string[]) => {
      expect(mocks.submitReview).toHaveBeenCalledTimes(2)
      return { resolved: ids, failed: [] }
    })
    await reviewSessions.submit('test-session-39', unitVerdicts(39, 'COMMENT', 'COMMENT'), NO_CHANGES, ['T-api', 'T-web'])
    await vi.waitFor(() => expect(session(39).threadResolution?.resolved).toEqual(['T-api', 'T-web']))
    expect(mocks.resolveOwnThreads).toHaveBeenCalledTimes(2)
  })
})

describe('starting a review of several PRs', () => {
  it('finds a unit session from any of its PRs', () => {
    expect(reviewSessions.getByPr('acme/docs#7')?.id).toBe('test-session-41')
    expect(reviewSessions.sessionState('acme/docs#7')).toEqual({ status: 'awaiting_feedback', active: true })
    expect(reviewSessions.getByPr('acme/docs#99')).toBeNull()
  })

  it('replaces the solo sessions its PRs had and sends every PR URL with the unit protocol', async () => {
    mocks.query.mockImplementation(async function* () {
      yield { type: 'result', subtype: 'success', is_error: false }
    })
    const started = await reviewSessions.start(storedSession(42).pr, [docs(8)])
    expect(started.members?.map((m) => m.number)).toEqual([42, 8])
    expect(reviewSessions.getByPr('acme/docs#8')?.id).toBe(started.id)
    expect(reviewSessions.getByPr('acme/api#42')?.id).toBe(started.id)
    const [{ prompt, options }] = mocks.query.mock.calls[0]
    expect(prompt).toBe('/review-pr https://github.com/acme/api/pull/42 https://github.com/acme/docs/pull/8')
    expect(options.systemPrompt.append).toContain('covers 2 linked PRs')
    await vi.waitFor(() => expect(session(42).status).toBe('awaiting_feedback'))
  })

  it('refuses while a member has a turn running', async () => {
    let finish: () => void = () => {}
    mocks.query.mockImplementation(async function* () {
      await new Promise<void>((resolve) => (finish = resolve))
      yield { type: 'result', subtype: 'success', is_error: false }
    })
    await reviewSessions.feedback('test-docs-9', 'go')
    await expect(reviewSessions.start(storedSession(43).pr, [docs(9)])).rejects.toThrow('The review of acme/docs#9 is still running')
    expect(reviewSessions.getByPr('acme/api#43')?.id).toBe('test-session-43')
    finish()
    await vi.waitFor(() => expect(reviewSessions.getByPr('acme/docs#9')?.status).toBe('awaiting_feedback'))
  })

  it('refuses while a member is posting or resolving threads', async () => {
    let finishPost: (review: SubmittedReview) => void = () => {}
    mocks.submitReview.mockReturnValueOnce(new Promise((resolve) => (finishPost = resolve)))
    const posting = reviewSessions.submit('test-docs-10', [{ prKey: 'acme/docs#10', event: 'COMMENT' }], NO_CHANGES, [])
    await expect(reviewSessions.start(storedSession(50).pr, [docs(10)])).rejects.toThrow('The review of acme/docs#10 is still running')
    finishPost(SUBMITTED)
    await posting

    let finishResolve: (value: { resolved: string[]; failed: [] }) => void = () => {}
    mocks.resolveOwnThreads.mockReturnValueOnce(new Promise((resolve) => (finishResolve = resolve)))
    const resolving = reviewSessions.resolveThreads('test-docs-11', ['T1'])
    await expect(reviewSessions.start(storedSession(51).pr, [docs(11)])).rejects.toThrow('The review of acme/docs#11 is still running')
    finishResolve({ resolved: ['T1'], failed: [] })
    await resolving
  })

  it('refuses to replace or discard a unit that posted to only some of its PRs', async () => {
    await expect(reviewSessions.start(storedSession(52).pr, [docs(12)])).rejects.toThrow('Some PRs in the review of acme/api#52 already posted')
    expect(() => reviewSessions.discard('test-session-52')).toThrow('Submit the rest or skip them before discarding it')
    expect(reviewSessions.getByPr('acme/docs#12')?.id).toBe('test-session-52')
  })
})
