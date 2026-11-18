import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { checkoutKind } from '@shared/authorSession'
import type { CloneInfo } from '@shared/types'
import { git, NETWORK_TIMEOUT_MS, trackingRefspec, type GitFailure } from './gitCommand'

export const RALLY_WORKTREES_DIR = join(homedir(), 'rally-worktrees')

export interface WorktreeTarget {
  /** owner/name on GitHub. */
  repo: string
  branch: string
  baseBranch: string
}

const expandHome = (folder: string) => folder.trim().replace(/^~(?=\/|$)/, homedir())

/** Returns owner/name, lowercased, for a GitHub remote URL, or null for any other URL. */
export function githubRepoOf(url: string): string | null {
  const match = url.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null
}

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

/**
 * Finds the local clone whose origin remote is the GitHub repo, searching each folder and the folders directly inside it.
 * It checks folders named after the repo first, then reads the rest in parallel.
 */
export async function findLocalClone(folders: string[], repo: string): Promise<string | null> {
  const wanted = repo.toLowerCase()
  const name = wanted.split('/').pop() ?? wanted
  const candidates = await candidateRepos(folders)
  const named = candidates.filter((dir) => basename(dir).toLowerCase() === name)
  for (const dir of named) {
    const origin = await originRepo(dir)
    if (origin?.repo === wanted) return origin.root
  }
  const others = await Promise.all(candidates.filter((dir) => !named.includes(dir)).map(originRepo))
  return others.find((origin) => origin?.repo === wanted)?.root ?? null
}

/** Returns the path of the worktree that has the branch checked out, or null when none does. */
export async function worktreeWithBranch(root: string, branch: string): Promise<string | null> {
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

async function localBranchExists(root: string, branch: string): Promise<boolean> {
  try {
    await git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch (error) {
    if ((error as GitFailure).code === 1) return false
    throw error
  }
}

/**
 * Checks out the PR branch in a worktree of the local clone: the worktree that already has it, or one Rally adds under ~/rally-worktrees.
 * Returns null when no folder holds a clone of the repo.
 */
export async function checkoutWorktree(folders: string[], target: WorktreeTarget): Promise<CloneInfo | null> {
  const root = await findLocalClone(folders, target.repo)
  if (!root) return null
  const base = { branch: target.branch, baseRef: `origin/${target.baseBranch}` }
  const rallyPath = rallyWorktreePath(target.repo, target.branch)
  const existing = await worktreeWithBranch(root, target.branch)
  if (existing) return { ...base, path: existing, kind: samePath(existing, rallyPath) ? 'rally_worktree' : 'local_worktree' }

  await git(root, ['fetch', 'origin', trackingRefspec('origin', target.branch)], NETWORK_TIMEOUT_MS)
  await git(root, ['worktree', 'prune'])
  const createdBranch = !(await localBranchExists(root, target.branch))
  await mkdir(dirname(rallyPath), { recursive: true })
  await git(
    root,
    createdBranch
      ? ['worktree', 'add', '--track', '-b', target.branch, rallyPath, `origin/${target.branch}`]
      : ['worktree', 'add', rallyPath, target.branch],
  )
  return { ...base, path: rallyPath, kind: 'rally_worktree', createdBranch }
}

/**
 * Removes a worktree Rally added, and its local branch when Rally created that too. With dropWork, the worktree's uncommitted edits and the
 * branch's unpushed commits go with them; without it, Rally refuses when either exists.
 */
export async function removeRallyWorktree(clone: CloneInfo, { dropWork }: { dropWork: boolean }): Promise<void> {
  if (checkoutKind(clone) !== 'rally_worktree' || !existsSync(clone.path)) return
  const root = await mainWorktree(clone.path)
  if (!root) return
  if (!dropWork && clone.createdBranch) {
    const unpushed = (await git(root, ['rev-list', '--count', `refs/heads/${clone.branch}`, '--not', '--remotes=origin'])).trim()
    if (unpushed !== '0') throw new Error(`The branch ${clone.branch} has commits GitHub doesn't.`)
  }
  await git(root, ['worktree', 'remove', ...(dropWork ? ['--force'] : []), clone.path])
  if (clone.createdBranch) await git(root, ['branch', '-D', clone.branch])
}
