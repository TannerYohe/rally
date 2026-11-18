import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUSH_BEFORE_POSTING_ERROR } from '@shared/authorSession'
import { authorSession as stored, feedbackItem as thread, fixturePr as pr, itemResponse as response } from '@shared/authorSession.fixture'
import type { AuthorSession, Drafts, FeedbackItem } from '@shared/types'
import type { AuthorToolHandlers } from './authorTools'
import { UncommittedChangesError } from '../git/prClone'

const CLONE = { path: join(tmpdir(), 'rally-author-test-clone'), branch: 'feature', baseRef: 'origin/main' }
const WORKTREE = { path: join(tmpdir(), 'rally-author-test-worktree'), branch: 'feature', baseRef: 'origin/main', kind: 'local_worktree' as const }
const OLD_TEMP_CLONE = { ...CLONE, path: join(tmpdir(), 'rally-author-test-old-clone') }

mkdirSync(CLONE.path, { recursive: true })
mkdirSync(WORKTREE.path, { recursive: true })
mkdirSync(OLD_TEMP_CLONE.path, { recursive: true })

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
  syncWorktree: vi.fn(),
  checkoutWorktree: vi.fn(),
  removeRallyWorktree: vi.fn(async () => {}),
  localCommits: vi.fn(),
  uncommittedPaths: vi.fn(),
  pushClone: vi.fn(),
  integrateRemote: vi.fn(),
  commitFiles: vi.fn(),
  latestCommitTouching: vi.fn(async (): Promise<string | null> => null),
  commitAll: vi.fn(),
  uncommittedDiff: vi.fn(),
  concludeMerge: vi.fn(),
  abortMerge: vi.fn(),
  discardUncommitted: vi.fn(),
  refreshOne: vi.fn(async () => {}),
  handlers: null as AuthorToolHandlers | null,
}))

vi.mock('../store', () => ({
  configFile: { get: () => ({ reviewSkill: 'review-pr', localRepoFolders: ['~/src'] }) },
  authorSessionsDir: { readAll: () => mocks.stored, write: vi.fn(), remove: vi.fn() },
}))
vi.mock('../prList', () => ({ authoredPrList: { refreshOne: mocks.refreshOne } }))
vi.mock('../github/client', () => ({ github: async () => ({ login: 'me' }) }))
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
  MergeConflictError: (await importOriginal<typeof import('../git/prClone')>()).MergeConflictError,
  UncommittedChangesError: (await importOriginal<typeof import('../git/prClone')>()).UncommittedChangesError,
  CLONE_DIR_NAME: 'repo',
  commitFiles: mocks.commitFiles,
  latestCommitTouching: mocks.latestCommitTouching,
  commitAll: mocks.commitAll,
  concludeMerge: mocks.concludeMerge,
  abortMerge: mocks.abortMerge,
  discardUncommitted: mocks.discardUncommitted,
  cloneBranch: mocks.cloneBranch,
  syncClone: mocks.syncClone,
  syncWorktree: mocks.syncWorktree,
  localCommits: mocks.localCommits,
  uncommittedPaths: mocks.uncommittedPaths,
  pushClone: mocks.pushClone,
  integrateRemote: mocks.integrateRemote,
  cloneDiff: vi.fn(async () => ''),
  uncommittedDiff: mocks.uncommittedDiff,
}))
vi.mock('../git/localWorktree', async (importOriginal) => ({
  checkoutKind: (await importOriginal<typeof import('../git/localWorktree')>()).checkoutKind,
  checkoutWorktree: mocks.checkoutWorktree,
  removeRallyWorktree: mocks.removeRallyWorktree,
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
  stored(14, { clone: CLONE, mergeConflicts: ['a.ts'], items: [thread('T1')] }),
  stored(15, { clone: CLONE, items: [thread('T1')] }),
  stored(16, { clone: CLONE, items: [thread('T1')], responses: { T1: response('T1', '', { action: 'fix', pendingCommit: true, files: ['a.ts'] }) } }),
  stored(17, {
    clone: CLONE,
    items: [thread('T1'), thread('T2'), thread('T3'), thread('T4')],
    responses: {
      T1: response('T1', 'Renamed in {commit}', { action: 'fix', pendingCommit: true, files: ['a.ts'], commitMessage: 'Rename' }),
      T2: response('T2', 'Also in {commit}', { action: 'fix', pendingCommit: true, files: ['a.ts'] }),
      T3: response('T3', 'Gone in {commit}', { action: 'fix', pendingCommit: true, files: ['b.ts'] }),
      T4: response('T4', 'Bad path {commit}', { action: 'fix', pendingCommit: true, files: ['../outside.ts'] }),
    },
  }),
  stored(18, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }] }),
  stored(60),
  stored(61, { sdkSessionId: 'temp-conversation' }),
  stored(62, { clone: OLD_TEMP_CLONE }),
  stored(63, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }] }),
  stored(64, { clone: { ...WORKTREE, kind: 'rally_worktree', createdBranch: true, path: join(tmpdir(), 'rally-author-test-rally-worktree') } }),
  stored(65),
  stored(54, { clone: CLONE, items: [thread('T1')], responses: { T1: response('T1', 'Fixed in {commit}', { action: 'fix', pendingCommit: true, files: ['b.ts'] }) } }),
  stored(19, {
    clone: { ...CLONE, syncedHead: 'old-head' },
    commits: [{ oid: 'aaaaaaa111', subject: 'fix' }],
    items: [thread('T1')],
    responses: { T1: response('T1', 'Fixed in aaaaaaa.', { action: 'fix', commits: ['aaaaaaa111'] }) },
  }),
  stored(24, { clone: { ...CLONE, path: join(tmpdir(), 'rally-author-test-missing-clone') }, commits: [{ oid: 'abc', subject: 'fix' }] }),
  stored(25, { clone: CLONE, uncommitted: ['a.ts'] }),
  stored(26, { clone: CLONE, mergeConflicts: ['a.ts'] }),
  stored(27, { clone: CLONE, uncommitted: ['a.ts'] }),
  stored(29, { clone: CLONE, uncommitted: ['a.ts'] }),
  stored(28, { status: 'running', clone: CLONE, responses: { T1: response('T1', 'Fixed in {commit}', { action: 'fix', pendingCommit: true, files: ['a.ts'] }) } }),
  stored(40),
  stored(41, { responses: { T1: response('T1', 'Unposted') }, items: [thread('T1')] }),
  stored(42, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }] }),
  stored(43, { clone: CLONE, mergeConflicts: ['a.ts'] }),
  stored(44, { reviewersToReRequest: ['bob'] }),
  stored(45),
  stored(46, { status: 'cancelled', clone: CLONE, items: [thread('T1')], responses: { T1: response('T1', '') } }),
  stored(47, { clone: CLONE, uncommitted: ['a.ts'] }),
  stored(48),
  stored(49),
  stored(50, { clone: { ...CLONE, path: join(tmpdir(), 'rally-author-test-missing-clone') }, uncommitted: ['a.ts'] }),
  stored(51, { clone: { ...CLONE, path: join(tmpdir(), 'rally-author-test-missing-clone') }, uncommitted: ['a.ts'] }),
  stored(52, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }], uncommitted: ['a.ts'] }),
  stored(53, { clone: CLONE, uncommitted: ['a.ts'] }),
  stored(31, {
    items: [thread('T1'), { ...thread('self-1'), kind: 'finding' }],
    responses: { T1: response('T1', 'Done'), 'self-1': { ...response('self-1', ''), action: 'fix' } },
    selfReview: { verdict: 'Minor', reportMarkdown: '', findings: [{ ...thread('self-1'), kind: 'finding' }] },
  }),
  stored(6, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }], items: [thread('T1')], responses: { T1: response('T1', 'Done') } }),
]

const { authorSessions, findingsFromDrafts } = await import('./authorSessions')
const { MergeConflictError } = await import('../git/prClone')

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
    mocks.integrateRemote,
    mocks.commitFiles,
    mocks.commitAll,
    mocks.uncommittedDiff,
    mocks.concludeMerge,
    mocks.abortMerge,
    mocks.discardUncommitted,
    mocks.checkoutWorktree,
    mocks.cloneBranch,
    mocks.removeRallyWorktree,
    mocks.requestReview,
    mocks.acknowledgeFeedbackItem,
  ])
    mock.mockReset()
  mocks.fetchApprovers.mockResolvedValue([])
  mocks.integrateRemote.mockImplementation(async (clone) => ({ clone, rewritten: {} }))
  mocks.fetchCloneSource.mockResolvedValue({ headUrl: 'u', branch: 'feature', baseUrl: 'u', baseBranch: 'main' })
  mocks.cloneBranch.mockResolvedValue(CLONE)
  mocks.syncClone.mockImplementation(async (clone) => clone)
  mocks.checkoutWorktree.mockResolvedValue(null)
  mocks.syncWorktree.mockImplementation(async (clone) => ({ ...clone, syncedHead: 'synced' }))
  mocks.localCommits.mockResolvedValue([])
  mocks.uncommittedPaths.mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(() => {
  for (const path of [CLONE.path, WORKTREE.path, OLD_TEMP_CLONE.path]) rmSync(path, { recursive: true, force: true })
  for (const s of mocks.stored) rmSync(join(tmpdir(), 'rally', s.id), { recursive: true, force: true })
})

describe('restoring sessions', () => {
  it('drops pending commits from a turn cut off by quitting', () => {
    expect(session(28).responses.T1).toMatchObject({ pendingCommit: false, commitError: expect.stringContaining("didn't finish") })
  })

  it('marks interrupted turns and pushes as errors', () => {
    expect(session(1)).toMatchObject({ status: 'error', error: expect.stringContaining('Interrupted') })
    expect(session(2)).toMatchObject({ status: 'error', error: expect.stringContaining('pushing or posting') })
  })
})

describe('runActions', () => {
  it('clones the branch, runs a turn, and keeps responses only for known items', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([thread('T1'), thread('T9')])
    mocks.localCommits.mockResolvedValue([{ oid: 'def4567890', subject: 'Rename the helper' }])
    mocks.commitFiles.mockResolvedValue('def4567890')
    const fix = { ...response('T1', 'Renamed in {commit}.'), action: 'fix' as const, files: ['a.ts'], commitMessage: 'Rename the helper' }
    finishTurn(() => mocks.handlers!.onResponses([fix, response('nope', 'x')]))

    await authorSessions.runActions(pr(20), [{ itemId: 'T1', action: 'fix', note: 'use camelCase' }], '')
    await vi.waitFor(() => expect(session(20).status).toBe('awaiting_feedback'))

    expect(mocks.cloneBranch).toHaveBeenCalledWith(join(tmpdir(), 'rally', session(20).id), expect.objectContaining({ branch: 'feature' }))
    const [preToolUse] = mocks.query.mock.calls[0][0].options.hooks.PreToolUse[0].hooks
    const decide = (command: string) =>
      preToolUse({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: command }, undefined, {})
    expect(await decide(`git commit -am fix && bundle exec rspec > /tmp/out.log`)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } })
    expect(await decide(`git push origin HEAD`)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } })
    const prompt = mocks.query.mock.calls[0][0].prompt as string
    expect(prompt).toContain('## Item T1: Fix')
    expect(prompt).toContain('Note from me: use camelCase')
    expect(session(20).items.map((i) => i.id)).toEqual(['T1'])
    expect(Object.keys(session(20).responses)).toEqual(['T1'])
    expect(mocks.commitFiles).toHaveBeenCalledWith(CLONE, ['a.ts'], 'Rename the helper')
    expect(session(20).responses.T1).toMatchObject({ pendingCommit: false, commits: ['def4567890'], reply: 'Renamed in def4567.', commitError: null })
    expect(session(20).commits).toEqual([{ oid: 'def4567890', subject: 'Rename the helper' }])
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
    mocks.pushClone.mockResolvedValue({ push: lastPush, clone: { ...CLONE, syncedHead: 'abc' } })
    await authorSessions.push('author-3')
    expect(session(3)).toMatchObject({ status: 'awaiting_feedback', commits: [], lastPush, mergeConflicts: [], clone: { syncedHead: 'abc' } })
    expect(mocks.refreshOne).toHaveBeenCalledWith('acme', 'api', 3)
  })

  it('has Claude resolve a conflicting merge, then commits the merge', async () => {
    mocks.integrateRemote.mockRejectedValue(new MergeConflictError('feature', ['a.ts']))
    mocks.localCommits.mockResolvedValue([{ oid: 'abc', subject: 'fix' }])
    finishTurn()
    await authorSessions.push('author-4')
    expect(session(4).mergeConflicts).toEqual(['a.ts'])
    await vi.waitFor(() => expect(mocks.concludeMerge).toHaveBeenCalledWith(CLONE, ['a.ts']))
    expect(mocks.query.mock.calls[0][0].prompt).toContain('- a.ts')
    await vi.waitFor(() => expect(session(4)).toMatchObject({ status: 'awaiting_feedback', mergeConflicts: [] }))
  })

  it('records a push that fails for a reason other than a conflict and keeps the commits', async () => {
    mocks.pushClone.mockRejectedValue(new Error('git push failed: rejected'))
    mocks.localCommits.mockResolvedValue([{ oid: 'abc', subject: 'fix' }])
    await expect(authorSessions.push('author-18')).rejects.toThrow('rejected')
    expect(session(18)).toMatchObject({ status: 'error', error: 'git push failed: rejected', commits: [{ oid: 'abc', subject: 'fix' }], mergeConflicts: [] })
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.refreshOne).not.toHaveBeenCalledWith('acme', 'api', 18)
  })

  it('leaves no session error when uncommitted files block merging new commits from GitHub', async () => {
    const refused = new UncommittedChangesError(['a.ts'])
    mocks.integrateRemote.mockRejectedValue(refused)
    mocks.localCommits.mockResolvedValue([{ oid: 'abc', subject: 'fix' }])
    mocks.uncommittedPaths.mockResolvedValue(['a.ts'])
    await expect(authorSessions.push('author-52')).rejects.toThrow(refused.message)
    expect(session(52)).toMatchObject({ status: 'awaiting_feedback', error: null, commits: [{ oid: 'abc', subject: 'fix' }] })
    expect(mocks.pushClone).not.toHaveBeenCalled()
  })

  it('saves the replayed shas and synced head before pushing, so a failed push keeps them', async () => {
    const lastPush = { at: '2026-11-16T00:00:00Z', oid: 'bbbbbbb222', commits: [{ oid: 'bbbbbbb222', subject: 'fix' }] }
    mocks.integrateRemote.mockResolvedValue({ clone: { ...CLONE, syncedHead: 'new-head' }, rewritten: { aaaaaaa111: 'bbbbbbb222' } })
    mocks.pushClone.mockRejectedValue(new Error('git push failed: network'))
    await expect(authorSessions.push('author-19')).rejects.toThrow('network')
    expect(session(19).responses.T1).toMatchObject({ commits: ['bbbbbbb222'], reply: 'Fixed in bbbbbbb.' })
    expect(session(19).clone?.syncedHead).toBe('new-head')
    expect(mocks.pushClone).toHaveBeenCalledWith({ ...CLONE, syncedHead: 'new-head' }, expect.any(String))
  })

  it('refuses to push, diff, or clone again when the clone holding unpushed commits is gone', async () => {
    await expect(authorSessions.diff('author-24')).rejects.toThrow("Rally's clone of this PR is gone")
    await expect(authorSessions.push('author-24')).rejects.toThrow("Rally's clone of this PR is gone")
    expect(mocks.pushClone).not.toHaveBeenCalled()
    mocks.fetchFeedbackItems.mockResolvedValue([thread('T1')])
    await expect(authorSessions.runActions(pr(24), [{ itemId: 'T1', action: 'fix', note: '' }], '')).rejects.toThrow("Rally's clone of this PR is gone")
    expect(mocks.cloneBranch).not.toHaveBeenCalledWith(join(tmpdir(), 'rally', 'author-24'), expect.anything())
  })

  it('aborts an open merge and lets new turns start again', async () => {
    await authorSessions.abortMerge('author-26')
    expect(mocks.abortMerge).toHaveBeenCalledWith(CLONE)
    expect(session(26)).toMatchObject({ mergeConflicts: [], status: 'awaiting_feedback' })
  })

  it('refuses to start a turn while discarding or aborting is under way', async () => {
    let finish: () => void = () => {}
    mocks.discardUncommitted.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    mocks.uncommittedPaths.mockResolvedValue([])
    const discarding = authorSessions.discardUncommitted('author-27')
    await expect(authorSessions.feedback('author-27', 'go')).rejects.toThrow('already posting')
    finish()
    await discarding
  })

  it('refuses a self-review or a message while a merge is open', async () => {
    await expect(authorSessions.selfReview(pr(14))).rejects.toThrow('Finish or abort the merge')
    await expect(authorSessions.feedback('author-14', 'hi')).rejects.toThrow('Finish or abort the merge')
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('discards uncommitted edits', async () => {
    mocks.uncommittedPaths.mockResolvedValue([])
    await authorSessions.discardUncommitted('author-25')
    expect(mocks.discardUncommitted).toHaveBeenCalledWith(CLONE)
    expect(session(25).uncommitted).toEqual([])
  })

  it('commits uncommitted edits with the given message', async () => {
    mocks.commitAll.mockResolvedValue('def')
    mocks.localCommits.mockResolvedValue([{ oid: 'def', subject: 'Tidy up' }])
    await authorSessions.commitUncommitted('author-29', '  Tidy up ')
    expect(mocks.commitAll).toHaveBeenCalledWith(CLONE, 'Tidy up')
    expect(session(29)).toMatchObject({ uncommitted: [], commits: [{ oid: 'def', subject: 'Tidy up' }] })
  })

  it('refuses to commit without a message, while a merge is open, or without a clone', async () => {
    await expect(authorSessions.commitUncommitted('author-25', ' ')).rejects.toThrow('Write a commit message first')
    await expect(authorSessions.commitUncommitted('author-14', 'Tidy up')).rejects.toThrow('Finish or abort the merge')
    await expect(authorSessions.commitUncommitted('author-48', 'Tidy up')).rejects.toThrow('nothing to commit')
    expect(mocks.commitAll).not.toHaveBeenCalled()
  })

  it('refuses to commit while a turn runs', async () => {
    let release: () => void = () => {}
    mocks.query.mockImplementation(async function* () {
      await new Promise<void>((resolve) => (release = resolve))
      yield { type: 'result', subtype: 'success', is_error: false }
    })
    await authorSessions.feedback('author-49', 'still working')
    await expect(authorSessions.commitUncommitted('author-49', 'Tidy up')).rejects.toThrow('already working')
    expect(mocks.commitAll).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(session(49).status).toBe('awaiting_feedback'))
  })

  it('forgets uncommitted edits and refuses to commit or discard once the clone folder is gone', async () => {
    await expect(authorSessions.commitUncommitted('author-50', 'Tidy up')).rejects.toThrow('cleared from the temp folder')
    expect(session(50)).toMatchObject({ uncommitted: [], status: 'error', error: expect.stringContaining('cleared from the temp folder') })
    expect(session(50).timeline.at(-1)).toMatchObject({ kind: 'warning', label: expect.stringContaining('cleared from the temp folder'), detail: 'a.ts' })
    await expect(authorSessions.discardUncommitted('author-50')).rejects.toThrow('cleared from the temp folder')
    await expect(authorSessions.uncommittedDiff('author-50')).rejects.toThrow('cleared from the temp folder')
    expect(mocks.commitAll).not.toHaveBeenCalled()
    expect(mocks.discardUncommitted).not.toHaveBeenCalled()
  })

  it('diffs uncommitted edits in the clone, and nothing without one', async () => {
    mocks.uncommittedDiff.mockResolvedValue({ diff: '+edit', truncated: false })
    expect(await authorSessions.uncommittedDiff('author-53')).toEqual({ diff: '+edit', truncated: false })
    expect(mocks.uncommittedDiff).toHaveBeenCalledWith(CLONE)
    expect(await authorSessions.uncommittedDiff('author-48')).toEqual({ diff: '', truncated: false, binaryFiles: [] })
  })

  it('rereads the clone when there is nothing to commit or the commit fails', async () => {
    mocks.uncommittedPaths.mockResolvedValue(['b.ts'])
    mocks.localCommits.mockResolvedValue([{ oid: 'x', subject: 'Earlier' }])
    mocks.commitAll.mockResolvedValue(null)
    await expect(authorSessions.commitUncommitted('author-25', 'Tidy up')).rejects.toThrow('no changes to commit')
    expect(session(25)).toMatchObject({ uncommitted: ['b.ts'], commits: [{ oid: 'x', subject: 'Earlier' }] })

    mocks.uncommittedPaths.mockResolvedValue(['c.ts'])
    mocks.commitAll.mockRejectedValue(new Error('git commit failed: hook rejected'))
    await expect(authorSessions.commitUncommitted('author-25', 'Tidy up')).rejects.toThrow('hook rejected')
    expect(session(25).uncommitted).toEqual(['c.ts'])
  })

  it('keeps the merge open when conflict markers remain', async () => {
    mocks.concludeMerge.mockRejectedValue(new Error('Conflict markers remain in a.ts.'))
    finishTurn()
    await authorSessions.resolveConflicts('author-14')
    await vi.waitFor(() => expect(session(14)).toMatchObject({ status: 'error', error: 'Conflict markers remain in a.ts.', mergeConflicts: ['a.ts'] }))
    await expect(authorSessions.runActions(pr(14), [{ itemId: 'T1', action: 'fix', note: '' }], '')).rejects.toThrow('Finish or abort the merge')
  })
})

describe('turn exits', () => {
  it('reads the clone after a cancelled turn without committing anything', async () => {
    mocks.localCommits.mockResolvedValue([])
    mocks.uncommittedPaths.mockResolvedValue(['a.ts'])
    mocks.query.mockImplementation(async function* () {
      mocks.handlers!.onResponses([{ ...response('T1', 'Fixed in {commit}'), action: 'fix', files: ['a.ts'] }])
      throw new Error('aborted')
    })
    await authorSessions.feedback('author-15', 'fix it')
    await vi.waitFor(() => expect(session(15).status).toBe('error'))
    expect(mocks.commitFiles).not.toHaveBeenCalled()
    expect(session(15)).toMatchObject({ uncommitted: ['a.ts'], responses: { T1: { pendingCommit: false, commitError: expect.stringContaining("didn't finish") } } })
  })

  it('never commits a fix left pending by an earlier failed turn on a later turn', async () => {
    mocks.query.mockImplementation(async function* () {
      throw new Error('aborted')
    })
    await authorSessions.feedback('author-16', 'go')
    await vi.waitFor(() => expect(session(16).status).toBe('error'))
    finishTurn()
    await authorSessions.feedback('author-16', 'something else')
    await vi.waitFor(() => expect(session(16).status).toBe('awaiting_feedback'))
    expect(mocks.commitFiles).not.toHaveBeenCalled()
  })

  it('commits each fix separately, shares a commit between fixes of the same file, and keeps going past a failure', async () => {
    mocks.commitFiles.mockImplementation(async (_clone, files: string[]) => {
      if (files[0] === '../outside.ts') throw new Error("pathspec '../outside.ts' is outside repository")
      return files[0] === 'a.ts' && !mocks.commitFiles.mock.calls.slice(0, -1).some(([, f]) => f[0] === 'a.ts') ? 'aaaaaaa999' : null
    })
    finishTurn()
    await authorSessions.feedback('author-17', 'commit them')
    await vi.waitFor(() => expect(session(17).status).toBe('awaiting_feedback'))
    const { T1, T2, T3, T4 } = session(17).responses
    expect(T1).toMatchObject({ pendingCommit: false, commits: ['aaaaaaa999'], reply: 'Renamed in aaaaaaa', commitError: null })
    expect(T2).toMatchObject({ pendingCommit: false, commits: [], reply: 'Also in aaaaaaa', commitError: null })
    expect(T3).toMatchObject({ pendingCommit: false, commitError: expect.stringContaining('no changes to commit') })
    expect(T4).toMatchObject({ pendingCommit: false, commitError: expect.stringContaining('outside repository') })
  })

  it('credits a fix Claude committed itself to its newest commit touching the files', async () => {
    mocks.commitFiles.mockResolvedValue(null)
    mocks.latestCommitTouching.mockResolvedValueOnce('bbbbbbb123')
    finishTurn()
    await authorSessions.feedback('author-54', 'fix it')
    await vi.waitFor(() => expect(session(54).status).toBe('awaiting_feedback'))
    expect(mocks.latestCommitTouching).toHaveBeenCalledWith(expect.anything(), ['b.ts'])
    expect(session(54).responses.T1).toMatchObject({ pendingCommit: false, commits: ['bbbbbbb123'], reply: 'Fixed in bbbbbbb', commitError: null })
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

  it('refuses to post a reply that still has the commit placeholder', async () => {
    await expect(authorSessions.postReplies('author-13', [{ itemId: 'T1', body: 'Fixed in {commit}', resolve: false }], false)).rejects.toThrow(
      'still has {commit}',
    )
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

describe('pruneUnlisted', () => {
  const own = [40, 41, 42, 43, 44, 45, 46, 47, 51].map((n) => `acme/api#${n}`)
  const othersListed = () => new Set(mocks.stored.map((st) => st.prKey).filter((key) => !own.includes(key)))

  it('removes sessions with no work left for PRs that left the list, with their session folders', async () => {
    const dir40 = join(tmpdir(), 'rally', 'author-40')
    mkdirSync(dir40, { recursive: true })
    let release: () => void = () => {}
    mocks.query.mockImplementation(async function* () {
      await new Promise<void>((resolve) => (release = resolve))
      yield { type: 'result', subtype: 'success', is_error: false }
    })
    await authorSessions.feedback('author-45', 'still working')

    authorSessions.pruneUnlisted(othersListed())

    expect(authorSessions.getByPr('acme/api#40')).toBeNull()
    expect(authorSessions.getByPr('acme/api#46')).toBeNull()
    expect(authorSessions.getByPr('acme/api#51')).toBeNull()
    await vi.waitFor(() => expect(existsSync(dir40)).toBe(false))
    expect(authorSessions.getByPr('acme/api#41')).not.toBeNull()
    expect(authorSessions.getByPr('acme/api#42')).not.toBeNull()
    expect(authorSessions.getByPr('acme/api#43')).not.toBeNull()
    expect(authorSessions.getByPr('acme/api#44')).not.toBeNull()
    expect(authorSessions.getByPr('acme/api#45')).not.toBeNull()
    expect(authorSessions.getByPr('acme/api#47')).not.toBeNull()
    expect(authorSessions.getByPr('acme/api#3')).not.toBeNull()
    release()
    await vi.waitFor(() => expect(session(45).status).toBe('awaiting_feedback'))
  })
})

describe('checking out the PR branch', () => {
  const turnOptions = () => mocks.query.mock.calls.at(-1)![0].options

  it('runs a self-review in the local worktree with the repo settings and CLAUDE.md loaded', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    finishTurn()
    await authorSessions.selfReview(pr(60))
    await vi.waitFor(() => expect(session(60).status).toBe('awaiting_feedback'))

    expect(mocks.checkoutWorktree).toHaveBeenCalledWith(['~/src'], { repo: 'acme/api', branch: 'feature', baseBranch: 'main' })
    expect(mocks.cloneBranch).not.toHaveBeenCalled()
    expect(session(60).clone).toEqual({ ...WORKTREE, syncedHead: 'synced', createdBranch: undefined })
    expect(turnOptions()).toMatchObject({ cwd: WORKTREE.path, settingSources: ['user', 'project', 'local'] })
  })

  it('starts a new conversation when the turn moves to a different folder', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    finishTurn()
    await authorSessions.feedback('author-61', 'carry on')
    await vi.waitFor(() => expect(session(61).status).toBe('awaiting_feedback'))
    expect(turnOptions().resume).toBeUndefined()
    expect(session(61).timeline).toContainEqual(expect.objectContaining({ kind: 'warning', detail: WORKTREE.path }))
  })

  it('moves a temp clone with no work of its own to the worktree and deletes the clone', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    finishTurn()
    await authorSessions.feedback('author-62', 'go')
    await vi.waitFor(() => expect(session(62).status).toBe('awaiting_feedback'))
    expect(session(62).clone?.path).toBe(WORKTREE.path)
    expect(existsSync(OLD_TEMP_CLONE.path)).toBe(false)
  })

  it('keeps using a temp clone that holds unpushed commits', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    mocks.localCommits.mockResolvedValue([{ oid: 'abc', subject: 'fix' }])
    finishTurn()
    await authorSessions.feedback('author-63', 'go')
    await vi.waitFor(() => expect(session(63).status).toBe('awaiting_feedback'))
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled()
    expect(turnOptions().cwd).toBe(CLONE.path)
  })

  it('clones into the temp folder for a PR from a fork', async () => {
    mocks.fetchCloneSource.mockResolvedValue({ headUrl: 'fork', branch: 'feature', baseUrl: 'upstream', baseBranch: 'main' })
    finishTurn()
    await authorSessions.feedback('author-65', 'go')
    await vi.waitFor(() => expect(session(65).status).toBe('awaiting_feedback'))
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled()
    expect(mocks.cloneBranch).toHaveBeenCalledWith(join(tmpdir(), 'rally', 'author-65'), expect.objectContaining({ headUrl: 'fork' }))
  })

  it('removes the worktree Rally added, with its edits, on start over', () => {
    const { clone } = session(64)
    authorSessions.discard('author-64')
    expect(mocks.removeRallyWorktree).toHaveBeenCalledWith(clone, true)
  })
})
