import { GraphqlResponseError } from '@octokit/graphql'
import type { MyReview, Pr, ReviewState } from '@shared/types'
import { github, timeoutRequest, type GithubClient } from './client'
import { countsAsReview } from './phase'

export type GithubPr = Omit<Pr, 'headKnownSince' | 'phase' | 'reviewStatus' | 'summary' | 'summaryError' | 'hidden'>

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
  }
`

const SEARCH_QUERY = `
  query($q: String!, $viewer: String!, $cursor: String) {
    search(query: $q, type: ISSUE, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ... on PullRequest { ...PrFields } }
    }
  }
  ${PR_FIELDS}
`

const SINGLE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $viewer: String!) {
    repository(owner: $owner, name: $repo) { pullRequest(number: $number) { ...PrFields } }
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

const MAX_PAGES = 4
const MAX_NODE_IDS = 100

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

interface RawPr {
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

async function myReviewsOf(gh: GithubClient, raws: RawPr[]): Promise<MyReview[][]> {
  const replyOnly = await replyOnlyReviewIds(gh, raws.flatMap((raw) => raw.reviews.nodes))
  return Promise.all(
    raws.map((raw) => olderReviewsUntilCounted(gh, raw, raw.reviews.nodes.map((r) => toMyReview(r, replyOnly.has(r.id))))),
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
  }
}

export async function searchPrs(queries: string[]): Promise<{ viewer: string; prs: GithubPr[] }> {
  const gh = await github()
  const byId = new Map<string, RawPr>()
  for (const q of queries) {
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const response: SearchResponse = await gh.graphql<SearchResponse>(SEARCH_QUERY, { q, viewer: gh.login, cursor })
      for (const node of response.search.nodes) {
        if ('id' in node) byId.set(node.id, node as RawPr)
      }
      if (!response.search.pageInfo.hasNextPage) break
      cursor = response.search.pageInfo.endCursor
    }
  }
  const raws = [...byId.values()]
  const myReviews = await myReviewsOf(gh, raws)
  return { viewer: gh.login, prs: raws.map((raw, index) => toPr(raw, gh.login, myReviews[index])) }
}

export async function fetchPr(owner: string, repo: string, number: number): Promise<GithubPr> {
  const gh = await github()
  const response = await gh.graphql<{ repository: { pullRequest: RawPr } }>(SINGLE_QUERY, {
    owner,
    repo,
    number,
    viewer: gh.login,
  })
  const raw = response.repository.pullRequest
  const [myReviews] = await myReviewsOf(gh, [raw])
  return toPr(raw, gh.login, myReviews)
}
