import { describe, expect, it } from 'vitest'
import { hasPendingWork, itemLocation, pendingReplies } from './authorSession'
import type { AuthorSession, ItemResponse } from './types'

const response = (itemId: string, reply: string, at = '2026-11-02T00:00:00Z'): ItemResponse => ({
  itemId,
  action: 'push_back',
  verdict: null,
  summary: '',
  reply,
  commits: [],
  at,
})

function session(overrides: Partial<AuthorSession> = {}): Pick<AuthorSession, 'status' | 'commits' | 'responses' | 'posted'> {
  return { status: 'awaiting_feedback', commits: [], responses: {}, posted: {}, ...overrides }
}

describe('pendingReplies', () => {
  it('skips empty replies and ones posted after Claude wrote them', () => {
    const s = session({
      responses: { a: response('a', 'Done'), b: response('b', ' '), c: response('c', 'Later') },
      posted: { a: { at: '2026-11-03T00:00:00Z', url: null, resolved: false, error: null } },
    })
    expect(pendingReplies(s).map((r) => r.itemId)).toEqual(['c'])
  })

  it('counts a reply again when Claude rewrote it after posting or posting failed', () => {
    const s = session({
      responses: { a: response('a', 'New', '2026-11-04T00:00:00Z'), b: response('b', 'Retry') },
      posted: {
        a: { at: '2026-11-03T00:00:00Z', url: null, resolved: false, error: null },
        b: { at: '2026-11-03T00:00:00Z', url: null, resolved: false, error: 'rate limited' },
      },
    })
    expect(pendingReplies(s).map((r) => r.itemId)).toEqual(['a', 'b'])
  })
})

describe('hasPendingWork', () => {
  it('is false once everything is pushed and posted', () => {
    expect(hasPendingWork(session())).toBe(false)
  })

  it('is true while running, with unpushed commits, or with unposted replies', () => {
    expect(hasPendingWork(session({ status: 'running' }))).toBe(true)
    expect(hasPendingWork(session({ commits: [{ oid: 'a', subject: 'fix' }] }))).toBe(true)
    expect(hasPendingWork(session({ responses: { a: response('a', 'Done') } }))).toBe(true)
  })
})

describe('itemLocation', () => {
  it('names the file and line, or the kind of comment', () => {
    expect(itemLocation({ kind: 'thread', path: 'a.ts', line: 3 })).toBe('a.ts:3')
    expect(itemLocation({ kind: 'review', path: null, line: null })).toBe('Review comment')
  })
})
