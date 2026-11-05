import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { prKey, REVIEW_EVENT_LABELS, type ReviewEvent, type ReviewSession } from '@shared/types'
import { DraftList } from '../components/DraftList'
import { PriorConcernList } from '../components/PriorConcernList'
import { Markdown } from '../components/Markdown'
import { Avatar } from '../components/Avatar'
import { BusyDot } from '../components/BusyDot'
import { DiffStat } from '../components/DiffStat'
import { PhaseBadge } from '../components/PhaseBadge'
import { RepoChip } from '../components/RepoChip'
import { ProgressTimeline } from '../components/ProgressTimeline'
import { ReviewTabBar, ReviewTabPanel } from '../components/ReviewTabBar'
import { SubmitBar } from '../components/SubmitBar'
import { feedbackMessage, type DraftEdits } from '../lib/feedback'
import { age, clockTime, fullTime } from '../lib/format'
import { usePrs, useReviewTab, useSession, useThreadResolution } from '../lib/hooks'
import { BUSY_STATUSES, isSubmitted, lastTurnStartedAt, prUpdatedSinceLastTurn, SESSION_STATUS_LABELS } from '../lib/sessionStatus'
import { emptyReviewTabs, type ReviewTab } from '../lib/reviewTabs'
import { PHASE_THEME, PRIMARY_BUTTON_CLASS } from '../lib/theme'

export function PrDetail() {
  const params = useParams()
  const owner = params.owner!
  const repo = params.repo!
  const number = Number(params.number)
  const key = prKey(owner, repo, number)
  const { prs } = usePrs()
  const pr = prs.find((p) => p.owner === owner && p.repo === repo && p.number === number)
  const [session, setSession] = useSession(key)
  const url = pr?.url ?? `https://github.com/${owner}/${repo}/pull/${number}`

  const start = async () => setSession(await window.rally.startReview({ owner, repo, number, url }))
  const startFollowUp = async (previous: ReviewSession) => {
    await window.rally.discardSession(previous.id)
    await start()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link to="/" className="text-xs text-ink-500 hover:text-ink-300">
          ← All PRs
        </Link>
        <div className="mt-3 flex items-start gap-4">
          {pr && <Avatar login={pr.author} url={pr.authorAvatarUrl} ringClass={PHASE_THEME[pr.phase].ring} />}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start gap-3">
              <h1 className="min-w-0 flex-1 text-xl font-semibold">{pr?.title ?? key}</h1>
              {pr && <PhaseBadge phase={pr.phase} />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-400">
              <RepoChip repo={repo} number={number} />
              {pr && (
                <>
                  <span>
                    by <span className="text-ink-200">{pr.author}</span>
                  </span>
                  <span>opened {age(pr.createdAt)} ago</span>
                  <DiffStat additions={pr.additions} deletions={pr.deletions} files={pr.changedFiles} />
                </>
              )}
              <a className="text-primary-400 hover:text-primary-300" href={url} target="_blank" rel="noreferrer">
                Open on GitHub ↗
              </a>
            </div>
          </div>
        </div>
        {pr?.summary && (
          <p className="mt-4 rounded-lg bg-secondary-500/5 px-4 py-3 text-sm text-ink-300 ring-1 ring-secondary-500/20">
            <span className="mr-2 text-secondary-400">✦</span>
            {pr.summary}
          </p>
        )}
      </div>

      {pr && (
        <details className="rounded-xl border border-white/5 bg-ink-900/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Description and files</summary>
          <div className="mt-3 space-y-4">
            <Markdown>{pr.body || '_No description._'}</Markdown>
            <ul className="space-y-0.5 font-mono text-xs text-ink-400">
              {pr.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {session ? (
        <ReviewPanel
          key={session.id}
          session={session}
          needsRereview={pr?.phase === 'awaiting_rereview'}
          prUpdatedAt={pr?.updatedAt ?? null}
          onDiscarded={() => setSession(null)}
          onStartFollowUp={() => startFollowUp(session)}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-secondary-500/30 bg-secondary-500/5 p-8 text-center">
          <p className="mb-3 text-sm text-ink-400">
            Runs your review skill from Settings in a Claude session. Nothing is posted to GitHub until you submit.
          </p>
          <button
            className={`${PRIMARY_BUTTON_CLASS} px-4 py-2 text-sm`}
            onClick={start}
          >
            Start review
          </button>
        </div>
      )}
    </div>
  )
}

interface ReviewPanelProps {
  session: ReviewSession
  needsRereview: boolean
  prUpdatedAt: string | null
  onDiscarded(): void
  onStartFollowUp(): void
}

function ReviewPanel({ session, needsRereview, prUpdatedAt, onDiscarded, onStartFollowUp }: ReviewPanelProps) {
  const [edits, setEdits] = useState<DraftEdits>({})
  const [feedback, setFeedback] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const busy = BUSY_STATUSES.includes(session.status)
  const submitted = isSubmitted(session)
  const { drafts } = session
  const hasDrafts = Boolean(drafts)
  const message = feedbackMessage(drafts, edits, feedback)
  const keptComments = drafts?.comments.filter((c) => !edits[c.id]?.dropped).length ?? 0
  const lastTurnAt = lastTurnStartedAt(session)
  const reviewTab = useReviewTab({ busy, hasDrafts, timeline: session.timeline })
  const prUpdatedAfterLastTurn = prUpdatedSinceLastTurn(session, prUpdatedAt)
  const threadResolution = useThreadResolution(session)
  const resolvingThreads = threadResolution.resolving
  const emptyTabs = emptyReviewTabs({ hasDrafts, threadCount: threadResolution.rows.length })
  const tabBadges: Record<ReviewTab, ReactNode> = {
    activity: busy && <BusyDot className="h-2 w-2 bg-primary-400" />,
    report: drafts && (
      <span className="max-w-48 truncate text-xs font-normal text-ink-400" title={drafts.verdict}>
        {drafts.verdict}
      </span>
    ),
    threads: threadResolution.selectedIds.length > 0 && <TabCount count={threadResolution.selectedIds.length} />,
    drafts: drafts && <TabCount count={keptComments} />,
  }

  const run = async (action: () => Promise<void>): Promise<boolean> => {
    setActionError(null)
    try {
      await action()
      setEdits({})
      setFeedback('')
      return true
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const canSend = !busy && Boolean(message)
  const send = async () => {
    reviewTab.follow()
    if (!(await run(() => window.rally.sendFeedback(session.id, message)))) reviewTab.sendFailed()
  }
  const sendOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (canSend) void send()
  }
  const submit = (event: ReviewEvent) => run(() => window.rally.submitReview(session.id, event, message, threadResolution.selectedIds))
  const startOver = () => {
    if (window.confirm('Discard this review session and its drafts?')) void window.rally.discardSession(session.id).then(onDiscarded)
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Review</h2>
        <span className={`text-sm ${session.status === 'error' ? 'text-rose-300' : 'text-ink-400'}`}>
          {busy && <BusyDot className="mr-2 h-2 w-2 bg-primary-400" />}
          {SESSION_STATUS_LABELS[session.status]}
        </span>
        <span className="text-sm text-ink-500" title={fullTime(session.createdAt)}>
          started {clockTime(session.createdAt)} · {age(session.createdAt)} ago
        </span>
        {prUpdatedAfterLastTurn && prUpdatedAt && (
          <span
            className="text-sm text-amber-300"
            title={`PR updated ${fullTime(prUpdatedAt)}, after Claude's last turn started at ${fullTime(lastTurnAt)}`}
          >
            PR updated since last turn
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {busy && (
            <button className="rounded-md bg-ink-800 px-3 py-1 text-sm hover:bg-ink-700" onClick={() => window.rally.cancelReview(session.id)}>
              Cancel
            </button>
          )}
          {!busy && !submitted && (
            <button
              className="rounded-md bg-ink-800 px-3 py-1 text-sm hover:bg-ink-700 disabled:opacity-40"
              disabled={resolvingThreads}
              onClick={startOver}
            >
              Start over
            </button>
          )}
        </div>
      </div>

      {(session.error || actionError) && (
        <div className="rounded-md bg-rose-950 px-3 py-2 text-sm text-rose-200">{session.error ?? actionError}</div>
      )}

      {session.submitted && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-950/70 px-4 py-3 text-sm text-emerald-200 ring-1 ring-emerald-500/20">
          <span>
            Submitted as {REVIEW_EVENT_LABELS[session.submitted.event].toLowerCase()}.{' '}
            <a className="underline" href={session.submitted.url} target="_blank" rel="noreferrer">
              View on GitHub ↗
            </a>
          </span>
          {needsRereview && <span className="text-amber-300">The PR changed since this review.</span>}
          {resolvingThreads && <span className="text-ink-300">Resolving threads…</span>}
          <button
            className={`${PRIMARY_BUTTON_CLASS} ml-auto px-3 py-1.5 text-sm`}
            disabled={resolvingThreads}
            onClick={onStartFollowUp}
          >
            Start follow-up review
          </button>
        </div>
      )}

      <ReviewTabBar tab={reviewTab.tab} badges={tabBadges} empty={emptyTabs} onSelect={reviewTab.select} />

      <ReviewTabPanel id="activity" tab={reviewTab.tab}>
        <div ref={reviewTab.activityRef}>
          <ProgressTimeline timeline={session.timeline} />
        </div>
      </ReviewTabPanel>

      <ReviewTabPanel id="report" tab={reviewTab.tab}>
        {emptyTabs.report ? (
          <EmptyTab>Claude hasn't published a report yet.</EmptyTab>
        ) : (
          drafts && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-ink-500">Verdict · </span>
                <span className="text-ink-200">{drafts.verdict}</span>
              </div>
              <Markdown>{drafts.reportMarkdown}</Markdown>
            </div>
          )
        )}
      </ReviewTabPanel>

      <ReviewTabPanel id="threads" tab={reviewTab.tab}>
        {emptyTabs.threads ? (
          <EmptyTab>No earlier comments. Threads appear in follow-up reviews.</EmptyTab>
        ) : (
          <PriorConcernList
            state={threadResolution}
            resolution={session.threadResolution ?? null}
            disabled={busy || resolvingThreads}
            submitted={submitted}
          />
        )}
      </ReviewTabPanel>

      <ReviewTabPanel id="drafts" tab={reviewTab.tab}>
        {emptyTabs.drafts ? (
          <EmptyTab>Claude hasn't drafted any comments yet.</EmptyTab>
        ) : (
          drafts && (
            <div className="space-y-2">
              {drafts.comments.length === 0 ? (
                <EmptyTab>No draft comments.</EmptyTab>
              ) : (
                <DraftList
                  drafts={drafts}
                  edits={edits}
                  disabled={busy || submitted}
                  onEdit={(id, edit) => setEdits(({ [id]: _removed, ...rest }) => (edit ? { ...rest, [id]: edit } : rest))}
                />
              )}
              {drafts.summaryBody && (
                <div className="rounded-md border border-ink-800 bg-ink-900 p-3 text-sm">
                  <div className="mb-1 text-xs text-ink-500">Review body</div>
                  {drafts.summaryBody}
                </div>
              )}
            </div>
          )
        )}
      </ReviewTabPanel>

      {!submitted && (
        <div className="space-y-3">
          <textarea
            className="w-full rounded-md border border-ink-800 bg-ink-900 p-3 text-sm"
            rows={3}
            placeholder='Feedback for Claude, e.g. "drop 2, make 1 shorter, is finding 4 real?"'
            value={feedback}
            disabled={busy}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={sendOnEnter}
          />
          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-ink-500">Enter to send · Shift+Enter for a new line</span>
            <button
              className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`}
              disabled={!canSend}
              onClick={send}
            >
              Send to Claude
            </button>
          </div>
          {drafts && <SubmitBar disabled={busy || resolvingThreads} commentCount={keptComments} threadCount={threadResolution.selectedIds.length} onSubmit={submit} />}
        </div>
      )}
    </section>
  )
}

function TabCount({ count }: { count: number }) {
  return <span className="rounded-full bg-white/10 px-1.5 text-xs font-normal text-ink-200">{count}</span>
}

function EmptyTab({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-500">{children}</p>
}
