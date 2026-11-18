import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { commitFile, git, seedRemote, useTestGitIdentity } from './testRepo.fixture'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'rally-worktree-test-')))
const home = join(root, 'home')

vi.mock('node:os', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:os')>()), homedir: () => home }))

const { checkoutWorktree, findLocalClone, LocalCloneError, rallyWorktreePath, removeRallyWorktree } = await import('./localWorktree')
const { localCommits, syncWorktree } = await import('./prClone')

const remote = join(root, 'remote.git')
const src = join(home, 'src')
const clonePath = join(src, 'api')
const GITHUB_URL = 'git@github.com:acme/api.git'

function pushBranch(seed: string, branch: string): void {
  git(seed, 'checkout', '-b', branch, 'main')
  commitFile(seed, `${branch.replaceAll('/', '-')}.txt`, `${branch}\n`)
  git(seed, 'push', 'origin', branch)
}

beforeAll(() => {
  useTestGitIdentity()
  const seed = join(root, 'seed')
  mkdirSync(src, { recursive: true })
  mkdirSync(join(src, 'not-a-repo'))
  seedRemote(root, remote, seed)
  for (const branch of ['mine', 'feature/new', 'local-only']) pushBranch(seed, branch)

  git(root, 'clone', remote, clonePath)
  git(clonePath, 'remote', 'set-url', 'origin', GITHUB_URL)
  git(clonePath, 'config', `url.${remote}.insteadOf`, GITHUB_URL)
  git(clonePath, 'branch', 'local-only', 'origin/local-only')
  git(clonePath, 'worktree', 'add', join(root, 'conductor', 'mine'), '-b', 'mine', 'origin/mine')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('findLocalClone', () => {
  it('finds the clone by its origin in a folder or one level down', async () => {
    expect(await findLocalClone(['~/src'], 'Acme/Api')).toBe(clonePath)
    expect(await findLocalClone([clonePath], 'acme/api')).toBe(clonePath)
  })

  it('resolves a linked worktree to its main clone', async () => {
    expect(await findLocalClone([join(root, 'conductor')], 'acme/api')).toBe(clonePath)
  })

  it('prefers the folder named after the repo, then the clone behind a hint, over other clones with the same origin', async () => {
    const other = join(src, 'aaa-old')
    git(root, 'clone', remote, other)
    git(other, 'remote', 'set-url', 'origin', GITHUB_URL)
    try {
      expect(await findLocalClone(['~/src'], 'acme/api')).toBe(clonePath)
      expect(await findLocalClone(['~/src'], 'acme/api', other)).toBe(other)
      expect(await findLocalClone([clonePath], 'acme/api', other)).toBe(clonePath)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('returns null when no folder holds the repo', async () => {
    expect(await findLocalClone(['~/src', join(root, 'missing')], 'acme/other')).toBeNull()
    expect(await findLocalClone([], 'acme/api')).toBeNull()
  })
})

describe('checkoutWorktree', () => {
  it('uses the worktree that already has the branch checked out', async () => {
    const clone = await checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'mine', baseBranch: 'main' })
    expect(clone).toEqual({ path: join(root, 'conductor', 'mine'), branch: 'mine', baseRef: 'origin/main', kind: 'local_worktree' })
  })

  it('returns null without a local clone', async () => {
    expect(await checkoutWorktree(['~/src'], { repo: 'acme/other', branch: 'mine', baseBranch: 'main' })).toBeNull()
  })

  it('adds a worktree with a new tracking branch, finds it again, and removes both', async () => {
    const target = { repo: 'acme/api', branch: 'feature/new', baseBranch: 'main' }
    const path = rallyWorktreePath(target.repo, target.branch)
    expect(path).toBe(join(home, 'rally-worktrees', 'acme', 'api', 'feature', 'new'))
    expect(rallyWorktreePath('other/api', 'feature/new')).not.toBe(path)
    expect(rallyWorktreePath(target.repo, 'feature-new')).not.toBe(path)

    const added = await checkoutWorktree(['~/src'], target)
    expect(added).toEqual({ path, branch: 'feature/new', baseRef: 'origin/main', kind: 'rally_worktree', createdBranch: true, cloneRoot: clonePath })
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/new')
    expect(git(path, 'rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe('origin/feature/new')

    expect(await checkoutWorktree(['~/src'], target)).toEqual({ path, branch: 'feature/new', baseRef: 'origin/main', kind: 'rally_worktree', cloneRoot: clonePath })

    await removeRallyWorktree(added!, { dropWork: false })
    expect(existsSync(path)).toBe(false)
    expect(git(clonePath, 'branch', '--list', 'feature/new').trim()).toBe('')
  })

  it('keeps a branch Rally created, and its worktree, when the branch has unpushed commits and work may not be dropped', async () => {
    const seed = join(root, 'seed')
    git(seed, 'checkout', '-b', 'unpushed', 'main')
    git(seed, 'push', 'origin', 'unpushed')
    const clone = await checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'unpushed', baseBranch: 'main' })
    commitFile(clone!.path, 'local.txt', 'local\n')

    await expect(removeRallyWorktree(clone!, { dropWork: false })).rejects.toThrow("has commits GitHub doesn't")
    expect(existsSync(clone!.path)).toBe(true)
    await removeRallyWorktree(clone!, { dropWork: true })
    expect(existsSync(clone!.path)).toBe(false)
    expect(git(clonePath, 'branch', '--list', 'unpushed').trim()).toBe('')
  })

  it('adds a worktree on an existing local branch and keeps the branch when removing it', async () => {
    const added = await checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'local-only', baseBranch: 'main' })
    expect(added).toMatchObject({ kind: 'rally_worktree', createdBranch: false })
    writeFileSync(join(added!.path, 'scratch.txt'), 'edit\n')

    await expect(removeRallyWorktree(added!, { dropWork: false })).rejects.toThrow()
    await removeRallyWorktree(added!, { dropWork: true })
    expect(existsSync(added!.path)).toBe(false)
    expect(git(clonePath, 'branch', '--list', 'local-only').trim()).toContain('local-only')
  })

  it('adds the worktree again after its folder was deleted by hand', async () => {
    const target = { repo: 'acme/api', branch: 'mine-again', baseBranch: 'main' }
    git(join(root, 'seed'), 'checkout', '-b', target.branch, 'main')
    git(join(root, 'seed'), 'push', 'origin', target.branch)
    const first = await checkoutWorktree(['~/src'], target)
    rmSync(first!.path, { recursive: true, force: true })

    const again = await checkoutWorktree(['~/src'], target)
    expect(again).toEqual({ path: first!.path, branch: target.branch, baseRef: 'origin/main', kind: 'rally_worktree', createdBranch: false, cloneRoot: clonePath })
    expect(git(again!.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(target.branch)
  })

  it('adds a worktree on a stale local branch without fetching, so syncing detects the force push', async () => {
    const seed = join(root, 'seed')
    git(seed, 'checkout', '-b', 'stale', 'main')
    commitFile(seed, 'stale.txt', 'old\n')
    git(seed, 'push', 'origin', 'stale')
    git(clonePath, 'fetch', 'origin', 'stale:refs/remotes/origin/stale')
    git(clonePath, 'branch', 'stale', 'origin/stale')
    const oldHead = git(clonePath, 'rev-parse', 'stale').trim()
    git(seed, 'commit', '--amend', '-m', 'rewritten')
    git(seed, 'push', '--force', 'origin', 'stale')

    const added = await checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'stale', baseBranch: 'main' })
    expect(added).toMatchObject({ kind: 'rally_worktree', createdBranch: false })
    const { clone: synced } = await syncWorktree(added!)
    expect(synced.syncedHead).toBe(oldHead)
    expect(await localCommits(synced)).toEqual([])
  })

  it('removes a worktree whose branch GitHub deleted after merging, counting commits up to the synced head as pushed', async () => {
    const seed = join(root, 'seed')
    git(seed, 'checkout', '-b', 'merged', 'main')
    git(seed, 'push', 'origin', 'merged')
    const added = await checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'merged', baseBranch: 'main' })
    commitFile(added!.path, 'fix.txt', 'fix\n')
    const head = git(added!.path, 'rev-parse', 'HEAD').trim()
    git(added!.path, 'push', 'origin', 'merged')
    git(seed, 'push', 'origin', '--delete', 'merged')
    git(clonePath, 'fetch', '--prune', 'origin')

    await expect(removeRallyWorktree(added!, { dropWork: false })).rejects.toThrow("has commits GitHub doesn't")
    await removeRallyWorktree({ ...added!, syncedHead: head }, { dropWork: false })
    expect(existsSync(added!.path)).toBe(false)
  })

  it('refuses to report a worktree removed when its clone is gone', async () => {
    const orphan = join(home, 'rally-worktrees', 'acme', 'api', 'orphan')
    mkdirSync(orphan, { recursive: true })
    writeFileSync(join(orphan, '.git'), `gitdir: ${join(root, 'missing', '.git', 'worktrees', 'orphan')}\n`)
    const clone = { path: orphan, branch: 'orphan', baseRef: 'origin/main', kind: 'rally_worktree' as const }
    await expect(removeRallyWorktree(clone, { dropWork: true })).rejects.toThrow("can't find the clone")
  })

  it('refuses to check out a branch your own worktree is rebasing', async () => {
    const seed = join(root, 'seed')
    git(seed, 'checkout', '-b', 'rebasing', 'main')
    commitFile(seed, 'conflict.txt', 'theirs\n')
    git(seed, 'push', 'origin', 'rebasing')
    const mine = join(root, 'conductor', 'rebasing')
    git(clonePath, 'fetch', 'origin', 'rebasing:refs/remotes/origin/rebasing')
    git(clonePath, 'worktree', 'add', '-b', 'rebasing', mine, 'main')
    commitFile(mine, 'conflict.txt', 'mine\n')
    expect(() => git(mine, 'rebase', 'origin/rebasing')).toThrow()

    await expect(checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'rebasing', baseBranch: 'main' })).rejects.toThrow(LocalCloneError)
    expect(existsSync(rallyWorktreePath('acme/api', 'rebasing'))).toBe(false)
    git(mine, 'rebase', '--abort')
  })

  it('stops when your own worktree for the branch is registered but its folder is missing', async () => {
    const seed = join(root, 'seed')
    git(seed, 'checkout', '-b', 'lost', 'main')
    git(seed, 'push', 'origin', 'lost')
    const mine = join(root, 'conductor', 'lost')
    git(clonePath, 'worktree', 'add', '-b', 'lost', mine, 'main')
    rmSync(mine, { recursive: true, force: true })

    await expect(checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'lost', baseBranch: 'main' })).rejects.toThrow('its folder is missing. Restore it, or run `git worktree prune`')
  })

  it('removes the branch Rally created after the worktree folder was deleted by hand', async () => {
    const seed = join(root, 'seed')
    git(seed, 'checkout', '-b', 'deleted', 'main')
    git(seed, 'push', 'origin', 'deleted')
    const added = await checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'deleted', baseBranch: 'main' })
    commitFile(added!.path, 'local.txt', 'local\n')
    rmSync(added!.path, { recursive: true, force: true })

    await removeRallyWorktree(added!, { dropWork: true })
    expect(git(clonePath, 'branch', '--list', 'deleted').trim()).toBe('')
    expect(git(clonePath, 'worktree', 'list')).not.toContain(added!.path)
  })

  it('never removes a worktree Rally did not add', async () => {
    const found = await checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'mine', baseBranch: 'main' })
    await removeRallyWorktree(found!, { dropWork: true })
    expect(existsSync(found!.path)).toBe(true)
  })
})
