import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { canPush, cloneChangeCount, committableFiles, PUSH_BEFORE_POSTING_ERROR } from '@shared/authorSession'
import { prKey, type AuthorSession, type PrRef } from '@shared/types'
import { BusyDot } from '../components/BusyDot'
import { ChangesPanel } from '../components/ChangesPanel'
import { FeedbackCard, type ActionPick } from '../components/FeedbackCard'
import { PrHeader } from '../components/PrHeader'
import { Composer, ErrorBox, ReportView, SessionHeader } from '../components/SessionPanel'
import { ProgressTimeline } from '../components/ProgressTimeline'
import { EmptyTab, TabBar, TabCount, TabPanel } from '../components/TabBar'
import { AUTHOR_STATUS_LABELS, AUTHOR_TAB_LABELS, AUTHOR_TABS, feedbackRows, NO_CHANGES_MESSAGE, replyPosts, splitWaitingRows, type AuthorTab, type FeedbackRow } from '../lib/authorView'
import { age, fullTime, plural } from '../lib/format'
import { useActionRunner, useAuthorSession, useFeedbackItems, usePrs } from '../lib/hooks'
import { BUSY_STATUSES } from '../lib/sessionStatus'
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/theme'

const TAB_PANEL = 'Respond'

export function AuthorPrDetail() {
  const params = useParams()
  const owner = params.owner!
  const repo = params.repo!
  const number = Number(params.number)
  const key = prKey(owner, repo, number)
  const { prs } = usePrs('authored')
  const pr = prs.find((p) => p.owner === owner && p.repo === repo && p.number === number)
  const url = pr?.url ?? `https://github.com/${owner}/${repo}/pull/${number}`
  const ref = useMemo<PrRef>(() => ({ owner, repo, number, url }), [owner, repo, number, url])
  const [session, setSession] = useAuthorSession(key)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <PrHeader list="authored" pr={pr} title={key} repo={repo} number={number} url={url} />
      <RespondPanel key={key} prRef={ref} session={session} onSession={setSession} />
    </div>
  )
}

interface RespondPanelProps {
  prRef: PrRef
  session: AuthorSession | null
  onSession(session: AuthorSession | null): void
}

function RespondPanel({ prRef, session, onSession }: RespondPanelProps) {
  const feedback = useFeedbackItems(prRef)
  const [picks, setPicks] = useState<Record<string, ActionPick>>({})
  const [replyEdits, setReplyEdits] = useState<Record<string, string>>({})
  const [resolve, setResolve] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState('')
  const [reRequestReviews, setReRequestReviews] = useState(true)
  const { error: actionError, run } = useActionRunner()
  const [chosenTab, setChosenTab] = useState<AuthorTab | null>(null)

  const busy = session !== null && BUSY_STATUSES.includes(session.status)
  useEffect(() => setChosenTab(null), [busy])
  const tab = chosenTab ?? (busy ? 'activity' : 'feedback')

  const rows = feedbackRows(feedback.items, session)
  const { open: openRows, waiting: waitingRows } = splitWaitingRows(rows)
  const requests = Object.entries(picks).map(([itemId, pick]) => ({ itemId, action: pick.action, note: pick.note }))
  const posts = session ? replyPosts(session, replyEdits, resolve) : []
  const unpushed = session?.commits.length ?? 0
  const postBlocked = unpushed > 0 ? PUSH_BEFORE_POSTING_ERROR : null
  const changeCount = session ? cloneChangeCount(session) : 0
  const leftBehind = session ? committableFiles(session).length : 0
  const repliesLabel = plural(posts.length, 'reply', 'replies')

  const runActions = () =>
    run(async () => {
      onSession(await window.rally.runAuthorActions(prRef, requests, message))
      setPicks({})
      setMessage('')
    })
  const sendMessage = (text: string) =>
    session &&
    run(async () => {
      await window.rally.sendAuthorFeedback(session.id, text)
      setMessage('')
    })
  const primary = () => (requests.length > 0 ? runActions() : sendMessage(message))
  const canRunPrimary = !busy && (requests.length > 0 || (session !== null && Boolean(message.trim())))
  const selfReview = () => run(async () => onSession(await window.rally.startSelfReview(prRef)))
  const push = () => session && run(() => window.rally.pushAuthorCommits(session.id))
  const postReplies = () => {
    if (!session || !window.confirm(`Post ${repliesLabel} to GitHub as you?`)) return
    void run(async () => {
      await window.rally.postAuthorReplies(session.id, posts, reRequestReviews)
      setReplyEdits({})
      setResolve({})
      feedback.reload()
    })
  }
  const acknowledge = (itemId: string) =>
    run(async () => {
      await window.rally.acknowledgeFeedback(prRef, itemId)
      feedback.reload()
    })
  const startOver = () => {
    if (!session || !window.confirm('Discard this session, its clone, unpushed commits, and unposted replies?')) return
    void run(async () => {
      await window.rally.discardAuthorSession(session.id)
      onSession(null)
    })
  }

  const card = (row: FeedbackRow) => {
    const id = row.item.id
    return (
      <FeedbackCard
        key={id}
        row={row}
        pick={picks[id]}
        replyEdit={replyEdits[id]}
        resolve={resolve[id] ?? false}
        disabled={busy}
        onPick={(pick) => setPicks(({ [id]: _removed, ...rest }) => (pick ? { ...rest, [id]: pick } : rest))}
        onReplyEdit={(body) => setReplyEdits(({ [id]: _removed, ...rest }) => (body === undefined ? rest : { ...rest, [id]: body }))}
        onResolve={(value) => setResolve((current) => ({ ...current, [id]: value }))}
        onDropReply={() => session && run(() => window.rally.discardAuthorReply(session.id, id))}
        onDismiss={() => session && run(() => window.rally.dismissFinding(session.id, id))}
        onAcknowledge={() => acknowledge(id)}
      />
    )
  }

  const badges: Record<AuthorTab, ReactNode> = {
    feedback: openRows.length > 0 && <TabCount count={openRows.length} />,
    activity: busy && <BusyDot className="h-2 w-2 bg-primary-400" />,
    changes: changeCount > 0 && <TabCount count={changeCount} />,
    report: session?.selfReview && (
      <span className="max-w-48 truncate text-xs font-normal text-ink-400" title={session.selfReview.verdict}>
        {session.selfReview.verdict}
      </span>
    ),
  }
  const empty: Record<AuthorTab, boolean> = {
    feedback: rows.length === 0,
    activity: !session || session.timeline.length === 0,
    changes: !session || (changeCount === 0 && !session.lastPush),
    report: !session?.selfReview,
  }

  return (
    <section className="space-y-4">
      <SessionHeader
        title="Respond"
        session={session}
        statusLabels={AUTHOR_STATUS_LABELS}
        actions={
          <>
            <button className={SECONDARY_BUTTON_CLASS} disabled={feedback.loading} onClick={feedback.reload}>
              {feedback.loading ? 'Loading…' : 'Refresh comments'}
            </button>
            <button
              className={SECONDARY_BUTTON_CLASS}
              disabled={busy}
              title="Run your review skill on this PR. Findings stay in Rally and show up as comments you can fix."
              onClick={selfReview}
            >
              Self-review
            </button>
            {session?.status === 'running' && (
              <button className={SECONDARY_BUTTON_CLASS} onClick={() => window.rally.cancelAuthorTurn(session.id)}>
                Cancel
              </button>
            )}
            {session && !busy && (
              <button className={SECONDARY_BUTTON_CLASS} onClick={startOver}>
                Start over
              </button>
            )}
          </>
        }
      />

      <ErrorBox message={actionError ?? session?.error ?? (feedback.error && `Loading comments failed: ${feedback.error}`)} />

      <TabBar name={TAB_PANEL} tabs={AUTHOR_TABS} labels={AUTHOR_TAB_LABELS} tab={tab} badges={badges} empty={empty} onSelect={setChosenTab} />

      <TabPanel name={TAB_PANEL} id="feedback" tab={tab}>
        {rows.length === 0 ? (
          <EmptyTab>{feedback.loading ? 'Loading comments…' : 'No open comments. Run a self-review to look for problems before reviewers do.'}</EmptyTab>
        ) : (
          <div className="space-y-3">
            {openRows.length > 0 ? (
              <ul className="space-y-3">{openRows.map(card)}</ul>
            ) : (
              <EmptyTab>Every open comment has your response. They wait on the reviewers below.</EmptyTab>
            )}
            {waitingRows.length > 0 && (
              <details className="space-y-3">
                <summary className="cursor-pointer text-xs text-ink-500 hover:text-ink-300">
                  {waitingRows.length} waiting on reviewers to resolve
                </summary>
                <ul className="mt-3 space-y-3">{waitingRows.map(card)}</ul>
              </details>
            )}
          </div>
        )}
      </TabPanel>

      <TabPanel name={TAB_PANEL} id="activity" tab={tab}>
        {session ? <ProgressTimeline timeline={session.timeline} /> : <EmptyTab>Nothing has run yet.</EmptyTab>}
      </TabPanel>

      <TabPanel name={TAB_PANEL} id="changes" tab={tab}>
        {session ? (
          <ChangesPanel
            session={session}
            disabled={busy}
            onPush={push}
            onResolveConflicts={() => run(() => window.rally.resolveMergeConflicts(session.id))}
            onAbortMerge={() => window.confirm('Abort the merge and drop Claude\'s conflict edits?') && run(() => window.rally.abortMerge(session.id))}
            onDiscardUncommitted={() =>
              window.confirm(`Discard ${plural(session.uncommitted.length, 'uncommitted file')} in the clone?`) && run(() => window.rally.discardUncommitted(session.id))
            }
            onCommitUncommitted={(message) => run(() => window.rally.commitUncommitted(session.id, message))}
          />
        ) : (
          <EmptyTab>{NO_CHANGES_MESSAGE}</EmptyTab>
        )}
      </TabPanel>

      <TabPanel name={TAB_PANEL} id="report" tab={tab}>
        {session?.selfReview ? (
          <ReportView verdict={session.selfReview.verdict} markdown={session.selfReview.reportMarkdown} />
        ) : (
          <EmptyTab>No self-review yet. It runs your review skill and keeps the results private.</EmptyTab>
        )}
      </TabPanel>

      <div className="space-y-3">
        <Composer
          value={message}
          placeholder={
            requests.length > 0
              ? 'Optional note for Claude about these comments'
              : 'Pick an action on a comment, or message Claude, e.g. "make the reply to the naming comment shorter"'
          }
          disabled={busy}
          canSend={canRunPrimary}
          sendLabel={requests.length > 0 ? `Run ${plural(requests.length, 'action')}` : 'Send to Claude'}
          onChange={setMessage}
          onSend={() => void primary()}
        />
        {posts.length > 0 && (
          <div className="flex items-center justify-end gap-3 rounded-xl bg-ink-900/60 px-4 py-3 ring-1 ring-white/5">
            <label
              className="mr-auto flex items-center gap-1.5 text-xs text-ink-400"
              title="Once a person's comments all have a reply or reaction from you, Rally re-requests their review, unless they already approved. A 👍 alone never triggers it."
            >
              <input type="checkbox" checked={reRequestReviews} disabled={busy} onChange={(e) => setReRequestReviews(e.target.checked)} />
              Re-request review from people I reply to
            </label>
            {postBlocked && (
              <>
                <span className="text-xs text-amber-300">{postBlocked}</span>
                <button className={SECONDARY_BUTTON_CLASS} onClick={() => setChosenTab('changes')}>
                  Review changes
                </button>
                {session && canPush(session) && (
                  <>
                    {leftBehind > 0 && <span className="text-xs text-amber-300">Push leaves out {plural(leftBehind, 'uncommitted file')}.</span>}
                    <button className={SECONDARY_BUTTON_CLASS} disabled={busy} onClick={push}>
                      Push {plural(unpushed, 'commit')}
                    </button>
                  </>
                )}
              </>
            )}
            <button className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`} disabled={busy || postBlocked !== null} onClick={postReplies}>
              Post {repliesLabel}
            </button>
          </div>
        )}
        {session && <ReRequestStatus session={session} />}
      </div>
    </section>
  )
}

function ReRequestStatus({ session }: { session: AuthorSession }) {
  const { lastReRequest, reviewersToReRequest } = session
  if (!lastReRequest && reviewersToReRequest.length === 0) return null
  const logins = (list: string[]) => list.map((login) => `@${login}`).join(', ')
  return (
    <div className="flex flex-wrap justify-end gap-x-3 text-xs">
      {lastReRequest && lastReRequest.reviewers.length > 0 && (
        <span className="text-emerald-300" title={fullTime(lastReRequest.at)}>
          Re-requested review from {logins(lastReRequest.reviewers)} {age(lastReRequest.at)} ago
        </span>
      )}
      {lastReRequest?.error && <span className="text-rose-300">Re-requesting review failed: {lastReRequest.error}</span>}
      {reviewersToReRequest.length > 0 && (
        <span className="text-ink-400">Will re-request {logins(reviewersToReRequest)} once their remaining comments are answered.</span>
      )}
    </div>
  )
}
