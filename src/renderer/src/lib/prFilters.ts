import { groupIntoUnits, type PrUnit } from '@shared/prUnit'
import type { Phase, Pr } from '@shared/types'

export type DraftFilter = 'all' | 'ready' | 'draft'
export type SortField = 'phase' | 'created' | 'updated' | 'size' | 'author' | 'repo'
export type SortDirection = 'asc' | 'desc'

export interface PrFilters {
  hiddenPhases: Phase[]
  authors: string[]
  repos: string[]
  draft: DraftFilter
}

export interface PrSort {
  field: SortField
  direction: SortDirection
}

export const DEFAULT_FILTERS: PrFilters = { hiddenPhases: [], authors: [], repos: [], draft: 'all' }
export const DEFAULT_SORT: PrSort = { field: 'phase', direction: 'asc' }

export const SORT_FIELD_LABELS: Record<SortField, string> = {
  phase: 'Phase',
  created: 'Opened',
  updated: 'Updated',
  size: 'Size',
  author: 'Author',
  repo: 'Repo',
}

export function repoName(pr: Pr): string {
  return `${pr.owner}/${pr.repo}`
}

export function activeFilterCount(filters: PrFilters): number {
  return filters.authors.length + filters.repos.length + (filters.draft === 'all' ? 0 : 1)
}

/** Keeps units where, for each filter, some member matches it. */
export function applySecondaryFilters(units: PrUnit[], filters: PrFilters): PrUnit[] {
  return units.filter(
    (unit) =>
      (filters.authors.length === 0 || unit.members.some((pr) => filters.authors.includes(pr.author))) &&
      (filters.repos.length === 0 || unit.members.some((pr) => filters.repos.includes(repoName(pr)))) &&
      (filters.draft === 'all' || unit.members.some((pr) => (filters.draft === 'draft') === pr.isDraft)),
  )
}

export interface DashboardView<P extends Phase> {
  visible: PrUnit[]
  hiddenUnits: PrUnit[]
  phaseCounts: Record<P, number>
  allMatchingHidden: boolean
  /** Every unit, before filtering. */
  units: PrUnit[]
}

export function dashboardView<P extends Phase>(prs: Pr[], filters: PrFilters, sort: PrSort, phaseOrder: readonly P[]): DashboardView<P> {
  const units = groupIntoUnits(prs, phaseOrder)
  const filtered = applySecondaryFilters(units, filters)
  const shown = filtered.filter((unit) => !unit.hidden)
  const phaseCounts = Object.fromEntries(phaseOrder.map((phase) => [phase, 0])) as Record<P, number>
  for (const unit of shown) {
    if (unit.phase in phaseCounts) phaseCounts[unit.phase as P]++
  }
  return {
    visible: sortUnits(shown.filter((unit) => !filters.hiddenPhases.includes(unit.phase)), sort, phaseOrder),
    hiddenUnits: sortUnits(filtered.filter((unit) => unit.hidden), sort, phaseOrder),
    phaseCounts,
    allMatchingHidden: shown.length === 0 && filtered.length > 0,
    units,
  }
}

function compareField(a: PrUnit, b: PrUnit, field: SortField, phaseOrder: readonly Phase[]): number {
  switch (field) {
    case 'phase':
      return phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase)
    case 'created':
      return a.createdAt.localeCompare(b.createdAt)
    case 'updated':
      return a.updatedAt.localeCompare(b.updatedAt)
    case 'size':
      return a.size - b.size
    case 'author':
      return a.members[0].author.localeCompare(b.members[0].author, undefined, { sensitivity: 'base' })
    case 'repo':
      return repoName(a.members[0]).localeCompare(repoName(b.members[0]))
  }
}

export function sortUnits(units: PrUnit[], sort: PrSort, phaseOrder: readonly Phase[]): PrUnit[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...units].sort((a, b) => sign * compareField(a, b, sort.field, phaseOrder) || a.createdAt.localeCompare(b.createdAt))
}

export interface FilterOption {
  value: string
  count: number
}

/** Counts the units with a member having each value, keeping selected values that no unit has. */
export function filterOptions(units: PrUnit[], key: (pr: Pr) => string, selected: string[]): FilterOption[] {
  const counts = new Map<string, number>(selected.map((value) => [value, 0]))
  for (const unit of units) {
    for (const value of new Set(unit.members.map(key))) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}
