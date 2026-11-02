import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PHASE_LABELS, PHASE_ORDER, type Phase, type Pr, type SessionStatus } from '@shared/types'
import { Avatar } from '../components/Avatar'
import { DiffStat } from '../components/DiffStat'
import { PhaseBadge } from '../components/PhaseBadge'
import { RepoChip } from '../components/RepoChip'
import { age } from '../lib/format'
import { usePrs } from '../lib/hooks'
import { BUSY_STATUSES, SESSION_STATUS_LABELS } from '../lib/sessionStatus'
import { PHASE_THEME } from '../lib/theme'

function sortPrs(prs: Pr[]): Pr[] {
  return [...prs].sort(
    (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || a.createdAt.localeCompare(b.createdAt),
  )
}

function ReviewStatusNote({ status }: { status: SessionStatus }) {
  const busy = BUSY_STATUSES.includes(status)
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${status === 'error' ? 'text-rose-300' : 'text-fuchsia-300/80'}`}>
      {busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fuchsia-400" />}
      {SESSION_STATUS_LABELS[status]}
    </span>
  )
}

function PrCard({ pr, onOpen }: { pr: Pr; onOpen(): void }) {
  const theme = PHASE_THEME[pr.phase]
  return (
    <li>
      <button
        onClick={onOpen}
        className="group relative flex w-full gap-4 overflow-hidden rounded-xl border border-white/5 bg-zinc-900/60 p-4 pl-5 text-left transition hover:border-white/10 hover:bg-zinc-900"
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${theme.accent}`} />
        <Avatar login={pr.author} url={pr.authorAvatarUrl} ringClass={theme.ring} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-3">
            <h3 className="min-w-0 flex-1 truncate font-medium text-zinc-100 group-hover:text-white">
              {pr.isDraft && (
                <span className="mr-2 rounded bg-zinc-700/60 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
                  Draft
                </span>
              )}
              {pr.title}
            </h3>
            <div className="flex flex-col items-end gap-1">
              <PhaseBadge phase={pr.phase} />
              {pr.phase === 'in_progress' && pr.reviewStatus && <ReviewStatusNote status={pr.reviewStatus} />}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
            <RepoChip repo={pr.repo} number={pr.number} />
            <span>
              by <span className="text-zinc-200">{pr.author}</span>
            </span>
            <span title={pr.createdAt}>opened {age(pr.createdAt)} ago</span>
            <span title={pr.updatedAt}>updated {age(pr.updatedAt)} ago</span>
            <DiffStat additions={pr.additions} deletions={pr.deletions} files={pr.changedFiles} />
          </div>
          <p className="line-clamp-2 text-sm text-zinc-400">
            <span className="mr-1.5 text-violet-400">✦</span>
            {pr.summary ?? <span className="italic text-zinc-600">Summarizing…</span>}
          </p>
        </div>
      </button>
    </li>
  )
}

export function Dashboard() {
  const { prs, refreshing, refreshedAt, error } = usePrs()
  const [hidden, setHidden] = useState<Set<Phase>>(new Set())
  const navigate = useNavigate()

  const counts = useMemo(() => {
    const result = Object.fromEntries(PHASE_ORDER.map((p) => [p, 0])) as Record<Phase, number>
    for (const pr of prs) result[pr.phase]++
    return result
  }, [prs])
  const visible = useMemo(() => sortPrs(prs.filter((pr) => !hidden.has(pr.phase))), [prs, hidden])

  const toggle = (phase: Phase) => {
    const next = new Set(hidden)
    if (next.has(phase)) next.delete(phase)
    else next.add(phase)
    setHidden(next)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-2 text-lg font-semibold">
          Open PRs <span className="text-zinc-500">{prs.length}</span>
        </h1>
        {PHASE_ORDER.map((phase) => {
          const theme = PHASE_THEME[phase]
          const active = !hidden.has(phase)
          return (
            <button
              key={phase}
              onClick={() => toggle(phase)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 transition ${active ? theme.chipActive : 'text-zinc-500 ring-zinc-800 hover:text-zinc-300'}`}
            >
              <span className={`h-2 w-2 rounded-full ${active ? theme.dot : 'bg-zinc-700'}`} />
              {PHASE_LABELS[phase]}
              <span className="font-semibold">{counts[phase]}</span>
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
          {refreshedAt && <span>Updated {age(refreshedAt)} ago</span>}
          <button
            className="rounded-md bg-gradient-to-r from-sky-500 to-violet-500 px-3 py-1.5 font-medium text-white shadow-lg shadow-violet-500/20 hover:from-sky-400 hover:to-violet-400 disabled:opacity-50"
            disabled={refreshing}
            onClick={() => window.rally.refreshPrs()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-rose-950/80 px-4 py-2 text-sm text-rose-200 ring-1 ring-rose-500/30">GitHub refresh failed: {error}</div>}

      {prs.length === 0 && !refreshing ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-400">
          No open PRs match. Add authors and repos in{' '}
          <Link className="text-sky-400 underline" to="/settings">
            Settings
          </Link>
          .
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((pr) => (
            <PrCard key={pr.id} pr={pr} onOpen={() => navigate(`/pr/${pr.owner}/${pr.repo}/${pr.number}`)} />
          ))}
        </ul>
      )}
    </div>
  )
}
