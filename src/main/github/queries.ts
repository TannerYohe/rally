import { GraphqlResponseError } from '@octokit/graphql'
import type { MyReview, Pr, ReviewState } from '@shared/types'
import { github, timeoutRequest, type GithubClient } from './client'
import { MY_REVIEW_WINDOW } from './phase'

export type GithubPr = Omit<Pr, 'headKnownSince' | 'phase' | 'reviewStatus' | 'summary' | 'summaryError' | 'hidden'>

const PR_FIELDS = `
  fragment PrFields on PullRequest {
    id number url title body createdAt updatedAt isDraft additions deletions changedFiles
    headRefOid baseRefName headRefName
    author { login avatarUrl(size: 80) }
    repository { name owner { login } }
    files(first: 100) { nodes { path } }
    reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login } } } }
    reviews(author: $viewer, last: ${MY_REVIEW_WINDOW}) { nodes { id databaseId state submittedAt body commit { oid } } }
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

const REVIEW_COMMENTS_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) { ... on PullRequestReview { id comments(first: 20) { nodes { replyTo { id } } } } }
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

type ReviewCommentsNode = { id: string; comments: { nodes: ReviewComment[] } }

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
  reviews: { nodes: RawReview[] }
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

async function replyOnlyReviewIds(gh: GithubClient, prs: RawPr[]): Promise<Set<string>> {
  const candidates = prs.flatMap((pr) => pr.reviews.nodes.filter(mightBeReplyOnly))
  const nodes = await fetchNodes<ReviewCommentsNode>(gh, REVIEW_COMMENTS_QUERY, candidates.map((r) => r.id))
  const replyOnly = new Set<string>()
  nodes.forEach((node, index) => {
    if (node && isReplyOnly(candidates[index], node.comments.nodes)) replyOnly.add(node.id)
  })
  return replyOnly
}

function forcePushedToHeadAt(raw: RawPr): string | null {
  const [event] = raw.timelineItems.nodes
  return event?.afterCommit?.oid === raw.headRefOid ? event.createdAt : null
}

interface SearchResponse {
  search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (RawPr | Record<string, never>)[] }
}

function toPr(raw: RawPr, viewer: string, replyOnly: Set<string>): GithubPr {
  const myReviews: MyReview[] = raw.reviews.nodes.map((r) => ({
    databaseId: r.databaseId,
    state: r.state,
    submittedAt: r.submittedAt,
    commitOid: r.commit?.oid ?? null,
    replyOnly: replyOnly.has(r.id),
  }))
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
  const replyOnly = await replyOnlyReviewIds(gh, raws)
  return { viewer: gh.login, prs: raws.map((raw) => toPr(raw, gh.login, replyOnly)) }
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
  return toPr(raw, gh.login, await replyOnlyReviewIds(gh, [raw]))
}
