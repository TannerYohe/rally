import { canPostReply } from '@shared/feedback'
import type { Drafts, PrRef, ReplyTarget } from '@shared/types'
import { github, timeoutRequest, type GithubClient } from './client'

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id comments(first: 100) { nodes { databaseId url path line originalLine bodyText author { login } } } }
        }
      }
    }
  }
`

export interface RawReviewComment {
  databaseId: number | null
  url: string
  path: string
  line: number | null
  originalLine: number | null
  bodyText: string
  author: { login: string } | null
}

interface ReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: { id: string; comments: { nodes: RawReviewComment[] } }[]
      }
    }
  }
}

export interface ReviewComment {
  threadId: string
  target: ReplyTarget
}

const EXCERPT_LENGTH = 160

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : flat
}

export function replyTarget(comment: RawReviewComment): ReplyTarget {
  return {
    author: comment.author?.login ?? null,
    path: comment.path,
    line: comment.line ?? comment.originalLine,
    excerpt: excerpt(comment.bodyText),
    url: comment.url,
  }
}

export async function fetchReviewComments(gh: GithubClient, pr: PrRef): Promise<Map<number, ReviewComment>> {
  const comments = new Map<number, ReviewComment>()
  let cursor: string | null = null
  do {
    const response: ReviewThreadsResponse = await gh.graphql<ReviewThreadsResponse>(REVIEW_THREADS_QUERY, {
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      cursor,
      request: timeoutRequest(),
    })
    const { nodes, pageInfo } = response.repository.pullRequest.reviewThreads
    for (const thread of nodes) {
      for (const comment of thread.comments.nodes) {
        if (comment.databaseId !== null) comments.set(comment.databaseId, { threadId: thread.id, target: replyTarget(comment) })
      }
    }
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null
  } while (cursor)
  return comments
}

export function hasReplies(drafts: Drafts): boolean {
  return drafts.comments.some(canPostReply)
}

export function attachReplyTargets(drafts: Drafts, reviewComments: Map<number, ReviewComment>): Drafts {
  const comments = drafts.comments.map((comment) =>
    canPostReply(comment) ? { ...comment, replyTarget: reviewComments.get(comment.replyToCommentId)?.target ?? null } : comment,
  )
  return { ...drafts, comments }
}

export async function describeReplies(pr: PrRef, drafts: Drafts): Promise<Drafts> {
  return attachReplyTargets(drafts, await fetchReviewComments(await github(), pr))
}
