import { EventEmitter } from 'node:events'
import {
  headKey,
  prKey,
  type HideMode,
  type MyReview,
  type Phase,
  type Pr,
  type PrListKind,
  type PrListState,
  type SessionStatus,
  type StoredHide,
} from '@shared/types'
import { errorMessage } from '@shared/errors'
import { summarizePr } from './claude/summarize'
import { computeAuthorPhase, type AuthorSessionPhaseInput } from './github/authorPhase'
import { computePhase } from './github/phase'
import { fetchPr, searchPrs, type GithubPr } from './github/queries'
import { AUTHORED_SEARCH_QUERIES, buildSearchQueries } from './github/search'
import { isHideActive, keepsUnlistedHide, newHide, refreshHide } from './hiddenPrs'
import type { JsonFile } from './jsonFile'
import {
  authoredHeadsSeenFile,
  authoredHiddenPrsFile,
  authoredPrCacheFile,
  authoredSummariesFile,
  configFile,
  headsSeenFile,
  hiddenPrsFile,
  prCacheFile,
  rallyReviewsFile,
  summariesFile,
  type PrCache,
} from './store'

const SUMMARY_CONCURRENCY = 3

export interface SessionState extends AuthorSessionPhaseInput {
  status: SessionStatus
}

/** Drops state kept for PRs that a full refresh no longer lists, given the keys of the PRs it did list. */
export type Pruner = (listed: Set<string>) => void

type SessionLookup = (key: string) => SessionState | null

type PhaseInput = Omit<Pr, 'phase' | 'reviewStatus' | 'openFindings' | 'hidden'>

interface PrListFiles {
  cache: JsonFile<PrCache>
  summaries: JsonFile<Record<string, string>>
  headsSeen: JsonFile<Record<string, string>>
  hidden: JsonFile<Record<string, StoredHide>>
}

interface PrListSource {
  kind: PrListKind
  files: PrListFiles
  searchQueries(): string[]
  phase(pr: PhaseInput, session: SessionState | null): Phase
}

function withRallyRepliesCounted(reviews: MyReview[], rallyReviewIds: number[]): MyReview[] {
  return reviews.map((r) => (r.replyOnly && r.databaseId !== null && rallyReviewIds.includes(r.databaseId) ? { ...r, replyOnly: false } : r))
}

class PrList extends EventEmitter {
  private state: PrListState
  private timer: NodeJS.Timeout | null = null
  private summarizing = new Set<string>()
  private summaryErrors = new Map<string, string>()
  private sessionOf: SessionLookup = () => null
  private refreshGeneration = 0
  private fetchedDuringRefresh = new Map<string, GithubPr>()
  private pruners: Pruner[] = []
  private readonly files: PrListFiles

  constructor(private readonly source: PrListSource) {
    super()
    this.files = source.files
    const cache = this.files.cache.get()
    this.state = { prs: this.withHidden(cache.prs), viewer: cache.viewer, refreshedAt: cache.refreshedAt, refreshing: false, error: null }
  }

  get kind(): PrListKind {
    return this.source.kind
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

  addPruner(pruner: Pruner): void {
    this.pruners.push(pruner)
  }

  setSessionLookup(lookup: SessionLookup): void {
    this.sessionOf = lookup
    this.reapplyPhases()
  }

  reapplyPhases(): void {
    const prs = this.withHidden(this.withPhases(this.state.prs))
    const changed = prs.some(
      (pr, i) =>
        pr.phase !== this.state.prs[i].phase ||
        pr.reviewStatus !== this.state.prs[i].reviewStatus ||
        pr.openFindings !== this.state.prs[i].openFindings ||
        pr.hidden?.mode !== this.state.prs[i].hidden?.mode,
    )
    if (changed) this.update({ prs })
  }

  async refresh(): Promise<void> {
    if (this.state.refreshing) return
    this.refreshGeneration++
    this.fetchedDuringRefresh.clear()
    this.update({ refreshing: true, error: null })
    try {
      const { viewer, prs: searched } = await searchPrs(this.source.searchQueries(), this.kind)
      const prs = searched.map((pr) => this.fetchedDuringRefresh.get(pr.id) ?? pr)
      const refreshedAt = new Date().toISOString()
      const listed = new Set(prs.map((pr) => prKey(pr.owner, pr.repo, pr.number)))
      for (const prune of this.pruners) prune(listed)
      this.update({ prs: this.decorate(prs, true), viewer, refreshedAt, refreshing: false })
      this.files.cache.set({ viewer, refreshedAt, prs: this.state.prs })
      void this.fillSummaries()
    } catch (error) {
      this.update({ refreshing: false, error: errorMessage(error) })
    }
  }

  /** Fetches one PR; a full refresh already in flight keeps this newer copy instead of its own. */
  async refreshOne(owner: string, repo: string, number: number): Promise<void> {
    const startedDuringRefresh = this.state.refreshing ? this.refreshGeneration : null
    const fetched = await fetchPr(owner, repo, number, this.kind)
    if (this.state.refreshing && this.refreshGeneration === startedDuringRefresh) this.fetchedDuringRefresh.set(fetched.id, fetched)
    const [fresh] = this.decorate([fetched], false)
    const prs = this.state.prs.some((p) => p.id === fresh.id)
      ? this.state.prs.map((p) => (p.id === fresh.id ? fresh : p))
      : [...this.state.prs, fresh]
    this.update({ prs })
    this.files.cache.set({ viewer: this.state.viewer, refreshedAt: this.state.refreshedAt, prs })
  }

  hide(id: string, mode: HideMode): void {
    const pr = this.state.prs.find((p) => p.id === id)
    if (!pr) throw new Error('This PR is no longer in the list. Refresh and try again.')
    this.files.hidden.set({ ...this.files.hidden.get(), [id]: newHide(pr, mode, new Date().toISOString()) })
    this.reapplyHidden()
  }

  unhide(id: string): void {
    const { [id]: _removed, ...rest } = this.files.hidden.get()
    this.files.hidden.set(rest)
    this.reapplyHidden()
  }

  private reapplyHidden(): void {
    this.update({ prs: this.withHidden(this.state.prs) })
  }

  private decorate(prs: GithubPr[], prune: boolean): Pr[] {
    this.syncHides(prs, prune)
    return this.withHidden(this.withPhases(this.withSummaries(this.withHeadTimes(prs, prune), prune)))
  }

  private syncHides(prs: GithubPr[], prune: boolean): void {
    const now = new Date().toISOString()
    const stored = this.files.hidden.get()
    const listed = new Set(prs.map((pr) => pr.id))
    const kept: Record<string, StoredHide> = Object.fromEntries(
      Object.entries(stored).filter(([id, hide]) => !listed.has(id) && (!prune || keepsUnlistedHide(hide, now))),
    )
    for (const pr of prs) {
      const hide = stored[pr.id] && refreshHide(stored[pr.id], pr, now)
      if (hide) kept[pr.id] = hide
    }
    if (JSON.stringify(kept) !== JSON.stringify(stored)) this.files.hidden.set(kept)
  }

  private withHidden(prs: Omit<Pr, 'hidden'>[]): Pr[] {
    const stored = this.files.hidden.get()
    return prs.map((pr) => {
      const hide = stored[pr.id]
      const shown = !hide || !isHideActive(hide, pr) || pr.phase === 'in_progress'
      return { ...pr, hidden: shown ? null : { mode: hide.mode, at: hide.at } }
    })
  }

  private withHeadTimes(prs: GithubPr[], prune: boolean): (GithubPr & { headKnownSince: string })[] {
    const seen = this.files.headsSeen.get()
    const now = new Date().toISOString()
    const recorded: Record<string, string> = prune ? {} : { ...seen }
    const result = prs.map((pr) => {
      const key = headKey(pr)
      const firstSeen = seen[key] ?? now
      recorded[key] = firstSeen
      const headKnownSince = pr.headForcePushedAt && pr.headForcePushedAt < firstSeen ? pr.headForcePushedAt : firstSeen
      return { ...pr, headKnownSince }
    })
    this.files.headsSeen.set(recorded)
    return result
  }

  private withPhases(prs: PhaseInput[]): Omit<Pr, 'hidden'>[] {
    return prs.map((pr) => {
      const session = this.sessionOf(prKey(pr.owner, pr.repo, pr.number))
      return { ...pr, reviewStatus: session?.status ?? null, openFindings: session?.openFindings ?? 0, phase: this.source.phase(pr, session) }
    })
  }

  private withSummaries<T extends GithubPr>(
    prs: T[],
    prune: boolean,
  ): (T & { summary: string | null; summaryError: string | null })[] {
    const summaries = this.files.summaries.get()
    if (prune) {
      const current = new Set(prs.map(headKey))
      this.files.summaries.set(Object.fromEntries(Object.entries(summaries).filter(([key]) => current.has(key))))
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
          this.files.summaries.set({ ...this.files.summaries.get(), [key]: summary })
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
    this.files.cache.set({ viewer: this.state.viewer, refreshedAt: this.state.refreshedAt, prs: this.state.prs })
  }

  private patchByHead(key: string, patch: Partial<Pr>): void {
    this.update({ prs: this.state.prs.map((p) => (headKey(p) === key ? { ...p, ...patch } : p)) })
  }

  private update(patch: Partial<PrListState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('changed', this.state)
  }
}

class ReviewPrList extends PrList {
  recordRallyReview(key: string, reviewId: number): void {
    const recorded = rallyReviewsFile.get()
    const ids = recorded[key] ?? []
    if (!ids.includes(reviewId)) rallyReviewsFile.set({ ...recorded, [key]: [...ids, reviewId] })
  }
}

function pruneRallyReviews(listed: Set<string>): void {
  rallyReviewsFile.set(Object.fromEntries(Object.entries(rallyReviewsFile.get()).filter(([key]) => listed.has(key))))
}

function reviewPhase(pr: PhaseInput, session: SessionState | null): Phase {
  const myReviews = withRallyRepliesCounted(pr.myReviews, rallyReviewsFile.get()[prKey(pr.owner, pr.repo, pr.number)] ?? [])
  return computePhase({ ...pr, myReviews, reviewInProgress: session?.active ?? false })
}

function authorPhase(pr: PhaseInput, session: SessionState | null): Phase {
  return computeAuthorPhase(pr.feedback, session)
}

export const prList = new ReviewPrList({
  kind: 'reviewing',
  files: { cache: prCacheFile, summaries: summariesFile, headsSeen: headsSeenFile, hidden: hiddenPrsFile },
  searchQueries: () => buildSearchQueries(configFile.get()),
  phase: reviewPhase,
})

prList.addPruner(pruneRallyReviews)

export const authoredPrList = new PrList({
  kind: 'authored',
  files: { cache: authoredPrCacheFile, summaries: authoredSummariesFile, headsSeen: authoredHeadsSeenFile, hidden: authoredHiddenPrsFile },
  searchQueries: () => AUTHORED_SEARCH_QUERIES,
  phase: authorPhase,
})

export const prLists: Record<PrListKind, PrList> = { reviewing: prList, authored: authoredPrList }
