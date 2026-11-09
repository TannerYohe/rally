import { GraphqlResponseError } from '@octokit/graphql'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrRef } from '@shared/types'
import type { RawThread } from './threads'

const mocks = vi.hoisted(() => ({ graphql: vi.fn() }))

vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  github: async () => ({ login: 'me', graphql: mocks.graphql }),
}))

const { lookupThread, resolveOwnThreads } = await import('./threads')

const pr: PrRef = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }
const url = 'https://github.com/acme/api/pull/12#discussion_r1'

interface ThreadOverrides {
  author?: string | null
  number?: number
  repo?: string
  owner?: string
  isResolved?: boolean
}

function thread(overrides: ThreadOverrides & { id?: string } = {}): RawThread {
  const author = overrides.author === undefined ? 'me' : overrides.author
  return {
    id: overrides.id ?? 'PRRT_1',
    isResolved: overrides.isResolved ?? false,
    isOutdated: false,
    pullRequest: {
      number: overrides.number ?? 12,
      repository: { name: overrides.repo ?? 'api', owner: { login: overrides.owner ?? 'acme' } },
    },
    comments: { nodes: [{ url, author: author ? { login: author } : null }] },
  }
}

describe('lookupThread', () => {
  it('returns threads the viewer started on this PR, ignoring login case', () => {
    expect(lookupThread(thread({ author: 'Me', isResolved: true }), 'me', pr)).toEqual({
      kind: 'own',
      thread: { id: 'PRRT_1', url, isResolved: true, isOutdated: false },
    })
  })

  it('rejects threads someone else started', () => {
    expect(lookupThread(thread({ author: 'teammate' }), 'me', pr)).toEqual({ kind: 'not_own' })
    expect(lookupThread(thread({ author: null }), 'me', pr)).toEqual({ kind: 'not_own' })
  })

  it('rejects threads on another PR, repo, or owner', () => {
    expect(lookupThread(thread({ number: 13 }), 'me', pr)).toEqual({ kind: 'not_own' })
    expect(lookupThread(thread({ repo: 'web' }), 'me', pr)).toEqual({ kind: 'not_own' })
    expect(lookupThread(thread({ owner: 'other' }), 'me', pr)).toEqual({ kind: 'not_own' })
  })

  it('reports missing nodes as not found', () => {
    expect(lookupThread(null, 'me', pr)).toEqual({ kind: 'not_found' })
  })

  it('rejects nodes that are not review threads', () => {
    expect(lookupThread({}, 'me', pr)).toEqual({ kind: 'not_own' })
  })
})

describe('resolveOwnThreads', () => {
  let threads: Record<string, RawThread | null>
  let failingMutations: Set<string>

  beforeEach(() => {
    threads = {}
    failingMutations = new Set()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.graphql.mockReset()
    mocks.graphql.mockImplementation(async (query: string, variables: { ids?: string[]; threadId?: string }) => {
      if (variables.ids) return { nodes: variables.ids.map((id) => threads[id] ?? null) }
      if (failingMutations.has(variables.threadId!)) throw new Error('GitHub said no')
      return { resolveReviewThread: { thread: { id: variables.threadId, isResolved: true } } }
    })
  })

  const mutatedIds = () => mocks.graphql.mock.calls.flatMap(([, variables]) => (variables.threadId ? [variables.threadId] : []))

  it('resolves open threads the viewer started, with a timeout on every GitHub call', async () => {
    threads.T1 = thread({ id: 'T1' })
    expect(await resolveOwnThreads(pr, ['T1'])).toEqual({ resolved: ['T1'], failed: [] })
    expect(mutatedIds()).toEqual(['T1'])
    for (const [, variables] of mocks.graphql.mock.calls) expect(variables.request.signal).toBeInstanceOf(AbortSignal)
  })

  it('refuses threads the viewer did not start and ids GitHub cannot find, without mutating', async () => {
    threads.T1 = thread({ id: 'T1', author: 'teammate' })
    expect(await resolveOwnThreads(pr, ['T1', 'T2'])).toEqual({
      resolved: [],
      failed: [
        { threadId: 'T1', error: 'Not a review thread you started on this PR' },
        { threadId: 'T2', error: 'Review thread not found' },
      ],
    })
    expect(mutatedIds()).toEqual([])
  })

  it('treats already resolved threads as done without mutating', async () => {
    threads.T1 = thread({ id: 'T1', isResolved: true })
    expect(await resolveOwnThreads(pr, ['T1'])).toEqual({ resolved: ['T1'], failed: [] })
    expect(mutatedIds()).toEqual([])
  })

  it('keeps going when one mutation fails', async () => {
    for (const id of ['T1', 'T2', 'T3']) threads[id] = thread({ id })
    failingMutations.add('T2')
    expect(await resolveOwnThreads(pr, ['T1', 'T2', 'T3'])).toEqual({
      resolved: ['T1', 'T3'],
      failed: [{ threadId: 'T2', error: 'GitHub said no' }],
    })
  })

  it('resolves each thread once when ids repeat', async () => {
    threads.T1 = thread({ id: 'T1' })
    expect(await resolveOwnThreads(pr, ['T1', 'T1'])).toEqual({ resolved: ['T1'], failed: [] })
    expect(mutatedIds()).toEqual(['T1'])
  })

  it('uses the partial data GitHub returns alongside errors for unknown ids', async () => {
    threads.T1 = thread({ id: 'T1' })
    mocks.graphql.mockImplementationOnce(async (query: string, variables: { ids: string[] }) => {
      const data = { nodes: variables.ids.map((id) => threads[id] ?? null) }
      throw new GraphqlResponseError({ method: 'POST', url: '/graphql' }, {}, { data, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a node', path: ['nodes'], extensions: {}, locations: [{ line: 1, column: 1 }] }] })
    })
    expect(await resolveOwnThreads(pr, ['T1', 'missing'])).toEqual({
      resolved: ['T1'],
      failed: [{ threadId: 'missing', error: 'Review thread not found' }],
    })
    expect(console.warn).toHaveBeenCalledWith('GitHub node lookup returned partial errors', expect.objectContaining({ errors: expect.any(Array) }))
  })
})
