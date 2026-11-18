import { GraphqlResponseError } from '@octokit/graphql'
import type { MyReview, Pr, PrCoords, PrListKind, ReviewState } from '@shared/types'
import { authorFeedback, type RawAuthorFields } from './authorPhase'
import { decisionsField, prCommentsField, reviewSummariesField, threadsField } from './feedbackFields'
import { github, timeoutRequest, type GithubClient } from './client'
import { countsAsReview } from './phase'

export type GithubPr = Omit<Pr, 'headKnownSince' | 'phase' | 'reviewStatus' | 'summary' | 'summaryError' | 'hidden'>

const AUTHORED = '@include(if: $authored)'

const REVIEW_PAGE_SIZE = 20
const MAX_REVIEW_PAGES = 10
const REVIEW_FIELDS = 'id databaseId state submittedAt body commit { oid }'
const REVIEW_PAGE_INFO = 'pageInfo { hasPreviousPage startCursor }'
const REVIEW_PAGE = `${REVIEW_PAGE_INFO} nodes { ${REVIEW_FIELDS} }`
const REVIEW_COMMENTS = 'comments(first: 20) { nodes { replyTo { id } } }'

const PR_FIELDS = `
  fragment PrFields on PullRequest {
    id number url title body createdAt updatedAt isDraft additions deletions changedFiles
    headRefOid baseRefName headRefName
    author { login avatarUrl(size: 80) }
    repository { name owner { login } }
    files(first: 100) { nodes { path } }
    reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login } } } }
    reviews(author: $viewer, last: ${REVIEW_PAGE_SIZE}) { ${REVIEW_PAGE} }
    timelineItems(last: 1, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) {
      nodes { ... on HeadRefForcePushedEvent { createdAt afterCommit { oid } } }
    }
    reviewDecision @include(if: $authored)
    ${decisionsField(AUTHORED)}
    ${threadsField('first: 100', AUTHORED)}
    ${prCommentsField('last: 100', AUTHORED)}
    ${reviewSummariesField('last: 100', AUTHORED, 'allReviews')}
  }
`

const SEARCH_QUERY = `
  query($q: String!, $viewer: String!, $authored: Boolean!, $pageSize: Int!, $cursor: String) {
    search(query: $q, type: ISSUE, first: $pageSize, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ... on PullRequest { ...PrFields } }
    }
  }
  ${PR_FIELDS}
`

const OLDER_REVIEWS_QUERY = `
  query($id: ID!, $viewer: String!, $before: String!) {
    node(id: $id) {
      ... on PullRequest {
        reviews(author: $viewer, last: ${REVIEW_PAGE_SIZE}, before: $before) {
          ${REVIEW_PAGE_INFO}
          nodes { ${REVIEW_FIELDS} ${REVIEW_COMMENTS} }
        }
      }
    }
  }
`

const REVIEW_COMMENTS_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) { ... on PullRequestReview { id ${REVIEW_COMMENTS} } }
  }
`

/** Authored PRs fetch every thread, comment, and review, so they come in small pages to keep each query's rate-limit cost low. */
export const SEARCH_PAGES: Record<PrListKind, { size: number; max: number }> = {
  reviewing: { size: 50, max: 4 },
  authored: { size: 10, max: 10 },
}
const MAX_NODE_IDS = 100
const PRS_PER_REQUEST = 20
const GONE_ERROR_TYPES = ['NOT_FOUND', 'FORBIDDEN']

/** A PR looked up by its coordinates: found open, gone (closed, merged, deleted, or not visible), or unknown after an error. */
export type PrLookup = { status: 'found'; pr: GithubPr } | { status: 'gone' } | { status: 'unknown' }

function multiPrQuery(count: number): string {
  const indexes = Array.from({ length: count }, (_, i) => i)
  const variables = indexes.map((i) => `$o${i}: String!, $r${i}: String!, $n${i}: Int!`).join(', ')
  const fields = indexes.map((i) => `p${i}: repository(owner: $o${i}, name: $r${i}) { pullRequest(number: $n${i}) { state ...PrFields } }`)
  return `
  query(${variables}, $viewer: String!, $authored: Boolean!) {
    ${fields.join('\n    ')}
  }
  ${PR_FIELDS}
`
}

interface RawReview {
  id: string
  databaseId: number | null
  state: ReviewState
  submittedAt: string | null
  body: string
  commit: { oid: string } | null
}

interface ReviewComment {
  replyTo: { id: string } | null
}

interface ReviewPage {
  pageInfo: { hasPreviousPage: boolean; startCursor: string | null }
  nodes: RawReview[]
}

type ReviewCommentsNode = { id: string; comments: { nodes: ReviewComment[] } }

interface OlderReviewPage {
  pageInfo: ReviewPage['pageInfo']
  nodes: (RawReview & ReviewCommentsNode)[]
}

interface RawPr extends Partial<RawAuthorFields> {
  id: string
  number: number
  url: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  headRefOid: string
  baseRefName: string
  headRefName: string
  author: { login: string; avatarUrl: string } | null
  repository: { name: string; owner: { login: string } }
  files: { nodes: { path: string }[] } | null
  reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] }
  reviews: ReviewPage
  timelineItems: { nodes: { createdAt: string; afterCommit: { oid: string } | null }[] }
}

function mightBeReplyOnly(review: Pick<RawReview, 'state' | 'body'>): boolean {
  return review.state === 'COMMENTED' && !review.body.trim()
}

export function isReplyOnly(review: Pick<RawReview, 'state' | 'body'>, comments: ReviewComment[]): boolean {
  return mightBeReplyOnly(review) && comments.length > 0 && comments.every((c) => c.replyTo)
}

export async function fetchNodes<T>(gh: GithubClient, query: string, ids: string[], timeoutMs?: number): Promise<(T | null)[]> {
  const nodes: (T | null)[] = []
  for (let i = 0; i < ids.length; i += MAX_NODE_IDS) {
    const request = timeoutMs ? timeoutRequest(timeoutMs) : undefined
    try {
      const response = await gh.graphql<{ nodes: (T | null)[] }>(query, { ids: ids.slice(i, i + MAX_NODE_IDS), request })
      nodes.push(...response.nodes)
    } catch (error) {
      const partial = error instanceof GraphqlResponseError ? (error.data as { nodes?: (T | null)[] } | undefined) : undefined
      if (!partial?.nodes) throw error
      console.warn('GitHub node lookup returned partial errors', { errors: (error as GraphqlResponseError<unknown>).errors })
      nodes.push(...partial.nodes)
    }
  }
  return nodes
}

async function replyOnlyReviewIds(gh: GithubClient, reviews: RawReview[]): Promise<Set<string>> {
  const candidates = reviews.filter(mightBeReplyOnly)
  const nodes = await fetchNodes<ReviewCommentsNode>(gh, REVIEW_COMMENTS_QUERY, candidates.map((r) => r.id))
  const replyOnly = new Set<string>()
  nodes.forEach((node, index) => {
    if (node && isReplyOnly(candidates[index], node.comments.nodes)) replyOnly.add(node.id)
  })
  return replyOnly
}

function toMyReview(review: RawReview, replyOnly: boolean): MyReview {
  return {
    databaseId: review.databaseId,
    state: review.state,
    submittedAt: review.submittedAt,
    commitOid: review.commit?.oid ?? null,
    replyOnly,
  }
}

async function fetchOlderReviews(gh: GithubClient, raw: RawPr, before: string): Promise<OlderReviewPage | null> {
  try {
    const response = await gh.graphql<{ node: { reviews: OlderReviewPage } | null }>(OLDER_REVIEWS_QUERY, {
      id: raw.id,
      viewer: gh.login,
      before,
      request: timeoutRequest(),
    })
    if (response.node) return response.node.reviews
    console.warn('GitHub returned no PR for an older reviews page', { pr: raw.url })
  } catch (error) {
    console.warn('Fetching an older page of my reviews failed', { pr: raw.url, error })
  }
  return null
}

async function olderReviewsUntilCounted(gh: GithubClient, raw: RawPr, newest: MyReview[]): Promise<MyReview[]> {
  let reviews = newest
  let page = raw.reviews.pageInfo
  for (let pages = 1; pages < MAX_REVIEW_PAGES; pages++) {
    if (reviews.some((r) => countsAsReview(r))) break
    if (!page.hasPreviousPage || !page.startCursor) break
    const older = await fetchOlderReviews(gh, raw, page.startCursor)
    if (!older) break
    reviews = [...older.nodes.map((r) => toMyReview(r, isReplyOnly(r, r.comments.nodes))), ...reviews]
    page = older.pageInfo
  }
  return reviews
}

/** Returns my reviews on each PR, paging back past thread replies only for PRs I review; author phases don't read them. */
async function myReviewsOf(gh: GithubClient, raws: RawPr[], kind: PrListKind): Promise<MyReview[][]> {
  const replyOnly = await replyOnlyReviewIds(gh, raws.flatMap((raw) => raw.reviews.nodes))
  return Promise.all(
    raws.map((raw) => {
      const newest = raw.reviews.nodes.map((r) => toMyReview(r, replyOnly.has(r.id)))
      return isAuthored(kind) ? newest : olderReviewsUntilCounted(gh, raw, newest)
    }),
  )
}

function forcePushedToHeadAt(raw: RawPr): string | null {
  const [event] = raw.timelineItems.nodes
  return event?.afterCommit?.oid === raw.headRefOid ? event.createdAt : null
}

interface SearchResponse {
  search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (RawPr | Record<string, never>)[] }
}

function toPr(raw: RawPr, viewer: string, myReviews: MyReview[]): GithubPr {
  const authored = authorFields(raw)
  const reviewRequestedFromMe = raw.reviewRequests.nodes.some(
    (n) => n.requestedReviewer?.login?.toLowerCase() === viewer.toLowerCase(),
  )
  return {
    id: raw.id,
    number: raw.number,
    owner: raw.repository.owner.login,
    repo: raw.repository.name,
    url: raw.url,
    title: raw.title,
    body: raw.body,
    author: raw.author?.login ?? 'ghost',
    authorAvatarUrl: raw.author?.avatarUrl ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    isDraft: raw.isDraft,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    headRefOid: raw.headRefOid,
    headForcePushedAt: forcePushedToHeadAt(raw),
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    files: raw.files?.nodes.map((f) => f.path) ?? [],
    reviewRequestedFromMe,
    myReviews,
    feedback: authored ? authorFeedback(authored, viewer) : null,
  }
}

function authorFields(raw: RawPr): RawAuthorFields | null {
  const { reviewDecision, latestOpinionatedReviews, reviewThreads, comments, allReviews } = raw
  if (!latestOpinionatedReviews || !reviewThreads || !comments || !allReviews) return null
  return { reviewDecision: reviewDecision ?? null, latestOpinionatedReviews, reviewThreads, comments, allReviews }
}

const isAuthored = (kind: PrListKind) => kind === 'authored'

export async function searchPrs(queries: string[], kind: PrListKind): Promise<{ viewer: string; prs: GithubPr[] }> {
  const gh = await github()
  const byId = new Map<string, RawPr>()
  for (const q of queries) {
    let cursor: string | null = null
    const pages = SEARCH_PAGES[kind]
    for (let page = 0; page < pages.max; page++) {
      const response: SearchResponse = await gh.graphql<SearchResponse>(SEARCH_QUERY, {
        q,
        viewer: gh.login,
        authored: isAuthored(kind),
        pageSize: pages.size,
        cursor,
        request: timeoutRequest(),
      })
      for (const node of response.search.nodes) {
        if ('id' in node) byId.set(node.id, node as RawPr)
      }
      if (!response.search.pageInfo.hasNextPage) break
      cursor = response.search.pageInfo.endCursor
    }
  }
  const raws = [...byId.values()]
  const myReviews = await myReviewsOf(gh, raws, kind)
  return { viewer: gh.login, prs: raws.map((raw, index) => toPr(raw, gh.login, myReviews[index])) }
}

type MultiPrResponse = Record<string, { pullRequest: (RawPr & { state: string }) | null } | null>

type GraphqlErrors = NonNullable<GraphqlResponseError<unknown>['errors']>

/** Runs one aliased lookup, returning partial data with its errors and rethrowing a failure that returned no data. */
async function requestPrs(gh: GithubClient, batch: PrCoords[], kind: PrListKind): Promise<{ data: MultiPrResponse; errors: GraphqlErrors | [] }> {
  const variables = Object.fromEntries(batch.flatMap((c, i) => [[`o${i}`, c.owner], [`r${i}`, c.repo], [`n${i}`, c.number]]))
  try {
    const data = await gh.graphql<MultiPrResponse>(multiPrQuery(batch.length), {
      ...variables,
      viewer: gh.login,
      authored: isAuthored(kind),
      request: timeoutRequest(),
    })
    return { data, errors: [] }
  } catch (error) {
    const partial = error instanceof GraphqlResponseError ? (error.data as MultiPrResponse | null | undefined) : undefined
    if (!partial) throw error
    const errors = (error as GraphqlResponseError<unknown>).errors ?? []
    console.warn('GitHub PR lookup returned partial errors', { errors })
    return { data: partial, errors }
  }
}

function lookupOf(alias: string, data: MultiPrResponse, errors: GraphqlErrors | []): RawPr | 'gone' | 'unknown' {
  const raw = data[alias]?.pullRequest
  if (raw) return raw.state === 'OPEN' ? raw : 'gone'
  const aliasErrors = errors.filter((e) => e.path?.[0] === alias)
  return aliasErrors.length > 0 && aliasErrors.every((e) => GONE_ERROR_TYPES.includes(e.type)) ? 'gone' : 'unknown'
}

/** Looks up PRs by their coordinates, 20 to a request, keeping only open ones. */
export async function fetchPrs(coords: PrCoords[], kind: PrListKind): Promise<{ viewer: string; lookups: PrLookup[] }> {
  const gh = await github()
  const lookups: PrLookup[] = []
  for (let start = 0; start < coords.length; start += PRS_PER_REQUEST) {
    const batch = coords.slice(start, start + PRS_PER_REQUEST)
    const { data, errors } = await requestPrs(gh, batch, kind)
    const results = batch.map((_, i) => lookupOf(`p${i}`, data, errors))
    const raws = results.filter((r): r is RawPr => typeof r === 'object')
    const myReviews = await myReviewsOf(gh, raws, kind)
    const prs = new Map(raws.map((raw, i) => [raw, toPr(raw, gh.login, myReviews[i])]))
    for (const result of results) {
      if (typeof result === 'object') lookups.push({ status: 'found', pr: prs.get(result)! })
      else lookups.push({ status: result })
    }
  }
  return { viewer: gh.login, lookups }
}
