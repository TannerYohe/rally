import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { canReplyTo, hasPendingWork, PUSH_BEFORE_POSTING_ERROR } from '@shared/authorSession'
import {
  prKey,
  type ActionRequest,
  type AuthorSession,
  type CloneInfo,
  type Drafts,
  type FeedbackItem,
  type ItemResponse,
  type PostedReply,
  type PrRef,
  type ReplyPost,
} from '@shared/types'
import { errorMessage } from '@shared/errors'
import { cloneBranch, cloneDiff, localCommits, pushClone, RemoteMovedError, syncClone, uncommittedPaths } from '../git/prClone'
import { acknowledgeFeedbackItem, fetchFeedbackItems } from '../github/authorFeedback'
import { repliedReviewers, requestReviews, reviewersReady, uniqueLogins } from '../github/reviewRequests'
import { fetchCloneSource, postAuthorReply, resolveFeedbackThread } from '../github/authorReplies'
import { authoredPrList, type SessionState } from '../prList'
import { authorSessionsDir, configFile } from '../store'
import { createAuthorServer } from './authorTools'
import { ClaudeSessions, now, sessionDir, type TurnSetup } from './claudeSessions'
import { AUTHOR_PROTOCOL, authorActionsPrompt, reviewPrompt } from './prompts'

const INTERRUPTED_TURN_ERROR = 'Interrupted when Rally closed. Send a message or run actions to resume.'
const INTERRUPTED_PUBLISH_ERROR = 'Rally closed while pushing or posting. Check the PR on GitHub before trying again.'
const STALE_ITEMS_ERROR = 'Some of these comments were resolved or removed on GitHub. Refresh and pick again.'

function restoreAuthorSession(stored: AuthorSession): AuthorSession {
  const session = { ...stored, reviewersToReRequest: stored.reviewersToReRequest ?? [], lastReRequest: stored.lastReRequest ?? null }
  switch (session.status) {
    case 'running':
      return { ...session, status: 'error', error: INTERRUPTED_TURN_ERROR }
    case 'submitting':
      return { ...session, status: 'error', error: INTERRUPTED_PUBLISH_ERROR }
    default:
      return session
  }
}

/** Turns self-review draft comments into private feedback items the author can act on. */
export function findingsFromDrafts(drafts: Drafts, at: string): FeedbackItem[] {
  return drafts.comments.map((comment) => ({
    id: `self-${comment.id}`,
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

const knownItemIds = (session: AuthorSession) => new Set([...session.items, ...(session.selfReview?.findings ?? [])].map((i) => i.id))

class AuthorSessions extends ClaudeSessions<AuthorSession> {
  private publishing = new Set<string>()

  constructor() {
    super(authorSessionsDir, restoreAuthorSession)
  }

  sessionState(key: string): SessionState | null {
    const session = this.getByPr(key)
    return session ? { status: session.status, active: hasPendingWork(session) } : null
  }

  async runActions(pr: PrRef, requests: ActionRequest[], note: string): Promise<AuthorSession> {
    if (requests.length === 0) throw new Error('Pick an action for at least one comment.')
    const session = this.ensure(pr)
    this.assertIdle(session.id)
    this.publishing.add(session.id)
    try {
      const items = [...(await fetchFeedbackItems(pr)), ...(session.selfReview?.findings ?? [])]
      const available = new Set(items.map((item) => item.id))
      if (requests.some((request) => !available.has(request.itemId))) throw new Error(STALE_ITEMS_ERROR)
      const requested = new Set(requests.map((request) => request.itemId))
      this.patch(session.id, (s) => ({ status: 'running', error: null, remoteMoved: false, items: mergeItems(s.items, items.filter((i) => requested.has(i.id))) }), true)
      const clone = await this.prepareClone(session.id)
      void this.runTurn(session.id, authorActionsPrompt(pr, clone, items, requests, note), 'respond')
    } catch (error) {
      if (this.byId(session.id).status === 'running') this.patch(session.id, () => ({ status: 'error', error: errorMessage(error) }), true)
      throw error
    } finally {
      this.publishing.delete(session.id)
    }
    return this.byId(session.id)
  }

  async selfReview(pr: PrRef): Promise<AuthorSession> {
    const session = this.ensure(pr)
    this.assertIdle(session.id)
    void this.runTurn(session.id, reviewPrompt(pr, configFile.get().reviewSkill), 'self_review')
    return this.byId(session.id)
  }

  async feedback(sessionId: string, message: string): Promise<void> {
    this.assertIdle(sessionId)
    this.patch(sessionId, () => ({ remoteMoved: false }))
    void this.runTurn(sessionId, message, 'refine')
  }

  async diff(sessionId: string): Promise<string> {
    const { clone } = this.byId(sessionId)
    return clone ? cloneDiff(clone) : ''
  }

  async push(sessionId: string): Promise<void> {
    this.assertIdle(sessionId)
    const { clone, pr } = this.byId(sessionId)
    if (!clone) throw new Error('Claude has not made any commits yet.')
    this.publishing.add(sessionId)
    this.patch(sessionId, () => ({ status: 'submitting', error: null, remoteMoved: false }), true)
    try {
      const lastPush = await pushClone(clone, now())
      this.patch(sessionId, () => ({ status: 'awaiting_feedback', lastPush, commits: [] }), true)
    } catch (error) {
      console.error('Pushing author commits failed', { pr: pr.url, error })
      await this.refreshClone(sessionId)
      this.patch(sessionId, () => ({ status: 'error', error: errorMessage(error), remoteMoved: error instanceof RemoteMovedError }), true)
      throw error
    } finally {
      this.publishing.delete(sessionId)
    }
    this.refreshPr(pr)
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

    this.publishing.add(sessionId)
    this.patch(sessionId, () => ({ status: 'submitting', error: null }), true)
    let failures = 0
    const answered: FeedbackItem[] = []
    try {
      for (const post of replies) {
        const posted = await this.postReply(session.pr, items.get(post.itemId)!, post)
        if (posted.error) failures++
        else answered.push(items.get(post.itemId)!)
        this.patch(sessionId, (s) => ({ posted: { ...s.posted, [post.itemId]: posted } }), true)
      }
      if (reRequestReviews) this.queueReRequests(sessionId, repliedReviewers(answered))
      await this.settleReRequests(sessionId)
    } finally {
      this.publishing.delete(sessionId)
      const error = failures > 0 ? `${failures} of ${replies.length} replies failed to post.` : null
      this.patch(sessionId, () => ({ status: error ? 'error' : 'awaiting_feedback', error }), true)
    }
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

  dismissFinding(sessionId: string, itemId: string): void {
    this.assertIdle(sessionId)
    this.patch(sessionId, (s) => {
      const { [itemId]: _dropped, ...responses } = s.responses
      const selfReview = s.selfReview && { ...s.selfReview, findings: s.selfReview.findings.filter((f) => f.id !== itemId) }
      return { responses, selfReview }
    }, true)
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
            const updates: [string, ItemResponse][] = responses.filter((r) => known.has(r.itemId)).map((r) => [r.itemId, { ...r, at }])
            return { responses: { ...s.responses, ...Object.fromEntries(updates) } }
          },
          true,
        )
      },
      onSelfReview: (drafts) => {
        const selfReview = { verdict: drafts.verdict, reportMarkdown: drafts.reportMarkdown, findings: findingsFromDrafts(drafts, now()) }
        this.patch(sessionId, () => ({ selfReview }), true)
      },
    })
    return { systemPromptAppend: AUTHOR_PROTOCOL, mcpServer }
  }

  protected async finishTurn(sessionId: string, resultOk: boolean): Promise<void> {
    await this.refreshClone(sessionId)
    await super.finishTurn(sessionId, resultOk)
  }

  private ensure(pr: PrRef): AuthorSession {
    const key = prKey(pr.owner, pr.repo, pr.number)
    return (
      this.getByPr(key) ??
      this.add({
        id: randomUUID(),
        pr,
        prKey: key,
        sdkSessionId: null,
        status: 'awaiting_feedback',
        error: null,
        timeline: [],
        createdAt: now(),
        updatedAt: now(),
        clone: null,
        items: [],
        responses: {},
        posted: {},
        selfReview: null,
        commits: [],
        uncommitted: [],
        lastPush: null,
        remoteMoved: false,
        reviewersToReRequest: [],
        lastReRequest: null,
      })
    )
  }

  private assertIdle(sessionId: string): void {
    this.byId(sessionId)
    if (this.isTurnRunning(sessionId)) throw new Error('Claude is already working on this PR')
    if (this.publishing.has(sessionId)) throw new Error('Rally is busy with this PR. Try again when it finishes.')
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
        await syncClone(clone)
        return clone
      }
      const fresh = await cloneBranch(sessionDir(sessionId), await fetchCloneSource(pr))
      this.patch(sessionId, () => ({ clone: fresh }), true)
      return fresh
    } finally {
      finishStep()
    }
  }

  private async refreshClone(sessionId: string): Promise<void> {
    const clone = this.find(sessionId)?.clone
    if (!clone || !existsSync(clone.path)) return
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

  private async settleReRequests(sessionId: string): Promise<void> {
    const { pr, reviewersToReRequest } = this.byId(sessionId)
    if (reviewersToReRequest.length === 0) return
    let ready: string[] = []
    try {
      const split = reviewersReady(reviewersToReRequest, await fetchFeedbackItems(pr))
      ready = split.ready
      if (ready.length > 0) await requestReviews(pr, ready)
      this.patch(sessionId, () => ({ reviewersToReRequest: split.waiting }), true)
      if (ready.length > 0) this.patch(sessionId, () => ({ lastReRequest: { at: now(), reviewers: ready, error: null } }), true)
    } catch (error) {
      console.error('Re-requesting reviews failed', { pr: pr.url, reviewers: ready, error })
      this.patch(sessionId, () => ({ lastReRequest: { at: now(), reviewers: ready, error: errorMessage(error) } }), true)
    }
  }

  private refreshPr(pr: PrRef): void {
    authoredPrList.refreshOne(pr.owner, pr.repo, pr.number).catch((error) => {
      console.error('Authored PR refresh failed', { pr: pr.url, error })
    })
  }
}

export const authorSessions = new AuthorSessions()
