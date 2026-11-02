import { EventEmitter } from 'node:events'
import { prKey, type Pr, type PrListState, type SessionStatus } from '@shared/types'
import { summarizePr, summaryCacheKey } from './claude/summarize'
import { computePhase } from './github/phase'
import { fetchPr, searchPrs } from './github/queries'
import { buildSearchQueries } from './github/search'
import { configFile, prCacheFile, summariesFile } from './store'

const SUMMARY_CONCURRENCY = 3

type ReviewStatusLookup = (key: string) => SessionStatus | null

class PrList extends EventEmitter {
  private state: PrListState
  private timer: NodeJS.Timeout | null = null
  private summarizing = new Set<string>()
  private reviewStatusOf: ReviewStatusLookup = () => null

  constructor() {
    super()
    const cache = prCacheFile.get()
    this.state = { prs: cache.prs, viewer: cache.viewer, refreshedAt: cache.refreshedAt, refreshing: false, error: null }
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
    this.reapplyReviewStatus()
  }

  reapplyReviewStatus(): void {
    const prs = this.withReviewStatus(this.state.prs)
    const changed = prs.some((pr, i) => pr.phase !== this.state.prs[i].phase || pr.reviewStatus !== this.state.prs[i].reviewStatus)
    if (changed) this.update({ prs })
  }

  async refresh(): Promise<void> {
    if (this.state.refreshing) return
    this.update({ refreshing: true, error: null })
    try {
      const { viewer, prs } = await searchPrs(buildSearchQueries(configFile.get()))
      const refreshedAt = new Date().toISOString()
      this.update({ prs: this.withReviewStatus(this.withSummaries(prs)), viewer, refreshedAt, refreshing: false })
      prCacheFile.set({ viewer, refreshedAt, prs: this.state.prs })
      void this.fillSummaries()
    } catch (error) {
      this.update({ refreshing: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  async refreshOne(owner: string, repo: string, number: number): Promise<void> {
    const [fresh] = this.withReviewStatus(this.withSummaries([await fetchPr(owner, repo, number)]))
    const prs = this.state.prs.some((p) => p.id === fresh.id)
      ? this.state.prs.map((p) => (p.id === fresh.id ? fresh : p))
      : [...this.state.prs, fresh]
    this.update({ prs })
    prCacheFile.set({ viewer: this.state.viewer, refreshedAt: this.state.refreshedAt, prs })
  }

  private withReviewStatus(prs: Pr[]): Pr[] {
    return prs.map((pr) => {
      const reviewStatus = this.reviewStatusOf(prKey(pr.owner, pr.repo, pr.number))
      const reviewInProgress = reviewStatus !== null && reviewStatus !== 'submitted'
      return { ...pr, reviewStatus, phase: computePhase({ ...pr, reviewInProgress }) }
    })
  }

  private withSummaries(prs: Pr[]): Pr[] {
    const summaries = summariesFile.get()
    return prs.map((pr) => ({ ...pr, summary: summaries[summaryCacheKey(pr)] ?? null }))
  }

  private async fillSummaries(): Promise<void> {
    const pending = this.state.prs.filter((pr) => !pr.summary && !this.summarizing.has(summaryCacheKey(pr)))
    const workers = Array.from({ length: SUMMARY_CONCURRENCY }, async () => {
      for (let pr = pending.shift(); pr; pr = pending.shift()) {
        const key = summaryCacheKey(pr)
        this.summarizing.add(key)
        try {
          const summary = await summarizePr(pr)
          summariesFile.set({ ...summariesFile.get(), [key]: summary })
          this.update({ prs: this.state.prs.map((p) => (summaryCacheKey(p) === key ? { ...p, summary } : p)) })
        } catch (error) {
          console.error('PR summary failed', { pr: pr.url, error })
        } finally {
          this.summarizing.delete(key)
        }
      }
    })
    await Promise.all(workers)
    prCacheFile.set({ viewer: this.state.viewer, refreshedAt: this.state.refreshedAt, prs: this.state.prs })
  }

  private update(patch: Partial<PrListState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('changed', this.state)
  }
}

export const prList = new PrList()
