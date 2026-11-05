import { EventEmitter } from 'node:events'
import { headKey, prKey, type HideMode, type MyReview, type Pr, type PrListState, type SessionStatus, type StoredHide } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { summarizePr } from './claude/summarize'
import { computePhase } from './github/phase'
import { fetchPr, searchPrs, type GithubPr } from './github/queries'
import { buildSearchQueries } from './github/search'
import { isHideActive, keepsUnlistedHide, newHide, refreshHide } from './hiddenPrs'
import { configFile, headsSeenFile, hiddenPrsFile, prCacheFile, rallyReviewsFile, summariesFile } from './store'

const SUMMARY_CONCURRENCY = 3

type ReviewStatusLookup = (key: string) => SessionStatus | null

function withRallyRepliesCounted(reviews: MyReview[], rallyReviewIds: number[]): MyReview[] {
  return reviews.map((r) => (r.replyOnly && r.databaseId !== null && rallyReviewIds.includes(r.databaseId) ? { ...r, replyOnly: false } : r))
}

class PrList extends EventEmitter {
  private state: PrListState
  private timer: NodeJS.Timeout | null = null
  private summarizing = new Set<string>()
  private summaryErrors = new Map<string, string>()
  private reviewStatusOf: ReviewStatusLookup = () => null

  constructor() {
    super()
    const cache = prCacheFile.get()
    this.state = { prs: this.withHidden(cache.prs), viewer: cache.viewer, refreshedAt: cache.refreshedAt, refreshing: false, error: null }
  }

  get(): PrListState {
    return this.state
  }

  start(): void {
    this.schedule()
    void this.refresh()
  }

  schedule(): void {
    if (this.timer) clearInterval(this.timer)
    const minutes = Math.max(1, configFile.get().pollIntervalMinutes)
    this.timer = setInterval(() => void this.refresh(), minutes * 60_000)
  }

  setReviewStatusLookup(lookup: ReviewStatusLookup): void {
    this.reviewStatusOf = lookup
    this.reapplyPhases()
  }

  recordRallyReview(key: string, reviewId: number): void {
    const recorded = rallyReviewsFile.get()
    const ids = recorded[key] ?? []
    if (!ids.includes(reviewId)) rallyReviewsFile.set({ ...recorded, [key]: [...ids, reviewId] })
  }

  reapplyPhases(): void {
    const prs = this.withHidden(this.withPhases(this.state.prs, false))
    const changed = prs.some(
      (pr, i) =>
        pr.phase !== this.state.prs[i].phase ||
        pr.reviewStatus !== this.state.prs[i].reviewStatus ||
        pr.hidden?.mode !== this.state.prs[i].hidden?.mode,
    )
    if (changed) this.update({ prs })
  }

  async refresh(): Promise<void> {
    if (this.state.refreshing) return
    this.update({ refreshing: true, error: null })
    try {
      const { viewer, prs } = await searchPrs(buildSearchQueries(configFile.get()))
      const refreshedAt = new Date().toISOString()
      this.update({ prs: this.decorate(prs, true), viewer, refreshedAt, refreshing: false })
      prCacheFile.set({ viewer, refreshedAt, prs: this.state.prs })
      void this.fillSummaries()
    } catch (error) {
      this.update({ refreshing: false, error: errorMessage(error) })
    }
  }

  async refreshOne(owner: string, repo: string, number: number): Promise<void> {
    const [fresh] = this.decorate([await fetchPr(owner, repo, number)], false)
    const prs = this.state.prs.some((p) => p.id === fresh.id)
      ? this.state.prs.map((p) => (p.id === fresh.id ? fresh : p))
      : [...this.state.prs, fresh]
    this.update({ prs })
    prCacheFile.set({ viewer: this.state.viewer, refreshedAt: this.state.refreshedAt, prs })
  }

  hide(id: string, mode: HideMode): void {
    const pr = this.state.prs.find((p) => p.id === id)
    if (!pr) throw new Error('This PR is no longer in the list. Refresh and try again.')
    hiddenPrsFile.set({ ...hiddenPrsFile.get(), [id]: newHide(pr, mode, new Date().toISOString()) })
    this.reapplyHidden()
  }

  unhide(id: string): void {
    const { [id]: _removed, ...rest } = hiddenPrsFile.get()
    hiddenPrsFile.set(rest)
    this.reapplyHidden()
  }

  private reapplyHidden(): void {
    this.update({ prs: this.withHidden(this.state.prs) })
  }

  private decorate(prs: GithubPr[], prune: boolean): Pr[] {
    this.syncHides(prs, prune)
    return this.withHidden(this.withPhases(this.withSummaries(this.withHeadTimes(prs, prune), prune), prune))
  }

  private syncHides(prs: GithubPr[], prune: boolean): void {
    const now = new Date().toISOString()
    const stored = hiddenPrsFile.get()
    const listed = new Set(prs.map((pr) => pr.id))
    const kept: Record<string, StoredHide> = Object.fromEntries(
      Object.entries(stored).filter(([id, hide]) => !listed.has(id) && (!prune || keepsUnlistedHide(hide, now))),
    )
    for (const pr of prs) {
      const hide = stored[pr.id] && refreshHide(stored[pr.id], pr, now)
      if (hide) kept[pr.id] = hide
    }
    if (JSON.stringify(kept) !== JSON.stringify(stored)) hiddenPrsFile.set(kept)
  }

  private withHidden(prs: Omit<Pr, 'hidden'>[]): Pr[] {
    const stored = hiddenPrsFile.get()
    return prs.map((pr) => {
      const hide = stored[pr.id]
      const shown = !hide || !isHideActive(hide, pr) || pr.phase === 'in_progress'
      return { ...pr, hidden: shown ? null : { mode: hide.mode, at: hide.at } }
    })
  }

  private withHeadTimes(prs: GithubPr[], prune: boolean): (GithubPr & { headKnownSince: string })[] {
    const seen = headsSeenFile.get()
    const now = new Date().toISOString()
    const recorded: Record<string, string> = prune ? {} : { ...seen }
    const result = prs.map((pr) => {
      const key = headKey(pr)
      const firstSeen = seen[key] ?? now
      recorded[key] = firstSeen
      const headKnownSince = pr.headForcePushedAt && pr.headForcePushedAt < firstSeen ? pr.headForcePushedAt : firstSeen
      return { ...pr, headKnownSince }
    })
    headsSeenFile.set(recorded)
    return result
  }

  private withPhases(prs: Omit<Pr, 'phase' | 'reviewStatus' | 'hidden'>[], prune: boolean): Omit<Pr, 'hidden'>[] {
    const rallyReviews = rallyReviewsFile.get()
    if (prune) {
      const current = new Set(prs.map((pr) => prKey(pr.owner, pr.repo, pr.number)))
      rallyReviewsFile.set(Object.fromEntries(Object.entries(rallyReviews).filter(([key]) => current.has(key))))
    }
    return prs.map((pr) => {
      const key = prKey(pr.owner, pr.repo, pr.number)
      const reviewStatus = this.reviewStatusOf(key)
      const reviewInProgress = reviewStatus !== null && reviewStatus !== 'submitted'
      const myReviews = withRallyRepliesCounted(pr.myReviews, rallyReviews[key] ?? [])
      return { ...pr, reviewStatus, phase: computePhase({ ...pr, myReviews, reviewInProgress }) }
    })
  }

  private withSummaries<T extends GithubPr>(
    prs: T[],
    prune: boolean,
  ): (T & { summary: string | null; summaryError: string | null })[] {
    const summaries = summariesFile.get()
    if (prune) {
      const current = new Set(prs.map(headKey))
      summariesFile.set(Object.fromEntries(Object.entries(summaries).filter(([key]) => current.has(key))))
      for (const key of this.summaryErrors.keys()) if (!current.has(key)) this.summaryErrors.delete(key)
    }
    return prs.map((pr) => ({
      ...pr,
      summary: summaries[headKey(pr)] ?? null,
      summaryError: this.summaryErrors.get(headKey(pr)) ?? null,
    }))
  }

  private async fillSummaries(): Promise<void> {
    const pending = this.state.prs.filter((pr) => !pr.summary && !this.summarizing.has(headKey(pr)))
    const workers = Array.from({ length: SUMMARY_CONCURRENCY }, async () => {
      for (let pr = pending.shift(); pr; pr = pending.shift()) {
        const key = headKey(pr)
        this.summarizing.add(key)
        try {
          const summary = await summarizePr(pr)
          summariesFile.set({ ...summariesFile.get(), [key]: summary })
          this.summaryErrors.delete(key)
          this.patchByHead(key, { summary, summaryError: null })
        } catch (error) {
          const summaryError = errorMessage(error)
          this.summaryErrors.set(key, summaryError)
          this.patchByHead(key, { summaryError })
          console.error('PR summary failed', { pr: pr.url, error })
        } finally {
          this.summarizing.delete(key)
        }
      }
    })
    await Promise.all(workers)
    prCacheFile.set({ viewer: this.state.viewer, refreshedAt: this.state.refreshedAt, prs: this.state.prs })
  }

  private patchByHead(key: string, patch: Partial<Pr>): void {
    this.update({ prs: this.state.prs.map((p) => (headKey(p) === key ? { ...p, ...patch } : p)) })
  }

  private update(patch: Partial<PrListState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('changed', this.state)
  }
}

export const prList = new PrList()
