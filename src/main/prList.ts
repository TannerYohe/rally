import { EventEmitter } from 'node:events'
import {
  headKey,
  isSamePr,
  keyOf,
  toPrRef,
  type HideMode,
  type MyReview,
  type Phase,
  type Pr,
  type PrCoords,
  type PrListKind,
  type PrLinks,
  type PrListState,
  type PrRef,
  type SessionStatus,
  type StoredHide,
} from '@shared/types'
import { errorMessage } from '@shared/errors'
import { parsePrRef } from '@shared/linkedPrs'
import { areLinked, handLinkedKeys, hasPair, linkNode, linkUnits, membersOf, oneSidedLinks, unitHide, type LinkNode } from '@shared/prUnit'
import { summarizePr } from './claude/summarize'
import { computeAuthorPhase } from './github/authorPhase'
import { computePhase } from './github/phase'
import { sameLogin } from './github/logins'
import { fetchPrs, searchPrs, type GithubPr, type PrLookup } from './github/queries'
import { AUTHORED_SEARCH_QUERIES, buildSearchQueries } from './github/search'
import { isHideActive, keepsUnlistedHide, newHide, refreshHide, withinUnlistedRetention } from './hiddenPrs'
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
  prLinksFile,
  rallyReviewsFile,
  summariesFile,
  type PrCache,
} from './store'

const SUMMARY_CONCURRENCY = 3
const MAX_LINK_ROUNDS = 3

export interface SessionState {
  status: SessionStatus
  active: boolean
}

/** Drops state kept for PRs that a full refresh no longer lists, given the keys of the PRs it did list. */
export type Pruner = (listed: Set<string>) => void

type SessionLookup = (key: string) => SessionState | null

type PhaseInput = Omit<Pr, 'phase' | 'reviewStatus' | 'hidden'>

interface PrListFiles {
  cache: JsonFile<PrCache>
  summaries: JsonFile<Record<string, string>>
  headsSeen: JsonFile<Record<string, string>>
  hidden: JsonFile<Record<string, StoredHide>>
}

interface PrLinkSource {
  file: JsonFile<PrLinks>
  markers(): string[]
}

interface PrListSource {
  kind: PrListKind
  files: PrListFiles
  /** Present for a list that groups linked PRs into units. */
  links?: PrLinkSource
  searchQueries(): string[]
  phase(pr: PhaseInput, sessionActive: boolean): Phase
}

/** A PR outside the list that a listed PR links one-sidedly. */
interface LinkTarget {
  node: LinkNode
  ref: PrRef
}

function uniqueCoords(coords: PrCoords[]): PrCoords[] {
  return coords.filter((c, index) => coords.findIndex((other) => isSamePr(other, c)) === index)
}

function unreciprocatedTargets(prs: Pr[]): Map<string, LinkTarget> {
  const refs = prs.flatMap((pr) => pr.unreciprocatedLinks ?? [])
  return new Map(refs.map((ref) => [keyOf(ref), { node: { key: keyOf(ref), coords: ref, targets: [] }, ref }]))
}

/** Shows every member of a unit while any member shows. */
function withUnitHides(prs: Pr[]): Pr[] {
  const byKey = new Map(prs.map((pr) => [keyOf(pr), pr]))
  return prs.map((pr) => (pr.linkedPrs ? { ...pr, hidden: unitHide(membersOf(pr, byKey)) } : pr))
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
  private linkTargets = new Map<string, LinkTarget>()
  private linkNodes = new Map<string, { body: string; markers: string[]; node: LinkNode }>()
  private refreshAgain = false
  private readonly files: PrListFiles

  constructor(private readonly source: PrListSource) {
    super()
    this.files = source.files
    const cache = this.files.cache.get()
    this.linkTargets = unreciprocatedTargets(cache.prs)
    this.state = { prs: this.settle(this.withHidden(cache.prs)), viewer: cache.viewer, refreshedAt: cache.refreshedAt, refreshing: false, error: null }
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
    const prs = this.settle(this.withHidden(this.withPhases(this.state.prs)))
    const changed =
      prs.length !== this.state.prs.length ||
      prs.some(
        (pr, i) =>
          pr.id !== this.state.prs[i].id ||
          pr.phase !== this.state.prs[i].phase ||
          pr.reviewStatus !== this.state.prs[i].reviewStatus ||
          pr.hidden?.mode !== this.state.prs[i].hidden?.mode ||
          JSON.stringify(pr.linkedPrs) !== JSON.stringify(this.state.prs[i].linkedPrs) ||
          JSON.stringify(pr.unreciprocatedLinks) !== JSON.stringify(this.state.prs[i].unreciprocatedLinks),
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
      const fromSearch = searched.map((pr) => this.fetchedDuringRefresh.get(pr.id) ?? pr)
      const companions = this.source.links ? await this.fetchCompanions(fromSearch, viewer, this.source.links) : []
      const prs = [...fromSearch, ...companions.map((pr) => ({ ...(this.fetchedDuringRefresh.get(pr.id) ?? pr), companion: true }))]
      const refreshedAt = new Date().toISOString()
      const listed = new Set(prs.map(keyOf))
      for (const prune of this.pruners) prune(listed)
      this.update({ prs: this.settle(this.decorate(prs, true)), viewer, refreshedAt, refreshing: false })
      this.files.cache.set({ viewer, refreshedAt, prs: this.state.prs })
      void this.fillSummaries()
    } catch (error) {
      this.update({ refreshing: false, error: errorMessage(error) })
    }
    if (this.refreshAgain) {
      this.refreshAgain = false
      await this.refresh()
    }
  }

  /**
   * Fetches the open PRs in other repos that listed PRs link, following mutual and hand links for a few rounds,
   * and returns those that join a unit with a listed PR. An unknown lookup reuses the PR's previous copy.
   */
  private async fetchCompanions(listed: GithubPr[], viewer: string, links: PrLinkSource): Promise<GithubPr[]> {
    const markers = links.markers()
    const handLinks = links.file.get()
    const known: LinkNode[] = listed.map((pr) => linkNode(pr, markers))
    const fetched = new Map<string, GithubPr>()
    let frontier = known
    for (let round = 0; round < MAX_LINK_ROUNDS && frontier.length > 0; round++) {
      const handTargets = frontier.flatMap((node) => handLinkedKeys(node.key, handLinks).flatMap((key) => parsePrRef(key) ?? []))
      const wanted = uniqueCoords([...frontier.flatMap((node) => node.targets), ...handTargets]).filter(
        (coords) => !known.some((node) => isSamePr(node.coords, coords)),
      )
      if (wanted.length === 0) break
      const lookups = await this.lookupCompanions(wanted)
      const found = lookups.flatMap((lookup, i): GithubPr[] => {
        switch (lookup.status) {
          case 'found':
            return sameLogin(lookup.pr.author, viewer) ? [] : [lookup.pr]
          case 'unknown':
            return this.state.prs.filter((pr) => isSamePr(pr, wanted[i]))
          case 'gone':
            return []
        }
      })
      const nodes = found.map((pr) => linkNode(pr, markers))
      for (const pr of found) fetched.set(keyOf(pr), pr)
      frontier = nodes.filter((node) => known.some((other) => areLinked(node, other, handLinks)))
      known.push(...nodes)
    }
    const listedKeys = new Set(listed.map(keyOf))
    const memberKeys = new Set(linkUnits(known, handLinks).filter((unit) => unit.some((key) => listedKeys.has(key))).flat())
    const outside = [...fetched.values()].filter((pr) => !memberKeys.has(keyOf(pr)))
    this.linkTargets = new Map(outside.map((pr) => [keyOf(pr), { node: linkNode(pr, markers), ref: toPrRef(pr) }]))
    return [...fetched.values()].filter((pr) => memberKeys.has(keyOf(pr)))
  }

  /** Looks up linked PRs, treating every one as unknown when the whole request fails. */
  private async lookupCompanions(wanted: PrCoords[]): Promise<PrLookup[]> {
    try {
      return (await fetchPrs(wanted, this.kind)).lookups
    } catch (error) {
      console.warn('Fetching linked PRs failed', { prs: wanted.map(keyOf), error })
      return wanted.map(() => ({ status: 'unknown' }))
    }
  }

  async refreshOne(owner: string, repo: string, number: number): Promise<void> {
    await this.refreshMany([{ owner, repo, number }])
  }

  /** Fetches PRs together and updates the list once, keeping a PR the list didn't already list only while a listed PR links it. */
  async refreshMany(refs: PrCoords[]): Promise<void> {
    const startedDuringRefresh = this.state.refreshing ? this.refreshGeneration : null
    const { lookups } = await fetchPrs(refs, this.kind)
    const fetched = lookups.flatMap((lookup) => (lookup.status === 'found' ? [lookup.pr] : []))
    const gone = refs.filter((_, i) => lookups[i].status === 'gone')
    const unknown = refs.filter((_, i) => lookups[i].status === 'unknown')
    if (unknown.length > 0) console.warn('Refreshing PRs left some unchanged after lookup errors', { prs: unknown.map(keyOf) })
    if (this.state.refreshing && this.refreshGeneration === startedDuringRefresh) for (const pr of fetched) this.fetchedDuringRefresh.set(pr.id, pr)
    const listedIds = new Set(this.state.prs.filter((pr) => !pr.companion).map((pr) => pr.id))
    const fresh = this.decorate(
      fetched.map((pr) => (this.source.links && !listedIds.has(pr.id) ? { ...pr, companion: true } : pr)),
      false,
    )
    const freshIds = new Set(fresh.map((pr) => pr.id))
    const kept = this.state.prs.filter((pr) => !gone.some((ref) => isSamePr(ref, pr)))
    const prs = this.settle([
      ...kept.map((pr) => (freshIds.has(pr.id) ? fresh.find((f) => f.id === pr.id)! : pr)),
      ...fresh.filter((pr) => !kept.some((k) => k.id === pr.id)),
    ])
    this.update({ prs })
    this.files.cache.set({ viewer: this.state.viewer, refreshedAt: this.state.refreshedAt, prs })
  }

  /** Links a listed PR with another PR by hand, then refreshes the list. */
  async link(key: string, target: PrCoords): Promise<void> {
    const links = this.linkSource()
    const pr = this.state.prs.find((p) => keyOf(p) === key)
    if (!pr) throw new Error('This PR is no longer in the list. Refresh and try again.')
    if (isSamePr(pr, target)) throw new Error("A PR can't be linked with itself.")
    const targetKey = await this.linkableKey(target)
    const stored = links.file.get()
    const { linked, unlinked } = stored
    links.file.set({
      ...stored,
      linked: [...linked.filter((pair) => !hasPair([pair], key, targetKey)), [key, targetKey]],
      unlinked: unlinked.filter((pair) => !hasPair([pair], key, targetKey)),
    })
    if (this.state.refreshing) this.refreshAgain = true
    else await this.refresh()
  }

  /** Unlinks a PR from each of the given PRs by hand, which outranks links in either description. */
  unlink(key: string, others: string[]): void {
    const links = this.linkSource()
    const pairs = others.filter((other) => other !== key).map((other): [string, string] => [key, other])
    const stored = links.file.get()
    const outsidePairs = (pair: [string, string]) => !pairs.some(([x, y]) => hasPair([pair], x, y))
    links.file.set({ ...stored, linked: stored.linked.filter(outsidePairs), unlinked: [...stored.unlinked.filter(outsidePairs), ...pairs] })
    const prs = this.settle(this.state.prs)
    this.update({ prs })
    this.files.cache.set({ viewer: this.state.viewer, refreshedAt: this.state.refreshedAt, prs })
  }

  /** Returns the PR's link node, parsing its description again only when the description or markers changed. */
  private linkNodeOf(pr: Pr, markers: string[]): LinkNode {
    const key = keyOf(pr)
    const cached = this.linkNodes.get(key)
    if (cached && cached.body === pr.body && cached.markers === markers) return cached.node
    const node = linkNode(pr, markers)
    this.linkNodes.set(key, { body: pr.body, markers, node })
    return node
  }

  private linkSource(): PrLinkSource {
    if (!this.source.links) throw new Error('This list does not link PRs.')
    return this.source.links
  }

  /** Returns the key of an open PR by someone else, with GitHub's casing, from the list or GitHub. */
  private async linkableKey(target: PrCoords): Promise<string> {
    const known = [...this.state.prs, ...[...this.linkTargets.values()].map((t) => t.ref)].find((pr) => isSamePr(pr, target))
    if (known) return keyOf(known)
    const { viewer, lookups } = await fetchPrs([target], this.kind)
    const [lookup] = lookups
    switch (lookup.status) {
      case 'found':
        if (sameLogin(lookup.pr.author, viewer)) throw new Error('That PR is yours. Rally only groups PRs you review.')
        return keyOf(lookup.pr)
      case 'gone':
        throw new Error(`${keyOf(target)} is closed, merged, or not visible to you.`)
      case 'unknown':
        throw new Error(`Rally couldn't look up ${keyOf(target)}. Try again.`)
    }
  }

  /** Hides every PR in a unit together. */
  hide(ids: string[], mode: HideMode): void {
    const at = new Date().toISOString()
    const hides = ids.map((id) => {
      const pr = this.state.prs.find((p) => p.id === id)
      if (!pr) throw new Error('This PR is no longer in the list. Refresh and try again.')
      return [id, newHide(pr, mode, at)] as const
    })
    this.files.hidden.set({ ...this.files.hidden.get(), ...Object.fromEntries(hides) })
    this.reapplyHidden()
  }

  unhide(ids: string[]): void {
    this.files.hidden.set(Object.fromEntries(Object.entries(this.files.hidden.get()).filter(([id]) => !ids.includes(id))))
    this.reapplyHidden()
  }

  private reapplyHidden(): void {
    this.update({ prs: this.settle(this.withHidden(this.state.prs)) })
  }

  private decorate(prs: GithubPr[], prune: boolean): Pr[] {
    this.syncHides(prs, prune)
    return this.withHidden(this.withPhases(this.withSummaries(this.withHeadTimes(prs, prune), prune)))
  }

  /** Relinks the list from PR descriptions and hand links, drops companions no listed PR links with, and lines up unit hides. */
  private settle(prs: Pr[]): Pr[] {
    const links = this.source.links
    if (!links) return prs
    const handLinks = links.file.get()
    const markers = links.markers()
    const nodes = prs.map((pr) => this.linkNodeOf(pr, markers))
    for (const key of this.linkNodes.keys()) if (!nodes.some((node) => node.key === key)) this.linkNodes.delete(key)
    const units = linkUnits(nodes, handLinks)
    const unitOf = new Map(units.flatMap((unit) => unit.map((key) => [key, unit] as const)))
    const listedKeys = new Set(prs.filter((pr) => !pr.companion).map(keyOf))
    const kept = prs.filter((pr) => !pr.companion || unitOf.get(keyOf(pr))?.some((key) => listedKeys.has(key)))
    const outside = [...this.linkTargets.values()].filter((target) => !nodes.some((n) => n.key === target.node.key))
    const oneSided = oneSidedLinks([...nodes, ...outside.map((target) => target.node)], handLinks, units)
    const refs = new Map<string, PrRef>([...prs.map((pr) => [keyOf(pr), toPrRef(pr)] as const), ...outside.map((t) => [t.node.key, t.ref] as const)])
    const linked = kept.map((pr) => {
      const key = keyOf(pr)
      const { linkedPrs: _linked, unreciprocatedLinks: _unreciprocated, ...rest } = pr
      const others = unitOf.get(key)?.filter((member) => member !== key)
      const unreciprocated = oneSided.get(key)?.map((target) => refs.get(target)!)
      return { ...rest, ...(others && { linkedPrs: others }), ...(unreciprocated && { unreciprocatedLinks: unreciprocated }) }
    })
    return withUnitHides(linked)
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
      const session = this.sessionOf(keyOf(pr))
      return { ...pr, reviewStatus: session?.status ?? null, phase: this.source.phase(pr, session?.active ?? false) }
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

/** Drops hand links and unlinks once neither PR has been listed for the unlisted retention window. */
function prunePrLinks(listed: Set<string>): void {
  const now = new Date().toISOString()
  const stored = prLinksFile.get()
  const listedAt = (key: string) => (listed.has(key) ? now : (stored.lastListedAt?.[key] ?? now))
  const recent = ([a, b]: [string, string]) => withinUnlistedRetention(listedAt(a), now) || withinUnlistedRetention(listedAt(b), now)
  const linked = stored.linked.filter(recent)
  const unlinked = stored.unlinked.filter(recent)
  const lastListedAt = Object.fromEntries([...linked, ...unlinked].flat().map((key) => [key, listedAt(key)]))
  const next = { linked, unlinked, lastListedAt }
  if (JSON.stringify(next) !== JSON.stringify(stored)) prLinksFile.set(next)
}

function pruneRallyReviews(listed: Set<string>): void {
  rallyReviewsFile.set(Object.fromEntries(Object.entries(rallyReviewsFile.get()).filter(([key]) => listed.has(key))))
}

function reviewPhase(pr: PhaseInput, sessionActive: boolean): Phase {
  const myReviews = withRallyRepliesCounted(pr.myReviews, rallyReviewsFile.get()[keyOf(pr)] ?? [])
  return computePhase({ ...pr, myReviews, reviewInProgress: sessionActive })
}

function authorPhase(pr: PhaseInput, sessionActive: boolean): Phase {
  if (pr.feedback) return computeAuthorPhase(pr.feedback, sessionActive)
  return sessionActive ? 'in_progress' : 'awaiting_reviews'
}

export const prList = new ReviewPrList({
  kind: 'reviewing',
  files: { cache: prCacheFile, summaries: summariesFile, headsSeen: headsSeenFile, hidden: hiddenPrsFile },
  links: { file: prLinksFile, markers: () => configFile.get().linkMarkers },
  searchQueries: () => buildSearchQueries(configFile.get()),
  phase: reviewPhase,
})

prList.addPruner(pruneRallyReviews)
prList.addPruner(prunePrLinks)

export const authoredPrList = new PrList({
  kind: 'authored',
  files: { cache: authoredPrCacheFile, summaries: authoredSummariesFile, headsSeen: authoredHeadsSeenFile, hidden: authoredHiddenPrsFile },
  searchQueries: () => AUTHORED_SEARCH_QUERIES,
  phase: authorPhase,
})

export const prLists: Record<PrListKind, PrList> = { reviewing: prList, authored: authoredPrList }
