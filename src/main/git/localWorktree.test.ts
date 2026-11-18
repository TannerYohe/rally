import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'rally-worktree-test-')))
const home = join(root, 'home')

vi.mock('node:os', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:os')>()), homedir: () => home }))

const { checkoutWorktree, findLocalClone, githubRepoOf, rallyWorktreePath, removeRallyWorktree } = await import('./localWorktree')

const remote = join(root, 'remote.git')
const src = join(home, 'src')
const clonePath = join(src, 'api')
const GITHUB_URL = 'git@github.com:acme/api.git'

const TEST_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, env: TEST_GIT_ENV, stdio: 'pipe' }).toString()
}

function pushBranch(seed: string, branch: string): void {
  git(seed, 'checkout', '-b', branch, 'main')
  writeFileSync(join(seed, `${branch.replaceAll('/', '-')}.txt`), `${branch}\n`)
  git(seed, 'add', '.')
  git(seed, 'commit', '-m', branch)
  git(seed, 'push', 'origin', branch)
}

beforeAll(() => {
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const) process.env[key] = TEST_GIT_ENV[key]
  const seed = join(root, 'seed')
  mkdirSync(src, { recursive: true })
  mkdirSync(join(src, 'not-a-repo'))
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'init', '--initial-branch=main', seed)
  writeFileSync(join(seed, 'a.txt'), 'one\n')
  git(seed, 'add', 'a.txt')
  git(seed, 'commit', '-m', 'init')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', 'origin', 'main')
  for (const branch of ['mine', 'feature/new', 'local-only']) pushBranch(seed, branch)

  git(root, 'clone', remote, clonePath)
  git(clonePath, 'remote', 'set-url', 'origin', GITHUB_URL)
  git(clonePath, 'config', `url.${remote}.insteadOf`, GITHUB_URL)
  git(clonePath, 'branch', 'local-only', 'origin/local-only')
  git(clonePath, 'worktree', 'add', join(root, 'conductor', 'mine'), '-b', 'mine', 'origin/mine')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('githubRepoOf', () => {
  it('reads owner/name from ssh and https GitHub URLs', () => {
    expect(githubRepoOf('git@github.com:Acme/API.git')).toBe('acme/api')
    expect(githubRepoOf('https://github.com/acme/api')).toBe('acme/api')
    expect(githubRepoOf('ssh://git@github.com/acme/api.git\n')).toBe('acme/api')
    expect(githubRepoOf('https://gitlab.com/acme/api.git')).toBeNull()
  })
})

describe('findLocalClone', () => {
  it('finds the clone by its origin in a folder or one level down', async () => {
    expect(await findLocalClone(['~/src'], 'Acme/Api')).toBe(clonePath)
    expect(await findLocalClone([clonePath], 'acme/api')).toBe(clonePath)
  })

  it('resolves a linked worktree to its main clone', async () => {
    expect(await findLocalClone([join(root, 'conductor')], 'acme/api')).toBe(clonePath)
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
    expect(path).toBe(join(home, 'rally-worktrees', 'api', 'feature-new'))

    const added = await checkoutWorktree(['~/src'], target)
    expect(added).toEqual({ path, branch: 'feature/new', baseRef: 'origin/main', kind: 'rally_worktree', createdBranch: true })
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/new')
    expect(git(path, 'rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe('origin/feature/new')

    expect(await checkoutWorktree(['~/src'], target)).toEqual({ path, branch: 'feature/new', baseRef: 'origin/main', kind: 'rally_worktree' })

    await removeRallyWorktree(added!, false)
    expect(existsSync(path)).toBe(false)
    expect(git(clonePath, 'branch', '--list', 'feature/new').trim()).toBe('')
  })

  it('adds a worktree on an existing local branch and keeps the branch when removing it', async () => {
    const added = await checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'local-only', baseBranch: 'main' })
    expect(added).toMatchObject({ kind: 'rally_worktree', createdBranch: false })
    writeFileSync(join(added!.path, 'scratch.txt'), 'edit\n')

    await expect(removeRallyWorktree(added!, false)).rejects.toThrow()
    await removeRallyWorktree(added!, true)
    expect(existsSync(added!.path)).toBe(false)
    expect(git(clonePath, 'branch', '--list', 'local-only').trim()).toContain('local-only')
  })

  it('never removes a worktree Rally did not add', async () => {
    const found = await checkoutWorktree(['~/src'], { repo: 'acme/api', branch: 'mine', baseBranch: 'main' })
    await removeRallyWorktree(found!, true)
    expect(existsSync(found!.path)).toBe(true)
  })
})
