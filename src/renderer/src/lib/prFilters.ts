import { PHASE_ORDER, type Phase, type Pr } from '@shared/types'

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

export function applySecondaryFilters(prs: Pr[], filters: PrFilters): Pr[] {
  return prs.filter(
    (pr) =>
      (filters.authors.length === 0 || filters.authors.includes(pr.author)) &&
      (filters.repos.length === 0 || filters.repos.includes(repoName(pr))) &&
      (filters.draft === 'all' || (filters.draft === 'draft') === pr.isDraft),
  )
}

export interface DashboardView {
  visible: Pr[]
  hidden: Pr[]
  phaseCounts: Record<Phase, number>
  allHidden: boolean
}

export function dashboardView(prs: Pr[], filters: PrFilters, sort: PrSort): DashboardView {
  const filtered = applySecondaryFilters(prs, filters)
  const shown = filtered.filter((pr) => !pr.hidden)
  const phaseCounts = Object.fromEntries(PHASE_ORDER.map((phase) => [phase, 0])) as Record<Phase, number>
  for (const pr of shown) phaseCounts[pr.phase]++
  return {
    visible: sortPrs(shown.filter((pr) => !filters.hiddenPhases.includes(pr.phase)), sort),
    hidden: sortPrs(filtered.filter((pr) => pr.hidden), sort),
    phaseCounts,
    allHidden: shown.length === 0 && filtered.length > 0,
  }
}

function compareField(a: Pr, b: Pr, field: SortField): number {
  switch (field) {
    case 'phase':
      return PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase)
    case 'created':
      return a.createdAt.localeCompare(b.createdAt)
    case 'updated':
      return a.updatedAt.localeCompare(b.updatedAt)
    case 'size':
      return a.additions + a.deletions - (b.additions + b.deletions)
    case 'author':
      return a.author.localeCompare(b.author, undefined, { sensitivity: 'base' })
    case 'repo':
      return repoName(a).localeCompare(repoName(b))
  }
}

export function sortPrs(prs: Pr[], sort: PrSort): Pr[] {
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...prs].sort((a, b) => sign * compareField(a, b, sort.field) || a.createdAt.localeCompare(b.createdAt))
}

export interface FilterOption {
  value: string
  count: number
}

export function filterOptions(prs: Pr[], key: (pr: Pr) => string, selected: string[]): FilterOption[] {
  const counts = new Map<string, number>(selected.map((value) => [value, 0]))
  for (const pr of prs) counts.set(key(pr), (counts.get(key(pr)) ?? 0) + 1)
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}
