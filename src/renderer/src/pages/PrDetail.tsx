import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { keyOf, toPrRef, unitMembers } from '@shared/prUnit'
import { prKey, REVIEW_EVENT_LABELS, type MemberVerdict, type Pr, type PrRef, type ReviewSession, type SubmittedReview } from '@shared/types'
import { draftsForPr, emptyReviewError, isUnitSession, sessionMembers } from '@shared/unitDrafts'
import { DraftList } from '../components/DraftList'
import { LinkPrForm, OneSidedLinks, UnlinkButton } from '../components/LinkedPrControls'
import { PriorConcernList } from '../components/PriorConcernList'
import { ReviewBodyEditor } from '../components/ReviewBodyEditor'
import { BusyDot } from '../components/BusyDot'
import { PrHeader, UnitHeader } from '../components/PrHeader'
import { ProgressTimeline } from '../components/ProgressTimeline'
import { RepoChip } from '../components/RepoChip'
import { Composer, ErrorBox, ReportView, SessionHeader } from '../components/SessionPanel'
import { EmptyTab, TabBar, TabCount, TabPanel } from '../components/TabBar'
import { SubmitBar } from '../components/SubmitBar'
import {
  feedbackMessage,
  keptCommentCount,
  pullChangesMessage,
  submitBlockedReason,
  type DraftChanges,
  type DraftEdits,
} from '@shared/feedback'
import { fullTime } from '../lib/format'
import { useActionRunner, usePrs, useReviewTab, useSession, useThreadResolution } from '../lib/hooks'
import {
  BUSY_STATUSES,
  isSubmitted,
  lastSuccessfulTurnStartedAt,
  latestUpdatedAt,
  prUpdatedSinceLastSuccessfulTurn,
  SESSION_STATUS_LABELS,
} from '../lib/sessionStatus'
import { emptyReviewTabs, REVIEW_TAB_LABELS, REVIEW_TABS, type ReviewTab } from '../lib/reviewTabs'
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/theme'

/** Confirms discarding the unsubmitted drafts of any session that starting a review of these PRs replaces. */
async function confirmReplacing(members: PrRef[], keep: ReviewSession | null): Promise<boolean> {
  const sessions = await Promise.all(members.map((member) => window.rally.getSession(keyOf(member))))
  const replaced = sessions.filter(
    (s, index): s is ReviewSession =>
      s !== null && s.id !== keep?.id && sessions.findIndex((other) => other?.id === s.id) === index && Boolean(s.drafts) && !isSubmitted(s),
  )
  if (replaced.length === 0) return true
  return window.confirm(`Starting this review discards the unsubmitted drafts of the review of ${replaced.map((s) => s.prKey).join(', ')}. Continue?`)
}

export function PrDetail() {
  const params = useParams()
  const owner = params.owner!
  const repo = params.repo!
  const number = Number(params.number)
  const key = prKey(owner, repo, number)
  const { prs } = usePrs('reviewing')
  const pr = prs.find((p) => p.owner === owner && p.repo === repo && p.number === number)
  const unit = pr ? unitMembers(prs, pr) : []
  const [session, setSession] = useSession(key)
  const url = pr?.url ?? `https://github.com/${owner}/${repo}/pull/${number}`
  const routeRef: PrRef = pr ? toPrRef(pr) : { owner, repo, number, url }
  const { error: startError, run: runStart } = useActionRunner()

  const start = (replacing: ReviewSession | null = null) =>
    runStart(async () => {
      const linked = unit.slice(1).map(toPrRef)
      if (!(await confirmReplacing([routeRef, ...linked], replacing))) return
      if (replacing) await window.rally.discardSession(replacing.id)
      setSession(await window.rally.startReview(routeRef, linked))
    })
  const sessionPrs = session ? sessionMembers(session).flatMap((m) => prs.find((p) => keyOf(p) === keyOf(m)) ?? []) : unit

  const header =
    unit.length > 1 ? (
      <UnitHeader members={unit} memberActions={(member) => <UnlinkButton pr={member} unit={unit} />} />
    ) : (
      <PrHeader list="reviewing" pr={pr} title={key} repo={repo} number={number} url={url} />
    )

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {header}

      {pr && (
        <div className="space-y-2">
          <OneSidedLinks prs={unit} />
          <LinkPrForm pr={pr} />
        </div>
      )}

      <ErrorBox message={startError} />

      {session ? (
        <>
          <MembershipNotice
            session={session}
            unit={unit}
            onStartOver={() => window.confirm('Discard this review session and its drafts, and review the PRs linked now?') && start(session)}
          />
          <ReviewPanel
            key={session.id}
            session={session}
            memberPrs={sessionPrs}
            needsRereview={sessionPrs.some((p) => p.phase === 'awaiting_rereview')}
            prUpdatedAt={latestUpdatedAt(sessionPrs)}
            onDiscarded={() => setSession(null)}
            onStartFollowUp={() => start(session)}
          />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-secondary-500/30 bg-secondary-500/5 p-8 text-center">
          <p className="mb-3 text-sm text-ink-400">
            {unit.length > 1
              ? `Runs your review skill from Settings on all ${unit.length} PRs in one Claude session. Nothing is posted to GitHub until you submit.`
              : 'Runs your review skill from Settings in a Claude session. Nothing is posted to GitHub until you submit.'}
          </p>
          <button className={`${PRIMARY_BUTTON_CLASS} px-4 py-2 text-sm`} onClick={() => start()}>
            Start review
          </button>
        </div>
      )}
    </div>
  )
}

/** Says which PRs joined or left the unit since the review started, and offers to start over with the current unit. */
function MembershipNotice({ session, unit, onStartOver }: { session: ReviewSession; unit: Pr[]; onStartOver(): void }) {
  if (unit.length === 0 || isSubmitted(session) || BUSY_STATUSES.includes(session.status)) return null
  const reviewed = sessionMembers(session).map(keyOf)
  const current = unit.map(keyOf)
  const joined = current.filter((k) => !reviewed.includes(k))
  const left = reviewed.filter((k) => !current.includes(k))
  if (joined.length === 0 && left.length === 0) return null
  const message = !isUnitSession(session)
    ? `This review covers only ${session.prKey}. ${joined.join(', ')} ${joined.length === 1 ? 'is' : 'are'} linked with it now.`
    : [
        joined.length > 0 && `${joined.join(', ')} joined this unit after the review started.`,
        left.length > 0 && `${left.join(', ')} left it.`,
      ]
        .filter(Boolean)
        .join(' ')
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-950/60 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/20">
      <span>{message} Start over to review the PRs linked now.</span>
      <button className={`${SECONDARY_BUTTON_CLASS} ml-auto`} onClick={onStartOver}>
        Start over
      </button>
    </div>
  )
}

function MemberLabel({ member, pr }: { member: PrRef; pr: Pr | undefined }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <RepoChip repo={member.repo} number={member.number} />
      {pr && <span className="truncate text-ink-200">{pr.title}</span>}
    </span>
  )
}

function SubmittedLine({ submitted }: { submitted: SubmittedReview }) {
  return (
    <>
      Submitted as {REVIEW_EVENT_LABELS[submitted.event].toLowerCase()}.{' '}
      <a className="underline" href={submitted.url} target="_blank" rel="noreferrer">
        View on GitHub ↗
      </a>
      {submitted.foldedDraftIds && submitted.foldedDraftIds.length > 0 && (
        <span className="ml-2 text-amber-300" title="GitHub couldn't place these on a line or thread, so they were posted in the review body">
          Moved {submitted.foldedDraftIds.map((id) => `#${id}`).join(', ')} into the review body.
        </span>
      )}
    </>
  )
}

interface ReviewPanelProps {
  session: ReviewSession
  /** The listed PRs the session reviews, for titles and update times. */
  memberPrs: Pr[]
  needsRereview: boolean
  prUpdatedAt: string | null
  onDiscarded(): void
  onStartFollowUp(): void
}

function ReviewPanel({ session, memberPrs, needsRereview, prUpdatedAt, onDiscarded, onStartFollowUp }: ReviewPanelProps) {
  const [edits, setEdits] = useState<DraftEdits>({})
  const [summaryEdits, setSummaryEdits] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState('')
  const { error: actionError, run: runAction } = useActionRunner()
  const busy = BUSY_STATUSES.includes(session.status)
  const submitted = isSubmitted(session)
  const { drafts } = session
  const hasDrafts = Boolean(drafts)
  const members = sessionMembers(session)
  const unit = members.length > 1
  const prOf = (member: PrRef) => memberPrs.find((pr) => keyOf(pr) === keyOf(member))
  const postedOf = (member: PrRef) => session.memberSubmits?.[keyOf(member)]?.submitted ?? null
  const pending = members.filter((member) => !postedOf(member))
  const anyPosted = pending.length < members.length
  const changes: DraftChanges = unit
    ? { edits, summaryBodyEdit: undefined, summaryBodyEdits: summaryEdits, instructions: feedback }
    : { edits, summaryBodyEdit: summaryEdits[session.prKey], instructions: feedback }
  const message = feedbackMessage(drafts, changes)
  const keptComments = keptCommentCount(drafts, edits)
  const pendingComments = drafts ? pending.reduce((sum, member) => sum + keptCommentCount(draftsForPr(drafts, keyOf(member)), edits), 0) : 0
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
      setSummaryEdits({})
      setFeedback('')
    })

  const canSend = !busy && !anyPosted && Boolean(message)
  const sendMessage = async (text: string) => {
    reviewTab.follow()
    if (!(await run(() => window.rally.sendFeedback(session.id, text)))) reviewTab.sendFailed()
  }
  const send = () => sendMessage(message)
  const pullChanges = () => sendMessage(pullChangesMessage(drafts, changes, lastSuccessfulTurnAt, members.length))
  const submit = (verdicts: MemberVerdict[]) =>
    run(async () => {
      const empty = drafts && emptyReviewError(drafts, verdicts, changes, unit)
      if (empty) throw new Error(empty)
      await window.rally.submitReview(session.id, verdicts, changes, threadResolution.selectedIds)
    })
  const startOver = () => {
    if (window.confirm('Discard this review session and its drafts?')) void window.rally.discardSession(session.id).then(onDiscarded)
  }
  const editSummary = (prKey: string, body: string | undefined) =>
    setSummaryEdits(({ [prKey]: _removed, ...rest }) => (body === undefined ? rest : { ...rest, [prKey]: body }))
  const editDraft = (id: string, edit: DraftEdits[string] | undefined) => setEdits(({ [id]: _removed, ...rest }) => (edit ? { ...rest, [id]: edit } : rest))

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
                {unit ? 'PRs updated since last successful turn' : 'PR updated since last successful turn'}
              </span>
              <button
                className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-200 ring-1 ring-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40"
                disabled={busy || resolvingThreads || anyPosted}
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
              <button className={SECONDARY_BUTTON_CLASS} onClick={() => window.rally.cancelReview(session.id)}>
                Cancel
              </button>
            )}
            {!busy && !submitted && (
              <button className={SECONDARY_BUTTON_CLASS} disabled={resolvingThreads} onClick={startOver}>
                Start over
              </button>
            )}
          </>
        }
      />

      <ErrorBox message={actionError ?? session.error} />

      {unit && anyPosted && !submitted && (
        <div className="space-y-1 rounded-xl bg-amber-950/60 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/20">
          {members.filter(postedOf).map((member) => (
            <div key={keyOf(member)} className="flex flex-wrap items-center gap-2">
              <MemberLabel member={member} pr={prOf(member)} />
              <SubmittedLine submitted={postedOf(member)!} />
            </div>
          ))}
          <div>Submit again to post the rest, or skip them. Claude can't change the drafts until every PR is posted or skipped.</div>
        </div>
      )}

      {session.submitted && (
        <div className="space-y-2 rounded-xl bg-emerald-950/70 px-4 py-3 text-sm text-emerald-200 ring-1 ring-emerald-500/20">
          {unit ? (
            members.map((member) => (
              <div key={keyOf(member)} className="flex flex-wrap items-center gap-2">
                <MemberLabel member={member} pr={prOf(member)} />
                {postedOf(member) ? <SubmittedLine submitted={postedOf(member)!} /> : <span className="text-ink-400">Skipped.</span>}
              </div>
            ))
          ) : (
            <div>
              <SubmittedLine submitted={session.submitted} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {needsRereview && <span className="text-amber-300">{unit ? 'A PR changed since this review.' : 'The PR changed since this review.'}</span>}
            {resolvingThreads && <span className="text-ink-300">Resolving threads…</span>}
            {!resolvingThreads && resolution && resolution.resolved.length > 0 && (
              <span className="text-emerald-300">Resolved {resolution.resolved.length} thread(s).</span>
            )}
            {!resolvingThreads && resolution && resolution.failed.length > 0 && (
              <button className="text-rose-300 underline hover:text-rose-200" onClick={() => reviewTab.select('threads')}>
                Couldn't resolve {resolution.failed.length} thread(s)
              </button>
            )}
            <button className={`${PRIMARY_BUTTON_CLASS} ml-auto px-3 py-1.5 text-sm`} disabled={resolvingThreads} onClick={onStartFollowUp}>
              Start follow-up review
            </button>
          </div>
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
          drafts && (
            <div className="space-y-3">
              {drafts.prReviews && (
                <ul className="space-y-1 text-sm">
                  {members.map((member) => (
                    <li key={keyOf(member)} className="flex items-center gap-2">
                      <MemberLabel member={member} pr={prOf(member)} />
                      <span className="text-ink-500">·</span>
                      <span className="text-ink-200">{drafts.prReviews?.find((r) => r.prKey === keyOf(member))?.verdict ?? 'No verdict'}</span>
                    </li>
                  ))}
                </ul>
              )}
              <ReportView verdict={drafts.verdict} markdown={drafts.reportMarkdown} />
            </div>
          )
        )}
      </TabPanel>

      <TabPanel name="Review" id="threads" tab={reviewTab.tab}>
        {emptyTabs.threads ? (
          <EmptyTab>No earlier comments. Threads appear in follow-up reviews.</EmptyTab>
        ) : (
          <PriorConcernList state={threadResolution} resolution={resolution} disabled={busy || resolvingThreads} submitted={submitted} />
        )}
      </TabPanel>

      <TabPanel name="Review" id="drafts" tab={reviewTab.tab}>
        {unit ? (
          <div className="space-y-6">
            {!hasDrafts && <EmptyTab>Claude hasn't drafted any comments yet.</EmptyTab>}
            {drafts &&
              members.map((member) => {
                const key = keyOf(member)
                const share = draftsForPr(drafts, key)
                const locked = busy || submitted || Boolean(postedOf(member))
                return (
                  <section key={key} className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <MemberLabel member={member} pr={prOf(member)} />
                      {postedOf(member) && <span className="text-xs font-normal text-emerald-300">posted</span>}
                    </h3>
                    {share.comments.length === 0 ? (
                      <EmptyTab>No draft comments on this PR.</EmptyTab>
                    ) : (
                      <DraftList drafts={share} edits={edits} disabled={locked} onEdit={editDraft} />
                    )}
                    <ReviewBodyEditor original={share.summaryBody} edit={summaryEdits[key]} disabled={locked} onEdit={(body) => editSummary(key, body)} />
                  </section>
                )
              })}
          </div>
        ) : (
          <div className="space-y-2">
            {emptyTabs.drafts ? (
              <EmptyTab>{hasDrafts ? 'No draft comments.' : "Claude hasn't drafted any comments yet."}</EmptyTab>
            ) : (
              drafts && <DraftList drafts={drafts} edits={edits} disabled={busy || submitted} onEdit={editDraft} />
            )}
            {drafts && (
              <ReviewBodyEditor
                original={drafts.summaryBody}
                edit={summaryEdits[session.prKey]}
                disabled={busy || submitted}
                onEdit={(body) => editSummary(session.prKey, body)}
              />
            )}
          </div>
        )}
      </TabPanel>

      {!submitted && (
        <div className="space-y-3">
          <Composer
            value={feedback}
            placeholder='Feedback for Claude, e.g. "drop 2, make 1 shorter, is finding 4 real?"'
            disabled={busy || anyPosted}
            canSend={canSend}
            sendLabel="Send to Claude"
            onChange={setFeedback}
            onSend={send}
          />
          {drafts && (
            <SubmitBar
              members={members.map((member) => ({ prKey: keyOf(member), label: <MemberLabel member={member} pr={prOf(member)} />, posted: postedOf(member) }))}
              disabled={busy || resolvingThreads}
              blockedReason={submitBlockedReason(feedback)}
              commentCount={pendingComments}
              threadCount={threadResolution.selectedIds.length}
              onSubmit={submit}
            />
          )}
        </div>
      )}
    </section>
  )
}
