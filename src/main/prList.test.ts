import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubPr } from './github/queries'

const mocks = vi.hoisted(() => {
  const file = <T>(initial: T) => {
    let value = initial
    return { get: () => value, set: (next: T) => void (value = next) }
  }
  return {
    store: {
      configFile: file({ pollIntervalMinutes: 5 }),
      prCacheFile: file({ viewer: null, refreshedAt: null, prs: [] }),
      summariesFile: file<Record<string, string>>({}),
      headsSeenFile: file<Record<string, string>>({}),
      hiddenPrsFile: file<Record<string, unknown>>({}),
      rallyReviewsFile: file<Record<string, number[]>>({}),
    },
    searchPrs: vi.fn(),
    fetchPr: vi.fn(),
    summarizePr: vi.fn(),
  }
})

vi.mock('./store', () => mocks.store)
vi.mock('./github/queries', () => ({ searchPrs: mocks.searchPrs, fetchPr: mocks.fetchPr }))
vi.mock('./github/search', () => ({ buildSearchQueries: () => ['query'] }))
vi.mock('./claude/summarize', () => ({ summarizePr: mocks.summarizePr }))

const { prList } = await import('./prList')

function githubPr(overrides: Partial<GithubPr> = {}): GithubPr {
  return {
    id: 'pr1',
    number: 1,
    owner: 'acme',
    repo: 'api',
    url: 'https://github.com/acme/api/pull/1',
    title: 'Change',
    body: '',
    author: 'alice',
    authorAvatarUrl: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    isDraft: false,
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    headRefOid: 'new',
    headForcePushedAt: null,
    baseRefName: 'main',
    headRefName: 'feature',
    files: [],
    reviewRequestedFromMe: false,
    myReviews: [],
    ...overrides,
  }
}

describe('prList', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.summarizePr.mockReset()
    mocks.store.hiddenPrsFile.set({})
    mocks.summarizePr.mockResolvedValue('A summary')
    mocks.store.rallyReviewsFile.set({})
    prList.setReviewStatusLookup(() => null)
  })

  it('prunes summaries for old heads and closed PRs on a full refresh', async () => {
    mocks.store.summariesFile.set({ 'pr1:old': 'stale', 'pr1:new': 'kept', 'closed:h': 'gone' })
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    expect(mocks.store.summariesFile.get()).toEqual({ 'pr1:new': 'kept' })
    expect(prList.get().prs[0].summary).toBe('kept')
  })

  it('keeps other summaries when refreshing one PR', async () => {
    mocks.store.summariesFile.set({ 'pr1:old': 'stale', 'other:h': 'other' })
    mocks.fetchPr.mockResolvedValue(githubPr())
    await prList.refreshOne('acme', 'api', 1)
    expect(mocks.store.summariesFile.get()).toEqual({ 'pr1:old': 'stale', 'other:h': 'other' })
  })

  it('hides a PR until it is unhidden', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    prList.hide('pr1', 'indefinite')
    expect(prList.get().prs[0].hidden).toMatchObject({ mode: 'indefinite' })

    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ headRefOid: 'newer' })] })
    await prList.refresh()
    expect(prList.get().prs[0].hidden).toMatchObject({ mode: 'indefinite' })

    prList.unhide('pr1')
    expect(prList.get().prs[0].hidden).toBeNull()
    expect(mocks.store.hiddenPrsFile.get()).toEqual({})
  })

  it('ends a snooze when the PR gets new commits', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    prList.hide('pr1', 'snooze')
    await prList.refresh()
    expect(prList.get().prs[0].hidden).toMatchObject({ mode: 'snooze' })

    mocks.fetchPr.mockResolvedValue(githubPr({ headRefOid: 'newer' }))
    await prList.refreshOne('acme', 'api', 1)
    expect(prList.get().prs[0].hidden).toBeNull()
    expect(mocks.store.hiddenPrsFile.get()).toEqual({})
  })

  it('keeps other hides when refreshing one PR', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr(), githubPr({ id: 'pr2', number: 2 })] })
    await prList.refresh()
    prList.hide('pr2', 'snooze')

    mocks.fetchPr.mockResolvedValue(githubPr())
    await prList.refreshOne('acme', 'api', 1)
    expect(Object.keys(mocks.store.hiddenPrsFile.get())).toEqual(['pr2'])
  })

  it('drops snoozes for unlisted PRs on a full refresh and keeps recent indefinite hides', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr(), githubPr({ id: 'pr2', number: 2 })] })
    await prList.refresh()
    prList.hide('pr1', 'snooze')
    prList.hide('pr2', 'indefinite')

    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [] })
    await prList.refresh()
    expect(Object.keys(mocks.store.hiddenPrsFile.get())).toEqual(['pr2'])
  })

  it('ages out indefinite hides for PRs unlisted for 30 days', async () => {
    const lastListedAt = new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString()
    const hide = { mode: 'indefinite', at: lastListedAt, headRefOid: 'new', reviewRequested: false, lastListedAt }
    mocks.store.hiddenPrsFile.set({ gone: hide })
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [] })
    await prList.refresh()
    expect(mocks.store.hiddenPrsFile.get()).toEqual({})
  })

  it('shows a hidden PR while its review is in progress', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    prList.hide('pr1', 'indefinite')

    prList.setReviewStatusLookup(() => 'awaiting_feedback')
    expect(prList.get().prs[0].hidden).toBeNull()

    prList.setReviewStatusLookup(() => null)
    expect(prList.get().prs[0].hidden).toMatchObject({ mode: 'indefinite' })
  })

  it('shows a summary error until a later summary succeeds', async () => {
    mocks.store.summariesFile.set({})
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ headRefOid: 'retry' })] })
    mocks.summarizePr.mockRejectedValueOnce(new Error('Summary failed: overloaded'))
    await prList.refresh()
    await vi.waitFor(() => expect(prList.get().prs[0].summaryError).toBe('Summary failed: overloaded'))

    await prList.refresh()
    await vi.waitFor(() => expect(prList.get().prs[0].summary).toBe('A summary'))
    expect(prList.get().prs[0].summaryError).toBeNull()
  })
  it('counts a reply-only review Rally submitted, even after its session is gone', async () => {
    const reply = { databaseId: 42, state: 'COMMENTED' as const, submittedAt: '2026-10-03T00:00:00Z', commitOid: 'new', replyOnly: true }
    const earlier = { ...reply, databaseId: 41, submittedAt: '2026-10-01T00:00:00Z', commitOid: 'old', replyOnly: false }
    mocks.store.headsSeenFile.set({ 'pr1:new': '2026-10-02T00:00:00Z' })
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ myReviews: [earlier, reply] })] })
    await prList.refresh()
    expect(prList.get().prs[0].phase).toBe('awaiting_rereview')

    prList.recordRallyReview('acme/api#1', 42)
    prList.reapplyPhases()
    expect(prList.get().prs[0].phase).toBe('pending_changes')

    await prList.refresh()
    expect(prList.get().prs[0].phase).toBe('pending_changes')
    expect(prList.get().prs[0].myReviews[1].replyOnly).toBe(true)
    expect(mocks.store.rallyReviewsFile.get()).toEqual({ 'acme/api#1': [42] })
  })

  it('keeps ignoring a reply-only review that Rally did not submit', async () => {
    const reply = { databaseId: 42, state: 'COMMENTED' as const, submittedAt: '2026-10-03T00:00:00Z', commitOid: 'new', replyOnly: true }
    const earlier = { ...reply, databaseId: 41, submittedAt: '2026-10-01T00:00:00Z', commitOid: 'old', replyOnly: false }
    mocks.store.headsSeenFile.set({ 'pr1:new': '2026-10-02T00:00:00Z' })
    mocks.store.rallyReviewsFile.set({ 'acme/api#1': [7] })
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ myReviews: [earlier, reply] })] })
    await prList.refresh()
    expect(prList.get().prs[0].phase).toBe('awaiting_rereview')
  })

  it('forgets Rally review ids for PRs that left the list on a full refresh', async () => {
    mocks.store.rallyReviewsFile.set({ 'acme/api#1': [42], 'acme/api#9': [7] })
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    expect(mocks.store.rallyReviewsFile.get()).toEqual({ 'acme/api#1': [42] })
  })
})
