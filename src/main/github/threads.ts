import { isSamePr, type PrRef, type ReviewThread, type ThreadResolution } from '@shared/types'
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
  isResolved?: boolean
  isOutdated?: boolean
  pullRequest?: { number: number; repository: { name: string; owner: { login: string } } }
  comments?: { nodes: { url: string; author: { login: string } | null }[] }
}

export type ThreadLookup = { kind: 'own'; thread: ReviewThread } | { kind: 'not_found' } | { kind: 'not_own' }

const GITHUB_TIMEOUT_MS = 15_000
const NOT_FOUND_ERROR = 'Review thread not found'
const NOT_OWN_ERROR = 'Not a review thread you started on this PR'

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function lookupThread(node: RawThread | null, viewer: string, pr: PrRef): ThreadLookup {
  if (!node) return { kind: 'not_found' }
  const first = node.comments?.nodes?.[0]
  const onPr = node.pullRequest
  if (!node.id || !first?.author || !onPr) return { kind: 'not_own' }
  const samePr = isSamePr({ owner: onPr.repository.owner.login, repo: onPr.repository.name, number: onPr.number }, pr)
  if (!samePr || !sameLogin(first.author.login, viewer)) return { kind: 'not_own' }
  return { kind: 'own', thread: { id: node.id, url: first.url, isResolved: Boolean(node.isResolved), isOutdated: Boolean(node.isOutdated) } }
}

async function lookupThreads(pr: PrRef, threadIds: string[]): Promise<Map<string, ThreadLookup>> {
  const ids = [...new Set(threadIds)]
  if (ids.length === 0) return new Map()
  const gh = await github()
  const nodes = await fetchNodes<RawThread>(gh, THREADS_QUERY, ids, GITHUB_TIMEOUT_MS)
  return new Map(ids.map((id, index) => [id, lookupThread(nodes[index] ?? null, gh.login, pr)]))
}

export async function fetchOwnThreads(pr: PrRef, threadIds: string[]): Promise<ReviewThread[]> {
  const lookups = await lookupThreads(pr, threadIds)
  return [...lookups.values()].flatMap((lookup) => (lookup.kind === 'own' ? [lookup.thread] : []))
}

export async function resolveOwnThreads(pr: PrRef, threadIds: string[]): Promise<Omit<ThreadResolution, 'at'>> {
  const gh = await github()
  const lookups = await lookupThreads(pr, threadIds)
  const result: Omit<ThreadResolution, 'at'> = { resolved: [], failed: [] }
  const fail = (threadId: string, error: string) => {
    console.error('Resolving review thread failed', { pr: pr.url, threadId, error })
    result.failed.push({ threadId, error })
  }
  for (const [threadId, lookup] of lookups) {
    if (lookup.kind === 'not_found') fail(threadId, NOT_FOUND_ERROR)
    else if (lookup.kind === 'not_own') fail(threadId, NOT_OWN_ERROR)
    else if (lookup.thread.isResolved) result.resolved.push(threadId)
    else {
      try {
        await gh.graphql(RESOLVE_MUTATION, { threadId, request: { signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) } })
        result.resolved.push(threadId)
      } catch (error) {
        fail(threadId, error instanceof Error ? error.message : String(error))
      }
    }
  }
  return result
}
