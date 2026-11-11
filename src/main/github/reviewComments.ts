import { canPostReply } from '@shared/feedback'
import type { DraftComment, Drafts, PrRef, RepliedComment } from '@shared/types'
import { github, GITHUB_TIMEOUT_MS, timeoutRequest, type GithubClient } from './client'
import { fetchNodes } from './queries'

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id comments(first: 100) { nodes { id databaseId } } }
        }
      }
    }
  }
`

const REPLIED_COMMENTS_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PullRequestReviewComment { url path line originalLine bodyText author { login } }
    }
  }
`

interface ReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: { id: string; comments: { nodes: { id: string; databaseId: number | null }[] } }[]
      }
    }
  }
}

export interface RawRepliedComment {
  url: string
  path: string
  line: number | null
  originalLine: number | null
  bodyText: string
  author: { login: string } | null
}

export interface ThreadComment {
  databaseId: number
  nodeId: string
  threadId: string
}

export const EXCERPT_LENGTH = 160

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : flat
}

export function repliedComment(comment: RawRepliedComment): RepliedComment {
  return {
    author: comment.author?.login ?? null,
    path: comment.path,
    line: comment.line ?? comment.originalLine,
    excerpt: excerpt(comment.bodyText),
    url: comment.url,
  }
}

export async function fetchThreadComments(gh: GithubClient, pr: PrRef): Promise<Map<number, ThreadComment>> {
  const comments = new Map<number, ThreadComment>()
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
      for (const { id, databaseId } of thread.comments.nodes) {
        if (databaseId !== null) comments.set(databaseId, { databaseId, nodeId: id, threadId: thread.id })
      }
    }
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null
  } while (cursor)
  return comments
}

/** Returns the review-thread comment a draft replies to, or undefined when submit will fold the reply into the review body. */
export function threadCommentFor(threadComments: Map<number, ThreadComment>, comment: DraftComment): ThreadComment | undefined {
  return canPostReply(comment) ? threadComments.get(comment.replyToCommentId) : undefined
}

export function needsReplyTargets(drafts: Drafts): boolean {
  return drafts.comments.some((comment) => canPostReply(comment) && comment.replyTarget === undefined)
}

export function attachReplyTargets(drafts: Drafts, repliedComments: Map<number, RepliedComment>): Drafts {
  const comments = drafts.comments.map((comment) => {
    if (!canPostReply(comment)) return comment
    const replied = repliedComments.get(comment.replyToCommentId)
    return { ...comment, replyTarget: replied ? { found: true as const, comment: replied } : { found: false as const } }
  })
  return { ...drafts, comments }
}

async function fetchRepliedComments(gh: GithubClient, threadComments: ThreadComment[]): Promise<Map<number, RepliedComment>> {
  const nodes = await fetchNodes<RawRepliedComment>(gh, REPLIED_COMMENTS_QUERY, threadComments.map((c) => c.nodeId), GITHUB_TIMEOUT_MS)
  const replied = new Map<number, RepliedComment>()
  threadComments.forEach(({ databaseId }, index) => {
    const node = nodes[index]
    if (node) replied.set(databaseId, repliedComment(node))
  })
  return replied
}

export async function describeReplies(pr: PrRef, drafts: Drafts): Promise<Drafts> {
  const gh = await github()
  const threadComments = await fetchThreadComments(gh, pr)
  const answered = new Map<number, ThreadComment>()
  for (const comment of drafts.comments) {
    const threadComment = threadCommentFor(threadComments, comment)
    if (threadComment) answered.set(threadComment.databaseId, threadComment)
  }
  return attachReplyTargets(drafts, await fetchRepliedComments(gh, [...answered.values()]))
}
