import { rm } from 'node:fs/promises'
import { checkoutKind, checkoutNoun, isWorktree } from '@shared/authorSession'
import { errorMessage } from '@shared/errors'
import type { CloneInfo, PrRef } from '@shared/types'
import { fetchCloneSource } from '../github/authorReplies'
import { samePath } from '../realPath'
import { checkoutWorktree, LocalCloneError } from '../git/localWorktree'
import { checkedOutBranch, cloneBranch, isForkSource, localCommits, syncClone, syncWorktree, uncommittedPaths, type WorktreeSyncState } from '../git/prClone'

const LOCAL_CLONE_RECOVERY = 'Fix that clone, or remove the folder holding it from Settings → Local repo folders; Rally then uses temp clones for every repo in that folder.'

const SYNC_WARNINGS: Record<WorktreeSyncState, string | null> = {
  synced: null,
  diverged: "The worktree has commits GitHub doesn't, and GitHub has commits it doesn't, so Rally left it as is. Push merges GitHub's commits in.",
  fast_forward_failed: "Rally couldn't fast-forward the worktree to GitHub's head, likely because uncommitted edits touch the same files, so Claude works on older code.",
}

/** Why a turn runs in the checkout it does. */
type CheckoutReason = 'temp_clone_has_work' | 'worktree_has_work' | 'fork' | 'no_local_clone' | 'worktree_found'

/** Names each checkout reason in the timeline's checkout step. */
export const CHECKOUT_REASONS: Record<CheckoutReason, string> = {
  temp_clone_has_work: 'Temp clone, which holds unpushed work',
  worktree_has_work: 'Worktree, which holds unpushed work',
  fork: 'Temp clone, since the PR comes from a fork',
  no_local_clone: 'Temp clone, since no local repo folder holds the repo',
  worktree_found: 'Worktree',
}

export interface Checkout {
  clone: CloneInfo
  reason: CheckoutReason
  /** A timeline warning about the checkout's state, such as a worktree left behind GitHub. */
  warning: string | null
}

/** Returns why Rally won't act on the checkout when it has a branch other than the PR's checked out, or null when it has the PR branch. */
export async function offBranchError(clone: CloneInfo): Promise<string | null> {
  const branch = await checkedOutBranch(clone)
  if (branch === clone.branch) return null
  const current = branch ? `\`${branch}\`` : 'a detached HEAD'
  const advice =
    checkoutKind(clone) === 'local_worktree' && branch
      ? 'Switch it back, or send a message so Rally checks the PR branch out in a worktree of its own.'
      : 'Switch it back, finishing or aborting any rebase or merge first.'
  return `The ${checkoutNoun(clone)} at ${clone.path} has ${current} checked out, not the PR branch \`${clone.branch}\`. ${advice}`
}

export async function assertOnPrBranch(clone: CloneInfo): Promise<void> {
  const error = await offBranchError(clone)
  if (error) throw new Error(error)
}

/** Returns whether the checkout holds commits GitHub doesn't have or uncommitted edits. */
async function holdsWork(clone: CloneInfo): Promise<boolean> {
  return (await localCommits(clone)).length > 0 || (await uncommittedPaths(clone)).length > 0
}

/** Syncs a worktree for a turn, naming it in any failure. */
async function syncLocalWorktree(clone: CloneInfo, reason: CheckoutReason): Promise<Checkout> {
  const { clone: synced, state } = await syncWorktree(clone).catch((error: unknown) => {
    throw new Error(`Rally couldn't update the worktree at ${clone.path}. ${LOCAL_CLONE_RECOVERY} ${errorMessage(error)}`)
  })
  return { clone: synced, reason, warning: SYNC_WARNINGS[state] }
}

export interface CheckoutRequest {
  pr: PrRef
  /** The session's last checkout, if any. */
  clone: CloneInfo | null
  /** The last checkout when its folder still exists. */
  held: CloneInfo | null
  folders: string[]
  /** Where a new temp clone goes. */
  cloneDir: string
}

/**
 * Returns the checkout a turn runs in. A checkout holding commits or edits stays in use until they are pushed or discarded, and a temp clone
 * or Rally worktree on another branch, or your own worktree with a detached HEAD such as mid-rebase, stops the turn. Otherwise Rally uses the local worktree for the branch, adding one when needed, and
 * clones into the temp folder only when no configured folder holds the repo or the PR comes from a fork.
 */
export async function chooseCheckout({ pr, clone, held, folders, cloneDir }: CheckoutRequest): Promise<Checkout> {
  if (held) {
    const offBranch = await offBranchError(held)
    const detached = offBranch !== null && (await checkedOutBranch(held)) === null
    if (offBranch && (checkoutKind(held) !== 'local_worktree' || detached)) throw new Error(offBranch)
    if (!offBranch && (await holdsWork(held))) {
      return isWorktree(held) ? syncLocalWorktree(held, 'worktree_has_work') : { clone: await syncClone(held), reason: 'temp_clone_has_work', warning: null }
    }
  }
  const tempClone = held && !isWorktree(held) ? held : null
  const source = await fetchCloneSource(pr)
  const repo = `${pr.owner}/${pr.repo}`
  const fork = isForkSource(source)
  const worktree = fork
    ? null
    : await checkoutWorktree(folders, { repo, branch: source.branch, baseBranch: source.baseBranch }, clone?.path).catch((error: unknown) => {
        const where = error instanceof LocalCloneError ? `your clone at ${error.root}` : `your clone of ${repo}`
        throw new Error(`Rally couldn't check out ${source.branch} in ${where}. ${LOCAL_CLONE_RECOVERY} ${errorMessage(error)}`)
      })
  if (!worktree) {
    const next = tempClone ? await syncClone(tempClone) : await cloneBranch(cloneDir, source)
    return { clone: next, reason: fork ? 'fork' : 'no_local_clone', warning: null }
  }
  if (tempClone) await rm(tempClone.path, { recursive: true, force: true })
  const previous = clone && samePath(clone.path, worktree.path) ? clone : undefined
  const carriedOver = { ...worktree, syncedHead: previous?.syncedHead, createdBranch: previous?.createdBranch || worktree.createdBranch }
  return syncLocalWorktree(carriedOver, 'worktree_found')
}
