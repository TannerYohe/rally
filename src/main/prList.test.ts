import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubPr } from './github/queries'

const mocks = vi.hoisted(() => {
  const file = <T>(initial: T) => {
    let value = initial
    return { get: () => value, set: (next: T) => void (value = next) }
  }
  return {
    store: {
      configFile: file({ pollIntervalMinutes: 5, linkMarkers: ['linked PR'] }),
      prCacheFile: file({ viewer: null, refreshedAt: null, prs: [] }),
      summariesFile: file<Record<string, string>>({}),
      headsSeenFile: file<Record<string, string>>({}),
      hiddenPrsFile: file<Record<string, unknown>>({}),
      rallyReviewsFile: file<Record<string, number[]>>({}),
      prLinksFile: file<{ linked: [string, string][]; unlinked: [string, string][]; lastListedAt?: Record<string, string> }>({ linked: [], unlinked: [] }),
      authoredPrCacheFile: file({ viewer: null, refreshedAt: null, prs: [] }),
      authoredSummariesFile: file<Record<string, string>>({}),
      authoredHeadsSeenFile: file<Record<string, string>>({}),
      authoredHiddenPrsFile: file<Record<string, unknown>>({}),
    },
    searchPrs: vi.fn(),
    fetchPrs: vi.fn(),
    summarizePr: vi.fn(),
  }
})

vi.mock('./store', () => mocks.store)
vi.mock('./github/queries', () => ({ searchPrs: mocks.searchPrs, fetchPrs: mocks.fetchPrs }))
vi.mock('./github/search', () => ({ buildSearchQueries: () => ['query'], AUTHORED_SEARCH_QUERIES: ['authored'] }))
vi.mock('./claude/summarize', () => ({ summarizePr: mocks.summarizePr }))

const { authoredPrList, prList } = await import('./prList')
const { newHide, UNLISTED_RETENTION_DAYS } = await import('./hiddenPrs')

const fetched = (...prs: GithubPr[]) => ({ viewer: 'me', lookups: prs.map((pr) => ({ status: 'found' as const, pr })) })

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
    feedback: null,
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
    mocks.store.prLinksFile.set({ linked: [], unlinked: [] })
    mocks.store.configFile.set({ pollIntervalMinutes: 5, linkMarkers: ['linked PR'] })
    mocks.fetchPrs.mockReset()
    mocks.fetchPrs.mockResolvedValue({ viewer: 'me', lookups: [] })
    prList.setSessionLookup(() => null)
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
    mocks.fetchPrs.mockResolvedValue(fetched(githubPr()))
    await prList.refreshOne('acme', 'api', 1)
    expect(mocks.store.summariesFile.get()).toEqual({ 'pr1:old': 'stale', 'other:h': 'other' })
  })

  it('keeps a PR refreshed during a full refresh instead of the older search result', async () => {
    let finishSearch: (value: unknown) => void = () => {}
    mocks.searchPrs.mockReturnValue(new Promise((resolve) => (finishSearch = resolve)))
    const refreshing = prList.refresh()
    mocks.fetchPrs.mockResolvedValue(fetched(githubPr({ title: 'Fresh' })))
    await prList.refreshOne('acme', 'api', 1)
    finishSearch({ viewer: 'me', prs: [githubPr({ title: 'Stale' }), githubPr({ id: 'pr2', number: 2 })] })
    await refreshing
    expect(prList.get().prs.map((pr) => pr.title)).toEqual(['Fresh', 'Change'])
  })

  it('uses the search result over a PR refreshed before the full refresh started', async () => {
    mocks.fetchPrs.mockResolvedValue(fetched(githubPr({ title: 'Older' })))
    await prList.refreshOne('acme', 'api', 1)
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ title: 'Newer' })] })
    await prList.refresh()
    expect(prList.get().prs.map((pr) => pr.title)).toEqual(['Newer'])
  })

  it('hides a PR until it is unhidden', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    prList.hide(['pr1'], 'indefinite')
    expect(prList.get().prs[0].hidden).toMatchObject({ mode: 'indefinite' })

    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ headRefOid: 'newer' })] })
    await prList.refresh()
    expect(prList.get().prs[0].hidden).toMatchObject({ mode: 'indefinite' })

    prList.unhide(['pr1'])
    expect(prList.get().prs[0].hidden).toBeNull()
    expect(mocks.store.hiddenPrsFile.get()).toEqual({})
  })

  it('ends a snooze when the PR gets new commits', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    prList.hide(['pr1'], 'snooze')
    await prList.refresh()
    expect(prList.get().prs[0].hidden).toMatchObject({ mode: 'snooze' })

    mocks.fetchPrs.mockResolvedValue(fetched(githubPr({ headRefOid: 'newer' })))
    await prList.refreshOne('acme', 'api', 1)
    expect(prList.get().prs[0].hidden).toBeNull()
    expect(mocks.store.hiddenPrsFile.get()).toEqual({})
  })

  it('keeps other hides when refreshing one PR', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr(), githubPr({ id: 'pr2', number: 2 })] })
    await prList.refresh()
    prList.hide(['pr2'], 'snooze')

    mocks.fetchPrs.mockResolvedValue(fetched(githubPr()))
    await prList.refreshOne('acme', 'api', 1)
    expect(Object.keys(mocks.store.hiddenPrsFile.get())).toEqual(['pr2'])
  })

  it('drops snoozes for unlisted PRs on a full refresh and keeps recent indefinite hides', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr(), githubPr({ id: 'pr2', number: 2 })] })
    await prList.refresh()
    prList.hide(['pr1'], 'snooze')
    prList.hide(['pr2'], 'indefinite')

    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [] })
    await prList.refresh()
    expect(Object.keys(mocks.store.hiddenPrsFile.get())).toEqual(['pr2'])
  })

  it('ages out indefinite hides for PRs unlisted past the retention window', async () => {
    const lastListedAt = new Date(Date.now() - (UNLISTED_RETENTION_DAYS + 1) * 24 * 60 * 60_000).toISOString()
    mocks.store.hiddenPrsFile.set({ gone: newHide(githubPr(), 'indefinite', lastListedAt) })
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [] })
    await prList.refresh()
    expect(mocks.store.hiddenPrsFile.get()).toEqual({})
  })

  it('ends a snooze on a re-request after the request it was taken under cleared', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ reviewRequestedFromMe: true })] })
    await prList.refresh()
    prList.hide(['pr1'], 'snooze')

    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    expect(prList.get().prs[0].hidden).toMatchObject({ mode: 'snooze' })

    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ reviewRequestedFromMe: true })] })
    await prList.refresh()
    expect(prList.get().prs[0].hidden).toBeNull()
  })

  it('does not write hides when review status changes', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    prList.hide(['pr1'], 'indefinite')
    const write = vi.spyOn(mocks.store.hiddenPrsFile, 'set')

    prList.reapplyPhases()
    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
  })

  it('shows a hidden PR while its review is in progress', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr()] })
    await prList.refresh()
    prList.hide(['pr1'], 'indefinite')

    prList.setSessionLookup(() => ({ status: 'awaiting_feedback', active: true, openFindings: 0 }))
    expect(prList.get().prs[0].hidden).toBeNull()

    prList.setSessionLookup(() => null)
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

  it('computes author phases for the authored list from its own query', async () => {
    const feedback = { reviewDecision: null, openThreads: 1, unacknowledged: 1, changesRequestedBy: [], approvedBy: [], truncated: false }
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ author: 'me', feedback })] })
    authoredPrList.setSessionLookup(() => null)
    await authoredPrList.refresh()
    expect(mocks.searchPrs).toHaveBeenLastCalledWith(['authored'], 'authored')
    expect(authoredPrList.get().prs[0].phase).toBe('needs_response')

    authoredPrList.setSessionLookup(() => ({ status: 'awaiting_feedback', active: true, openFindings: 0 }))
    expect(authoredPrList.get().prs[0].phase).toBe('in_progress')
    expect(mocks.store.authoredPrCacheFile.get().prs).toHaveLength(1)
  })

  it('needs a response while a self-review finding is open, and counts the findings on the PR', async () => {
    const feedback = { reviewDecision: 'APPROVED' as const, openThreads: 0, unacknowledged: 0, changesRequestedBy: [], approvedBy: ['bob'], truncated: false }
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ author: 'me', feedback })] })
    authoredPrList.setSessionLookup(() => null)
    await authoredPrList.refresh()
    expect(authoredPrList.get().prs[0]).toMatchObject({ phase: 'approved', openFindings: 0 })

    authoredPrList.setSessionLookup(() => ({ status: 'awaiting_feedback', active: false, openFindings: 2 }))
    expect(authoredPrList.get().prs[0]).toMatchObject({ phase: 'needs_response', openFindings: 2 })

    authoredPrList.setSessionLookup(() => ({ status: 'awaiting_feedback', active: false, openFindings: 1 }))
    expect(authoredPrList.get().prs[0]).toMatchObject({ phase: 'needs_response', openFindings: 1 })
  })

  it('refreshes each list without touching the files of the other list', async () => {
    const reviewingFiles = ['prCacheFile', 'summariesFile', 'headsSeenFile', 'hiddenPrsFile', 'rallyReviewsFile'] as const
    const authoredFiles = ['authoredPrCacheFile', 'authoredSummariesFile', 'authoredHeadsSeenFile', 'authoredHiddenPrsFile'] as const
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ id: 'mine', author: 'me' })] })

    const reviewingWrites = reviewingFiles.map((name) => vi.spyOn(mocks.store[name], 'set'))
    await authoredPrList.refresh()
    await vi.waitFor(() => expect(mocks.store.authoredPrCacheFile.get().prs[0]).toMatchObject({ summary: 'A summary' }))
    for (const write of reviewingWrites) expect(write).not.toHaveBeenCalled()
    for (const write of reviewingWrites) write.mockRestore()

    const authoredWrites = authoredFiles.map((name) => vi.spyOn(mocks.store[name], 'set'))
    await prList.refresh()
    await vi.waitFor(() => expect(mocks.store.prCacheFile.get().prs[0]).toMatchObject({ summary: 'A summary' }))
    for (const write of authoredWrites) expect(write).not.toHaveBeenCalled()
    for (const write of authoredWrites) write.mockRestore()
  })

  it('passes the PRs a full refresh listed to each pruner, but not on a single-PR refresh', async () => {
    mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [githubPr({ number: 7 })] })
    const pruner = vi.fn()
    authoredPrList.addPruner(pruner)
    await authoredPrList.refresh()
    expect(pruner).toHaveBeenCalledWith(new Set(['acme/api#7']))

    mocks.fetchPrs.mockResolvedValue(fetched(githubPr({ number: 7 })))
    await authoredPrList.refreshOne('acme', 'api', 7)
    expect(pruner).toHaveBeenCalledTimes(1)
  })

  describe('units', () => {
    const api = (overrides: Partial<GithubPr> = {}) => githubPr({ body: 'Linked PR: acme/web#2', ...overrides })
    const web = (overrides: Partial<GithubPr> = {}) =>
      githubPr({ id: 'pr2', number: 2, repo: 'web', url: 'https://github.com/acme/web/pull/2', body: 'Linked PR: acme/api#1', ...overrides })

    it('links PRs that list each other and survives a single-PR refresh', async () => {
      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api(), web()] })
      await prList.refresh()
      expect(prList.get().prs.map((pr) => pr.linkedPrs)).toEqual([['acme/web#2'], ['acme/api#1']])

      mocks.fetchPrs.mockResolvedValue(fetched(web({ title: 'Fresh' })))
      await prList.refreshOne('acme', 'web', 2)
      expect(prList.get().prs.map((pr) => pr.linkedPrs)).toEqual([['acme/web#2'], ['acme/api#1']])
    })

    it('regroups when the link markers change', async () => {
      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api(), web()] })
      await prList.refresh()
      expect(prList.get().prs.map((pr) => pr.linkedPrs)).toEqual([['acme/web#2'], ['acme/api#1']])

      mocks.store.configFile.set({ ...mocks.store.configFile.get(), linkMarkers: ['depends on'] })
      prList.reapplyPhases()
      expect(prList.get().prs.map((pr) => pr.linkedPrs)).toEqual([undefined, undefined])
    })

    it('flags a one-sided link and leaves both PRs on their own', async () => {
      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api(), web({ body: '' })] })
      await prList.refresh()
      const [first, second] = prList.get().prs
      expect(first.linkedPrs).toBeUndefined()
      expect(first.unreciprocatedLinks).toEqual([{ owner: 'acme', repo: 'web', number: 2, url: 'https://github.com/acme/web/pull/2' }])
      expect(second.unreciprocatedLinks).toBeUndefined()
    })

    it('splits a unit that was unlinked by hand', async () => {
      mocks.store.prLinksFile.set({ linked: [], unlinked: [['acme/web#2', 'acme/api#1']] })
      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api(), web()] })
      await prList.refresh()
      expect(prList.get().prs.map((pr) => pr.linkedPrs)).toEqual([undefined, undefined])
    })

    it('does not link the authored list', async () => {
      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ author: 'me' }), web({ author: 'me' })] })
      authoredPrList.setSessionLookup(() => null)
      await authoredPrList.refresh()
      expect(authoredPrList.get().prs.map((pr) => pr.linkedPrs)).toEqual([undefined, undefined])
    })

    it('hides a unit together and shows it again as soon as one member shows', async () => {
      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api(), web()] })
      await prList.refresh()
      prList.hide(['pr1', 'pr2'], 'snooze')
      expect(prList.get().prs.map((pr) => pr.hidden?.mode)).toEqual(['snooze', 'snooze'])

      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api(), web({ headRefOid: 'newer' })] })
      await prList.refresh()
      expect(prList.get().prs.map((pr) => pr.hidden)).toEqual([null, null])
      expect(Object.keys(mocks.store.hiddenPrsFile.get())).toEqual(['pr1'])
    })

    it("restores a PR's own hide when it is unlinked from a unit that showed it", async () => {
      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api(), web()] })
      await prList.refresh()
      mocks.store.hiddenPrsFile.set({ pr1: newHide(api(), 'indefinite', new Date().toISOString()) })
      prList.reapplyPhases()
      expect(prList.get().prs.map((pr) => pr.hidden)).toEqual([null, null])

      prList.unlink('acme/web#2', ['acme/api#1'])
      expect(prList.get().prs.map((pr) => pr.hidden?.mode)).toEqual(['indefinite', undefined])
    })

    it("restores a PR's own hide when a single-PR refresh splits its unit", async () => {
      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api(), web()] })
      await prList.refresh()
      mocks.store.hiddenPrsFile.set({ pr1: newHide(api(), 'indefinite', new Date().toISOString()) })
      prList.reapplyPhases()

      mocks.fetchPrs.mockResolvedValueOnce(fetched(web({ body: '' })))
      await prList.refreshOne('acme', 'web', 2)
      expect(prList.get().prs.map((pr) => pr.hidden?.mode)).toEqual(['indefinite', undefined])
    })

    it('shows every member while one member has a review in progress', async () => {
      mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api(), web()] })
      await prList.refresh()
      prList.hide(['pr1', 'pr2'], 'indefinite')

      prList.setSessionLookup((key) => (key === 'acme/api#1' ? { status: 'awaiting_feedback', active: true, openFindings: 0 } : null))
      expect(prList.get().prs.map((pr) => pr.hidden)).toEqual([null, null])
    })
  
    describe('companions', () => {
      const worker = (overrides: Partial<GithubPr> = {}) =>
        githubPr({ id: 'pr3', number: 3, repo: 'worker', url: 'https://github.com/acme/worker/pull/3', body: 'Linked PR: acme/web#2', ...overrides })
      const found = (pr: GithubPr) => ({ status: 'found' as const, pr })

      it('fetches a mutually linked PR outside the list as a full member, kept through pruners', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api()] })
        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [found(web())] })
        const pruner = vi.fn()
        prList.addPruner(pruner)
        mocks.store.summariesFile.set({ 'pr2:new': 'web summary' })

        await prList.refresh()

        expect(mocks.fetchPrs).toHaveBeenCalledWith([{ owner: 'acme', repo: 'web', number: 2 }], 'reviewing')
        expect(prList.get().prs.map((pr) => [pr.repo, pr.companion, pr.linkedPrs])).toEqual([
          ['api', undefined, ['acme/web#2']],
          ['web', true, ['acme/api#1']],
        ])
        expect(pruner).toHaveBeenCalledWith(new Set(['acme/api#1', 'acme/web#2']))
        expect(mocks.store.summariesFile.get()).toMatchObject({ 'pr2:new': 'web summary' })
      })

      it('follows mutual links for more rounds', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api()] })
        mocks.fetchPrs
          .mockResolvedValueOnce({ viewer: 'me', lookups: [found(web({ body: 'Linked PRs: acme/api#1 acme/worker#3' }))] })
          .mockResolvedValueOnce({ viewer: 'me', lookups: [found(worker())] })

        await prList.refresh()

        expect(mocks.fetchPrs).toHaveBeenCalledTimes(2)
        expect(prList.get().prs.map((pr) => pr.repo)).toEqual(['api', 'web', 'worker'])
      })

      it('stops following links after three fetch rounds', async () => {
        const docs = githubPr({ id: 'pr4', number: 4, repo: 'docs', url: 'https://github.com/acme/docs/pull/4', body: 'Linked PRs: acme/worker#3 acme/extra#5' })
        const extra = githubPr({ id: 'pr5', number: 5, repo: 'extra', url: 'https://github.com/acme/extra/pull/5', body: 'Linked PR: acme/docs#4' })
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api()] })
        mocks.fetchPrs
          .mockResolvedValueOnce({ viewer: 'me', lookups: [found(web({ body: 'Linked PRs: acme/api#1 acme/worker#3' }))] })
          .mockResolvedValueOnce({ viewer: 'me', lookups: [found(worker({ body: 'Linked PRs: acme/web#2 acme/docs#4' }))] })
          .mockResolvedValueOnce({ viewer: 'me', lookups: [found(docs)] })
          .mockResolvedValueOnce({ viewer: 'me', lookups: [found(extra)] })

        await prList.refresh()

        expect(mocks.fetchPrs).toHaveBeenCalledTimes(3)
        expect(prList.get().prs.map((pr) => pr.repo)).toEqual(['api', 'web', 'worker', 'docs'])
      })

      it('does not follow the links of a PR that only one side lists', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api()] })
        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [found(web({ body: 'Linked PR: acme/worker#3' }))] })

        await prList.refresh()

        expect(mocks.fetchPrs).toHaveBeenCalledTimes(1)
        expect(prList.get().prs.map((pr) => pr.repo)).toEqual(['api'])
        expect(prList.get().prs[0].unreciprocatedLinks).toEqual([{ owner: 'acme', repo: 'web', number: 2, url: 'https://github.com/acme/web/pull/2' }])
      })

      it('does not group a link target that is gone or mine', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ body: 'Linked PRs: acme/web#2 acme/worker#3' })] })
        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [{ status: 'gone' }, found(worker({ author: 'ME', body: 'Linked PR: acme/api#1' }))] })

        await prList.refresh()

        expect(prList.get().prs.map((pr) => pr.repo)).toEqual(['api'])
        expect(prList.get().prs[0].unreciprocatedLinks).toBeUndefined()
      })

      it('keeps the previous copy of a companion whose lookup failed, and drops one that closed', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api()] })
        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [found(web({ title: 'Before' }))] })
        await prList.refresh()

        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [{ status: 'unknown' }] })
        await prList.refresh()
        expect(prList.get().prs.map((pr) => pr.title)).toEqual(['Change', 'Before'])

        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [{ status: 'gone' }] })
        await prList.refresh()
        expect(prList.get().prs.map((pr) => pr.repo)).toEqual(['api'])
      })

      it('applies the search and keeps previous companions when the companion lookup fails outright', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api()] })
        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [found(web({ title: 'Before' }))] })
        await prList.refresh()

        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ title: 'Searched' })] })
        mocks.fetchPrs.mockRejectedValueOnce(new Error('rate limited'))
        await prList.refresh()

        expect(prList.get().error).toBeNull()
        expect(prList.get().prs.map((pr) => pr.title)).toEqual(['Searched', 'Before'])
        expect(warn).toHaveBeenCalledWith('Fetching linked PRs failed', expect.objectContaining({ prs: ['acme/web#2'] }))
      })

      it('fetches a PR linked by hand', async () => {
        mocks.store.prLinksFile.set({ linked: [['acme/api#1', 'acme/web#2']], unlinked: [] })
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ body: '' })] })
        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [found(web({ body: '' }))] })

        await prList.refresh()

        expect(prList.get().prs.map((pr) => pr.linkedPrs)).toEqual([['acme/web#2'], ['acme/api#1']])
      })

      it('refreshes every member together in one update and keeps the companion', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api()] })
        mocks.fetchPrs.mockResolvedValueOnce(fetched(web()))
        await prList.refresh()
        const changed = vi.fn()
        prList.on('changed', changed)

        mocks.fetchPrs.mockResolvedValueOnce(fetched(api({ title: 'API fresh' }), web({ title: 'Web fresh' })))
        await prList.refreshMany([{ owner: 'acme', repo: 'api', number: 1 }, { owner: 'acme', repo: 'web', number: 2 }])
        prList.off('changed', changed)

        expect(changed).toHaveBeenCalledTimes(1)
        expect(prList.get().prs.map((pr) => [pr.title, pr.companion, pr.linkedPrs])).toEqual([
          ['API fresh', undefined, ['acme/web#2']],
          ['Web fresh', true, ['acme/api#1']],
        ])
      })

      it('does not list a PR that left the unit when refreshing members', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api()] })
        mocks.fetchPrs.mockResolvedValueOnce(fetched(web()))
        await prList.refresh()
        prList.unlink('acme/web#2', ['acme/api#1'])

        mocks.fetchPrs.mockResolvedValueOnce(fetched(api(), web()))
        await prList.refreshMany([{ owner: 'acme', repo: 'api', number: 1 }, { owner: 'acme', repo: 'web', number: 2 }])

        expect(prList.get().prs.map((pr) => pr.repo)).toEqual(['api'])
      })

      it('drops a PR that closed and keeps one whose lookup failed when refreshing members', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ body: '' }), web({ body: '' })] })
        await prList.refresh()

        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [{ status: 'gone' }, { status: 'unknown' }] })
        await prList.refreshMany([{ owner: 'acme', repo: 'api', number: 1 }, { owner: 'acme', repo: 'web', number: 2 }])

        expect(prList.get().prs.map((pr) => pr.repo)).toEqual(['web'])
      })

      it('links a PR outside the list by hand and fetches it as a companion', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ body: '' })] })
        await prList.refresh()
        mocks.fetchPrs.mockResolvedValueOnce(fetched(web({ body: '', owner: 'Acme' }))).mockResolvedValueOnce(fetched(web({ body: '', owner: 'Acme' })))

        await prList.link('acme/api#1', { owner: 'acme', repo: 'WEB', number: 2 })

        expect(mocks.store.prLinksFile.get()).toMatchObject({ linked: [['acme/api#1', 'Acme/web#2']], unlinked: [] })
        expect(prList.get().prs.map((pr) => pr.linkedPrs)).toEqual([['Acme/web#2'], ['acme/api#1']])
      })

      it('refreshes again when a link lands during a refresh', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ body: '' }), web({ body: '' })] })
        await prList.refresh()
        let finishSearch: (value: unknown) => void = () => {}
        mocks.searchPrs.mockReturnValueOnce(new Promise((resolve) => (finishSearch = resolve)))
        const refreshing = prList.refresh()

        await prList.link('acme/api#1', { owner: 'acme', repo: 'web', number: 2 })
        finishSearch({ viewer: 'me', prs: [api({ body: '' }), web({ body: '' })] })
        await refreshing

        expect(mocks.searchPrs).toHaveBeenCalledTimes(3)
        expect(prList.get().prs.map((pr) => pr.linkedPrs)).toEqual([['acme/web#2'], ['acme/api#1']])
      })

      it('refuses to link my own PR or one that is closed', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ body: '' })] })
        await prList.refresh()
        mocks.fetchPrs.mockResolvedValueOnce(fetched(web({ author: 'me' })))
        await expect(prList.link('acme/api#1', { owner: 'acme', repo: 'web', number: 2 })).rejects.toThrow('That PR is yours')
        mocks.fetchPrs.mockResolvedValueOnce({ viewer: 'me', lookups: [{ status: 'gone' }] })
        await expect(prList.link('acme/api#1', { owner: 'acme', repo: 'web', number: 2 })).rejects.toThrow('closed, merged, or not visible')
        expect(mocks.store.prLinksFile.get()).toMatchObject({ linked: [], unlinked: [] })
      })

      it('unlinks a PR from the rest of its unit and drops a companion that no longer joins one', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api()] })
        mocks.fetchPrs.mockResolvedValueOnce(fetched(web()))
        await prList.refresh()

        prList.unlink('acme/web#2', ['acme/api#1'])

        expect(mocks.store.prLinksFile.get()).toMatchObject({ linked: [], unlinked: [['acme/web#2', 'acme/api#1']] })
        expect(prList.get().prs.map((pr) => [pr.repo, pr.linkedPrs])).toEqual([['api', undefined]])
      })

      it('keeps hand links whose PRs both left the list until the retention window passes', async () => {
        const recently = new Date().toISOString()
        const longAgo = new Date(Date.now() - (UNLISTED_RETENTION_DAYS + 1) * 24 * 60 * 60_000).toISOString()
        mocks.store.prLinksFile.set({
          linked: [['acme/api#1', 'acme/gone#9']],
          unlinked: [['acme/old#1', 'acme/gone#9'], ['acme/stale#1', 'acme/stale#2']],
          lastListedAt: { 'acme/gone#9': longAgo, 'acme/old#1': recently, 'acme/stale#1': longAgo, 'acme/stale#2': longAgo },
        })
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ body: '' })] })
        mocks.fetchPrs.mockResolvedValue({ viewer: 'me', lookups: [{ status: 'gone' }] })
        await prList.refresh()
        expect(mocks.store.prLinksFile.get()).toMatchObject({
          linked: [['acme/api#1', 'acme/gone#9']],
          unlinked: [['acme/old#1', 'acme/gone#9']],
          lastListedAt: { 'acme/gone#9': longAgo, 'acme/old#1': recently },
        })
        expect(mocks.store.prLinksFile.get().lastListedAt?.['acme/api#1']).toBeDefined()
      })

      it('does not rewrite hand links when a listed PR was stamped within the last day', async () => {
        const recently = new Date().toISOString()
        mocks.store.prLinksFile.set({ linked: [['acme/api#1', 'acme/gone#9']], unlinked: [], lastListedAt: { 'acme/api#1': recently, 'acme/gone#9': recently } })
        const stored = mocks.store.prLinksFile.get()
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ body: '' })] })
        mocks.fetchPrs.mockResolvedValue({ viewer: 'me', lookups: [{ status: 'gone' }] })
        await prList.refresh()
        expect(mocks.store.prLinksFile.get()).toBe(stored)
      })

      it('never fetches companions for the authored list', async () => {
        mocks.searchPrs.mockResolvedValue({ viewer: 'me', prs: [api({ author: 'me' })] })
        await authoredPrList.refresh()
        expect(mocks.fetchPrs).not.toHaveBeenCalled()
      })
    })
  })
})
