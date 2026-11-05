import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PHASE_LABELS, PHASE_ORDER, type Phase, type Pr, type SessionStatus } from '@shared/types'
import { Avatar } from '../components/Avatar'
import { BusyDot } from '../components/BusyDot'
import { DiffStat } from '../components/DiffStat'
import { FailedInstallBanner } from '../components/FailedInstallBanner'
import { FilterPanel } from '../components/FilterPanel'
import { HideControls } from '../components/HideControls'
import { PhaseBadge } from '../components/PhaseBadge'
import { RepoChip } from '../components/RepoChip'
import { SortControl } from '../components/SortControl'
import { age } from '../lib/format'
import { usePersistentState, usePrs } from '../lib/hooks'
import { activeFilterCount, dashboardView, DEFAULT_FILTERS, DEFAULT_SORT, type PrFilters, type PrSort } from '../lib/prFilters'
import { BUSY_STATUSES, SESSION_STATUS_LABELS } from '../lib/sessionStatus'
import { settingsPath } from '../lib/settingsSections'
import { PHASE_THEME, PRIMARY_BUTTON_CLASS } from '../lib/theme'

function ReviewStatusNote({ status }: { status: SessionStatus }) {
  const busy = BUSY_STATUSES.includes(status)
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${status === 'error' ? 'text-rose-300' : 'text-highlight-300/80'}`}>
      {busy && <BusyDot className="h-1.5 w-1.5 bg-highlight-400" />}
      {SESSION_STATUS_LABELS[status]}
    </span>
  )
}

function PrCard({ pr, onOpen }: { pr: Pr; onOpen(): void }) {
  const theme = PHASE_THEME[pr.phase]
  return (
    <li className={`group relative ${pr.hidden ? 'opacity-60 hover:opacity-100' : ''}`}>
      <button
        onClick={onOpen}
        className={`relative flex w-full gap-4 overflow-hidden rounded-xl border border-white/5 bg-ink-900/60 p-4 pl-5 text-left transition hover:border-white/10 hover:bg-ink-900 ${pr.hidden ? 'pb-11' : ''}`}
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${theme.accent}`} />
        <Avatar login={pr.author} url={pr.authorAvatarUrl} ringClass={theme.ring} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-3">
            <h3 className="min-w-0 flex-1 truncate font-medium text-ink-100 group-hover:text-white">
              {pr.isDraft && (
                <span className="mr-2 rounded bg-ink-700/60 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-ink-300">
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
            <RepoChip repo={pr.repo} number={pr.number} />
            <span>
              by <span className="text-ink-200">{pr.author}</span>
            </span>
            <span title={pr.createdAt}>opened {age(pr.createdAt)} ago</span>
            <span title={pr.updatedAt}>updated {age(pr.updatedAt)} ago</span>
            <DiffStat additions={pr.additions} deletions={pr.deletions} files={pr.changedFiles} />
          </div>
          <p className="line-clamp-2 text-sm text-ink-400">
            <span className="mr-1.5 text-secondary-400">✦</span>
            {pr.summary ??
              (pr.summaryError ? (
                <span className="italic text-ink-600" title={pr.summaryError}>
                  Summary unavailable
                </span>
              ) : (
                <span className="italic text-ink-600">Summarizing…</span>
              ))}
          </p>
        </div>
      </button>
      <HideControls
        pr={pr}
        className={`absolute bottom-3 right-3 p-1 ${pr.hidden ? '' : 'rounded-lg bg-ink-900 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100'}`}
      />
    </li>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-ink-800 p-10 text-center text-sm text-ink-400">{children}</div>
}

interface PrListProps {
  prs: Pr[]
  visible: Pr[]
  allMatchingHidden: boolean
  refreshing: boolean
  onOpen(pr: Pr): void
}

function PrList({ prs, visible, allMatchingHidden, refreshing, onOpen }: PrListProps) {
  if (prs.length === 0 && !refreshing) {
    return (
      <EmptyState>
        No open PRs match. Add authors and repos in{' '}
        <Link className="text-primary-400 underline" to={settingsPath('pull-requests')}>
          Settings
        </Link>
        .
      </EmptyState>
    )
  }
  if (visible.length === 0) return <EmptyState>{allMatchingHidden ? 'All matching PRs are hidden.' : 'No PRs match these filters.'}</EmptyState>
  return <PrCards prs={visible} onOpen={onOpen} />
}

function PrCards({ prs, onOpen }: { prs: Pr[]; onOpen(pr: Pr): void }) {
  return (
    <ul className="space-y-2.5">
      {prs.map((pr) => (
        <PrCard key={pr.id} pr={pr} onOpen={() => onOpen(pr)} />
      ))}
    </ul>
  )
}

function HiddenPrs({ prs, onOpen }: { prs: Pr[]; onOpen(pr: Pr): void }) {
  const [open, setOpen] = useState(false)
  if (prs.length === 0) return null
  return (
    <section className="space-y-2.5 pt-2">
      <button className="text-xs text-ink-500 hover:text-ink-300" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {prs.length} hidden
      </button>
      {open && <PrCards prs={prs} onOpen={onOpen} />}
    </section>
  )
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5Z" />
    </svg>
  )
}

export function Dashboard() {
  const { prs, refreshing, refreshedAt, error } = usePrs()
  const [filters, setFilters] = usePersistentState<PrFilters>('rally.dashboard.filters', DEFAULT_FILTERS)
  const [sort, setSort] = usePersistentState<PrSort>('rally.dashboard.sort', DEFAULT_SORT)
  const [showFilters, setShowFilters] = useState(false)
  const navigate = useNavigate()

  const { visible, hiddenPrs, phaseCounts, allMatchingHidden } = useMemo(() => dashboardView(prs, filters, sort), [prs, filters, sort])
  const activeCount = activeFilterCount(filters)
  const openPr = (pr: Pr) => navigate(`/pr/${pr.owner}/${pr.repo}/${pr.number}`)

  const togglePhase = (phase: Phase) => {
    const hiddenPhases = filters.hiddenPhases.includes(phase)
      ? filters.hiddenPhases.filter((p) => p !== phase)
      : [...filters.hiddenPhases, phase]
    setFilters({ ...filters, hiddenPhases })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">
          Open PRs{' '}
          <span className="text-ink-500">
            {visible.length === prs.length ? prs.length : `${visible.length} of ${prs.length}`}
          </span>
        </h1>
        <div className="ml-auto flex items-center gap-3 text-xs text-ink-500">
          {refreshedAt && <span>Updated {age(refreshedAt)} ago</span>}
          <button
            className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5`}
            disabled={refreshing}
            onClick={() => window.rally.refreshPrs()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PHASE_ORDER.map((phase) => {
          const theme = PHASE_THEME[phase]
          const active = !filters.hiddenPhases.includes(phase)
          return (
            <button
              key={phase}
              onClick={() => togglePhase(phase)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 transition ${active ? theme.chipActive : 'text-ink-500 ring-ink-800 hover:text-ink-300'}`}
            >
              <span className={`h-2 w-2 rounded-full ${active ? theme.dot : 'bg-ink-700'}`} />
              {PHASE_LABELS[phase]}
              <span className="font-semibold">{phaseCounts[phase]}</span>
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-2">
          {activeCount > 0 && (
            <button className="text-xs text-ink-500 hover:text-ink-300" onClick={() => setFilters({ ...DEFAULT_FILTERS, hiddenPhases: filters.hiddenPhases })}>
              Clear filters
            </button>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ring-1 transition ${showFilters || activeCount ? 'bg-secondary-500/15 text-secondary-100 ring-secondary-400/40' : 'text-ink-400 ring-ink-800 hover:text-ink-200'}`}
          >
            <FunnelIcon />
            Filters
            {activeCount > 0 && <span className="rounded-full bg-secondary-400 px-1.5 text-[10px] font-semibold text-ink-950">{activeCount}</span>}
          </button>
          <SortControl sort={sort} onChange={setSort} />
        </div>
      </div>

      {showFilters && <FilterPanel prs={prs} filters={filters} onChange={setFilters} />}

      <FailedInstallBanner />

      {error && <div className="rounded-lg bg-rose-950/80 px-4 py-2 text-sm text-rose-200 ring-1 ring-rose-500/30">GitHub refresh failed: {error}</div>}

      <PrList prs={prs} visible={visible} allMatchingHidden={allMatchingHidden} refreshing={refreshing} onOpen={openPr} />
      <HiddenPrs prs={hiddenPrs} onOpen={openPr} />
    </div>
  )
}
