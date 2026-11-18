import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { checkoutKind, RALLY_WORKTREES_FOLDER } from '@shared/authorSession'
import type { CloneInfo } from '@shared/types'
import { git, gitSucceeds, NETWORK_TIMEOUT_MS, trackingRefspec } from './gitCommand'
import { githubRepoOf } from './githubRemotes'

export interface WorktreeTarget {
  /** owner/name on GitHub. */
  repo: string
  branch: string
  baseBranch: string
}

const expandHome = (folder: string) => folder.trim().replace(/^~(?=\/|$)/, homedir())

const RALLY_WORKTREES_DIR = expandHome(RALLY_WORKTREES_FOLDER)

/** Lists each folder and the folders directly inside it that hold a .git entry. */
async function candidateRepos(folders: string[]): Promise<string[]> {
  const dirs: string[] = []
  for (const folder of folders.map(expandHome).filter((f) => f && existsSync(f))) {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
    dirs.push(folder, ...entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => join(folder, e.name)))
  }
  return dirs.filter((dir) => existsSync(join(dir, '.git')))
}

/** Returns the main working tree of the repo that dir belongs to, even when dir is one of its linked worktrees. */
async function mainWorktree(dir: string): Promise<string | null> {
  try {
    return dirname((await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim())
  } catch {
    return null
  }
}

/** Returns the GitHub repo, as lowercased owner/name, that a folder's repo has as its origin, or null. */
async function originRepo(dir: string): Promise<{ root: string; repo: string | null } | null> {
  const root = await mainWorktree(dir)
  if (!root) return null
  const url = await git(root, ['config', '--get', 'remote.origin.url']).catch(() => '')
  return { root, repo: githubRepoOf(url) }
}

const ORIGIN_READ_CONCURRENCY = 8

/**
 * Finds the local clone whose origin remote is the GitHub repo, searching each folder and the folders directly inside it.
 * It checks the clone behind `hint` first when one of the folders holds it, then folders named after the repo, then reads the rest a few at a time.
 */
export async function findLocalClone(folders: string[], repo: string, hint?: string): Promise<string | null> {
  const wanted = repo.toLowerCase()
  const name = wanted.split('/').pop() ?? wanted
  const candidates = await candidateRepos(folders)
  const hinted = hint && existsSync(hint) ? await originRepo(hint) : null
  if (hinted?.repo === wanted && candidates.some((dir) => samePath(dir, hinted.root))) return hinted.root
  const named = candidates.filter((dir) => basename(dir).toLowerCase() === name)
  for (const dir of named) {
    const origin = await originRepo(dir)
    if (origin?.repo === wanted) return origin.root
  }
  const pending = candidates.filter((dir) => !named.includes(dir))
  let found: string | null = null
  const workers = Array.from({ length: ORIGIN_READ_CONCURRENCY }, async () => {
    for (let dir = pending.shift(); dir && !found; dir = pending.shift()) {
      const origin = await originRepo(dir)
      if (origin?.repo === wanted) found = origin.root
    }
  })
  await Promise.all(workers)
  return found
}

/** Returns the path of the worktree that has the branch checked out, or null when none does. */
async function worktreeWithBranch(root: string, branch: string): Promise<string | null> {
  const blocks = (await git(root, ['worktree', 'list', '--porcelain'])).split('\n\n')
  for (const block of blocks) {
    const lines = block.split('\n')
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    if (path && lines.includes(`branch refs/heads/${branch}`) && existsSync(path)) return path
  }
  return null
}

/** Returns where Rally adds a worktree for the branch: ~/rally-worktrees/<owner>/<name>/<branch>, with each part of the branch a folder. */
export function rallyWorktreePath(repo: string, branch: string): string {
  return join(RALLY_WORKTREES_DIR, ...repo.split('/'), ...branch.split('/'))
}

const samePath = (a: string, b: string) => existsSync(a) && existsSync(b) && realpathSync(a) === realpathSync(b)

const localBranchExists = (root: string, branch: string) => gitSucceeds(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])

/** A git failure in the user's local clone, naming that clone. */
export class LocalCloneError extends Error {
  constructor(
    readonly root: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'LocalCloneError'
  }
}

/**
 * Checks out the PR branch in a worktree of the local clone: the worktree that already has it, or one Rally adds under RALLY_WORKTREES_FOLDER.
 * Returns null when no folder holds a clone of the repo. Rally fetches the branch only when it creates the local branch, so a worktree added on
 * an existing branch still has the GitHub head it last fetched for syncWorktree to compare against.
 */
export async function checkoutWorktree(folders: string[], target: WorktreeTarget, hint?: string): Promise<CloneInfo | null> {
  const root = await findLocalClone(folders, target.repo, hint)
  if (!root) return null
  const base = { branch: target.branch, baseRef: `origin/${target.baseBranch}` }
  const rallyPath = rallyWorktreePath(target.repo, target.branch)
  try {
    const existing = await worktreeWithBranch(root, target.branch)
    if (existing) return { ...base, path: existing, kind: samePath(existing, rallyPath) ? 'rally_worktree' : 'local_worktree' }
    const createdBranch = !(await localBranchExists(root, target.branch))
    if (createdBranch) await git(root, ['fetch', 'origin', trackingRefspec('origin', target.branch)], NETWORK_TIMEOUT_MS)
    await mkdir(dirname(rallyPath), { recursive: true })
    await git(
      root,
      createdBranch
        ? ['worktree', 'add', '--force', '--track', '-b', target.branch, rallyPath, `origin/${target.branch}`]
        : ['worktree', 'add', '--force', rallyPath, target.branch],
    )
    return { ...base, path: rallyPath, kind: 'rally_worktree', createdBranch }
  } catch (error) {
    throw new LocalCloneError(root, error)
  }
}

/**
 * Removes a worktree Rally added, and its local branch when Rally created that too. With dropWork, the worktree's uncommitted edits and the
 * branch's unpushed commits go with them; without it, Rally refuses when either exists. Commits up to the head Rally last synced or pushed
 * count as pushed, even after GitHub deletes the branch.
 */
export async function removeRallyWorktree(clone: CloneInfo, { dropWork }: { dropWork: boolean }): Promise<void> {
  if (checkoutKind(clone) !== 'rally_worktree' || !existsSync(clone.path)) return
  const root = await mainWorktree(clone.path)
  if (!root) throw new Error(`Rally can't find the clone the worktree at ${clone.path} belongs to. Delete that folder yourself.`)
  if (!dropWork && clone.createdBranch) {
    const pushed = ['--remotes=origin', ...(clone.syncedHead ? [clone.syncedHead] : [])]
    const unpushed = (await git(root, ['rev-list', '--count', `refs/heads/${clone.branch}`, '--not', ...pushed])).trim()
    if (unpushed !== '0') throw new Error(`The branch ${clone.branch} has commits GitHub doesn't.`)
  }
  await git(root, ['worktree', 'remove', ...(dropWork ? ['--force'] : []), clone.path])
  if (clone.createdBranch) await git(root, ['branch', '-D', clone.branch])
}
