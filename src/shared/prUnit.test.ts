import { describe, expect, it } from 'vitest'
import { groupIntoUnits, linkNode, linkUnits, oneSidedLinks, unitHide, unitMembers, unitPhase } from './prUnit'
import { REVIEW_PHASE_ORDER, type Pr, type PrLinks } from './types'

const MARKERS = ['linked PR']
const NO_LINKS: PrLinks = { linked: [], unlinked: [] }

function node(repo: string, links: string[] = []) {
  return linkNode({ owner: 'acme', repo, number: 1, body: `Linked PRs: ${links.map((r) => `acme/${r}#1`).join(' ')}` }, MARKERS)
}

function pr(repo: string, overrides: Partial<Pr> = {}): Pr {
  return {
    id: repo,
    number: 1,
    owner: 'acme',
    repo,
    url: `https://github.com/acme/${repo}/pull/1`,
    title: repo,
    body: '',
    author: 'alice',
    authorAvatarUrl: null,
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    isDraft: false,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    headRefOid: 'h',
    headForcePushedAt: null,
    headKnownSince: null,
    baseRefName: 'main',
    headRefName: 'f',
    files: [],
    reviewRequestedFromMe: false,
    myReviews: [],
    feedback: null,
    phase: 'unreviewed',
    reviewStatus: null,
    summary: null,
    summaryError: null,
    hidden: null,
    ...overrides,
  }
}

describe('linkUnits', () => {
  it('groups PRs that list each other', () => {
    expect(linkUnits([node('api', ['web']), node('web', ['api'])], NO_LINKS)).toEqual([['acme/api#1', 'acme/web#1']])
  })

  it('leaves a one-sided link ungrouped', () => {
    expect(linkUnits([node('api', ['web']), node('web')], NO_LINKS)).toEqual([])
  })

  it('matches links regardless of owner and repo case', () => {
    const api = linkNode({ owner: 'acme', repo: 'api', number: 1, body: 'Linked PR: ACME/Web#1' }, MARKERS)
    expect(linkUnits([api, node('web', ['api'])], NO_LINKS)).toHaveLength(1)
  })

  it('follows mutual links transitively', () => {
    const units = linkUnits([node('api', ['web']), node('web', ['api', 'worker']), node('worker', ['web'])], NO_LINKS)
    expect(units).toEqual([['acme/api#1', 'acme/web#1', 'acme/worker#1']])
  })

  it('groups hand-linked PRs and splits hand-unlinked ones', () => {
    expect(linkUnits([node('api'), node('web')], { linked: [['acme/web#1', 'acme/api#1']], unlinked: [] })).toHaveLength(1)
    const unlinked = { linked: [['acme/api#1', 'acme/web#1']] as [string, string][], unlinked: [['acme/web#1', 'acme/api#1']] as [string, string][] }
    expect(linkUnits([node('api', ['web']), node('web', ['api'])], unlinked)).toEqual([])
  })

  it('caps a unit at five members', () => {
    const repos = ['a', 'b', 'c', 'd', 'e', 'f']
    const nodes = repos.map((repo) => node(repo, repos.filter((r) => r !== repo)))
    expect(linkUnits(nodes, NO_LINKS)).toEqual([repos.slice(0, 5).map((r) => `acme/${r}#1`)])
  })
})

describe('oneSidedLinks', () => {
  it('lists links that are not returned, unless dismissed', () => {
    const nodes = [node('api', ['web', 'worker']), node('web'), node('worker', ['api'])]
    const units = linkUnits(nodes, NO_LINKS)
    expect(oneSidedLinks(nodes, NO_LINKS, units)).toEqual(new Map([['acme/api#1', ['acme/web#1']]]))
    expect(oneSidedLinks(nodes, { linked: [], unlinked: [['acme/web#1', 'acme/api#1']] }, units)).toEqual(new Map())
  })

  it('does not list a one-sided link that was linked by hand', () => {
    const nodes = [node('api', ['web']), node('web')]
    const links: PrLinks = { linked: [['acme/api#1', 'acme/web#1']], unlinked: [] }
    expect(oneSidedLinks(nodes, links, linkUnits(nodes, links))).toEqual(new Map())
  })
})

describe('unitPhase', () => {
  it('takes the most urgent member phase, so a unit is approved only when every member is', () => {
    expect(unitPhase([pr('a', { phase: 'approved' }), pr('b', { phase: 'awaiting_rereview' })], REVIEW_PHASE_ORDER)).toBe('awaiting_rereview')
    expect(unitPhase([pr('a', { phase: 'approved' }), pr('b', { phase: 'approved' })], REVIEW_PHASE_ORDER)).toBe('approved')
    expect(unitPhase([pr('a', { phase: 'pending_changes' }), pr('b', { phase: 'in_progress' })], REVIEW_PHASE_ORDER)).toBe('in_progress')
  })
})

describe('unitHide', () => {
  it('hides a unit only while every member is hidden', () => {
    const hide = { mode: 'snooze' as const, at: '2026-10-03T00:00:00Z' }
    expect(unitHide([pr('a', { hidden: hide }), pr('b', { hidden: hide })])).toEqual(hide)
    expect(unitHide([pr('a', { hidden: hide }), pr('b')])).toBeNull()
  })
})

describe('groupIntoUnits', () => {
  it('builds one unit per linked group, led by its first listed member, with aggregate sort fields', () => {
    const api = pr('api', { linkedPrs: ['acme/web#1'], createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', additions: 10 })
    const solo = pr('solo')
    const web = pr('web', { linkedPrs: ['acme/api#1'], companion: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', deletions: 5 })

    const units = groupIntoUnits([api, solo, web], REVIEW_PHASE_ORDER)

    expect(units.map((u) => u.members.map((m) => m.repo))).toEqual([['api', 'web'], ['solo']])
    expect(units[0]).toMatchObject({ key: 'acme/api#1', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', size: 17 })
  })

  it('ignores a linked key that is not in the list', () => {
    const units = groupIntoUnits([pr('api', { linkedPrs: ['acme/gone#1'] })], REVIEW_PHASE_ORDER)
    expect(units.map((u) => u.members.length)).toEqual([1])
  })
})

describe('unitMembers', () => {
  it('returns the PR first, then its linked PRs in list order', () => {
    const prs = [pr('api', { linkedPrs: ['acme/web#1'] }), pr('solo'), pr('web', { linkedPrs: ['acme/api#1'] })]
    expect(unitMembers(prs, prs[2]).map((m) => m.repo)).toEqual(['web', 'api'])
  })
})
