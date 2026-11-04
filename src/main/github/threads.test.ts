import { describe, expect, it } from 'vitest'
import type { PrRef } from '@shared/types'
import { lookupThread, type RawThread } from './threads'

const pr: PrRef = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }
const url = 'https://github.com/acme/api/pull/12#discussion_r1'

interface ThreadOverrides {
  author?: string | null
  number?: number
  repo?: string
  owner?: string
  isResolved?: boolean
}

function thread(overrides: ThreadOverrides = {}): RawThread {
  const author = overrides.author === undefined ? 'me' : overrides.author
  return {
    id: 'PRRT_1',
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
