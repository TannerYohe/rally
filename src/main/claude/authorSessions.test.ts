import { existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUSH_BEFORE_POSTING_ERROR } from '@shared/authorSession'
import { authorSession as stored, descriptionDraft, feedbackItem as thread, fixturePr as pr, itemResponse as response } from '@shared/authorSession.fixture'
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
  fetchDescription: vi.fn(),
  updateDescription: vi.fn(),
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
  headOf: vi.fn(async () => 'turn-start'),
  commitAll: vi.fn(),
  uncommittedDiff: vi.fn(),
  concludeMerge: vi.fn(),
  abortMerge: vi.fn(),
  discardUncommitted: vi.fn(),
  checkedOutBranch: vi.fn(async (clone: { branch: string }): Promise<string | null> => clone.branch),
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
vi.mock('../github/prDescription', () => ({ fetchDescription: mocks.fetchDescription, updateDescription: mocks.updateDescription }))
vi.mock('../git/prClone', async (importOriginal) => ({
  MergeConflictError: (await importOriginal<typeof import('../git/prClone')>()).MergeConflictError,
  UncommittedChangesError: (await importOriginal<typeof import('../git/prClone')>()).UncommittedChangesError,
  isForkSource: (await importOriginal<typeof import('../git/prClone')>()).isForkSource,
  commitFiles: mocks.commitFiles,
  latestCommitTouching: mocks.latestCommitTouching,
  headOf: mocks.headOf,
  commitAll: mocks.commitAll,
  concludeMerge: mocks.concludeMerge,
  abortMerge: mocks.abortMerge,
  discardUncommitted: mocks.discardUncommitted,
  checkedOutBranch: mocks.checkedOutBranch,
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
  LocalCloneError: (await importOriginal<typeof import('../git/localWorktree')>()).LocalCloneError,
  checkoutWorktree: mocks.checkoutWorktree,
  removeRallyWorktree: mocks.removeRallyWorktree,
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('./executable', () => ({ claudeExecutable: () => 'claude' }))
vi.mock('./modelOptions', () => ({ reviewModelOptions: (_config: unknown, env: Record<string, string>) => ({ env }) }))
vi.mock('./timeline', () => ({ reduceTimeline: (timeline: unknown) => timeline, closeOpenEntries: (timeline: unknown) => timeline }))
vi.mock('./authorTools', () => ({
  PUBLISH_RESPONSES_TOOL: 'mcp__rally__publish_responses',
  PUBLISH_DESCRIPTION_TOOL: 'mcp__rally__publish_description',
  createAuthorServer: (handlers: AuthorToolHandlers) => {
    mocks.handlers = handlers
    return {}
  },
}))

/** Returns a stored session saved before sessions had description fields. */
function legacySession(number: number): AuthorSession {
  const { description: _description, descriptionUpdatedAt: _updatedAt, ...rest } = stored(number)
  return rest as AuthorSession
}

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
  stored(160),
  stored(161, { sdkSessionId: 'temp-conversation' }),
  stored(162, { clone: OLD_TEMP_CLONE }),
  stored(163, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }] }),
  stored(164, { clone: { ...WORKTREE, kind: 'rally_worktree', createdBranch: true, path: join(tmpdir(), 'rally-author-test-rally-worktree') } }),
  stored(165),
  stored(166, { clone: { ...WORKTREE, kind: 'rally_worktree', createdBranch: true } }),
  stored(167, { clone: { ...WORKTREE, kind: 'rally_worktree', createdBranch: true } }),
  stored(168, { clone: { ...WORKTREE, kind: 'rally_worktree' } }),
  stored(169),
  stored(170),
  stored(172, { sdkSessionId: 'temp-conversation' }),
  stored(173, { clone: WORKTREE, sdkSessionId: 'worktree-conversation', sdkCwd: WORKTREE.path }),
  stored(174, { clone: { ...WORKTREE, path: join(tmpdir(), 'rally-author-test-missing-worktree') }, commits: [{ oid: 'abc', subject: 'fix' }], uncommitted: ['a.ts'] }),
  stored(175, { clone: WORKTREE, commits: [{ oid: 'abc', subject: 'fix' }] }),
  stored(176, { clone: { ...WORKTREE, kind: 'rally_worktree' } }),
  stored(177, { clone: WORKTREE }),
  stored(178, { clone: { ...CLONE, path: join(tmpdir(), 'rally-author-test-edits-clone') } }),
  stored(179, { clone: CLONE, items: [thread('T1')], responses: { T1: response('T1', 'Fixed in {commit}', { action: 'fix', pendingCommit: true, files: ['a.ts'] }) } }),
  stored(171, { clone: { ...WORKTREE, kind: 'rally_worktree', createdBranch: true, syncedHead: 'prev' } }),
  stored(154, { clone: CLONE, items: [thread('T1')], responses: { T1: response('T1', 'Fixed in {commit}', { action: 'fix', pendingCommit: true, files: ['b.ts'] }) } }),
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
  stored(32, {
    items: [thread('T1'), { ...thread('self-1'), kind: 'finding' }, { ...thread('self-2'), kind: 'finding' }],
    responses: { T1: response('T1', 'Done'), 'self-1': response('self-1', '', { action: 'push_back', summary: 'Intended' }) },
    selfReview: { verdict: 'Minor', reportMarkdown: '', findings: [{ ...thread('self-1'), kind: 'finding' }, { ...thread('self-2'), kind: 'finding' }] },
  }),
  stored(60, { description: descriptionDraft() }),
  stored(61, {
    clone: CLONE,
    commits: [{ oid: 'abc', subject: 'fix' }],
    description: descriptionDraft(),
  }),
  stored(62, { description: descriptionDraft() }),
  stored(66, {
    clone: CLONE,
    commits: [{ oid: 'abc', subject: 'fix' }],
    description: descriptionDraft(),
  }),
  stored(67, {
    clone: CLONE,
    commits: [{ oid: 'abc', subject: 'fix' }],
    description: descriptionDraft(),
  }),
  stored(68, { description: descriptionDraft(), status: 'error', error: 'Rally couldn\'t update the PR description: timeout' }),
  stored(69, { description: descriptionDraft(), status: 'error', error: 'The Claude turn ended with an error.' }),
  stored(72, { description: descriptionDraft(), status: 'error', error: "The commits are pushed. Rally couldn't update the PR description: Not Found" }),
  legacySession(70),
  stored(71),
  stored(63),
  stored(64),
  stored(65),
  stored(6, { clone: CLONE, commits: [{ oid: 'abc', subject: 'fix' }], items: [thread('T1')], responses: { T1: response('T1', 'Done') } }),
  stored(54, {
    selfReview: { verdict: 'Minor', reportMarkdown: '', findings: [{ ...thread('self-r-1'), kind: 'finding' }, { ...thread('self-r-2'), kind: 'finding' }] },
  }),
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
    mocks.checkedOutBranch,
    mocks.latestCommitTouching,
    mocks.headOf,
    mocks.fetchDescription,
    mocks.updateDescription,
  ])
    mock.mockReset()
  mocks.checkedOutBranch.mockImplementation(async (clone: { branch: string }) => clone.branch)
  mocks.latestCommitTouching.mockResolvedValue(null)
  mocks.headOf.mockResolvedValue('turn-start')
  mocks.fetchApprovers.mockResolvedValue([])
  mocks.integrateRemote.mockImplementation(async (clone) => ({ clone, rewritten: {} }))
  mocks.fetchCloneSource.mockResolvedValue({ headUrl: 'u', branch: 'feature', baseUrl: 'u', baseBranch: 'main' })
  mocks.cloneBranch.mockResolvedValue(CLONE)
  mocks.syncClone.mockImplementation(async (clone) => clone)
  mocks.checkoutWorktree.mockResolvedValue(null)
  mocks.syncWorktree.mockImplementation(async (clone) => ({ clone: { ...clone, syncedHead: 'synced' }, state: 'synced' }))
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
    const outsideTemp = join(homedir(), 'src', 'api')
    expect(await decide(`git -C ${outsideTemp} commit -am fix && bundle exec rspec > ${outsideTemp}/out.log`)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } })
    expect(await decide(`git push origin HEAD`)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } })
    expect(mocks.query.mock.calls[0][0].options.env).toMatchObject({ GIT_CONFIG_VALUE_0: 'https://github.com/' })
    const prompt = mocks.query.mock.calls[0][0].prompt as string
    expect(prompt).toContain('## Item T1: Fix')
    expect(prompt).toContain('Note from me: use camelCase')
    expect(session(20).items.map((i) => i.id)).toEqual(['T1'])
    expect(Object.keys(session(20).responses)).toEqual(['T1'])
    expect(mocks.commitFiles).toHaveBeenCalledWith(CLONE, ['a.ts'], 'Rename the helper')
    expect(session(20).responses.T1).toMatchObject({ pendingCommit: false, commits: ['def4567890'], reply: 'Renamed in def4567.', commitError: null })
    expect(session(20).commits).toEqual([{ oid: 'def4567890', subject: 'Rename the helper' }])
    expect(authorSessions.sessionState('acme/api#20')).toEqual({ status: 'awaiting_feedback', active: true, openFindings: 0 })
  })

  it('refuses items that are no longer open on GitHub without starting a turn', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([thread('T1')])
    await expect(authorSessions.runActions(pr(21), [{ itemId: 'gone', action: 'fix', note: '' }], '')).rejects.toThrow('resolved or removed')
    expect(mocks.query).not.toHaveBeenCalled()
    expect(session(21).status).toBe('awaiting_feedback')
  })

  it('accepts listed findings and refuses dismissed ones', async () => {
    mocks.fetchFeedbackItems.mockResolvedValue([thread('T1')])
    authorSessions.clearFindings(session(54).id, ['self-r-2'])
    await expect(authorSessions.runActions(pr(54), [{ itemId: 'self-r-2', action: 'fix', note: '' }], '')).rejects.toThrow('resolved or removed')
    expect(mocks.query).not.toHaveBeenCalled()

    finishTurn()
    await authorSessions.runActions(pr(54), [{ itemId: 'self-r-1', action: 'investigate', note: '' }], '')
    await vi.waitFor(() => expect(session(54).status).toBe('awaiting_feedback'))
    expect(mocks.query.mock.calls[0][0].prompt).toContain('## Item self-r-1')
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
    mocks.uncommittedPaths.mockResolvedValue(['a.ts'])
    const discarding = authorSessions.discardUncommitted('author-27', ['a.ts'])
    await expect(authorSessions.feedback('author-27', 'go')).rejects.toThrow('still working on this PR')
    finish()
    await discarding
  })

  it('refuses a self-review or a message while a merge is open', async () => {
    await expect(authorSessions.selfReview(pr(14))).rejects.toThrow('Finish or abort the merge')
    await expect(authorSessions.feedback('author-14', 'hi')).rejects.toThrow('Finish or abort the merge')
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('discards uncommitted edits', async () => {
    mocks.uncommittedPaths.mockResolvedValueOnce(['a.ts']).mockResolvedValue([])
    await authorSessions.discardUncommitted('author-25', ['a.ts'])
    expect(mocks.discardUncommitted).toHaveBeenCalledWith(CLONE)
    expect(session(25).uncommitted).toEqual([])
  })

  it('refuses to discard when the uncommitted files are not the ones confirmed, and shows the new list', async () => {
    mocks.uncommittedPaths.mockResolvedValue(['a.ts', 'mine.ts'])
    await expect(authorSessions.discardUncommitted('author-53', ['a.ts'])).rejects.toThrow('uncommitted files changed')
    expect(mocks.discardUncommitted).not.toHaveBeenCalled()
    expect(session(53).uncommitted).toEqual(['a.ts', 'mine.ts'])
  })

  it('refuses to push, discard, commit, or diff while the checkout has another branch checked out', async () => {
    mocks.checkedOutBranch.mockResolvedValueOnce('main').mockResolvedValueOnce('main').mockResolvedValueOnce(null).mockResolvedValueOnce('main')
    await expect(authorSessions.push('author-42')).rejects.toThrow('has `main` checked out, not the PR branch `feature`')
    await expect(authorSessions.discardUncommitted('author-47', ['a.ts'])).rejects.toThrow('has `main` checked out')
    await expect(authorSessions.commitUncommitted('author-47', 'Tidy')).rejects.toThrow('has a detached HEAD checked out')
    await expect(authorSessions.uncommittedDiff('author-47')).rejects.toThrow('has `main` checked out')
    expect(mocks.pushClone).not.toHaveBeenCalled()
    expect(mocks.discardUncommitted).not.toHaveBeenCalled()
    expect(mocks.commitAll).not.toHaveBeenCalled()
  })

  it('says a missing worktree keeps its commits on the branch, and forgets its uncommitted edits', async () => {
    await expect(authorSessions.push('author-174')).rejects.toThrow('The worktree for this PR is gone')
    expect(session(174).timeline.at(-1)).toMatchObject({ kind: 'warning', label: expect.stringContaining('worktree for this PR was removed'), detail: 'a.ts' })
    await expect(authorSessions.commitUncommitted('author-174', 'Tidy')).rejects.toThrow('commits on the branch are kept')
    await expect(authorSessions.diff('author-174')).rejects.toThrow('The worktree for this PR is gone')
    expect(session(174)).toMatchObject({ uncommitted: [], status: 'error' })
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
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await vi.waitFor(() => expect(session(49).status).toBe('awaiting_feedback'))
  })

  it('forgets uncommitted edits and refuses to commit or discard once the clone folder is gone', async () => {
    await expect(authorSessions.commitUncommitted('author-50', 'Tidy up')).rejects.toThrow('cleared from the temp folder')
    expect(session(50)).toMatchObject({ uncommitted: [], status: 'error', error: expect.stringContaining('cleared from the temp folder') })
    expect(session(50).timeline.at(-1)).toMatchObject({ kind: 'warning', label: expect.stringContaining('cleared from the temp folder'), detail: 'a.ts' })
    await expect(authorSessions.discardUncommitted('author-50', ['a.ts'])).rejects.toThrow('cleared from the temp folder')
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

  it('credits a fix Claude committed itself to its newest commit of the turn touching the files', async () => {
    mocks.commitFiles.mockResolvedValue(null)
    mocks.latestCommitTouching.mockResolvedValueOnce('bbbbbbb123')
    mocks.headOf.mockResolvedValue('before-turn')
    finishTurn(() => mocks.headOf.mockResolvedValue('after-turn'))
    await authorSessions.feedback('author-154', 'fix it')
    await vi.waitFor(() => expect(session(154).status).toBe('awaiting_feedback'))
    expect(mocks.latestCommitTouching).toHaveBeenCalledWith(expect.anything(), ['b.ts'], 'before-turn')
    expect(session(154).responses.T1).toMatchObject({ pendingCommit: false, commits: ['bbbbbbb123'], reply: 'Fixed in bbbbbbb', commitError: null })
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

  it('turns published drafts into private findings that can be cleared', async () => {
    finishTurn(() => mocks.handlers!.onSelfReview(drafts))
    await authorSessions.selfReview(pr(30))
    await vi.waitFor(() => expect(session(30).status).toBe('awaiting_feedback'))
    expect(mocks.query.mock.calls[0][0].prompt).toBe('/review-pr https://github.com/acme/api/pull/30')
    expect(session(30).selfReview).toMatchObject({ verdict: 'Minor changes', findings: [{ kind: 'finding', severity: 'high' }] })
    const findingId = session(30).selfReview!.findings[0].id
    expect(findingId).toMatch(/^self-.+-1$/)

    expect(authorSessions.sessionState('acme/api#30')).toMatchObject({ active: false, openFindings: 1 })

    authorSessions.clearFindings(session(30).id, [findingId])
    expect(session(30).selfReview?.findings).toEqual([])
    expect(authorSessions.sessionState('acme/api#30')).toMatchObject({ openFindings: 0 })
  })

  it('resolves handled findings with their responses, leaving reviewer comments alone', () => {
    authorSessions.clearFindings(session(32).id, ['self-1', 'T1'])
    expect(session(32).items.map((i) => i.id)).toEqual(['T1', 'self-2'])
    expect(Object.keys(session(32).responses)).toEqual(['T1'])
    expect(session(32).selfReview?.findings.map((f) => f.id)).toEqual(['self-2'])
  })

  it('drops the earlier self-review findings and their responses, and gives the new findings new ids, when a new one publishes', async () => {
    const sessionId = session(31).id
    finishTurn(() => mocks.handlers!.onSelfReview({ ...drafts, comments: [{ ...drafts.comments[0], body: 'Different problem' }] }))
    await authorSessions.feedback(sessionId, 'review again')
    await vi.waitFor(() => expect(session(31).status).toBe('awaiting_feedback'))
    expect(session(31).items.map((i) => i.id)).toEqual(['T1'])
    expect(Object.keys(session(31).responses)).toEqual(['T1'])
    expect(session(31).selfReview?.findings[0]).toMatchObject({ comments: [{ body: 'Different problem' }] })
    const firstId = session(31).selfReview!.findings[0].id

    finishTurn(() => mocks.handlers!.onSelfReview({ ...drafts, comments: [{ ...drafts.comments[0], body: 'Different problem' }] }))
    await authorSessions.feedback(sessionId, 'review again')
    await vi.waitFor(() => expect(session(31).status).toBe('awaiting_feedback'))
    expect(session(31).selfReview?.findings[0].id).not.toBe(firstId)
  })

  it('maps draft comments to findings with ids scoped to the review', () => {
    expect(findingsFromDrafts(drafts, 'r1', 'now')[0]).toMatchObject({ id: 'self-r1-1', path: 'a.ts', line: 4, comments: [{ body: 'Null check', createdAt: 'now' }] })
  })
})

describe('description updates', () => {
  it('saves a proposed description with GitHub\'s current one as its base', async () => {
    mocks.fetchDescription.mockResolvedValue({ title: 'Fix', body: 'Old body\r\n' })
    finishTurn()
    await authorSessions.feedback(session(63).id, 'update the description')
    await vi.waitFor(() => expect(session(63).status).toBe('awaiting_feedback'))

    expect(await mocks.handlers!.onDescription({ title: ' Fix the bug ', body: 'New body\n' })).toContain('saved')
    expect(session(63).description).toMatchObject({ title: 'Fix the bug', body: 'New body', base: { title: 'Fix', body: 'Old body\r\n' } })
    expect(authorSessions.sessionState('acme/api#63')).toMatchObject({ active: true })
    expect(await mocks.handlers!.onDescription({ title: 'Fix', body: 'Old body\n' })).toContain('nothing to update')
    expect(session(63).description).toBeNull()
    expect(authorSessions.sessionState('acme/api#63')).toMatchObject({ active: false })
  })

  it('logs and reports a proposal Rally couldn\'t compare with GitHub', async () => {
    mocks.fetchDescription.mockRejectedValue(new Error('Not Found'))
    finishTurn()
    await authorSessions.feedback(session(71).id, 'update the description')
    await vi.waitFor(() => expect(session(71).status).toBe('awaiting_feedback'))
    await expect(mocks.handlers!.onDescription({ title: 'Fix the bug', body: 'New body' })).rejects.toThrow('Not Found')
    expect(console.error).toHaveBeenCalledWith('Reading the PR description for a proposed update failed', expect.objectContaining({ pr: pr(71).url }))
    expect(session(71).description).toBeNull()
  })

  it('asks Claude to update the description from the clone, quoting the current one', async () => {
    mocks.fetchDescription.mockResolvedValue({ title: 'Fix', body: 'Old body\nSecond line' })
    finishTurn()
    await authorSessions.draftDescription(pr(64))
    await vi.waitFor(() => expect(session(64).status).toBe('awaiting_feedback'))
    const prompt = mocks.query.mock.calls[0][0].prompt as string
    expect(prompt).toContain('Current title: Fix')
    expect(prompt).toContain('> Old body\n> Second line')
    expect(prompt).toContain(`checked out at ${CLONE.path}`)
  })

  it("doesn't start a turn when reading the current description fails", async () => {
    mocks.fetchDescription.mockRejectedValue(new Error('Not Found'))
    await expect(authorSessions.draftDescription(pr(65))).rejects.toThrow('Not Found')
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('updates GitHub with the author\'s edit and clears the draft', async () => {
    mocks.fetchDescription.mockResolvedValue({ title: 'Fix', body: 'Old body' })
    await authorSessions.push('author-60', { title: 'Fix the bug ', body: 'Edited body' })
    expect(mocks.updateDescription).toHaveBeenCalledWith(pr(60), { title: 'Fix the bug', body: 'Edited body' })
    expect(session(60)).toMatchObject({ status: 'awaiting_feedback', description: null, descriptionUpdatedAt: expect.any(String) })
    expect(mocks.pushClone).not.toHaveBeenCalled()
    expect(mocks.refreshOne).toHaveBeenCalledWith('acme', 'api', 60)
  })

  it('pushes commits before updating the description', async () => {
    const lastPush = { at: '2026-11-16T00:00:00Z', oid: 'abc', commits: [{ oid: 'abc', subject: 'fix' }] }
    mocks.pushClone.mockResolvedValue({ push: lastPush, clone: CLONE })
    mocks.fetchDescription.mockResolvedValue({ title: 'Fix', body: 'Old body' })
    mocks.updateDescription.mockImplementation(async () => expect(mocks.pushClone).toHaveBeenCalled())
    await authorSessions.push('author-61')
    expect(mocks.updateDescription).toHaveBeenCalledWith(pr(61), { title: 'Fix the bug', body: 'New body' })
    expect(session(61)).toMatchObject({ status: 'awaiting_feedback', commits: [], description: null })
  })

  it('keeps pushed commits and the draft when the description update fails after them', async () => {
    const lastPush = { at: '2026-11-16T00:00:00Z', oid: 'abc', commits: [{ oid: 'abc', subject: 'fix' }] }
    mocks.pushClone.mockResolvedValue({ push: lastPush, clone: CLONE })
    mocks.fetchDescription.mockResolvedValue({ title: 'Fix', body: 'Old body' })
    mocks.updateDescription.mockRejectedValue(new Error('Not Found'))
    await expect(authorSessions.push('author-66')).rejects.toThrow("The commits are pushed. Rally couldn't update the PR description: Not Found")
    expect(session(66)).toMatchObject({ status: 'error', commits: [], lastPush, description: { title: 'Fix the bug' } })
    expect(mocks.refreshOne).toHaveBeenCalledWith('acme', 'api', 66)
  })

  it('leaves the description update for later when the merge conflicts', async () => {
    mocks.integrateRemote.mockRejectedValue(new MergeConflictError('feature', ['a.ts']))
    mocks.localCommits.mockResolvedValue([{ oid: 'abc', subject: 'fix' }])
    finishTurn()
    await authorSessions.push('author-67')
    expect(session(67)).toMatchObject({ mergeConflicts: ['a.ts'], description: { title: 'Fix the bug' } })
    expect(mocks.fetchDescription).not.toHaveBeenCalled()
    expect(mocks.updateDescription).not.toHaveBeenCalled()
    expect(mocks.refreshOne).not.toHaveBeenCalled()
  })

  it('restores a session saved before description updates with none pending', () => {
    expect(session(70)).toMatchObject({ description: null, descriptionUpdatedAt: null })
    expect(authorSessions.sessionState('acme/api#70')).toMatchObject({ active: false })
  })

  it('clears a draft GitHub already has without updating it again', async () => {
    mocks.fetchDescription.mockResolvedValue({ title: 'Fix the bug', body: 'New body\r\n' })
    await authorSessions.push('author-68')
    expect(mocks.updateDescription).not.toHaveBeenCalled()
    expect(session(68)).toMatchObject({ status: 'awaiting_feedback', error: null, description: null, descriptionUpdatedAt: expect.any(String) })
  })

  it('refuses to overwrite a description that changed on GitHub, keeping the draft', async () => {
    mocks.fetchDescription.mockResolvedValue({ title: 'Fix', body: 'Someone edited this' })
    await expect(authorSessions.push('author-62')).rejects.toThrow('changed on GitHub')
    expect(mocks.updateDescription).not.toHaveBeenCalled()
    expect(session(62)).toMatchObject({ status: 'error', description: { title: 'Fix the bug' } })

    await expect(authorSessions.push('author-62', { title: ' ', body: 'x' })).rejects.toThrow("title can't be empty")
    authorSessions.discardDescription('author-62')
    expect(session(62)).toMatchObject({ description: null, status: 'awaiting_feedback', error: null })
    await expect(authorSessions.push('author-62')).rejects.toThrow('no commits or description update')
  })

  it('keeps an error the description update didn\'t cause when discarding it', () => {
    authorSessions.discardDescription('author-69')
    expect(session(69)).toMatchObject({ description: null, status: 'error', error: 'The Claude turn ended with an error.' })
  })

  it('clears a failed description request\'s error, after commits, when discarding it', () => {
    authorSessions.discardDescription('author-72')
    expect(session(72)).toMatchObject({ description: null, status: 'awaiting_feedback', error: null })
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

  it('re-reads a worktree before pruning, removes the worktree without dropping work, and keeps the session when that fails', async () => {
    const listed = new Set(mocks.stored.map((st) => st.prKey).filter((key) => key !== 'acme/api#166' && key !== 'acme/api#167'))
    mocks.removeRallyWorktree.mockImplementation(async () => {
      if (mocks.removeRallyWorktree.mock.calls.length > 1) throw new Error("The branch feature has commits GitHub doesn't.")
    })
    authorSessions.pruneUnlisted(listed)

    await vi.waitFor(() => expect(mocks.removeRallyWorktree).toHaveBeenCalledTimes(2))
    expect(mocks.removeRallyWorktree).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rally_worktree' }), { dropWork: false })
    expect(mocks.uncommittedPaths).toHaveBeenCalledWith(expect.objectContaining({ path: WORKTREE.path }))
    await vi.waitFor(() => expect([authorSessions.getByPr('acme/api#166'), authorSessions.getByPr('acme/api#167')].filter(Boolean)).toHaveLength(1))
  })

  it('keeps a worktree session whose worktree has commits Rally hasn\'t seen yet', async () => {
    mocks.localCommits.mockResolvedValue([{ oid: 'new', subject: 'made by hand' }])
    const listed = new Set(mocks.stored.map((st) => st.prKey).filter((key) => key !== 'acme/api#168'))
    authorSessions.pruneUnlisted(listed)
    await vi.waitFor(() => expect(session(168).commits).toEqual([{ oid: 'new', subject: 'made by hand' }]))
    expect(mocks.removeRallyWorktree).not.toHaveBeenCalled()
  })
})

describe('checking out the PR branch', () => {
  const turnOptions = () => mocks.query.mock.calls.at(-1)![0].options

  it('runs a self-review in the local worktree with the repo settings and CLAUDE.md loaded', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    finishTurn()
    await authorSessions.selfReview(pr(160))
    await vi.waitFor(() => expect(session(160).status).toBe('awaiting_feedback'))

    expect(mocks.checkoutWorktree).toHaveBeenCalledWith(['~/src'], { repo: 'acme/api', branch: 'feature', baseBranch: 'main' }, undefined)
    expect(mocks.cloneBranch).not.toHaveBeenCalled()
    expect(session(160).clone).toEqual({ ...WORKTREE, syncedHead: 'synced', createdBranch: undefined })
    expect(turnOptions()).toMatchObject({ cwd: WORKTREE.path, settingSources: ['user', 'project', 'local'] })
  })

  it('starts a new conversation when the turn moves to a different folder', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    finishTurn()
    await authorSessions.feedback('author-161', 'carry on')
    await vi.waitFor(() => expect(session(161).status).toBe('awaiting_feedback'))
    expect(turnOptions().resume).toBeUndefined()
    expect(session(161).timeline).toContainEqual(expect.objectContaining({ kind: 'warning', detail: WORKTREE.path }))
  })

  it('moves a temp clone with no work of its own to the worktree and deletes the clone', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    finishTurn()
    await authorSessions.feedback('author-162', 'go')
    await vi.waitFor(() => expect(session(162).status).toBe('awaiting_feedback'))
    expect(session(162).clone?.path).toBe(WORKTREE.path)
    expect(existsSync(OLD_TEMP_CLONE.path)).toBe(false)
  })

  it('keeps using a temp clone that holds unpushed commits', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    mocks.localCommits.mockResolvedValue([{ oid: 'abc', subject: 'fix' }])
    finishTurn()
    await authorSessions.feedback('author-163', 'go')
    await vi.waitFor(() => expect(session(163).status).toBe('awaiting_feedback'))
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled()
    expect(turnOptions().cwd).toBe(CLONE.path)
  })

  it('resumes the conversation in the same folder, records the folder it ran in, and adds no warning', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    mocks.query.mockImplementation(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'next-conversation' }
      yield { type: 'result', subtype: 'success', is_error: false }
    })
    await authorSessions.feedback('author-173', 'carry on')
    await vi.waitFor(() => expect(session(173).status).toBe('awaiting_feedback'))
    expect(turnOptions().resume).toBe('worktree-conversation')
    expect(session(173)).toMatchObject({ sdkSessionId: 'next-conversation', sdkCwd: WORKTREE.path })
    expect(session(173).timeline).not.toContainEqual(expect.objectContaining({ kind: 'warning' }))
  })

  it('resumes a conversation saved before sdkCwd existed when the turn runs in the session folder', async () => {
    mocks.fetchCloneSource.mockResolvedValue({ headUrl: 'fork', branch: 'feature', baseBranch: 'main', baseUrl: 'upstream' })
    mocks.cloneBranch.mockResolvedValue({ ...CLONE, path: join(tmpdir(), 'rally', 'author-172') })
    mkdirSync(join(tmpdir(), 'rally', 'author-172'), { recursive: true })
    finishTurn()
    await authorSessions.feedback('author-172', 'carry on')
    await vi.waitFor(() => expect(session(172).status).toBe('awaiting_feedback'))
    expect(turnOptions().resume).toBe('temp-conversation')
  })

  it('notes a diverged worktree in the timeline and names the checkout in the step', async () => {
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    mocks.syncWorktree.mockImplementation(async (clone) => ({ clone: { ...clone, syncedHead: 'base' }, state: 'diverged' }))
    finishTurn()
    await authorSessions.feedback('author-169', 'go')
    await vi.waitFor(() => expect(session(169).status).toBe('awaiting_feedback'))
    expect(session(169).timeline).toContainEqual(expect.objectContaining({ kind: 'warning', label: expect.stringContaining('Rally left it as is'), detail: WORKTREE.path }))
    expect(session(169).timeline).toContainEqual(expect.objectContaining({ kind: 'step', detail: `Worktree: ${WORKTREE.path}` }))
  })

  it('names the clone and how to fall back to temp clones when the local clone fails to check out', async () => {
    const { LocalCloneError } = await import('../git/localWorktree')
    mocks.checkoutWorktree.mockRejectedValue(new LocalCloneError('/home/me/src/api', new Error('git fetch failed: Permission denied (publickey).')))
    await expect(authorSessions.feedback('author-170', 'go')).rejects.toThrow('in your clone at /home/me/src/api. Fix that clone, or remove the folder holding it')
    expect(session(170)).toMatchObject({ status: 'error', error: expect.stringContaining('Permission denied (publickey)') })
  })

  it('keeps the branch Rally created and the synced head across turns in its worktree, however git spells its path', async () => {
    mocks.checkoutWorktree.mockResolvedValue({ ...WORKTREE, path: `${realpathSync.native(WORKTREE.path)}${sep}`, kind: 'rally_worktree' })
    finishTurn()
    await authorSessions.feedback('author-171', 'go')
    await vi.waitFor(() => expect(session(171).status).toBe('awaiting_feedback'))
    expect(mocks.syncWorktree).toHaveBeenCalledWith(expect.objectContaining({ createdBranch: true, syncedHead: 'prev' }))
  })

  it('keeps using a worktree that holds unpushed commits even when no local repo folder finds it', async () => {
    mocks.localCommits.mockResolvedValue([{ oid: 'abc', subject: 'fix' }])
    finishTurn()
    await authorSessions.feedback('author-175', 'go')
    await vi.waitFor(() => expect(session(175).status).toBe('awaiting_feedback'))
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled()
    expect(mocks.cloneBranch).not.toHaveBeenCalled()
    expect(turnOptions().cwd).toBe(WORKTREE.path)
    expect(session(175).timeline).toContainEqual(expect.objectContaining({ kind: 'step', detail: `Worktree, which holds unpushed work: ${WORKTREE.path}` }))
  })

  it('stops the turn when a Rally worktree has another branch checked out, saying to switch it back', async () => {
    mocks.checkedOutBranch.mockResolvedValueOnce('spike')
    await expect(authorSessions.feedback('author-176', 'go')).rejects.toThrow('has `spike` checked out, not the PR branch `feature`. Switch it back, finishing or aborting')
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('stops the turn when your own worktree has a detached HEAD, such as mid-rebase', async () => {
    mocks.checkedOutBranch.mockResolvedValue(null)
    await expect(authorSessions.feedback('author-177', 'go')).rejects.toThrow('has a detached HEAD checked out, not the PR branch `feature`. Switch it back, finishing or aborting')
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled()
  })

  it('checks the PR branch out again when your own worktree has another branch checked out', async () => {
    mocks.checkedOutBranch.mockResolvedValueOnce('main')
    mocks.checkoutWorktree.mockResolvedValue({ ...WORKTREE, path: OLD_TEMP_CLONE.path, kind: 'rally_worktree' })
    finishTurn()
    await authorSessions.feedback('author-177', 'go')
    await vi.waitFor(() => expect(session(177).status).toBe('awaiting_feedback'))
    expect(mocks.checkoutWorktree).toHaveBeenCalledWith(['~/src'], expect.anything(), WORKTREE.path)
    expect(session(177).clone).toMatchObject({ kind: 'rally_worktree' })
  })

  it('keeps using a temp clone that holds only uncommitted edits', async () => {
    const path = join(tmpdir(), 'rally-author-test-edits-clone')
    mkdirSync(path, { recursive: true })
    mocks.checkoutWorktree.mockResolvedValue(WORKTREE)
    mocks.uncommittedPaths.mockResolvedValue(['a.ts'])
    finishTurn()
    await authorSessions.feedback('author-178', 'go')
    await vi.waitFor(() => expect(session(178).status).toBe('awaiting_feedback'))
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled()
    expect(turnOptions().cwd).toBe(path)
    expect(existsSync(path)).toBe(true)
    rmSync(path, { recursive: true, force: true })
  })

  it('leaves a turn\'s fixes uncommitted, and refuses the diff, when the turn ends on another branch', async () => {
    finishTurn(() => mocks.checkedOutBranch.mockResolvedValue('spike'))
    await authorSessions.feedback('author-179', 'fix it')
    await vi.waitFor(() => expect(session(179).status).toBe('awaiting_feedback'))
    expect(mocks.commitFiles).not.toHaveBeenCalled()
    expect(session(179).responses.T1).toMatchObject({ pendingCommit: false, commitError: expect.stringContaining('has `spike` checked out') })
    await expect(authorSessions.diff('author-179')).rejects.toThrow('has `spike` checked out')
  })

  it('clones into the temp folder for a PR from a fork', async () => {
    mocks.fetchCloneSource.mockResolvedValue({ headUrl: 'fork', branch: 'feature', baseUrl: 'upstream', baseBranch: 'main' })
    finishTurn()
    await authorSessions.feedback('author-165', 'go')
    await vi.waitFor(() => expect(session(165).status).toBe('awaiting_feedback'))
    expect(mocks.checkoutWorktree).not.toHaveBeenCalled()
    expect(mocks.cloneBranch).toHaveBeenCalledWith(join(tmpdir(), 'rally', 'author-165'), expect.objectContaining({ headUrl: 'fork' }))
  })

  it('removes the worktree Rally added, with its edits, on start over', async () => {
    const { clone } = session(164)
    await authorSessions.discard('author-164')
    expect(mocks.removeRallyWorktree).toHaveBeenCalledWith(clone, { dropWork: true })
    expect(authorSessions.getByPr('acme/api#164')).toBeNull()
  })

  it('keeps the session and names the folder when start over cannot remove the worktree', async () => {
    mocks.removeRallyWorktree.mockRejectedValue(new Error('git worktree remove failed: locked'))
    await expect(authorSessions.discard('author-168')).rejects.toThrow(`Rally couldn't remove the worktree at ${WORKTREE.path}`)
    expect(authorSessions.getByPr('acme/api#168')).not.toBeNull()
  })
})
