import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { prKey, REVIEW_EVENT_LABELS, type ReviewEvent, type ReviewSession } from '@shared/types'
import { DraftList } from '../components/DraftList'
import { PriorConcernList } from '../components/PriorConcernList'
import { ReviewBodyEditor } from '../components/ReviewBodyEditor'
import { BusyDot } from '../components/BusyDot'
import { PrHeader } from '../components/PrHeader'
import { ProgressTimeline } from '../components/ProgressTimeline'
import { Composer, ErrorBox, ReportView, SessionHeader } from '../components/SessionPanel'
import { EmptyTab, TabBar, TabCount, TabPanel } from '../components/TabBar'
import { SubmitBar } from '../components/SubmitBar'
import {
  EMPTY_COMMENT_REVIEW_ERROR,
  feedbackMessage,
  isEmptyCommentReview,
  keptCommentCount,
  pullChangesMessage,
  submitBlockedReason,
  type DraftChanges,
  type DraftEdits,
} from '@shared/feedback'
import { fullTime } from '../lib/format'
import { useActionRunner, usePrs, useReviewTab, useSession, useThreadResolution } from '../lib/hooks'
import { BUSY_STATUSES, isSubmitted, lastSuccessfulTurnStartedAt, prUpdatedSinceLastSuccessfulTurn, SESSION_STATUS_LABELS } from '../lib/sessionStatus'
import { emptyReviewTabs, REVIEW_TAB_LABELS, REVIEW_TABS, type ReviewTab } from '../lib/reviewTabs'
import { PRIMARY_BUTTON_CLASS } from '../lib/theme'

export function PrDetail() {
  const params = useParams()
  const owner = params.owner!
  const repo = params.repo!
  const number = Number(params.number)
  const key = prKey(owner, repo, number)
  const { prs } = usePrs('reviewing')
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
      <PrHeader list="reviewing" pr={pr} title={key} repo={repo} number={number} url={url} />

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
  const [summaryEdit, setSummaryEdit] = useState<string | undefined>(undefined)
  const [feedback, setFeedback] = useState('')
  const { error: actionError, run: runAction } = useActionRunner()
  const busy = BUSY_STATUSES.includes(session.status)
  const submitted = isSubmitted(session)
  const { drafts } = session
  const hasDrafts = Boolean(drafts)
  const changes: DraftChanges = { edits, summaryBodyEdit: summaryEdit, instructions: feedback }
  const message = feedbackMessage(drafts, changes)
  const keptComments = keptCommentCount(drafts, edits)
  const lastSuccessfulTurnAt = lastSuccessfulTurnStartedAt(session)
  const reviewTab = useReviewTab({ busy, hasDrafts, timeline: session.timeline })
  const prUpdatedAfterLastSuccessfulTurn = prUpdatedSinceLastSuccessfulTurn(session, prUpdatedAt)
  const threadResolution = useThreadResolution(session)
  const resolvingThreads = threadResolution.resolving
  const resolution = session.threadResolution ?? null
  const emptyTabs = emptyReviewTabs({ hasDrafts, commentCount: drafts?.comments.length ?? 0, threadCount: threadResolution.rows.length })
  const tabBadges: Record<ReviewTab, ReactNode> = {
    activity: busy && <BusyDot className="h-2 w-2 bg-primary-400" />,
    report: drafts && (
      <span className="max-w-48 truncate text-xs font-normal text-ink-400" title={drafts.verdict}>
        {drafts.verdict}
      </span>
    ),
    threads: threadResolution.selectedIds.length > 0 && <TabCount count={threadResolution.selectedIds.length} />,
    drafts: !emptyTabs.drafts && <TabCount count={keptComments} />,
  }

  const run = (action: () => Promise<void>) =>
    runAction(async () => {
      await action()
      setEdits({})
      setSummaryEdit(undefined)
      setFeedback('')
    })

  const canSend = !busy && Boolean(message)
  const sendMessage = async (text: string) => {
    reviewTab.follow()
    if (!(await run(() => window.rally.sendFeedback(session.id, text)))) reviewTab.sendFailed()
  }
  const send = () => sendMessage(message)
  const pullChanges = () => sendMessage(pullChangesMessage(drafts, changes, lastSuccessfulTurnAt))
  const submit = (event: ReviewEvent) =>
    run(async () => {
      if (drafts && isEmptyCommentReview(event, drafts, changes)) throw new Error(EMPTY_COMMENT_REVIEW_ERROR)
      await window.rally.submitReview(session.id, event, changes, threadResolution.selectedIds)
    })
  const startOver = () => {
    if (window.confirm('Discard this review session and its drafts?')) void window.rally.discardSession(session.id).then(onDiscarded)
  }

  return (
    <section className="space-y-4">
      <SessionHeader
        title="Review"
        session={session}
        statusLabels={SESSION_STATUS_LABELS}
        notes={
          prUpdatedAfterLastSuccessfulTurn &&
          prUpdatedAt && (
            <span className="flex items-center gap-2 text-sm text-amber-300">
              <span title={`PR updated ${fullTime(prUpdatedAt)}, after Claude's last successful turn started at ${fullTime(lastSuccessfulTurnAt)}`}>
                PR updated since last successful turn
              </span>
              <button
                className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-200 ring-1 ring-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40"
                disabled={busy || resolvingThreads}
                title="Send Claude a turn to pull in the commits, comments, and reviews since its last successful turn and update the review, along with any pending edits and feedback"
                onClick={pullChanges}
              >
                Pull in changes
              </button>
            </span>
          )
        }
        actions={
          <>
            {session.status === 'running' && (
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
          </>
        }
      />

      <ErrorBox message={actionError ?? session.error} />

      {session.submitted && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-emerald-950/70 px-4 py-3 text-sm text-emerald-200 ring-1 ring-emerald-500/20">
          <span>
            Submitted as {REVIEW_EVENT_LABELS[session.submitted.event].toLowerCase()}.{' '}
            <a className="underline" href={session.submitted.url} target="_blank" rel="noreferrer">
              View on GitHub ↗
            </a>
          </span>
          {needsRereview && <span className="text-amber-300">The PR changed since this review.</span>}
          {session.submitted.foldedDraftIds && session.submitted.foldedDraftIds.length > 0 && (
            <span className="text-amber-300" title="GitHub couldn't place these on a line or thread, so they were posted in the review body">
              Moved {session.submitted.foldedDraftIds.map((id) => `#${id}`).join(', ')} into the review body.
            </span>
          )}
          {resolvingThreads && <span className="text-ink-300">Resolving threads…</span>}
          {!resolvingThreads && resolution && resolution.resolved.length > 0 && (
            <span className="text-emerald-300">Resolved {resolution.resolved.length} thread(s).</span>
          )}
          {!resolvingThreads && resolution && resolution.failed.length > 0 && (
            <button className="text-rose-300 underline hover:text-rose-200" onClick={() => reviewTab.select('threads')}>
              Couldn't resolve {resolution.failed.length} thread(s)
            </button>
          )}
          <button
            className={`${PRIMARY_BUTTON_CLASS} ml-auto px-3 py-1.5 text-sm`}
            disabled={resolvingThreads}
            onClick={onStartFollowUp}
          >
            Start follow-up review
          </button>
        </div>
      )}

      <TabBar name="Review" tabs={REVIEW_TABS} labels={REVIEW_TAB_LABELS} tab={reviewTab.tab} badges={tabBadges} empty={emptyTabs} onSelect={reviewTab.select} />

      <TabPanel name="Review" id="activity" tab={reviewTab.tab}>
        <div ref={reviewTab.activityRef}>
          <ProgressTimeline timeline={session.timeline} />
        </div>
      </TabPanel>

      <TabPanel name="Review" id="report" tab={reviewTab.tab}>
        {emptyTabs.report ? (
          <EmptyTab>Claude hasn't published a report yet.</EmptyTab>
        ) : (
          drafts && <ReportView verdict={drafts.verdict} markdown={drafts.reportMarkdown} />
        )}
      </TabPanel>

      <TabPanel name="Review" id="threads" tab={reviewTab.tab}>
        {emptyTabs.threads ? (
          <EmptyTab>No earlier comments. Threads appear in follow-up reviews.</EmptyTab>
        ) : (
          <PriorConcernList
            state={threadResolution}
            resolution={resolution}
            disabled={busy || resolvingThreads}
            submitted={submitted}
          />
        )}
      </TabPanel>

      <TabPanel name="Review" id="drafts" tab={reviewTab.tab}>
        <div className="space-y-2">
          {emptyTabs.drafts ? (
            <EmptyTab>{hasDrafts ? 'No draft comments.' : "Claude hasn't drafted any comments yet."}</EmptyTab>
          ) : (
            drafts && (
              <DraftList
                drafts={drafts}
                edits={edits}
                disabled={busy || submitted}
                onEdit={(id, edit) => setEdits(({ [id]: _removed, ...rest }) => (edit ? { ...rest, [id]: edit } : rest))}
              />
            )
          )}
          {drafts && (
            <ReviewBodyEditor original={drafts.summaryBody} edit={summaryEdit} disabled={busy || submitted} onEdit={setSummaryEdit} />
          )}
        </div>
      </TabPanel>

      {!submitted && (
        <div className="space-y-3">
          <Composer
            value={feedback}
            placeholder='Feedback for Claude, e.g. "drop 2, make 1 shorter, is finding 4 real?"'
            disabled={busy}
            canSend={canSend}
            sendLabel="Send to Claude"
            onChange={setFeedback}
            onSend={send}
          />
          {drafts && (
            <SubmitBar
              disabled={busy || resolvingThreads}
              blockedReason={submitBlockedReason(feedback)}
              commentCount={keptComments}
              threadCount={threadResolution.selectedIds.length}
              onSubmit={submit}
            />
          )}
        </div>
      )}
    </section>
  )
}
