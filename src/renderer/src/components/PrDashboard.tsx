import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PrUnit } from '@shared/prUnit'
import { PHASE_LABELS, type Phase, type Pr, type PrFeedback, type PrListKind, type SessionStatus } from '@shared/types'
import { Avatar } from './Avatar'
import { BusyDot } from './BusyDot'
import { DiffStat } from './DiffStat'
import { FailedInstallBanner } from './FailedInstallBanner'
import { FilterPanel } from './FilterPanel'
import { HideControls } from './HideControls'
import { PhaseBadge } from './PhaseBadge'
import { RepoChip } from './RepoChip'
import { SortControl } from './SortControl'
import { PrSummary } from './PrSummary'
import { age, plural } from '../lib/format'
import { usePersistentState, usePrs } from '../lib/hooks'
import { activeFilterCount, dashboardView, DEFAULT_FILTERS, DEFAULT_SORT, type PrFilters, type PrSort } from '../lib/prFilters'
import { BUSY_STATUSES } from '../lib/sessionStatus'
import { PHASE_THEME, PRIMARY_BUTTON_CLASS } from '../lib/theme'

export interface DashboardConfig {
  list: PrListKind
  title: string
  phaseOrder: readonly Phase[]
  storageKey: string
  detailPath(pr: Pr): string
  emptyState: ReactNode
  statusLabels: StatusLabels
}

type StatusLabels = Record<SessionStatus, string>

function SessionStatusNote({ status, labels }: { status: SessionStatus; labels: StatusLabels }) {
  const busy = BUSY_STATUSES.includes(status)
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${status === 'error' ? 'text-rose-300' : 'text-highlight-300/80'}`}>
      {busy && <BusyDot className="h-1.5 w-1.5 bg-highlight-400" />}
      {labels[status]}
    </span>
  )
}

function FeedbackNote({ feedback, openFindings }: { feedback: PrFeedback; openFindings: number }) {
  const parts: ReactNode[] = []
  if (openFindings > 0) {
    parts.push(
      <span key="findings" className="text-amber-300">
        {plural(openFindings, 'open self-review finding')}
      </span>,
    )
  }
  if (feedback.unacknowledged > 0) {
    parts.push(
      <span key="unanswered" className="text-amber-300">
        {feedback.unacknowledged} unanswered
      </span>,
    )
  }
  if (feedback.truncated) {
    parts.push(
      <span key="truncated" className="text-amber-300" title="This PR has more threads, comments, or reviews than the list reads. Open it to check them all.">
        too much activity to check here
      </span>,
    )
  }
  if (feedback.changesRequestedBy.length > 0) {
    parts.push(
      <span key="changes" className="text-amber-300">
        changes requested by {feedback.changesRequestedBy.join(', ')}
      </span>,
    )
  }
  if (feedback.approvedBy.length > 0) {
    parts.push(
      <span key="approved" className="text-emerald-300">
        approved by {feedback.approvedBy.join(', ')}
      </span>,
    )
  }
  if (parts.length === 0) parts.push(<span key="none">{feedback.openThreads > 0 ? `${feedback.openThreads} open threads` : 'no open threads'}</span>)
  return <>{parts}</>
}

interface CardListProps {
  list: PrListKind
  statusLabels: StatusLabels
}

function DraftTag() {
  return (
    <span className="mr-2 rounded bg-ink-700/60 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-ink-300">
      Draft
    </span>
  )
}

function UnitStatus({ unit, labels }: { unit: PrUnit; labels: StatusLabels }) {
  const status = unit.phase === 'in_progress' ? unit.members.find((pr) => pr.reviewStatus)?.reviewStatus : null
  return (
    <div className="flex flex-col items-end gap-1">
      <PhaseBadge phase={unit.phase} />
      {status && <SessionStatusNote status={status} labels={labels} />}
    </div>
  )
}

function SingleCardBody({ pr, unit, statusLabels }: { pr: Pr; unit: PrUnit; statusLabels: StatusLabels }) {
  return (
    <>
      <div className="flex items-start gap-3">
        <h3 className="min-w-0 flex-1 truncate font-medium text-ink-100 group-hover:text-white">
          {pr.isDraft && <DraftTag />}
          {pr.title}
        </h3>
        <UnitStatus unit={unit} labels={statusLabels} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
        <RepoChip repo={pr.repo} number={pr.number} />
        {pr.feedback ? (
          <FeedbackNote feedback={pr.feedback} openFindings={pr.openFindings} />
        ) : (
          <span>
            by <span className="text-ink-200">{pr.author}</span>
          </span>
        )}
        <span title={pr.createdAt}>opened {age(pr.createdAt)} ago</span>
        <span title={pr.updatedAt}>updated {age(pr.updatedAt)} ago</span>
        <DiffStat additions={pr.additions} deletions={pr.deletions} files={pr.changedFiles} />
      </div>
      <PrSummary pr={pr} className="line-clamp-2" />
    </>
  )
}

function UnitCardBody({ unit, statusLabels }: { unit: PrUnit; statusLabels: StatusLabels }) {
  const authors = [...new Set(unit.members.map((pr) => pr.author))]
  const repoCount = new Set(unit.members.map((pr) => `${pr.owner}/${pr.repo}`.toLowerCase())).size
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="rounded bg-secondary-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-200">
          {repoCount} {repoCount === 1 ? 'repo' : 'repos'}
        </span>
        <span className="min-w-0 flex-1" />
        <UnitStatus unit={unit} labels={statusLabels} />
      </div>
      <ul className="space-y-1.5">
        {unit.members.map((pr) => (
          <li key={pr.id} className="space-y-0.5">
            <div className="flex min-w-0 items-center gap-2 text-xs text-ink-400">
              <RepoChip repo={pr.repo} number={pr.number} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-100 group-hover:text-white">
                {pr.isDraft && <DraftTag />}
                {pr.title}
              </span>
              <DiffStat additions={pr.additions} deletions={pr.deletions} files={pr.changedFiles} />
            </div>
            <PrSummary pr={pr} className="line-clamp-1 pl-1" />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
        <span>
          by <span className="text-ink-200">{authors.join(', ')}</span>
        </span>
        <span title={unit.createdAt}>opened {age(unit.createdAt)} ago</span>
        <span title={unit.updatedAt}>updated {age(unit.updatedAt)} ago</span>
      </div>
    </>
  )
}

function UnitCard({ list, statusLabels, unit, onOpen }: CardListProps & { unit: PrUnit; onOpen(): void }) {
  const [lead] = unit.members
  const theme = PHASE_THEME[unit.phase]
  return (
    <li className={`group relative ${unit.hidden ? 'opacity-60 hover:opacity-100' : ''}`}>
      <button
        onClick={onOpen}
        className={`relative flex w-full gap-4 overflow-hidden rounded-xl border border-white/5 bg-ink-900/60 p-4 pl-5 text-left transition hover:border-white/10 hover:bg-ink-900 ${unit.hidden ? 'pb-11' : ''}`}
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${theme.accent}`} />
        <Avatar login={lead.author} url={lead.authorAvatarUrl} ringClass={theme.ring} />
        <div className="min-w-0 flex-1 space-y-1.5">
          {unit.members.length > 1 ? <UnitCardBody unit={unit} statusLabels={statusLabels} /> : <SingleCardBody pr={lead} unit={unit} statusLabels={statusLabels} />}
        </div>
      </button>
      <HideControls
        list={list}
        ids={unit.members.map((pr) => pr.id)}
        hidden={unit.hidden}
        phase={unit.phase}
        className={`absolute bottom-3 right-3 p-1 ${unit.hidden ? '' : 'rounded-lg bg-ink-900 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100'}`}
      />
    </li>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-ink-800 p-10 text-center text-sm text-ink-400">{children}</div>
}

interface PrListProps extends CardListProps {
  total: number
  visible: PrUnit[]
  allMatchingHidden: boolean
  refreshing: boolean
  emptyState: ReactNode
  onOpen(pr: Pr): void
}

function PrList({ list, statusLabels, total, visible, allMatchingHidden, refreshing, emptyState, onOpen }: PrListProps) {
  if (total === 0 && !refreshing) return <EmptyState>{emptyState}</EmptyState>
  if (visible.length === 0) return <EmptyState>{allMatchingHidden ? 'All matching PRs are hidden.' : 'No PRs match these filters.'}</EmptyState>
  return <UnitCards list={list} statusLabels={statusLabels} units={visible} onOpen={onOpen} />
}

function UnitCards({ list, statusLabels, units, onOpen }: CardListProps & { units: PrUnit[]; onOpen(pr: Pr): void }) {
  return (
    <ul className="space-y-2.5">
      {units.map((unit) => (
        <UnitCard key={unit.key} list={list} statusLabels={statusLabels} unit={unit} onOpen={() => onOpen(unit.members[0])} />
      ))}
    </ul>
  )
}

function HiddenUnits({ list, statusLabels, units, onOpen }: CardListProps & { units: PrUnit[]; onOpen(pr: Pr): void }) {
  const [open, setOpen] = useState(false)
  if (units.length === 0) return null
  return (
    <section className="space-y-2.5 pt-2">
      <button className="text-xs text-ink-500 hover:text-ink-300" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {units.length} hidden
      </button>
      {open && <UnitCards list={list} statusLabels={statusLabels} units={units} onOpen={onOpen} />}
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

export function PrDashboard({ config }: { config: DashboardConfig }) {
  const { list, phaseOrder } = config
  const { prs, refreshing, refreshedAt, error } = usePrs(list)
  const [filters, setFilters] = usePersistentState<PrFilters>(`${config.storageKey}.filters`, DEFAULT_FILTERS)
  const [sort, setSort] = usePersistentState<PrSort>(`${config.storageKey}.sort`, DEFAULT_SORT)
  const [showFilters, setShowFilters] = useState(false)
  const navigate = useNavigate()

  const { visible, hiddenUnits, phaseCounts, allMatchingHidden, units } = useMemo(
    () => dashboardView(prs, filters, sort, phaseOrder),
    [prs, filters, sort, phaseOrder],
  )
  const activeCount = activeFilterCount(filters)
  const openPr = (pr: Pr) => navigate(config.detailPath(pr))

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
          {config.title}{' '}
          <span className="text-ink-500">
            {visible.length === units.length ? units.length : `${visible.length} of ${units.length}`}
          </span>
        </h1>
        <div className="ml-auto flex items-center gap-3 text-xs text-ink-500">
          {refreshedAt && <span>Updated {age(refreshedAt)} ago</span>}
          <button
            className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5`}
            disabled={refreshing}
            onClick={() => window.rally.refreshPrs(list)}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {phaseOrder.map((phase) => {
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

      {showFilters && <FilterPanel units={units} filters={filters} showAuthors={list === 'reviewing'} onChange={setFilters} />}

      <FailedInstallBanner />

      {error && <div className="rounded-lg bg-rose-950/80 px-4 py-2 text-sm text-rose-200 ring-1 ring-rose-500/30">GitHub refresh failed: {error}</div>}

      <PrList
        list={list}
        statusLabels={config.statusLabels}
        total={units.length}
        visible={visible}
        allMatchingHidden={allMatchingHidden}
        refreshing={refreshing}
        emptyState={config.emptyState}
        onOpen={openPr}
      />
      <HiddenUnits list={list} statusLabels={config.statusLabels} units={hiddenUnits} onOpen={openPr} />
    </div>
  )
}
