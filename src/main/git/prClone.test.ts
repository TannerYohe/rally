import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CloneInfo } from '@shared/types'
import {
  abortMerge,
  cloneBranch,
  cloneDiff,
  commitAll,
  commitFiles,
  concludeMerge,
  discardUncommitted,
  ForcePushConflictError,
  integrateRemote,
  localCommits,
  MergeConflictError,
  pushClone,
  syncClone,
  uncommittedDiff,
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

/** Brings GitHub's commits in, then pushes, as Push does. */
async function syncAndPush(clone: CloneInfo, at: string) {
  const integrated = await integrateRemote(clone)
  return { ...(await pushClone(integrated.clone, at)), rewritten: integrated.rewritten }
}

const diffFiles = (diff: string) => [...diff.matchAll(/^diff --git a\/(\S+) b\//gm)].map((match) => match[1])

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
    expect((await cloneDiff(clone)).diff).toContain('+three')

    const pushed = await syncAndPush(clone, AT)
    expect(pushed).toEqual({ push: { at: AT, oid: commits[0].oid, commits }, clone: { ...clone, syncedHead: commits[0].oid }, rewritten: {} })
    expect(git(root, '--git-dir', remote, 'rev-parse', 'feature').trim()).toBe(commits[0].oid)
    expect(git(clone.path, 'rev-parse', 'origin/feature').trim()).toBe(commits[0].oid)
    expect(await localCommits(clone)).toEqual([])
  })

  it('merges commits that landed on GitHub before pushing', async () => {
    const clone = await cloneBranch(join(root, 'session3'), source)
    const other = await cloneBranch(join(root, 'session4'), source)
    commitFile(other.path, 'd.txt', 'four\n')
    const theirs = await syncAndPush(other, AT)

    commitFile(clone.path, 'e.txt', 'five\n')
    const pushed = await syncAndPush(clone, AT)
    expect(git(root, '--git-dir', remote, 'rev-parse', 'feature').trim()).toBe(pushed.push.oid)
    expect(git(clone.path, 'log', '-1', '--format=%P').trim().split(' ')).toContain(theirs.push.oid)
  })

  it('leaves a conflicting merge in progress and commits it once resolved', async () => {
    const clone = await cloneBranch(join(root, 'session11'), source)
    const other = await cloneBranch(join(root, 'session12'), source)
    commitFile(other.path, 'b.txt', 'theirs\n')
    await syncAndPush(other, AT)
    commitFile(clone.path, 'b.txt', 'mine\n')

    const conflict = await syncAndPush(clone, AT).catch((error: unknown) => error)
    expect(conflict).toBeInstanceOf(MergeConflictError)
    expect((conflict as MergeConflictError).files).toEqual(['b.txt'])
    await expect(concludeMerge(clone, ['b.txt'])).rejects.toThrow('Conflict markers remain in b.txt')

    writeFileSync(join(clone.path, 'b.txt'), 'both\n')
    await concludeMerge(clone, ['b.txt'])
    const pushed = await syncAndPush(clone, AT)
    expect(git(root, '--git-dir', remote, 'show', `${pushed.push.oid}:b.txt`)).toBe('both\n')
  })

  it('aborts a conflicting merge', async () => {
    const clone = await cloneBranch(join(root, 'session13'), source)
    const other = await cloneBranch(join(root, 'session14'), source)
    commitFile(other.path, 'a.txt', 'theirs\n')
    await syncAndPush(other, AT)
    commitFile(clone.path, 'a.txt', 'mine\n')
    await syncAndPush(clone, AT).catch(() => {})

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

  it('commits every edit, including new and deleted files, and returns null when there are none', async () => {
    const clone = await cloneBranch(join(root, 'session16'), source)
    writeFileSync(join(clone.path, 'new.txt'), 'new\n')
    rmSync(join(clone.path, 'a.txt'))

    const oid = await commitAll(clone, 'Tidy up')
    expect((await localCommits(clone))[0]).toEqual({ oid, subject: 'Tidy up' })
    expect(git(clone.path, 'show', '--name-status', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['A\tnew.txt', 'D\ta.txt'])
    expect(await uncommittedPaths(clone)).toEqual([])
    expect(await commitAll(clone, 'Nothing new')).toBeNull()
  })

  it('lists and diffs each uncommitted file, including files in a new directory, without staging them', async () => {
    const clone = await cloneBranch(join(root, 'session17'), source)
    mkdirSync(join(clone.path, 'scratch'))
    writeFileSync(join(clone.path, 'scratch', 'one.txt'), 'one\n')
    writeFileSync(join(clone.path, 'scratch', 'two.txt'), 'two\n')
    rmSync(join(clone.path, 'a.txt'))

    expect((await uncommittedPaths(clone)).sort()).toEqual(['a.txt', 'scratch/one.txt', 'scratch/two.txt'])
    const diff = (await uncommittedDiff(clone)).diff
    expect(diff).toContain('+one')
    expect(diff).toContain('+two')
    expect(diff).toContain('deleted file mode')
    expect(git(clone.path, 'diff', '--cached', '--name-only').trim()).toBe('')
    expect(readdirSync(join(clone.path, '.git')).filter((name) => name.startsWith('rally-uncommitted-'))).toEqual([])
  })

  it('lists renamed files once and keeps names with spaces or accents unquoted', async () => {
    const clone = await cloneBranch(join(root, 'session18'), source)
    commitFile(clone.path, 'move-me.txt', 'moving\n')
    git(clone.path, 'mv', 'move-me.txt', 'moved.txt')
    writeFileSync(join(clone.path, 'with space.txt'), 'spaced\n')
    writeFileSync(join(clone.path, 'résumé.txt'), 'accent\n')

    expect((await uncommittedPaths(clone)).sort()).toEqual(['moved.txt', 'résumé.txt', 'with space.txt'])
  })

  it('diffs commits and uncommitted edits as plain text with a/ and b/ headers whatever the clone configures', async () => {
    const clone = await cloneBranch(join(root, 'session19'), source)
    commitFile(clone.path, 'committed.txt', 'committed\n')
    for (const [key, value] of [
      ['diff.mnemonicPrefix', 'true'],
      ['diff.noprefix', 'true'],
      ['diff.external', 'echo junk'],
      ['color.ui', 'always'],
    ]) {
      git(clone.path, 'config', key, value)
    }
    writeFileSync(join(clone.path, '.git', 'info', 'attributes'), 'hidden.txt -diff\n')
    writeFileSync(join(clone.path, 'new.txt'), 'new\n')
    writeFileSync(join(clone.path, 'hidden.txt'), 'hidden\n')
    writeFileSync(join(clone.path, 'résumé.txt'), 'accent\n')

    const uncommitted = (await uncommittedDiff(clone)).diff
    expect(uncommitted).toContain('diff --git a/new.txt b/new.txt')
    expect(uncommitted).toContain('+new')
    expect(uncommitted).toContain('+hidden')
    expect(uncommitted).toContain('diff --git a/résumé.txt b/résumé.txt')
    expect(uncommitted).not.toContain('junk')
    expect(uncommitted).not.toContain('\u001b[')
    const committed = (await cloneDiff(clone)).diff
    expect(committed).toContain('diff --git a/committed.txt b/committed.txt')
    expect(committed).toContain('+committed')
  })

  it('says when a diff was cut off', async () => {
    const clone = await cloneBranch(join(root, 'session20'), source)
    writeFileSync(join(clone.path, 'small.txt'), 'small\n')
    expect((await uncommittedDiff(clone)).truncated).toBe(false)
    writeFileSync(join(clone.path, 'big.txt'), 'x\n'.repeat(250_000))
    expect(await uncommittedDiff(clone)).toMatchObject({ truncated: true, diff: expect.any(String) })
  })

  it('fast-forwards a clone with no commits of its own on sync', async () => {
    const clone = await cloneBranch(join(root, 'session5'), source)
    const other = await cloneBranch(join(root, 'session6'), source)
    commitFile(other.path, 'f.txt', 'six\n')
    const { push } = await syncAndPush(other, AT)

    const synced = await syncClone(clone)
    expect(git(clone.path, 'rev-parse', 'HEAD').trim()).toBe(push.oid)
    expect(synced.syncedHead).toBe(push.oid)
  })

  it('diffs only the commits made in the clone after the branch moved on GitHub', async () => {
    const clone = await cloneBranch(join(root, 'session7'), source)
    const other = await cloneBranch(join(root, 'session8'), source)
    commitFile(clone.path, 'mine.txt', 'mine\n')
    commitFile(other.path, 'theirs.txt', 'theirs\n')
    await syncAndPush(other, AT)
    await syncClone(clone)

    const diff = (await cloneDiff(clone)).diff
    expect(diff).toContain('mine.txt')
    expect(diff).not.toContain('theirs.txt')
  })

  it('keeps local commits on sync when the branch moved on GitHub', async () => {
    const clone = await cloneBranch(join(root, 'session9'), source)
    const other = await cloneBranch(join(root, 'session10'), source)
    commitFile(clone.path, 'kept.txt', 'kept\n')
    const [local] = await localCommits(clone)
    commitFile(other.path, 'moved.txt', 'moved\n')
    await syncAndPush(other, AT)

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
      await syncAndPush(other, AT)
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
      const result = await syncAndPush(clone, AT)
      const replayed = result.rewritten[mine.oid]
      expect(replayed).not.toBe(mine.oid)
      expect(git(clone.path, 'log', '-1', '--format=%P', replayed).trim()).toBe(head)
      expect(git(root, '--git-dir', remote, 'rev-parse', forced.branch).trim()).toBe(replayed)
      expect(result.clone.syncedHead).toBe(replayed)
    })

    it('diffs only commits Rally made after the branch was force-pushed', async () => {
      const { forced, forcePush } = await forcedBranch()
      const pre = await cloneBranch(join(root, 'force-diff-pre'), forced)
      commitFile(pre.path, 'dropped.txt', 'dropped\n')
      git(pre.path, 'push', 'origin', `HEAD:refs/heads/${forced.branch}`)
      const clone = await cloneBranch(join(root, 'force-diff'), forced)
      commitFile(clone.path, 'ours.txt', 'ours\n')
      await forcePush('theirs-forced.txt')
      git(clone.path, 'fetch', 'origin')
      expect(diffFiles((await cloneDiff(clone)).diff)).toEqual(['ours.txt'])
    })

    it('pairs old and new shas when the force-pushed head already contains one of the replayed commits', async () => {
      const { forced } = await forcedBranch()
      const clone = await cloneBranch(join(root, 'force-cherry'), forced)
      commitFile(clone.path, 'first.txt', 'first\n')
      commitFile(clone.path, 'second.txt', 'second\n')
      const [second, first] = await localCommits(clone)
      const other = await cloneBranch(join(root, 'force-cherry-other'), forced)
      git(other.path, 'commit', '--amend', '-m', 'rewritten')
      git(other.path, 'fetch', clone.path, 'HEAD')
      git(other.path, 'cherry-pick', first.oid)
      git(other.path, 'push', '--force', 'origin', `HEAD:refs/heads/${forced.branch}`)

      const { rewritten } = await syncAndPush(clone, AT)
      expect(Object.keys(rewritten).sort()).toEqual([first.oid, second.oid].sort())
      expect(git(clone.path, 'log', '-1', '--format=%s', rewritten[second.oid]).trim()).toBe('change second.txt')
      expect(git(clone.path, 'log', '-1', '--format=%s', rewritten[first.oid]).trim()).toBe('change first.txt')
      expect(rewritten[first.oid]).not.toBe(first.oid)
      expect(git(clone.path, 'log', '-1', '--format=%P', rewritten[second.oid]).trim()).toBe(rewritten[first.oid])
    })

    it('replays and records the new synced head when integrating, without pushing anything', async () => {
      const { forced, forcePush } = await forcedBranch()
      const clone = await cloneBranch(join(root, 'force-integrate'), forced)
      commitFile(clone.path, 'kept.txt', 'kept\n')
      const [mine] = await localCommits(clone)
      const head = await forcePush('r.txt')

      const { clone: integrated, rewritten } = await integrateRemote(clone)
      expect(integrated.syncedHead).toBe(head)
      expect(Object.keys(rewritten)).toEqual([mine.oid])
      expect(git(clone.path, 'log', '-1', '--format=%P', rewritten[mine.oid]).trim()).toBe(head)
      expect((await localCommits(integrated)).map((c) => c.oid)).toEqual([rewritten[mine.oid]])
      expect(git(root, '--git-dir', remote, 'rev-parse', forced.branch).trim()).toBe(head)
    })

    it('refuses and restores the clone when the replay conflicts', async () => {
      const { forced, forcePush } = await forcedBranch()
      const clone = await cloneBranch(join(root, 'force-conflict'), forced)
      commitFile(clone.path, 'm.txt', 'mine\n')
      const before = git(clone.path, 'rev-parse', 'HEAD').trim()
      await forcePush('m.txt')

      await expect(syncAndPush(clone, AT)).rejects.toBeInstanceOf(ForcePushConflictError)
      expect(git(clone.path, 'rev-parse', 'HEAD').trim()).toBe(before)
      expect(await uncommittedPaths(clone)).toEqual([])
    })
  })

  it('refuses to merge over uncommitted edits until they are discarded', async () => {
    const clone = await cloneBranch(join(root, 'leftovers'), source)
    const other = await cloneBranch(join(root, 'leftovers-other'), source)
    commitFile(clone.path, 'n.txt', 'n\n')
    commitFile(other.path, 'a.txt', 'remote\n')
    await syncAndPush(other, AT)
    writeFileSync(join(clone.path, 'a.txt'), 'leftover\n')
    writeFileSync(join(clone.path, 'stray.txt'), 'stray\n')

    const refused = await syncAndPush(clone, AT).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(UncommittedChangesError)
    expect((refused as UncommittedChangesError).files.sort()).toEqual(['a.txt', 'stray.txt'])

    await discardUncommitted(clone)
    expect(await uncommittedPaths(clone)).toEqual([])
    await syncAndPush(clone, AT)
  })

  it('records the synced head and replayed shas from integrating, before any push', async () => {
    const clone = await cloneBranch(join(root, 'integrate-only'), source)
    const other = await cloneBranch(join(root, 'integrate-only-other'), source)
    commitFile(clone.path, 'p.txt', 'p\n')
    commitFile(other.path, 'q.txt', 'q\n')
    const { push } = await syncAndPush(other, AT)

    const integrated = await integrateRemote(clone)
    expect(integrated.clone.syncedHead).toBe(push.oid)
    expect((await localCommits(integrated.clone)).map((c) => c.subject)).toEqual([expect.stringContaining('Merge'), 'change p.txt'])
  })
})
