import { describe, expect, it } from 'vitest'
import { groupIntoUnits, type PrUnit } from '@shared/prUnit'
import { AUTHOR_PHASE_ORDER, REVIEW_PHASE_ORDER, type Pr } from '@shared/types'
import { applySecondaryFilters, dashboardView, DEFAULT_FILTERS, DEFAULT_SORT, filterOptions, sortUnits } from './prFilters'

function pr(overrides: Partial<Pr>): Pr {
  return {
    id: overrides.id ?? 'id',
    number: overrides.number ?? (overrides.id ?? 'id').charCodeAt(0),
    owner: 'acme',
    repo: 'api',
    url: '',
    title: '',
    body: '',
    author: 'alice',
    authorAvatarUrl: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    isDraft: false,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    headRefOid: '',
    headForcePushedAt: null,
    headKnownSince: null,
    baseRefName: 'main',
    headRefName: 'x',
    files: [],
    reviewRequestedFromMe: false,
    myReviews: [],
    feedback: null,
    phase: 'unreviewed',
    reviewStatus: null,
    openFindings: 0,
    summary: null,
    summaryError: null,
    hidden: null,
    ...overrides,
  }
}

const prs = [
  pr({ id: 'a', author: 'alice', repo: 'api', isDraft: false, phase: 'approved', createdAt: '2026-10-03T00:00:00Z', additions: 5 }),
  pr({ id: 'b', author: 'bob', repo: 'web', isDraft: true, phase: 'in_progress', createdAt: '2026-10-01T00:00:00Z', additions: 50 }),
  pr({ id: 'c', author: 'Carol', repo: 'api', isDraft: false, phase: 'unreviewed', createdAt: '2026-10-02T00:00:00Z', additions: 1 }),
]

const units = (list: Pr[]) => groupIntoUnits(list, REVIEW_PHASE_ORDER)
const ids = (list: PrUnit[]) => list.map((u) => u.members.map((p) => p.id).join('+'))
const sortPrs = (list: Pr[], sort: Parameters<typeof sortUnits>[1], order: Parameters<typeof sortUnits>[2]) => sortUnits(groupIntoUnits(list, order), sort, order)

describe('applySecondaryFilters', () => {
  it('keeps everything by default', () => {
    expect(ids(applySecondaryFilters(units(prs), DEFAULT_FILTERS))).toEqual(['a', 'b', 'c'])
  })

  it('ORs within a filter and ANDs across filters', () => {
    const filters = { ...DEFAULT_FILTERS, authors: ['alice', 'bob'], repos: ['acme/api'] }
    expect(ids(applySecondaryFilters(units(prs), filters))).toEqual(['a'])
  })

  it('filters by draft status', () => {
    expect(ids(applySecondaryFilters(units(prs), { ...DEFAULT_FILTERS, draft: 'draft' }))).toEqual(['b'])
    expect(ids(applySecondaryFilters(units(prs), { ...DEFAULT_FILTERS, draft: 'ready' }))).toEqual(['a', 'c'])
  })
})

describe('sortPrs', () => {
  it('sorts by the phase order it is given', () => {
    const authored = [pr({ id: 'x', phase: 'approved' }), pr({ id: 'y', phase: 'needs_response' }), pr({ id: 'z', phase: 'awaiting_reviews' })]
    expect(ids(sortPrs(authored, { field: 'phase', direction: 'asc' }, AUTHOR_PHASE_ORDER))).toEqual(['y', 'z', 'x'])
  })

  it('sorts by phase order', () => {
    expect(ids(sortPrs(prs, { field: 'phase', direction: 'asc' }, REVIEW_PHASE_ORDER))).toEqual(['b', 'c', 'a'])
  })

  it('sorts by size descending', () => {
    expect(ids(sortPrs(prs, { field: 'size', direction: 'desc' }, REVIEW_PHASE_ORDER))).toEqual(['b', 'a', 'c'])
  })

  it('sorts authors case-insensitively', () => {
    expect(ids(sortPrs(prs, { field: 'author', direction: 'asc' }, REVIEW_PHASE_ORDER))).toEqual(['a', 'b', 'c'])
  })

  it('sorts newest first', () => {
    expect(ids(sortPrs(prs, { field: 'created', direction: 'desc' }, REVIEW_PHASE_ORDER))).toEqual(['a', 'c', 'b'])
  })
})

describe('filterOptions', () => {
  it('counts values and keeps stale selections', () => {
    expect(filterOptions(units(prs), (p) => p.repo, ['gone'])).toEqual([
      { value: 'api', count: 2 },
      { value: 'web', count: 1 },
      { value: 'gone', count: 0 },
    ])
  })
})

describe('dashboardView', () => {
  const hiddenAt = '2026-11-01T00:00:00Z'
  const withHidden = [
    ...prs,
    pr({ id: 'd', phase: 'unreviewed', hidden: { mode: 'indefinite', at: hiddenAt } }),
    pr({ id: 'e', author: 'bob', phase: 'approved', hidden: { mode: 'snooze', at: hiddenAt } }),
  ]

  it('moves hidden PRs out of the list and the phase counts', () => {
    const view = dashboardView(withHidden, DEFAULT_FILTERS, DEFAULT_SORT, REVIEW_PHASE_ORDER)
    expect(ids(view.visible)).toEqual(['b', 'c', 'a'])
    expect(ids(view.hiddenUnits)).toEqual(['d', 'e'])
    expect(view.phaseCounts).toEqual({ in_progress: 1, awaiting_rereview: 0, unreviewed: 1, pending_changes: 0, approved: 1 })
    expect(view.allMatchingHidden).toBe(false)
  })

  it('applies author filters but not phase toggles to hidden PRs', () => {
    const view = dashboardView(withHidden, { ...DEFAULT_FILTERS, authors: ['bob'], hiddenPhases: ['approved'] }, DEFAULT_SORT, REVIEW_PHASE_ORDER)
    expect(ids(view.visible)).toEqual(['b'])
    expect(ids(view.hiddenUnits)).toEqual(['e'])
  })

  it('reports when every matching PR is hidden', () => {
    expect(dashboardView(withHidden.slice(3), DEFAULT_FILTERS, DEFAULT_SORT, REVIEW_PHASE_ORDER).allMatchingHidden).toBe(true)
    expect(dashboardView([], DEFAULT_FILTERS, DEFAULT_SORT, REVIEW_PHASE_ORDER).allMatchingHidden).toBe(false)
  })
})

describe('units on the dashboard', () => {
  const api = pr({ id: 'api', number: 1, repo: 'api', author: 'alice', phase: 'approved', linkedPrs: ['acme/web#2'], createdAt: '2026-10-05T00:00:00Z', additions: 1 })
  const web = pr({ id: 'web', number: 2, repo: 'web', author: 'bob', phase: 'awaiting_rereview', linkedPrs: ['acme/api#1'], createdAt: '2026-10-01T00:00:00Z', isDraft: true, additions: 100 })
  const solo = pr({ id: 'solo', number: 3, repo: 'api', author: 'carol', phase: 'unreviewed', createdAt: '2026-10-03T00:00:00Z', additions: 50 })

  it('shows a unit once, in its most urgent phase, counted once', () => {
    const view = dashboardView([api, solo, web], DEFAULT_FILTERS, DEFAULT_SORT, REVIEW_PHASE_ORDER)
    expect(ids(view.visible)).toEqual(['api+web', 'solo'])
    expect(view.phaseCounts).toMatchObject({ awaiting_rereview: 1, unreviewed: 1, approved: 0 })
    expect(view.units).toHaveLength(2)
  })

  it('matches a filter when any member does', () => {
    expect(ids(applySecondaryFilters(units([api, solo, web]), { ...DEFAULT_FILTERS, authors: ['bob'] }))).toEqual(['api+web'])
    expect(ids(applySecondaryFilters(units([api, solo, web]), { ...DEFAULT_FILTERS, authors: ['alice'], repos: ['acme/web'] }))).toEqual(['api+web'])
    expect(ids(applySecondaryFilters(units([api, solo, web]), { ...DEFAULT_FILTERS, draft: 'draft' }))).toEqual(['api+web'])
  })

  it('sorts by the earliest opened member and the total size', () => {
    expect(ids(sortUnits(units([api, solo, web]), { field: 'created', direction: 'asc' }, REVIEW_PHASE_ORDER))).toEqual(['api+web', 'solo'])
    expect(ids(sortUnits(units([api, solo, web]), { field: 'size', direction: 'asc' }, REVIEW_PHASE_ORDER))).toEqual(['solo', 'api+web'])
  })

  it('counts a unit once per filter value', () => {
    expect(filterOptions(units([api, solo, web]), (p) => p.owner, [])).toEqual([{ value: 'acme', count: 2 }])
  })
})
