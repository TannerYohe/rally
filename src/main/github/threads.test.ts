import { describe, expect, it } from 'vitest'
import type { PrRef } from '@shared/types'
import { ownThreads, type RawThread } from './threads'

const pr: PrRef = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }

function thread(overrides: { id?: string; author?: string | null; number?: number; repo?: string; isResolved?: boolean } = {}): RawThread {
  const author = overrides.author === undefined ? 'me' : overrides.author
  return {
    id: overrides.id ?? 'PRRT_1',
    isResolved: overrides.isResolved ?? false,
    isOutdated: false,
    pullRequest: { number: overrides.number ?? 12, repository: { name: overrides.repo ?? 'api', owner: { login: 'acme' } } },
    comments: { nodes: [{ url: 'https://github.com/acme/api/pull/12#discussion_r1', author: author ? { login: author } : null }] },
  }
}

describe('ownThreads', () => {
  it('keeps threads the viewer started on this PR, ignoring login case', () => {
    expect(ownThreads([thread({ author: 'Me', isResolved: true })], 'me', pr)).toEqual([
      { id: 'PRRT_1', url: 'https://github.com/acme/api/pull/12#discussion_r1', isResolved: true, isOutdated: false },
    ])
  })

  it('drops threads someone else started', () => {
    expect(ownThreads([thread({ author: 'teammate' }), thread({ author: null })], 'me', pr)).toEqual([])
  })

  it('drops threads on another PR or repo', () => {
    expect(ownThreads([thread({ number: 13 }), thread({ repo: 'web' })], 'me', pr)).toEqual([])
  })

  it('drops missing nodes and nodes that are not review threads', () => {
    expect(ownThreads([null, { ...thread(), id: undefined }], 'me', pr)).toEqual([])
  })
})
