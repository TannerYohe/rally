import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { CloneInfo, LocalCommit, PushRecord } from '@shared/types'

const run = promisify(execFile)

const GH_CREDENTIAL_HELPER = '!gh auth git-credential'
const GH_CREDENTIALS = ['-c', 'credential.helper=', '-c', `credential.helper=${GH_CREDENTIAL_HELPER}`]
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_DIFF_CHARS = 400_000
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

export class UncommittedChangesError extends Error {
  constructor(readonly files: string[]) {
    super(`Commit or discard the ${files.length} uncommitted change(s) in the Changes tab before Rally merges the branch's new commits from GitHub.`)
    this.name = 'UncommittedChangesError'
  }
}

export class ForcePushConflictError extends Error {
  constructor(branch: string) {
    super(`origin/${branch} was force-pushed, and Rally's commits don't apply cleanly on top of it. Start over to drop them.`)
    this.name = 'ForcePushConflictError'
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

async function git(cwd: string, args: string[], timeoutMs = LOCAL_TIMEOUT_MS, env: Record<string, string> = {}): Promise<string> {
  try {
    const { stdout } = await run('git', [...GH_CREDENTIALS, ...args], {
      cwd,
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
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
  return { path, branch: source.branch, baseRef: `${baseRemote}/${source.baseBranch}`, syncedHead: await revParse(path, 'HEAD') }
}

async function revParse(cwd: string, ref: string): Promise<string> {
  return (await git(cwd, ['rev-parse', ref])).trim()
}

const remoteRef = (clone: CloneInfo) => `origin/${clone.branch}`

/** Returns the ref Rally's own commits start after, falling back to the remote branch for clones from before syncedHead existed. */
const syncedRef = (clone: CloneInfo) => clone.syncedHead ?? remoteRef(clone)

async function fetchBranch(clone: CloneInfo): Promise<void> {
  await git(clone.path, ['fetch', 'origin', trackingRefspec('origin', clone.branch)], NETWORK_TIMEOUT_MS)
}

/** Fetches the head and base branches, and moves the clone to GitHub's head, even after a force push, when it holds no commits or edits of its own. */
export async function syncClone(clone: CloneInfo): Promise<CloneInfo> {
  await fetchBranch(clone)
  const [baseRemote, ...baseBranch] = clone.baseRef.split('/')
  await git(clone.path, ['fetch', baseRemote, trackingRefspec(baseRemote, baseBranch.join('/'))], NETWORK_TIMEOUT_MS)
  if ((await localCommits(clone)).length > 0 || (await uncommittedPaths(clone)).length > 0) return clone
  await git(clone.path, ['reset', '--hard', remoteRef(clone)])
  return { ...clone, syncedHead: await revParse(clone.path, 'HEAD') }
}

async function commitList(clone: CloneInfo, extra: string[]): Promise<LocalCommit[]> {
  const out = await git(clone.path, ['log', `--format=%H${FIELD_SEPARATOR}%s`, ...extra, 'HEAD', `^${remoteRef(clone)}`, `^${syncedRef(clone)}`])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [oid, subject] = line.split(FIELD_SEPARATOR)
      return { oid, subject: subject ?? '' }
    })
}

/** Returns the commits Rally made in the clone that GitHub doesn't have, newest first. */
export function localCommits(clone: CloneInfo): Promise<LocalCommit[]> {
  return commitList(clone, [])
}

/** Discards edits in the clone that no commit holds, including new files. */
export async function discardUncommitted(clone: CloneInfo): Promise<void> {
  await git(clone.path, ['reset', '--hard', 'HEAD'])
  await git(clone.path, ['clean', '-fd'])
}

/** Lists every changed, new, and deleted file in the clone that no commit holds, one entry per file even inside new directories. */
export async function uncommittedPaths(clone: CloneInfo): Promise<string[]> {
  const entries = (await git(clone.path, ['status', '--porcelain', '-z', '--untracked-files=all'])).split('\0').filter(Boolean)
  const paths: string[] = []
  for (let i = 0; i < entries.length; i++) {
    paths.push(entries[i].slice(3))
    if (entries[i][0] === 'R' || entries[i][0] === 'C') i++
  }
  return paths
}

/** Pins the a/ and b/ prefixes the diff view parses and shows file contents rather than a textconv or external driver's rendering. */
const DIFF_DISPLAY_FLAGS = ['--src-prefix=a/', '--dst-prefix=b/', '--no-textconv', '--no-ext-diff']

const truncateDiff = (diff: string) => (diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n… diff truncated` : diff)

/** Returns the unified diff of the clone's unpushed commits, cut off at MAX_DIFF_CHARS. */
export async function cloneDiff(clone: CloneInfo): Promise<string> {
  return truncateDiff(await git(clone.path, ['diff', ...DIFF_DISPLAY_FLAGS, `${syncedRef(clone)}...HEAD`]))
}

/** Returns the unified diff of the edits commitAll would commit, new files included, staged in a scratch index and cut off at MAX_DIFF_CHARS. */
export async function uncommittedDiff(clone: CloneInfo): Promise<string> {
  const env = { GIT_INDEX_FILE: join(clone.path, '.git', `rally-uncommitted-${randomUUID()}.index`) }
  try {
    await git(clone.path, ['read-tree', 'HEAD'], LOCAL_TIMEOUT_MS, env)
    await git(clone.path, ['add', '-A', '--', '.'], LOCAL_TIMEOUT_MS, env)
    return truncateDiff(await git(clone.path, ['diff', '--cached', ...DIFF_DISPLAY_FLAGS, 'HEAD'], LOCAL_TIMEOUT_MS, env))
  } finally {
    await rm(env.GIT_INDEX_FILE, { force: true })
  }
}

async function isAncestor(clone: CloneInfo, ancestor: string, descendant = 'HEAD'): Promise<boolean> {
  try {
    await git(clone.path, ['merge-base', '--is-ancestor', ancestor, descendant])
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

/** Commits every edit in the clone, including new and deleted files, and returns the new commit's sha, or null when there are none. */
export function commitAll(clone: CloneInfo, message: string): Promise<string | null> {
  return commitFiles(clone, ['.'], message)
}

async function conflictedFiles(clone: CloneInfo): Promise<string[]> {
  const out = await git(clone.path, ['diff', '--name-only', '--diff-filter=U'])
  return out.split('\n').filter(Boolean)
}

/** Merges the remote branch into the clone, leaving the merge in progress and throwing MergeConflictError when it conflicts. */
async function mergeRemote(clone: CloneInfo): Promise<void> {
  try {
    await git(clone.path, ['merge', '--no-edit', `origin/${clone.branch}`])
  } catch (error) {
    const files = await conflictedFiles(clone)
    if (files.length === 0) throw error
    throw new MergeConflictError(clone.branch, files)
  }
}

/** Commits a merge whose conflicts were resolved, refusing while any of the files still has conflict markers. */
export async function concludeMerge(clone: CloneInfo, files: string[]): Promise<CloneInfo> {
  const contents = await Promise.all(files.map(async (file) => [file, await readFile(join(clone.path, file), 'utf8').catch(() => '')] as const))
  const unresolved = contents.filter(([, text]) => CONFLICT_MARKER.test(text)).map(([file]) => file)
  if (unresolved.length > 0) throw new Error(`Conflict markers remain in ${unresolved.join(', ')}.`)
  await git(clone.path, ['add', '-A', '--', ...files])
  await git(clone.path, ['commit', '--no-edit'])
  return { ...clone, syncedHead: await revParse(clone.path, remoteRef(clone)) }
}

/** Replays Rally's commits onto a force-pushed branch and returns each rewritten commit's old sha mapped to its new one. */
async function replayOntoRemote(clone: CloneInfo): Promise<Record<string, string>> {
  const before = await commitList(clone, ['--no-merges'])
  try {
    await git(clone.path, ['rebase', '--empty=keep', '--reapply-cherry-picks', '--onto', remoteRef(clone), syncedRef(clone)])
  } catch {
    await git(clone.path, ['rebase', '--abort']).catch(() => {})
    throw new ForcePushConflictError(clone.branch)
  }
  const after = await commitList({ ...clone, syncedHead: undefined }, ['--no-merges'])
  return Object.fromEntries(before.map((commit, index) => [commit.oid, after[index]?.oid ?? commit.oid]))
}

export interface IntegrateResult {
  clone: CloneInfo
  /** Old sha to new sha for commits Rally replayed onto a force-pushed branch. */
  rewritten: Record<string, string>
}

export interface PushResult {
  push: PushRecord
  clone: CloneInfo
}

export async function abortMerge(clone: CloneInfo): Promise<void> {
  await git(clone.path, ['merge', '--abort'])
}

/**
 * Fetches the head branch and brings commits that landed on GitHub into the clone: merged in, or after a force push, with Rally's commits replayed on top.
 * The returned clone records GitHub's head as synced, so save it before pushing in case the push fails.
 */
export async function integrateRemote(clone: CloneInfo): Promise<IntegrateResult> {
  await fetchBranch(clone)
  if (await isAncestor(clone, remoteRef(clone))) return { clone, rewritten: {} }
  const leftovers = await uncommittedPaths(clone)
  if (leftovers.length > 0) throw new UncommittedChangesError(leftovers)
  const forcePushed = clone.syncedHead !== undefined && !(await isAncestor(clone, clone.syncedHead, remoteRef(clone)))
  const rewritten = forcePushed ? await replayOntoRemote(clone) : {}
  if (!forcePushed) await mergeRemote(clone)
  return { clone: { ...clone, syncedHead: await revParse(clone.path, remoteRef(clone)) }, rewritten }
}

/** Pushes the clone's commits to the head branch without force; run integrateRemote first so GitHub's commits are already in. */
export async function pushClone(clone: CloneInfo, at: string): Promise<PushResult> {
  const commits = await commitList({ ...clone, syncedHead: undefined }, [])
  if (commits.length === 0) throw new Error('There are no commits to push.')
  const oid = await revParse(clone.path, 'HEAD')
  await git(clone.path, ['push', 'origin', `HEAD:refs/heads/${clone.branch}`], NETWORK_TIMEOUT_MS)
  return { push: { at, oid, commits }, clone: { ...clone, syncedHead: oid } }
}
