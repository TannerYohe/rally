import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { prKey, type ReviewEvent, type ReviewSession, type SessionStatus } from '@shared/types'
import { DraftList } from '../components/DraftList'
import { Markdown } from '../components/Markdown'
import { Avatar } from '../components/Avatar'
import { DiffStat } from '../components/DiffStat'
import { PhaseBadge } from '../components/PhaseBadge'
import { RepoChip } from '../components/RepoChip'
import { ProgressTimeline } from '../components/ProgressTimeline'
import { SubmitBar } from '../components/SubmitBar'
import { feedbackMessage, type DraftEdits } from '../lib/feedback'
import { age } from '../lib/format'
import { usePrs, useSession } from '../lib/hooks'
import { PHASE_THEME } from '../lib/theme'

const STATUS_LABELS: Record<SessionStatus, string> = {
  running: 'Claude is working…',
  submitting: 'Posting and submitting the review…',
  awaiting_feedback: 'Waiting for your feedback',
  submitted: 'Review submitted',
  error: 'Error',
  cancelled: 'Cancelled',
}

const BUSY: SessionStatus[] = ['running', 'submitting']

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

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← All PRs
        </Link>
        <div className="mt-3 flex items-start gap-4">
          {pr && <Avatar login={pr.author} url={pr.authorAvatarUrl} ringClass={PHASE_THEME[pr.phase].ring} />}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start gap-3">
              <h1 className="min-w-0 flex-1 text-xl font-semibold">{pr?.title ?? key}</h1>
              {pr && <PhaseBadge phase={pr.phase} />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
              <RepoChip repo={repo} number={number} />
              {pr && (
                <>
                  <span>
                    by <span className="text-zinc-200">{pr.author}</span>
                  </span>
                  <span>opened {age(pr.createdAt)} ago</span>
                  <DiffStat additions={pr.additions} deletions={pr.deletions} files={pr.changedFiles} />
                </>
              )}
              <a className="text-sky-400 hover:text-sky-300" href={url} target="_blank" rel="noreferrer">
                Open on GitHub ↗
              </a>
            </div>
          </div>
        </div>
        {pr?.summary && (
          <p className="mt-4 rounded-lg bg-violet-500/5 px-4 py-3 text-sm text-zinc-300 ring-1 ring-violet-500/20">
            <span className="mr-2 text-violet-400">✦</span>
            {pr.summary}
          </p>
        )}
      </div>

      {pr && (
        <details className="rounded-xl border border-white/5 bg-zinc-900/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Description and files</summary>
          <div className="mt-3 space-y-4">
            <Markdown>{pr.body || '_No description._'}</Markdown>
            <ul className="space-y-0.5 font-mono text-xs text-zinc-400">
              {pr.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {session ? (
        <ReviewPanel key={session.id} session={session} onDiscarded={() => setSession(null)} />
      ) : (
        <div className="rounded-xl border border-dashed border-violet-500/30 bg-violet-500/5 p-8 text-center">
          <p className="mb-3 text-sm text-zinc-400">
            Runs the <code>review-pr</code> skill in a Claude session. Nothing is posted to GitHub until you submit.
          </p>
          <button
            className="rounded-md bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/20 hover:from-sky-400 hover:to-violet-400"
            onClick={start}
          >
            Start review
          </button>
        </div>
      )}
    </div>
  )
}

function ReviewPanel({ session, onDiscarded }: { session: ReviewSession; onDiscarded(): void }) {
  const [edits, setEdits] = useState<DraftEdits>({})
  const [feedback, setFeedback] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const busy = BUSY.includes(session.status)
  const { drafts } = session
  const message = feedbackMessage(drafts, edits, feedback)
  const keptComments = drafts?.comments.filter((c) => !edits[c.id]?.dropped).length ?? 0

  const run = async (action: () => Promise<void>) => {
    setActionError(null)
    try {
      await action()
      setEdits({})
      setFeedback('')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const send = () => run(() => window.rally.sendFeedback(session.id, message))
  const submit = (event: ReviewEvent) => run(() => window.rally.submitReview(session.id, event, message))
  const startOver = () => {
    if (window.confirm('Discard this review session and its drafts?')) void window.rally.discardSession(session.id).then(onDiscarded)
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Review</h2>
        <span className={`text-sm ${session.status === 'error' ? 'text-rose-300' : 'text-zinc-400'}`}>
          {busy && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />}
          {STATUS_LABELS[session.status]}
        </span>
        <div className="ml-auto flex gap-2">
          {busy ? (
            <button className="rounded-md bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700" onClick={() => window.rally.cancelReview(session.id)}>
              Cancel
            </button>
          ) : (
            <button className="rounded-md bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700" onClick={startOver}>
              Start over
            </button>
          )}
        </div>
      </div>

      {(session.error || actionError) && (
        <div className="rounded-md bg-rose-950 px-3 py-2 text-sm text-rose-200">{session.error ?? actionError}</div>
      )}

      {session.submitted && (
        <div className="rounded-md bg-emerald-950 px-3 py-2 text-sm text-emerald-200">
          Submitted as {session.submitted.event.replace('_', ' ').toLowerCase()}.{' '}
          <a className="underline" href={session.submitted.url} target="_blank" rel="noreferrer">
            View on GitHub ↗
          </a>
        </div>
      )}

      <details className="rounded-xl border border-white/5 bg-zinc-900/40 p-4" open={busy || !drafts}>
        <summary className="cursor-pointer text-sm font-semibold">Activity</summary>
        <div className="mt-3">
          <ProgressTimeline timeline={session.timeline} />
        </div>
      </details>

      {drafts && (
        <>
          <details className="rounded-xl border border-white/5 bg-zinc-900/40 p-4" open>
            <summary className="cursor-pointer text-sm font-semibold">
              Report · <span className="font-normal text-zinc-400">{drafts.verdict}</span>
            </summary>
            <div className="mt-3">
              <Markdown>{drafts.reportMarkdown}</Markdown>
            </div>
          </details>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Draft comments</h3>
            <DraftList
              drafts={drafts}
              edits={edits}
              disabled={busy || session.status === 'submitted'}
              onEdit={(id, edit) => setEdits(({ [id]: _removed, ...rest }) => (edit ? { ...rest, [id]: edit } : rest))}
            />
            {drafts.summaryBody && (
              <div className="rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm">
                <div className="mb-1 text-xs text-zinc-500">Review body</div>
                {drafts.summaryBody}
              </div>
            )}
          </div>
        </>
      )}

      {session.status !== 'submitted' && (
        <div className="space-y-3">
          <textarea
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm"
            rows={3}
            placeholder='Feedback for Claude, e.g. "drop 2, make 1 shorter, is finding 4 real?"'
            value={feedback}
            disabled={busy}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="flex justify-end">
            <button
              className="rounded-md bg-gradient-to-r from-sky-500 to-violet-500 px-3 py-1.5 text-sm font-medium text-white hover:from-sky-400 hover:to-violet-400 disabled:opacity-40"
              disabled={busy || !message}
              onClick={send}
            >
              Send to Claude
            </button>
          </div>
          {drafts && <SubmitBar disabled={busy} commentCount={keptComments} onSubmit={submit} />}
        </div>
      )}
    </section>
  )
}
