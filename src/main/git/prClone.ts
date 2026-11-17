import { execFile } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { CloneInfo, LocalCommit, PushRecord } from '@shared/types'

const run = promisify(execFile)

const GH_CREDENTIAL_HELPER = '!gh auth git-credential'
const GH_CREDENTIALS = ['-c', 'credential.helper=', '-c', `credential.helper=${GH_CREDENTIAL_HELPER}`]
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
export const MAX_DIFF_CHARS = 400_000
const FIELD_SEPARATOR = '\x1f'

export const CLONE_DIR_NAME = 'repo'

export class MergeConflictError extends Error {
  constructor(
    branch: string,
    readonly files: string[],
  ) {
    super(`Merging origin/${branch} conflicted in ${files.join(', ')}.`)
    this.name = 'MergeConflictError'
  }
}

const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7})(?: |$)/m

const LOCAL_TIMEOUT_MS = 60_000
const NETWORK_TIMEOUT_MS = 3 * 60_000
const CLONE_TIMEOUT_MS = 10 * 60_000

interface GitFailure {
  code?: number | string
  killed?: boolean
  stderr?: string
}

async function git(cwd: string, args: string[], timeoutMs = LOCAL_TIMEOUT_MS): Promise<string> {
  try {
    const { stdout } = await run('git', [...GH_CREDENTIALS, ...args], {
      cwd,
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return stdout
  } catch (error) {
    const failure = error as GitFailure
    const reason = failure.killed ? `timed out after ${Math.round(timeoutMs / 1000)}s` : failure.stderr?.trim() || (error as Error).message
    throw Object.assign(new Error(`git ${args[0]} failed: ${reason}`), { code: failure.code })
  }
}

const trackingRefspec = (remote: string, branch: string) => `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`

export interface CloneSource {
  headUrl: string
  branch: string
  baseUrl: string
  baseBranch: string
}

/** Clones the PR's head branch into `<dir>/repo` and fetches its base branch. Rally passes gh's credentials on each network command. */
export async function cloneBranch(dir: string, source: CloneSource): Promise<CloneInfo> {
  const path = join(dir, CLONE_DIR_NAME)
  await mkdir(dir, { recursive: true })
  await rm(path, { recursive: true, force: true })
  await git(dir, ['clone', '--filter=blob:none', '--single-branch', '--branch', source.branch, source.headUrl, path], CLONE_TIMEOUT_MS)
  const baseRemote = source.baseUrl === source.headUrl ? 'origin' : 'upstream'
  if (baseRemote === 'upstream') await git(path, ['remote', 'add', 'upstream', source.baseUrl])
  await git(path, ['fetch', baseRemote, trackingRefspec(baseRemote, source.baseBranch)], NETWORK_TIMEOUT_MS)
  return { path, branch: source.branch, baseRef: `${baseRemote}/${source.baseBranch}` }
}

async function fetchBranch(clone: CloneInfo): Promise<void> {
  await git(clone.path, ['fetch', 'origin', trackingRefspec('origin', clone.branch)], NETWORK_TIMEOUT_MS)
}

/** Fetches the head and base branches, and fast-forwards the clone to GitHub when it has no commits of its own. */
export async function syncClone(clone: CloneInfo): Promise<void> {
  await fetchBranch(clone)
  const [baseRemote, ...baseBranch] = clone.baseRef.split('/')
  await git(clone.path, ['fetch', baseRemote, trackingRefspec(baseRemote, baseBranch.join('/'))], NETWORK_TIMEOUT_MS)
  if ((await localCommits(clone)).length === 0) await git(clone.path, ['reset', '--hard', `origin/${clone.branch}`])
}

export async function localCommits(clone: CloneInfo): Promise<LocalCommit[]> {
  const out = await git(clone.path, ['log', `--format=%H${FIELD_SEPARATOR}%s`, `origin/${clone.branch}..HEAD`])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [oid, subject] = line.split(FIELD_SEPARATOR)
      return { oid, subject: subject ?? '' }
    })
}

export async function uncommittedPaths(clone: CloneInfo): Promise<string[]> {
  const out = await git(clone.path, ['status', '--porcelain'])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
}

/** Returns the unified diff of the clone's unpushed commits, cut off at MAX_DIFF_CHARS. */
export async function cloneDiff(clone: CloneInfo): Promise<string> {
  const diff = await git(clone.path, ['diff', `origin/${clone.branch}...HEAD`])
  return diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n… diff truncated` : diff
}

async function isAncestor(clone: CloneInfo, ancestor: string): Promise<boolean> {
  try {
    await git(clone.path, ['merge-base', '--is-ancestor', ancestor, 'HEAD'])
    return true
  } catch (error) {
    if ((error as GitFailure).code === 1) return false
    throw error
  }
}

/** Commits the listed files, including deletions, and returns the new commit's sha, or null when they have no changes. */
export async function commitFiles(clone: CloneInfo, files: string[], message: string): Promise<string | null> {
  await git(clone.path, ['add', '-A', '--', ...files])
  const staged = await git(clone.path, ['diff', '--cached', '--name-only'])
  if (!staged.trim()) return null
  await git(clone.path, ['commit', '-m', message, '--', ...files])
  return (await git(clone.path, ['rev-parse', 'HEAD'])).trim()
}

async function conflictedFiles(clone: CloneInfo): Promise<string[]> {
  const out = await git(clone.path, ['diff', '--name-only', '--diff-filter=U'])
  return out.split('\n').filter(Boolean)
}

/** Merges the remote branch into the clone, leaving the merge in progress and throwing MergeConflictError when it conflicts. */
export async function mergeRemote(clone: CloneInfo): Promise<void> {
  try {
    await git(clone.path, ['merge', '--no-edit', `origin/${clone.branch}`])
  } catch (error) {
    const files = await conflictedFiles(clone)
    if (files.length === 0) throw error
    throw new MergeConflictError(clone.branch, files)
  }
}

/** Commits a merge whose conflicts were resolved, refusing while any of the files still has conflict markers. */
export async function concludeMerge(clone: CloneInfo, files: string[]): Promise<void> {
  const contents = await Promise.all(files.map(async (file) => [file, await readFile(join(clone.path, file), 'utf8').catch(() => '')] as const))
  const unresolved = contents.filter(([, text]) => CONFLICT_MARKER.test(text)).map(([file]) => file)
  if (unresolved.length > 0) throw new Error(`Conflict markers remain in ${unresolved.join(', ')}.`)
  await git(clone.path, ['add', '-A', '--', ...files])
  await git(clone.path, ['commit', '--no-edit'])
}

export async function abortMerge(clone: CloneInfo): Promise<void> {
  await git(clone.path, ['merge', '--abort'])
}

/** Pushes the clone's commits to the head branch without force, first merging in commits that landed on GitHub since. */
export async function pushClone(clone: CloneInfo, at: string): Promise<PushRecord> {
  if ((await localCommits(clone)).length === 0) throw new Error('There are no commits to push.')
  await fetchBranch(clone)
  if (!(await isAncestor(clone, `origin/${clone.branch}`))) await mergeRemote(clone)
  const commits = await localCommits(clone)
  await git(clone.path, ['push', 'origin', `HEAD:refs/heads/${clone.branch}`], NETWORK_TIMEOUT_MS)
  await fetchBranch(clone)
  const oid = (await git(clone.path, ['rev-parse', 'HEAD'])).trim()
  return { at, oid, commits }
}
