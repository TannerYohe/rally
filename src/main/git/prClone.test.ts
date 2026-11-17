import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cloneBranch, cloneDiff, localCommits, pushClone, RemoteMovedError, syncClone, uncommittedPaths } from './prClone'

const root = mkdtempSync(join(tmpdir(), 'rally-clone-test-'))
const remote = join(root, 'remote.git')
const seed = join(root, 'seed')
const AT = '2026-11-16T00:00:00Z'

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

function commitFile(cwd: string, name: string, content: string): void {
  writeFileSync(join(cwd, name), content)
  git(cwd, 'add', name)
  git(cwd, 'commit', '-m', `change ${name}`)
}

const source = { headUrl: `file://${remote}`, branch: 'feature', baseUrl: `file://${remote}`, baseBranch: 'main' }

beforeAll(() => {
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'init', '--initial-branch=main', seed)
  commitFile(seed, 'a.txt', 'one\n')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', 'origin', 'main')
  git(seed, 'checkout', '-b', 'feature')
  commitFile(seed, 'b.txt', 'two\n')
  git(seed, 'push', 'origin', 'feature')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('prClone', () => {
  it('clones the head branch with the base branch fetched', async () => {
    const clone = await cloneBranch(join(root, 'session1'), source)
    expect(clone).toMatchObject({ branch: 'feature', baseRef: 'origin/main' })
    expect(git(clone.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature')
    expect(git(clone.path, 'rev-parse', '--verify', 'origin/main').trim()).toMatch(/^[0-9a-f]{40}$/)
    expect(await localCommits(clone)).toEqual([])
  })

  it('lists, diffs, and pushes local commits', async () => {
    const clone = await cloneBranch(join(root, 'session2'), source)
    commitFile(clone.path, 'c.txt', 'three\n')
    writeFileSync(join(clone.path, 'loose.txt'), 'x')

    const commits = await localCommits(clone)
    expect(commits.map((c) => c.subject)).toEqual(['change c.txt'])
    expect(await uncommittedPaths(clone)).toEqual(['loose.txt'])
    expect(await cloneDiff(clone)).toContain('+three')

    const pushed = await pushClone(clone, AT)
    expect(pushed).toEqual({ at: AT, oid: commits[0].oid, commits })
    expect(git(root, '--git-dir', remote, 'rev-parse', 'feature').trim()).toBe(commits[0].oid)
    expect(await localCommits(clone)).toEqual([])
  })

  it('refuses to push when the branch moved on GitHub', async () => {
    const clone = await cloneBranch(join(root, 'session3'), source)
    const other = await cloneBranch(join(root, 'session4'), source)
    commitFile(other.path, 'd.txt', 'four\n')
    await pushClone(other, AT)

    commitFile(clone.path, 'e.txt', 'five\n')
    await expect(pushClone(clone, AT)).rejects.toBeInstanceOf(RemoteMovedError)
  })

  it('fast-forwards a clone with no commits of its own on sync', async () => {
    const clone = await cloneBranch(join(root, 'session5'), source)
    const other = await cloneBranch(join(root, 'session6'), source)
    commitFile(other.path, 'f.txt', 'six\n')
    const { oid } = await pushClone(other, AT)

    await syncClone(clone)
    expect(git(clone.path, 'rev-parse', 'HEAD').trim()).toBe(oid)
  })
})
