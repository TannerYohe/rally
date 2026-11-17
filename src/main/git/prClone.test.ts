import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  abortMerge,
  cloneBranch,
  cloneDiff,
  commitFiles,
  concludeMerge,
  discardUncommitted,
  ForcePushConflictError,
  localCommits,
  MergeConflictError,
  pushClone,
  syncClone,
  uncommittedPaths,
  UncommittedChangesError,
} from './prClone'

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
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const) process.env[key] = TEST_GIT_ENV[key]
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
    expect(pushed).toEqual({ push: { at: AT, oid: commits[0].oid, commits }, clone: { ...clone, syncedHead: commits[0].oid }, rewritten: {} })
    expect(git(root, '--git-dir', remote, 'rev-parse', 'feature').trim()).toBe(commits[0].oid)
    expect(git(clone.path, 'rev-parse', 'origin/feature').trim()).toBe(commits[0].oid)
    expect(await localCommits(clone)).toEqual([])
  })

  it('merges commits that landed on GitHub before pushing', async () => {
    const clone = await cloneBranch(join(root, 'session3'), source)
    const other = await cloneBranch(join(root, 'session4'), source)
    commitFile(other.path, 'd.txt', 'four\n')
    const theirs = await pushClone(other, AT)

    commitFile(clone.path, 'e.txt', 'five\n')
    const pushed = await pushClone(clone, AT)
    expect(git(root, '--git-dir', remote, 'rev-parse', 'feature').trim()).toBe(pushed.push.oid)
    expect(git(clone.path, 'log', '-1', '--format=%P').trim().split(' ')).toContain(theirs.push.oid)
  })

  it('leaves a conflicting merge in progress and commits it once resolved', async () => {
    const clone = await cloneBranch(join(root, 'session11'), source)
    const other = await cloneBranch(join(root, 'session12'), source)
    commitFile(other.path, 'b.txt', 'theirs\n')
    await pushClone(other, AT)
    commitFile(clone.path, 'b.txt', 'mine\n')

    const conflict = await pushClone(clone, AT).catch((error: unknown) => error)
    expect(conflict).toBeInstanceOf(MergeConflictError)
    expect((conflict as MergeConflictError).files).toEqual(['b.txt'])
    await expect(concludeMerge(clone, ['b.txt'])).rejects.toThrow('Conflict markers remain in b.txt')

    writeFileSync(join(clone.path, 'b.txt'), 'both\n')
    await concludeMerge(clone, ['b.txt'])
    const pushed = await pushClone(clone, AT)
    expect(git(root, '--git-dir', remote, 'show', `${pushed.push.oid}:b.txt`)).toBe('both\n')
  })

  it('aborts a conflicting merge', async () => {
    const clone = await cloneBranch(join(root, 'session13'), source)
    const other = await cloneBranch(join(root, 'session14'), source)
    commitFile(other.path, 'a.txt', 'theirs\n')
    await pushClone(other, AT)
    commitFile(clone.path, 'a.txt', 'mine\n')
    await pushClone(clone, AT).catch(() => {})

    await abortMerge(clone)
    expect(await uncommittedPaths(clone)).toEqual([])
    expect((await localCommits(clone)).map((c) => c.subject)).toEqual(['change a.txt'])
  })

  it('commits only the listed files and returns null when they have no changes', async () => {
    const clone = await cloneBranch(join(root, 'session15'), source)
    writeFileSync(join(clone.path, 'fix.txt'), 'fix\n')
    writeFileSync(join(clone.path, 'other.txt'), 'other\n')
    rmSync(join(clone.path, 'a.txt'))

    const oid = await commitFiles(clone, ['fix.txt', 'a.txt'], 'Fix the thing')
    expect((await localCommits(clone))[0]).toEqual({ oid, subject: 'Fix the thing' })
    expect(git(clone.path, 'show', '--name-status', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['A\tfix.txt', 'D\ta.txt'])
    expect(await uncommittedPaths(clone)).toEqual(['other.txt'])
    expect(await commitFiles(clone, ['fix.txt'], 'Nothing new')).toBeNull()
  })

  it('fast-forwards a clone with no commits of its own on sync', async () => {
    const clone = await cloneBranch(join(root, 'session5'), source)
    const other = await cloneBranch(join(root, 'session6'), source)
    commitFile(other.path, 'f.txt', 'six\n')
    const { push } = await pushClone(other, AT)

    const synced = await syncClone(clone)
    expect(git(clone.path, 'rev-parse', 'HEAD').trim()).toBe(push.oid)
    expect(synced.syncedHead).toBe(push.oid)
  })

  it('diffs only the commits made in the clone after the branch moved on GitHub', async () => {
    const clone = await cloneBranch(join(root, 'session7'), source)
    const other = await cloneBranch(join(root, 'session8'), source)
    commitFile(clone.path, 'mine.txt', 'mine\n')
    commitFile(other.path, 'theirs.txt', 'theirs\n')
    await pushClone(other, AT)
    await syncClone(clone)

    const diff = await cloneDiff(clone)
    expect(diff).toContain('mine.txt')
    expect(diff).not.toContain('theirs.txt')
  })

  it('keeps local commits on sync when the branch moved on GitHub', async () => {
    const clone = await cloneBranch(join(root, 'session9'), source)
    const other = await cloneBranch(join(root, 'session10'), source)
    commitFile(clone.path, 'kept.txt', 'kept\n')
    const [local] = await localCommits(clone)
    commitFile(other.path, 'moved.txt', 'moved\n')
    await pushClone(other, AT)

    await syncClone(clone)
    expect(git(clone.path, 'rev-parse', 'HEAD').trim()).toBe(local.oid)
    expect((await localCommits(clone)).map((c) => c.oid)).toEqual([local.oid])
  })

  describe('after a force push', () => {
    let branchCount = 0
    async function forcedBranch() {
      const branch = `forced-${++branchCount}`
      const seedClone = await cloneBranch(join(root, `${branch}-seed`), source)
      git(seedClone.path, 'push', 'origin', `HEAD:refs/heads/${branch}`)
      const forced = { ...source, branch }
      const forcePush = async (file: string) => {
        const other = await cloneBranch(join(root, `${branch}-other-${file}`), forced)
        writeFileSync(join(other.path, file), `${file}\n`)
        git(other.path, 'add', file)
        git(other.path, 'commit', '--amend', '-m', 'rewritten')
        git(other.path, 'push', '--force', 'origin', `HEAD:refs/heads/${branch}`)
        return git(other.path, 'rev-parse', 'HEAD').trim()
      }
      return { forced, forcePush }
    }

    it('resets a clone with no commits or edits of its own to the new head on sync', async () => {
      const { forced, forcePush } = await forcedBranch()
      const clone = await cloneBranch(join(root, 'force-sync'), forced)
      const head = await forcePush('g.txt')
      const synced = await syncClone(clone)
      expect(git(clone.path, 'rev-parse', 'HEAD').trim()).toBe(head)
      expect(await localCommits(synced)).toEqual([])
    })

    it('keeps uncommitted edits on sync instead of resetting', async () => {
      const clone = await cloneBranch(join(root, 'edits-sync'), source)
      const before = git(clone.path, 'rev-parse', 'HEAD').trim()
      const other = await cloneBranch(join(root, 'edits-sync-other'), source)
      commitFile(other.path, 'h.txt', 'h\n')
      await pushClone(other, AT)
      writeFileSync(join(clone.path, 'a.txt'), 'half-done\n')

      await syncClone(clone)
      expect(git(clone.path, 'rev-parse', 'HEAD').trim()).toBe(before)
      expect(await uncommittedPaths(clone)).toEqual(['a.txt'])
    })

    it('replays only commits Rally made onto the new head and maps their old shas to new ones', async () => {
      const { forced, forcePush } = await forcedBranch()
      const clone = await cloneBranch(join(root, 'force-push'), forced)
      commitFile(clone.path, 'mine.txt', 'mine\n')
      const [mine] = await localCommits(clone)
      const head = await forcePush('k.txt')

      expect((await localCommits(clone)).map((c) => c.oid)).toEqual([mine.oid])
      const result = await pushClone(clone, AT)
      const replayed = result.rewritten[mine.oid]
      expect(replayed).not.toBe(mine.oid)
      expect(git(clone.path, 'log', '-1', '--format=%P', replayed).trim()).toBe(head)
      expect(git(root, '--git-dir', remote, 'rev-parse', forced.branch).trim()).toBe(replayed)
      expect(result.clone.syncedHead).toBe(replayed)
    })

    it('refuses and restores the clone when the replay conflicts', async () => {
      const { forced, forcePush } = await forcedBranch()
      const clone = await cloneBranch(join(root, 'force-conflict'), forced)
      commitFile(clone.path, 'm.txt', 'mine\n')
      const before = git(clone.path, 'rev-parse', 'HEAD').trim()
      await forcePush('m.txt')

      await expect(pushClone(clone, AT)).rejects.toBeInstanceOf(ForcePushConflictError)
      expect(git(clone.path, 'rev-parse', 'HEAD').trim()).toBe(before)
      expect(await uncommittedPaths(clone)).toEqual([])
    })
  })

  it('refuses to merge over uncommitted edits until they are discarded', async () => {
    const clone = await cloneBranch(join(root, 'leftovers'), source)
    const other = await cloneBranch(join(root, 'leftovers-other'), source)
    commitFile(clone.path, 'n.txt', 'n\n')
    commitFile(other.path, 'a.txt', 'remote\n')
    await pushClone(other, AT)
    writeFileSync(join(clone.path, 'a.txt'), 'leftover\n')
    writeFileSync(join(clone.path, 'stray.txt'), 'stray\n')

    const refused = await pushClone(clone, AT).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(UncommittedChangesError)
    expect((refused as UncommittedChangesError).files.sort()).toEqual(['a.txt', 'stray.txt'])

    await discardUncommitted(clone)
    expect(await uncommittedPaths(clone)).toEqual([])
    await pushClone(clone, AT)
  })
})
