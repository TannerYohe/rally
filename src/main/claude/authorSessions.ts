import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  canReplyTo,
  COMMIT_PLACEHOLDER,
  hasPendingWork,
  hasUnsharedWork,
  newAuthorSession,
  normalizedDescription,
  PUSH_BEFORE_POSTING_ERROR,
  sameDescription,
  shortSha,
} from '@shared/authorSession'
import { EMPTY_DIFF } from '@shared/diff'
import {
  prKey,
  type ActionRequest,
  type AuthorSession,
  type CloneInfo,
  type DescriptionDraft,
  type DiffResult,
  type Drafts,
  type FeedbackItem,
  type ItemResponse,
  type PostedReply,
  type PrDescription,
  type PrRef,
  type ReplyPost,
  type TurnMode,
} from '@shared/types'
import { errorMessage } from '@shared/errors'
import {
  abortMerge,
  CLONE_DIR_NAME,
  cloneBranch,
  cloneDiff,
  commitAll,
  commitFiles,
  concludeMerge,
  discardUncommitted,
  localCommits,
  MergeConflictError,
  integrateRemote,
  pushClone,
  syncClone,
  UncommittedChangesError,
  uncommittedDiff,
  uncommittedPaths,
} from '../git/prClone'
import { acknowledgeFeedbackItem, fetchFeedbackItems } from '../github/authorFeedback'
import { github } from '../github/client'
import { uniqueLogins } from '../github/logins'
import { fetchApprovers, isRejectedRequest, repliedReviewers, requestReview, reviewersReady } from '../github/reviewRequests'
import { fetchCloneSource, postAuthorReply, resolveFeedbackThread } from '../github/authorReplies'
import { fetchDescription, updateDescription } from '../github/prDescription'
import { authoredPrList, type SessionState } from '../prList'
import { authorSessionsDir, configFile } from '../store'
import { createAuthorServer, type PublishedResponse } from './authorTools'
import { ClaudeSessions, now, sessionDir, type TurnSetup } from './claudeSessions'
import { AUTHOR_PROTOCOL, authorActionsPrompt, descriptionPrompt, mergeConflictPrompt, reviewPrompt } from './prompts'

const INTERRUPTED_TURN_ERROR = 'Interrupted when Rally closed. Send a message or run actions to resume.'
const INTERRUPTED_PUBLISH_ERROR = 'Rally closed while pushing or posting. Check the PR on GitHub before trying again.'
const MERGE_IN_PROGRESS_ERROR = 'Finish or abort the merge in the Changes tab first.'
const NOTHING_TO_COMMIT_ERROR = 'Claude listed files for this fix, but they had no changes to commit.'
const TURN_DID_NOT_FINISH_ERROR = `The turn didn't finish, so Rally didn't commit these files. Run Fix again.`
const CLONE_LOST_ERROR = `Rally's clone of this PR is gone, probably cleared from the temp folder, and its unpushed commits with it. Start over to clone again.`
const CLONE_CLEARED_ERROR = "Rally's clone of this PR was cleared from the temp folder, and its uncommitted edits with it."
const STALE_ITEMS_ERROR = 'Some of these comments were resolved or removed on GitHub. Refresh and pick again.'
const NOTHING_TO_PUSH_ERROR = 'There are no commits or description update to push.'
const EMPTY_TITLE_ERROR = "The PR title can't be empty."
const COMMITS_PUSHED_NOTE = 'The commits are pushed.'
const DESCRIPTION_CHANGED_ERROR =
  'The PR title or description changed on GitHub since Claude proposed this update, so Rally left it alone. Ask Claude to update the description again, or discard this update.'

/** Returns the session's items, responses, and self-review findings without the ones `drop` matches. */
function withoutItems(session: AuthorSession, drop: (itemId: string) => boolean): Pick<AuthorSession, 'items' | 'responses' | 'selfReview'> {
  return {
    items: session.items.filter((item) => !drop(item.id)),
    responses: Object.fromEntries(Object.entries(session.responses).filter(([itemId]) => !drop(itemId))),
    selfReview: session.selfReview && { ...session.selfReview, findings: session.selfReview.findings.filter((finding) => !drop(finding.id)) },
  }
}

/** Marks fixes waiting on a commit as not committed, for a turn that didn't finish. */
function withoutPendingCommits(responses: Record<string, ItemResponse>): Record<string, ItemResponse> {
  return Object.fromEntries(
    Object.entries(responses).map(([id, r]) => [id, r.pendingCommit ? { ...r, pendingCommit: false, commitError: TURN_DID_NOT_FINISH_ERROR } : r]),
  )
}

function restoreAuthorSession(stored: AuthorSession): AuthorSession {
  const session = {
    ...stored,
    reviewersToReRequest: stored.reviewersToReRequest ?? [],
    lastReRequest: stored.lastReRequest ?? null,
    mergeConflicts: stored.mergeConflicts ?? [],
    description: stored.description ?? null,
    descriptionUpdatedAt: stored.descriptionUpdatedAt ?? null,
  }
  switch (session.status) {
    case 'running':
      return { ...session, status: 'error', error: INTERRUPTED_TURN_ERROR, responses: withoutPendingCommits(session.responses) }
    case 'submitting':
      return { ...session, status: 'error', error: INTERRUPTED_PUBLISH_ERROR }
    default:
      return session
  }
}

const FINDING_ID_PREFIX = 'self-'

const isFindingId = (id: string) => id.startsWith(FINDING_ID_PREFIX)

/** Turns self-review draft comments into private feedback items the author can act on. */
export function findingsFromDrafts(drafts: Drafts, at: string): FeedbackItem[] {
  return drafts.comments.map((comment) => ({
    id: `${FINDING_ID_PREFIX}${comment.id}`,
    kind: 'finding',
    author: null,
    authorIsBot: false,
    avatarUrl: null,
    path: comment.path,
    line: comment.line,
    url: null,
    severity: comment.severity,
    outdated: false,
    answered: false,
    comments: [{ author: null, avatarUrl: null, body: comment.body, createdAt: at, url: '' }],
    replyToCommentId: null,
    reactionSubjectId: null,
  }))
}

function mergeItems(current: FeedbackItem[], next: FeedbackItem[]): FeedbackItem[] {
  const replaced = new Set(next.map((item) => item.id))
  return [...current.filter((item) => !replaced.has(item.id)), ...next]
}

/** Returns Claude's published response with Rally's commit state carried over from the item's earlier response. */
function receivedResponse(published: PublishedResponse, previous: ItemResponse | undefined, at: string): ItemResponse {
  const pendingCommit = published.action === 'fix' && published.files.length > 0
  return { ...published, pendingCommit, commits: previous?.commits ?? [], commitError: null, at }
}

const fillCommit = (reply: string, oid: string) => reply.replaceAll(COMMIT_PLACEHOLDER, shortSha(oid))

/** Points each response's commits and reply at the shas Rally gave its commits when replaying them onto a force-pushed branch. */
function rewriteCommits(responses: Record<string, ItemResponse>, rewritten: Record<string, string>): Record<string, ItemResponse> {
  const pairs = Object.entries(rewritten).filter(([from, to]) => from !== to)
  if (pairs.length === 0) return responses
  const rewrite = (response: ItemResponse): ItemResponse => ({
    ...response,
    commits: response.commits.map((oid) => rewritten[oid] ?? oid),
    reply: pairs.reduce((reply, [from, to]) => reply.replaceAll(shortSha(from), shortSha(to)), response.reply),
  })
  return Object.fromEntries(Object.entries(responses).map(([id, response]) => [id, rewrite(response)]))
}

const knownItemIds = (session: AuthorSession) => new Set([...session.items, ...(session.selfReview?.findings ?? [])].map((i) => i.id))

class AuthorSessions extends ClaudeSessions<AuthorSession> {
  constructor() {
    super(authorSessionsDir, restoreAuthorSession)
  }

  sessionState(key: string): SessionState | null {
    const session = this.getByPr(key)
    return session ? { status: session.status, active: hasPendingWork(session), openFindings: session.selfReview?.findings.length ?? 0 } : null
  }

  async runActions(pr: PrRef, requests: ActionRequest[], note: string): Promise<AuthorSession> {
    if (requests.length === 0) throw new Error('Pick an action for at least one comment.')
    const session = this.ensure(pr)
    await this.startCloneTurn(session.id, 'respond', async () => {
      const items = [...(await fetchFeedbackItems(pr)), ...(session.selfReview?.findings ?? [])]
      const available = new Set(items.map((item) => item.id))
      if (requests.some((request) => !available.has(request.itemId))) throw new Error(STALE_ITEMS_ERROR)
      const requested = new Set(requests.map((request) => request.itemId))
      this.patch(session.id, (s) => ({ items: mergeItems(s.items, items.filter((i) => requested.has(i.id))) }), true)
      return (clone) => authorActionsPrompt(pr, clone, items, requests, note)
    })
    return this.byId(session.id)
  }

  /** Starts a turn asking Claude to bring the PR's title and description up to date with its code, including unpushed commits. */
  async draftDescription(pr: PrRef): Promise<AuthorSession> {
    const session = this.ensure(pr)
    await this.startCloneTurn(session.id, 'describe', async () => {
      const current = await fetchDescription(pr)
      return (clone) => descriptionPrompt(pr, clone, current)
    })
    return this.byId(session.id)
  }

  /**
   * Runs `prepare`, clones or updates the PR branch, then starts a turn with the prompt `prepare` builds for the clone.
   * A failure before the turn starts is recorded on the session and rethrown.
   */
  private async startCloneTurn(sessionId: string, mode: TurnMode, prepare: () => Promise<(clone: CloneInfo) => string>): Promise<void> {
    this.assertCanStartTurn(sessionId)
    await this.whilePublishing(sessionId, async () => {
      try {
        const prompt = await prepare()
        this.patch(sessionId, () => ({ status: 'running', error: null }), true)
        const clone = await this.prepareClone(sessionId)
        void this.runTurn(sessionId, prompt(clone), mode)
      } catch (error) {
        if (this.byId(sessionId).status === 'running') this.patch(sessionId, () => ({ status: 'error', error: errorMessage(error) }), true)
        throw error
      }
    })
  }

  async selfReview(pr: PrRef): Promise<AuthorSession> {
    const session = this.ensure(pr)
    this.assertCanStartTurn(session.id)
    void this.runTurn(session.id, reviewPrompt(pr, configFile.get().reviewSkill), 'self_review')
    return this.byId(session.id)
  }

  async diff(sessionId: string): Promise<DiffResult> {
    const { clone } = this.byId(sessionId)
    if (!clone) return EMPTY_DIFF
    this.assertCloneFolder(sessionId)
    return cloneDiff(clone)
  }

  async uncommittedDiff(sessionId: string): Promise<DiffResult> {
    const { clone } = this.byId(sessionId)
    if (!clone) return EMPTY_DIFF
    this.assertCloneFolder(sessionId)
    return uncommittedDiff(clone)
  }

  /** Pushes unpushed commits, then applies the description update, using the author's edit of it when given. */
  async push(sessionId: string, descriptionEdit: PrDescription | null = null): Promise<void> {
    this.assertIdle(sessionId)
    const { clone, pr, commits, description, mergeConflicts } = this.byId(sessionId)
    if (mergeConflicts.length > 0) throw new Error(MERGE_IN_PROGRESS_ERROR)
    if (commits.length === 0 && !description) throw new Error(NOTHING_TO_PUSH_ERROR)
    if (description && !(descriptionEdit ?? description).title.trim()) throw new Error(EMPTY_TITLE_ERROR)
    if (commits.length > 0) {
      if (!clone) throw new Error(CLONE_LOST_ERROR)
      this.assertCloneFolder(sessionId)
    }
    const conflicts = await this.whilePublishing(sessionId, async () => {
      this.patch(sessionId, () => ({ status: 'submitting', error: null }), true)
      const conflicts = clone && commits.length > 0 ? await this.pushCommits(sessionId, clone) : []
      if (conflicts.length > 0) {
        this.patch(sessionId, () => ({ status: 'awaiting_feedback' }), true)
        return conflicts
      }
      try {
        if (description) await this.publishDescription(sessionId, description, descriptionEdit, commits.length > 0)
        this.patch(sessionId, () => ({ status: 'awaiting_feedback' }), true)
      } finally {
        this.refreshPr(pr)
      }
      return []
    })
    if (clone && conflicts.length > 0) void this.runTurn(sessionId, mergeConflictPrompt(clone, conflicts), 'resolve_merge')
  }

  /** Merges or replays GitHub's new commits into the clone and pushes, returning the files a conflicting merge left for Claude. */
  private async pushCommits(sessionId: string, clone: CloneInfo): Promise<string[]> {
    try {
      const integrated = await integrateRemote(clone)
      this.patch(sessionId, (s) => ({ clone: integrated.clone, responses: rewriteCommits(s.responses, integrated.rewritten) }), true)
      const { push: lastPush, clone: pushed } = await pushClone(integrated.clone, now())
      this.patch(sessionId, () => ({ lastPush, clone: pushed, commits: [] }), true)
      return []
    } catch (error) {
      await this.refreshClone(sessionId)
      if (error instanceof UncommittedChangesError) {
        this.patch(sessionId, () => ({ status: 'awaiting_feedback' }), true)
        throw error
      }
      if (!(error instanceof MergeConflictError)) {
        console.error('Pushing author commits failed', { pr: this.byId(sessionId).pr.url, error })
        this.patch(sessionId, () => ({ status: 'error', error: errorMessage(error) }), true)
        throw error
      }
      this.patch(sessionId, () => ({ mergeConflicts: error.files }), true)
      return error.files
    }
  }

  /** Updates the PR's title and description on GitHub, refusing when they changed there since Claude proposed the update. */
  private async publishDescription(sessionId: string, draft: DescriptionDraft, edit: PrDescription | null, afterCommits: boolean): Promise<void> {
    const { pr } = this.byId(sessionId)
    try {
      const current = await fetchDescription(pr)
      if (current.title === draft.base.title && current.body === draft.base.body) {
        const next = edit ?? draft
        await updateDescription(pr, { title: next.title.trim(), body: next.body })
        this.patch(sessionId, () => ({ description: null, descriptionUpdatedAt: now() }), true)
        return
      }
    } catch (error) {
      console.error('Updating the PR description failed', { pr: pr.url, error })
      this.failDescription(sessionId, `Rally couldn't update the PR description: ${errorMessage(error)}`, afterCommits)
    }
    this.failDescription(sessionId, DESCRIPTION_CHANGED_ERROR, afterCommits)
  }

  /** Records and throws a failed description update, noting when the commits pushed just before it went through. */
  private failDescription(sessionId: string, message: string, afterCommits: boolean): never {
    const error = afterCommits ? `${COMMITS_PUSHED_NOTE} ${message}` : message
    this.patch(sessionId, () => ({ status: 'error', error }), true)
    throw new Error(error)
  }

  /** Saves the title and description Claude proposed, with GitHub's current ones as the base, or drops the draft when they already match. */
  private async receiveDescription(sessionId: string, proposed: PrDescription): Promise<string> {
    const current = await fetchDescription(this.byId(sessionId).pr)
    if (sameDescription(proposed, current)) {
      this.patch(sessionId, () => ({ description: null }), true)
      return 'The proposed title and description match GitHub, so there is nothing to update.'
    }
    const description: DescriptionDraft = { ...normalizedDescription(proposed), base: current, at: now() }
    this.patch(sessionId, () => ({ description }), true)
    return 'Rally saved the proposed title and description. The user reviews them and updates GitHub when they push.'
  }

  discardDescription(sessionId: string): void {
    this.assertIdle(sessionId)
    this.patch(sessionId, () => ({ description: null }), true)
  }

  /** Returns whether the clone's folder is gone, forgetting the uncommitted edits that went with it and noting them in the log and the timeline. */
  private cloneFolderGone(sessionId: string): boolean {
    const session = this.find(sessionId)
    if (!session?.clone || existsSync(session.clone.path)) return false
    if (session.uncommitted.length > 0) {
      console.warn('Forgetting the uncommitted edits of a cleared clone', { pr: session.pr.url, sessionId, files: session.uncommitted })
      this.append(sessionId, { kind: 'warning', id: randomUUID(), label: CLONE_CLEARED_ERROR, detail: session.uncommitted.join(', '), at: now() })
      this.patch(sessionId, () => ({ uncommitted: [] }), true)
    }
    return true
  }

  /** Throws, and records on the session, when the clone's folder is gone, naming its unpushed commits or else its uncommitted edits as lost. */
  private assertCloneFolder(sessionId: string): void {
    if (!this.cloneFolderGone(sessionId)) return
    const error = this.byId(sessionId).commits.length > 0 ? CLONE_LOST_ERROR : CLONE_CLEARED_ERROR
    this.patch(sessionId, () => ({ status: 'error', error }), true)
    throw new Error(error)
  }

  /** Returns the clone for an action on its uncommitted edits, refusing while busy, without a clone or its folder, or while a merge is open. */
  private assertCanTouchUncommitted(sessionId: string, nothingError: string): CloneInfo {
    this.assertIdle(sessionId)
    const { clone, mergeConflicts } = this.byId(sessionId)
    if (!clone) throw new Error(nothingError)
    this.assertCloneFolder(sessionId)
    if (mergeConflicts.length > 0) throw new Error(MERGE_IN_PROGRESS_ERROR)
    return clone
  }

  /** Throws away edits in the clone that no fix committed, such as those left by a cancelled turn. */
  async discardUncommitted(sessionId: string): Promise<void> {
    const clone = this.assertCanTouchUncommitted(sessionId, 'There is nothing to discard.')
    await this.whilePublishing(sessionId, async () => {
      await discardUncommitted(clone)
      await this.refreshClone(sessionId)
    })
  }

  /** Commits every edit in the clone that no fix committed, such as changes Claude made for a free-form message. */
  async commitUncommitted(sessionId: string, message: string): Promise<void> {
    const clone = this.assertCanTouchUncommitted(sessionId, 'There is nothing to commit.')
    const { pr } = this.byId(sessionId)
    if (!message.trim()) throw new Error('Write a commit message first.')
    await this.whilePublishing(sessionId, async () => {
      try {
        const oid = await commitAll(clone, message.trim()).catch((error: unknown) => {
          console.error('Committing uncommitted changes failed', { pr: pr.url, sessionId, error })
          throw error
        })
        if (!oid) throw new Error('The clone has no changes to commit.')
      } finally {
        await this.refreshClone(sessionId)
      }
    })
  }

  /** Starts a Claude turn to resolve the conflicts left by merging the remote branch. */
  async resolveConflicts(sessionId: string): Promise<void> {
    this.assertIdle(sessionId)
    const { clone, mergeConflicts } = this.byId(sessionId)
    if (!clone || mergeConflicts.length === 0) throw new Error('There is no merge to resolve.')
    void this.runTurn(sessionId, mergeConflictPrompt(clone, mergeConflicts), 'resolve_merge')
  }

  async abortMerge(sessionId: string): Promise<void> {
    this.assertIdle(sessionId)
    const { clone } = this.byId(sessionId)
    if (!clone) throw new Error('There is no merge to abort.')
    await this.whilePublishing(sessionId, async () => {
      await abortMerge(clone)
      this.patch(sessionId, () => ({ mergeConflicts: [], error: null, status: 'awaiting_feedback' }), true)
      await this.refreshClone(sessionId)
    })
  }

  async postReplies(sessionId: string, posts: ReplyPost[], reRequestReviews: boolean): Promise<void> {
    this.assertIdle(sessionId)
    const session = this.byId(sessionId)
    if (session.commits.length > 0) throw new Error(PUSH_BEFORE_POSTING_ERROR)
    const items = new Map(session.items.map((item) => [item.id, item]))
    const replies = posts.filter((post) => post.body.trim())
    if (replies.length === 0) throw new Error('There are no replies to post.')
    const unpostable = replies.find((post) => !items.get(post.itemId) || !canReplyTo(items.get(post.itemId)!))
    if (unpostable) throw new Error(`Rally can't post a reply to ${unpostable.itemId}.`)
    if (replies.some((post) => post.body.includes(COMMIT_PLACEHOLDER))) {
      throw new Error(`A reply still has ${COMMIT_PLACEHOLDER} because Rally had nothing to commit for it. Edit the reply first.`)
    }

    let failures = 0
    const answered: FeedbackItem[] = []
    await this.whilePublishing(sessionId, async () => {
      this.patch(sessionId, () => ({ status: 'submitting', error: null }), true)
      try {
        for (const post of replies) {
          const posted = await this.postReply(session.pr, items.get(post.itemId)!, post)
          if (posted.error) failures++
          else answered.push(items.get(post.itemId)!)
          this.patch(sessionId, (s) => ({ posted: { ...s.posted, [post.itemId]: posted } }), true)
        }
        if (reRequestReviews) this.queueReRequests(sessionId, repliedReviewers(answered, (await github()).login))
        await this.settleReRequests(sessionId)
      } finally {
        const error = failures > 0 ? `${failures} of ${replies.length} replies failed to post.` : null
        this.patch(sessionId, () => ({ status: error ? 'error' : 'awaiting_feedback', error }), true)
      }
    })
    this.refreshPr(session.pr)
  }

  /** Reacts 👍 to a comment, then re-requests any queued reviewer that leaves with nothing unanswered. */
  async acknowledge(pr: PrRef, itemId: string): Promise<void> {
    await acknowledgeFeedbackItem(pr, itemId)
    const session = this.getByPr(prKey(pr.owner, pr.repo, pr.number))
    if (session && !this.isTurnRunning(session.id) && !this.publishing.has(session.id)) await this.settleReRequests(session.id)
    this.refreshPr(pr)
  }

  discardReply(sessionId: string, itemId: string): void {
    this.assertIdle(sessionId)
    this.patch(sessionId, (s) => {
      const response = s.responses[itemId]
      return response ? { responses: { ...s.responses, [itemId]: { ...response, reply: '' } } } : {}
    }, true)
  }

  /** Removes self-review findings and their responses, whether dismissed before any action or resolved after one. */
  clearFindings(sessionId: string, itemIds: string[]): void {
    this.assertIdle(sessionId)
    const cleared = new Set(itemIds.filter(isFindingId))
    this.patch(
      sessionId,
      (s) => withoutItems(s, (itemId) => cleared.has(itemId)),
      true,
    )
  }

  /**
   * Removes sessions, and their clones, for PRs that left the list, keeping any that still have work: a running turn, uncommitted edits,
   * unpushed commits, unposted replies, a description update, an open merge, or queued re-requests. A failed or cancelled last turn doesn't count.
   */
  pruneUnlisted(listed: Set<string>): void {
    for (const session of [...this.sessions.values()]) {
      if (listed.has(session.prKey) || this.isTurnRunning(session.id) || this.publishing.has(session.id)) continue
      this.cloneFolderGone(session.id)
      const hasWork = hasUnsharedWork(this.byId(session.id)) || session.mergeConflicts.length > 0
      if (hasWork || session.reviewersToReRequest.length > 0) continue
      console.info('Pruning the author session of a PR that left My PRs', { pr: session.pr.url, sessionId: session.id })
      this.remove(session)
    }
  }

  discard(sessionId: string): void {
    const session = this.byId(sessionId)
    if (this.publishing.has(sessionId)) throw new Error('Wait for Rally to finish pushing or posting before discarding this session')
    this.remove(session)
  }

  protected turnSetup(sessionId: string): TurnSetup {
    const mcpServer = createAuthorServer({
      onResponses: (responses) => {
        const at = now()
        this.patch(
          sessionId,
          (s) => {
            const known = knownItemIds(s)
            const updates = responses
              .filter((r) => known.has(r.itemId))
              .map((r): [string, ItemResponse] => [r.itemId, receivedResponse(r, s.responses[r.itemId], at)])
            return { responses: { ...s.responses, ...Object.fromEntries(updates) } }
          },
          true,
        )
      },
      onDescription: (proposed) => this.receiveDescription(sessionId, proposed),
      onSelfReview: (drafts) => {
        const selfReview = { verdict: drafts.verdict, reportMarkdown: drafts.reportMarkdown, findings: findingsFromDrafts(drafts, now()) }
        this.patch(
          sessionId,
          (s) => ({ ...withoutItems(s, isFindingId), selfReview }),
          true,
        )
      },
    })
    return { systemPromptAppend: AUTHOR_PROTOCOL, mcpServer, readOnlyGitRepos: [join(sessionDir(sessionId), CLONE_DIR_NAME)] }
  }

  /**
   * Commits what a successful turn produced: the merge on a merge-resolution turn, else the files listed for each fix.
   * A failed or cancelled turn commits nothing and marks its pending fixes as not committed. The clone's state is read after any turn.
   */
  protected async turnEnded(sessionId: string, succeeded: boolean, mode: TurnMode): Promise<void> {
    const session = this.find(sessionId)
    if (!session) return
    if (!succeeded) this.dropPendingCommits(sessionId)
    const clone = session.clone
    if (!clone || this.cloneFolderGone(sessionId)) return
    try {
      if (succeeded && mode === 'resolve_merge') {
        const merged = await concludeMerge(clone, session.mergeConflicts)
        this.patch(sessionId, () => ({ mergeConflicts: [], clone: merged }), true)
      } else if (succeeded) {
        await this.commitPublishedFixes(sessionId, clone)
      }
    } finally {
      await this.refreshClone(sessionId)
    }
  }

  private dropPendingCommits(sessionId: string): void {
    this.patch(sessionId, (s) => ({ responses: withoutPendingCommits(s.responses) }), true)
  }

  /** Commits each fix's listed files in its own commit and puts the short sha into its reply; one fix failing to commit doesn't stop the rest. */
  private async commitPublishedFixes(sessionId: string, clone: CloneInfo): Promise<void> {
    const committedFile = new Map<string, string>()
    for (const response of Object.values(this.byId(sessionId).responses).filter((r) => r.pendingCommit)) {
      let update: ItemResponse
      try {
        const oid = await commitFiles(clone, response.files, response.commitMessage.trim() || `Address review comment ${response.itemId}`)
        if (oid) for (const file of response.files) committedFile.set(file, oid)
        const covering = oid ?? response.files.map((file) => committedFile.get(file)).find(Boolean) ?? response.commits.at(-1) ?? null
        update = covering
          ? { ...response, pendingCommit: false, commits: oid ? [...response.commits, oid] : response.commits, reply: fillCommit(response.reply, covering) }
          : { ...response, pendingCommit: false, commitError: NOTHING_TO_COMMIT_ERROR }
      } catch (error) {
        console.error('Committing a fix failed', { sessionId, itemId: response.itemId, files: response.files, error })
        update = { ...response, pendingCommit: false, commitError: `Rally couldn't commit this fix: ${errorMessage(error)}` }
      }
      this.patch(sessionId, (s) => ({ responses: { ...s.responses, [response.itemId]: update } }), true)
    }
  }

  private ensure(pr: PrRef): AuthorSession {
    return this.getByPr(prKey(pr.owner, pr.repo, pr.number)) ?? this.add(newAuthorSession(this.newSessionCore(pr, 'awaiting_feedback')))
  }

  /** Allows a new turn only while no merge is open; the merge's own resolution turn starts through resolveConflicts. */
  protected assertCanStartTurn(sessionId: string): void {
    super.assertCanStartTurn(sessionId)
    if (this.byId(sessionId).mergeConflicts.length > 0) throw new Error(MERGE_IN_PROGRESS_ERROR)
  }

  private async prepareClone(sessionId: string): Promise<CloneInfo> {
    const { clone, pr } = this.byId(sessionId)
    const stepId = randomUUID()
    const label = clone ? 'Updating the PR branch' : 'Cloning the PR branch'
    this.append(sessionId, { kind: 'step', id: stepId, label, detail: '', done: false, at: now() })
    const finishStep = () =>
      this.patch(sessionId, (s) => ({ timeline: s.timeline.map((e) => (e.id === stepId && e.kind === 'step' ? { ...e, done: true } : e)) }))
    try {
      if (clone && existsSync(clone.path)) {
        const synced = await syncClone(clone)
        this.patch(sessionId, () => ({ clone: synced }), true)
        return synced
      }
      if (this.byId(sessionId).commits.length > 0) this.assertCloneFolder(sessionId)
      else this.cloneFolderGone(sessionId)
      const fresh = await cloneBranch(sessionDir(sessionId), await fetchCloneSource(pr))
      this.patch(sessionId, () => ({ clone: fresh }), true)
      return fresh
    } finally {
      finishStep()
    }
  }

  private async refreshClone(sessionId: string): Promise<void> {
    const clone = this.find(sessionId)?.clone
    if (!clone || this.cloneFolderGone(sessionId)) return
    try {
      const [commits, uncommitted] = await Promise.all([localCommits(clone), uncommittedPaths(clone)])
      this.patch(sessionId, () => ({ commits, uncommitted }), true)
    } catch (error) {
      console.error('Reading the author clone failed', { sessionId, error })
    }
  }

  private async postReply(pr: PrRef, item: FeedbackItem, post: ReplyPost): Promise<PostedReply> {
    const body = post.body.trim()
    const base = { at: now(), body, resolved: false, resolveError: null }
    let url: string
    try {
      url = await postAuthorReply(pr, item, body)
    } catch (error) {
      console.error('Posting an author reply failed', { pr: pr.url, itemId: item.id, error })
      return { ...base, url: null, error: errorMessage(error) }
    }
    if (!post.resolve || item.kind !== 'thread') return { ...base, url, error: null }
    try {
      await resolveFeedbackThread(item.id)
      return { ...base, url, error: null, resolved: true }
    } catch (error) {
      console.error('Resolving a thread after replying failed', { pr: pr.url, itemId: item.id, error })
      return { ...base, url, error: null, resolveError: errorMessage(error) }
    }
  }

  private queueReRequests(sessionId: string, reviewers: string[]): void {
    this.patch(sessionId, (s) => ({ reviewersToReRequest: uniqueLogins([...s.reviewersToReRequest, ...reviewers]) }), true)
  }

  /** Re-requests each queued reviewer with nothing left unanswered, one at a time so GitHub rejecting one doesn't hold back the rest. */
  private async settleReRequests(sessionId: string): Promise<void> {
    const { pr, reviewersToReRequest } = this.byId(sessionId)
    if (reviewersToReRequest.length === 0) return
    let split
    try {
      const [items, approvers] = await Promise.all([fetchFeedbackItems(pr), fetchApprovers(pr)])
      split = reviewersReady(reviewersToReRequest, items, approvers, (await github()).login)
    } catch (error) {
      console.error('Checking reviewers to re-request failed', { pr: pr.url, error })
      this.patch(sessionId, () => ({ lastReRequest: { at: now(), reviewers: [], error: errorMessage(error) } }), true)
      return
    }
    const requested: string[] = []
    const retry: string[] = []
    const failures: string[] = []
    for (const login of split.ready) {
      try {
        await requestReview(pr, login)
        requested.push(login)
      } catch (error) {
        console.error('Re-requesting a review failed', { pr: pr.url, reviewer: login, error })
        failures.push(`@${login}: ${errorMessage(error)}`)
        if (!isRejectedRequest(error)) retry.push(login)
      }
    }
    this.patch(sessionId, () => ({ reviewersToReRequest: [...split.waiting, ...retry] }), true)
    if (requested.length > 0 || failures.length > 0) {
      const lastReRequest = { at: now(), reviewers: requested, error: failures.length > 0 ? failures.join('; ') : null }
      this.patch(sessionId, () => ({ lastReRequest }), true)
    }
  }

  private refreshPr(pr: PrRef): void {
    authoredPrList.refreshOne(pr.owner, pr.repo, pr.number).catch((error) => {
      console.error('Authored PR refresh failed', { pr: pr.url, error })
    })
  }
}

export const authorSessions = new AuthorSessions()
