import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { PUSH_BEFORE_POSTING_ERROR, rebaseMessage } from '@shared/authorSession'
import { prKey, type AuthorSession, type PrRef } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { BusyDot } from '../components/BusyDot'
import { ChangesPanel } from '../components/ChangesPanel'
import { FeedbackCard, type ActionPick } from '../components/FeedbackCard'
import { Markdown } from '../components/Markdown'
import { PrHeader } from '../components/PrHeader'
import { ProgressTimeline } from '../components/ProgressTimeline'
import { EmptyTab, TabBar, TabCount, TabPanel } from '../components/TabBar'
import { AUTHOR_STATUS_LABELS, AUTHOR_TAB_LABELS, AUTHOR_TABS, feedbackRows, replyPosts, splitWaitingRows, type AuthorTab, type FeedbackRow } from '../lib/authorView'
import { age, clockTime, fullTime } from '../lib/format'
import { useAuthorSession, useFeedbackItems, usePrs } from '../lib/hooks'
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
  const [actionError, setActionError] = useState<string | null>(null)
  const [chosenTab, setChosenTab] = useState<AuthorTab | null>(null)

  const busy = session !== null && BUSY_STATUSES.includes(session.status)
  useEffect(() => setChosenTab(null), [busy])
  const tab = chosenTab ?? (busy ? 'activity' : 'feedback')

  const rows = feedbackRows(feedback.items, session)
  const { open: openRows, waiting: waitingRows } = splitWaitingRows(rows)
  const requests = Object.entries(picks).map(([itemId, pick]) => ({ itemId, action: pick.action, note: pick.note }))
  const posts = session ? replyPosts(session, replyEdits, resolve) : []
  const postBlocked = session && session.commits.length > 0 ? PUSH_BEFORE_POSTING_ERROR : null

  const run = async (action: () => Promise<void>): Promise<boolean> => {
    setActionError(null)
    try {
      await action()
      return true
    } catch (error) {
      setActionError(errorMessage(error))
      return false
    }
  }

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
  const sendOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (canRunPrimary) void primary()
  }
  const selfReview = () => run(async () => onSession(await window.rally.startSelfReview(prRef)))
  const postReplies = () => {
    if (!session || !window.confirm(`Post ${posts.length} repl${posts.length === 1 ? 'y' : 'ies'} to GitHub as you?`)) return
    void run(async () => {
      await window.rally.postAuthorReplies(session.id, posts)
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
    changes: session && session.commits.length > 0 && <TabCount count={session.commits.length} />,
    report: session?.selfReview && (
      <span className="max-w-48 truncate text-xs font-normal text-ink-400" title={session.selfReview.verdict}>
        {session.selfReview.verdict}
      </span>
    ),
  }
  const empty: Record<AuthorTab, boolean> = {
    feedback: rows.length === 0,
    activity: !session || session.timeline.length === 0,
    changes: !session || (session.commits.length === 0 && !session.lastPush),
    report: !session?.selfReview,
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Respond</h2>
        {session && (
          <>
            <span className={`text-sm ${session.status === 'error' ? 'text-rose-300' : 'text-ink-400'}`}>
              {busy && <BusyDot className="mr-2 h-2 w-2 bg-primary-400" />}
              {AUTHOR_STATUS_LABELS[session.status]}
            </span>
            <span className="text-sm text-ink-500" title={fullTime(session.createdAt)}>
              started {clockTime(session.createdAt)} · {age(session.createdAt)} ago
            </span>
          </>
        )}
        <div className="ml-auto flex gap-2">
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
        </div>
      </div>

      {(actionError || session?.error || feedback.error) && (
        <div className="rounded-md bg-rose-950 px-3 py-2 text-sm text-rose-200">
          {actionError ?? session?.error ?? `Loading comments failed: ${feedback.error}`}
        </div>
      )}

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
            onPush={() => run(() => window.rally.pushAuthorCommits(session.id))}
            onRebase={() => session.clone && sendMessage(rebaseMessage(session.clone.branch))}
          />
        ) : (
          <EmptyTab>No changes yet. Pick Fix on a comment to have Claude change the code.</EmptyTab>
        )}
      </TabPanel>

      <TabPanel name={TAB_PANEL} id="report" tab={tab}>
        {session?.selfReview ? (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-ink-500">Verdict · </span>
              <span className="text-ink-200">{session.selfReview.verdict}</span>
            </div>
            <Markdown>{session.selfReview.reportMarkdown}</Markdown>
          </div>
        ) : (
          <EmptyTab>No self-review yet. It runs your review skill and keeps the results private.</EmptyTab>
        )}
      </TabPanel>

      <div className="space-y-3">
        <textarea
          className="w-full rounded-md border border-ink-800 bg-ink-900 p-3 text-sm"
          rows={3}
          placeholder={
            requests.length > 0
              ? 'Optional note for Claude about these comments'
              : 'Pick an action on a comment, or message Claude, e.g. "make the reply to the naming comment shorter"'
          }
          value={message}
          disabled={busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={sendOnEnter}
        />
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-ink-500">Enter to send · Shift+Enter for a new line</span>
          <button className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`} disabled={!canRunPrimary} onClick={primary}>
            {requests.length > 0 ? `Run ${requests.length} action${requests.length === 1 ? '' : 's'}` : 'Send to Claude'}
          </button>
        </div>
        {posts.length > 0 && (
          <div className="flex items-center justify-end gap-3 rounded-xl bg-ink-900/60 px-4 py-3 ring-1 ring-white/5">
            {postBlocked && <span className="text-xs text-amber-300">{postBlocked}</span>}
            <button className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`} disabled={busy || postBlocked !== null} onClick={postReplies}>
              Post {posts.length} repl{posts.length === 1 ? 'y' : 'ies'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
