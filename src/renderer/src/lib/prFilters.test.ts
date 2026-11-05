import { describe, expect, it } from 'vitest'
import type { Pr } from '@shared/types'
import { applySecondaryFilters, dashboardView, DEFAULT_FILTERS, DEFAULT_SORT, filterOptions, sortPrs } from './prFilters'

function pr(overrides: Partial<Pr>): Pr {
  return {
    id: overrides.id ?? 'id',
    number: 1,
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
    phase: 'unreviewed',
    reviewStatus: null,
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

const ids = (list: Pr[]) => list.map((p) => p.id)

describe('applySecondaryFilters', () => {
  it('keeps everything by default', () => {
    expect(ids(applySecondaryFilters(prs, DEFAULT_FILTERS))).toEqual(['a', 'b', 'c'])
  })

  it('ORs within a filter and ANDs across filters', () => {
    const filters = { ...DEFAULT_FILTERS, authors: ['alice', 'bob'], repos: ['acme/api'] }
    expect(ids(applySecondaryFilters(prs, filters))).toEqual(['a'])
  })

  it('filters by draft status', () => {
    expect(ids(applySecondaryFilters(prs, { ...DEFAULT_FILTERS, draft: 'draft' }))).toEqual(['b'])
    expect(ids(applySecondaryFilters(prs, { ...DEFAULT_FILTERS, draft: 'ready' }))).toEqual(['a', 'c'])
  })
})

describe('sortPrs', () => {
  it('sorts by phase order', () => {
    expect(ids(sortPrs(prs, { field: 'phase', direction: 'asc' }))).toEqual(['b', 'c', 'a'])
  })

  it('sorts by size descending', () => {
    expect(ids(sortPrs(prs, { field: 'size', direction: 'desc' }))).toEqual(['b', 'a', 'c'])
  })

  it('sorts authors case-insensitively', () => {
    expect(ids(sortPrs(prs, { field: 'author', direction: 'asc' }))).toEqual(['a', 'b', 'c'])
  })

  it('sorts newest first', () => {
    expect(ids(sortPrs(prs, { field: 'created', direction: 'desc' }))).toEqual(['a', 'c', 'b'])
  })
})

describe('filterOptions', () => {
  it('counts values and keeps stale selections', () => {
    expect(filterOptions(prs, (p) => p.repo, ['gone'])).toEqual([
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
    const view = dashboardView(withHidden, DEFAULT_FILTERS, DEFAULT_SORT)
    expect(ids(view.visible)).toEqual(['b', 'c', 'a'])
    expect(ids(view.hiddenPrs)).toEqual(['d', 'e'])
    expect(view.phaseCounts).toEqual({ in_progress: 1, awaiting_rereview: 0, unreviewed: 1, pending_changes: 0, approved: 1 })
    expect(view.allMatchingHidden).toBe(false)
  })

  it('applies author filters but not phase toggles to hidden PRs', () => {
    const view = dashboardView(withHidden, { ...DEFAULT_FILTERS, authors: ['bob'], hiddenPhases: ['approved'] }, DEFAULT_SORT)
    expect(ids(view.visible)).toEqual(['b'])
    expect(ids(view.hiddenPrs)).toEqual(['e'])
  })

  it('reports when every matching PR is hidden', () => {
    expect(dashboardView(withHidden.slice(3), DEFAULT_FILTERS, DEFAULT_SORT).allMatchingHidden).toBe(true)
    expect(dashboardView([], DEFAULT_FILTERS, DEFAULT_SORT).allMatchingHidden).toBe(false)
  })
})
