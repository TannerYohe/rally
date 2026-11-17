import { describe, expect, it } from 'vitest'
import { canPush, cloneChangeCount, committableFiles, hasPendingWork, hasUnsharedWork, itemLocation, pendingReplies } from './authorSession'
import { feedbackItem, itemResponse } from './authorSession.fixture'
import type { AuthorSession, FeedbackItem } from './types'

const response = (itemId: string, reply: string, at?: string) => itemResponse(itemId, reply, at ? { at } : {})
const item = (id: string, kind: FeedbackItem['kind'] = 'thread') => feedbackItem(id, { kind })

function session(overrides: Partial<AuthorSession> = {}): Pick<AuthorSession, 'status' | 'commits' | 'uncommitted' | 'responses' | 'posted' | 'items'> {
  return { status: 'awaiting_feedback', commits: [], uncommitted: [], responses: {}, posted: {}, items: ['a', 'b', 'c'].map((id) => item(id)), ...overrides }
}

describe('pendingReplies', () => {
  it('skips empty replies and ones posted after Claude wrote them', () => {
    const s = session({
      responses: { a: response('a', 'Done'), b: response('b', ' '), c: response('c', 'Later') },
      posted: { a: { at: '2026-11-03T00:00:00Z', body: '', url: null, resolved: false, error: null, resolveError: null } },
    })
    expect(pendingReplies(s).map((r) => r.itemId)).toEqual(['c'])
  })

  it('counts a reply again when Claude rewrote it after posting or posting failed', () => {
    const s = session({
      responses: { a: response('a', 'New', '2026-11-04T00:00:00Z'), b: response('b', 'Retry') },
      posted: {
        a: { at: '2026-11-03T00:00:00Z', body: '', url: null, resolved: false, error: null, resolveError: null },
        b: { at: '2026-11-03T00:00:00Z', body: '', url: null, resolved: false, error: 'rate limited', resolveError: null },
      },
    })
    expect(pendingReplies(s).map((r) => r.itemId)).toEqual(['a', 'b'])
  })
})

describe('pendingReplies on findings', () => {
  it('leaves out replies Rally can never post, so a fixed finding does not pin the PR in progress', () => {
    const s = session({ items: [item('self-1', 'finding')], responses: { 'self-1': response('self-1', 'Fixed in abc') } })
    expect(pendingReplies(s)).toEqual([])
    expect(hasPendingWork(s)).toBe(false)
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

describe('hasUnsharedWork', () => {
  it('ignores the last turn status and counts only uncommitted edits, unpushed commits, and unposted replies', () => {
    expect(hasUnsharedWork(session({ status: 'error' }))).toBe(false)
    expect(hasUnsharedWork(session({ uncommitted: ['a.ts'] }))).toBe(true)
    expect(hasUnsharedWork(session({ commits: [{ oid: 'a', subject: 'fix' }] }))).toBe(true)
    expect(hasUnsharedWork(session({ responses: { a: response('a', 'Done') } }))).toBe(true)
  })
})

describe('itemLocation', () => {
  it('names the file and line, or the kind of comment', () => {
    expect(itemLocation({ kind: 'thread', path: 'a.ts', line: 3 })).toBe('a.ts:3')
    expect(itemLocation({ kind: 'review', path: null, line: null })).toBe('Review summary')
    expect(itemLocation({ kind: 'comment', path: null, line: null })).toBe('PR comment')
  })
})

describe('canPush', () => {
  const commits = [{ oid: 'a', subject: 'fix' }]

  it('is true with commits and no open merge, even with uncommitted files', () => {
    expect(canPush({ commits, mergeConflicts: [] })).toBe(true)
    expect(canPush({ commits: [], mergeConflicts: [] })).toBe(false)
    expect(canPush({ commits, mergeConflicts: ['a.ts'] })).toBe(false)
  })
})

describe('committableFiles', () => {
  it('lists uncommitted files except while a merge is open', () => {
    expect(committableFiles({ uncommitted: ['a.ts'], mergeConflicts: [] })).toEqual(['a.ts'])
    expect(committableFiles({ uncommitted: ['a.ts', 'merged.ts'], mergeConflicts: ['a.ts'] })).toEqual([])
  })
})

describe('cloneChangeCount', () => {
  it('adds committable files and unpushed commits', () => {
    const commits = [{ oid: 'a', subject: 'fix' }]
    expect(cloneChangeCount({ commits, uncommitted: ['a.ts', 'b.ts'], mergeConflicts: [] })).toBe(3)
    expect(cloneChangeCount({ commits, uncommitted: ['a.ts', 'merged.ts'], mergeConflicts: ['a.ts'] })).toBe(1)
  })
})
