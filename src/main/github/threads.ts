import type { PrRef, ReviewThread, ThreadResolution } from '@shared/types'
import { github } from './client'
import { fetchNodes } from './queries'

const THREADS_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PullRequestReviewThread {
        id isResolved isOutdated
        pullRequest { number repository { name owner { login } } }
        comments(first: 1) { nodes { url author { login } } }
      }
    }
  }
`

const RESOLVE_MUTATION = `
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
  }
`

export interface RawThread {
  id?: string
  isResolved: boolean
  isOutdated: boolean
  pullRequest: { number: number; repository: { name: string; owner: { login: string } } }
  comments: { nodes: { url: string; author: { login: string } | null }[] }
}

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function isOnPr(thread: RawThread, pr: PrRef): boolean {
  const { number, repository } = thread.pullRequest
  return number === pr.number && sameLogin(repository.name, pr.repo) && sameLogin(repository.owner.login, pr.owner)
}

export function ownThreads(nodes: (RawThread | null)[], viewer: string, pr: PrRef): ReviewThread[] {
  return nodes.flatMap((node) => {
    const first = node?.comments.nodes[0]
    if (!node?.id || !first?.author || !sameLogin(first.author.login, viewer) || !isOnPr(node, pr)) return []
    return [{ id: node.id, url: first.url, isResolved: node.isResolved, isOutdated: node.isOutdated }]
  })
}

export async function fetchOwnThreads(pr: PrRef, threadIds: string[]): Promise<ReviewThread[]> {
  const ids = [...new Set(threadIds)]
  if (ids.length === 0) return []
  const gh = await github()
  return ownThreads(await fetchNodes<RawThread>(gh, THREADS_QUERY, ids), gh.login, pr)
}

export async function resolveOwnThreads(pr: PrRef, threadIds: string[]): Promise<ThreadResolution> {
  const gh = await github()
  const owned = new Map((await fetchOwnThreads(pr, threadIds)).map((thread) => [thread.id, thread]))
  const result: ThreadResolution = { resolved: [], failed: [] }
  for (const threadId of new Set(threadIds)) {
    const thread = owned.get(threadId)
    if (!thread) {
      result.failed.push({ threadId, error: 'Not a review thread you started on this PR' })
    } else if (thread.isResolved) {
      result.resolved.push(threadId)
    } else {
      try {
        await gh.graphql(RESOLVE_MUTATION, { threadId })
        result.resolved.push(threadId)
      } catch (error) {
        result.failed.push({ threadId, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return result
}
