import { describe, expect, it } from 'vitest'
import {
  actionableItems,
  canPush,
  checkoutNoun,
  cloneChangeCount,
  committableFiles,
  discardQuestion,
  handledFindingIds,
  hasPendingWork,
  hasUnsharedWork,
  itemLocation,
  pendingChangeCount,
  pendingReplies,
  sameDescription,
  startOverQuestion,
} from './authorSession'
import { descriptionDraft, feedbackItem, itemResponse } from './authorSession.fixture'
import type { AuthorSession, FeedbackItem } from './types'

const response = (itemId: string, reply: string, at?: string) => itemResponse(itemId, reply, at ? { at } : {})
const item = (id: string, kind: FeedbackItem['kind'] = 'thread') => feedbackItem(id, { kind })

type WorkFields = 'status' | 'commits' | 'uncommitted' | 'responses' | 'posted' | 'items' | 'description'

const DESCRIPTION = descriptionDraft()

function session(overrides: Partial<AuthorSession> = {}): Pick<AuthorSession, WorkFields> {
  return { status: 'awaiting_feedback', commits: [], uncommitted: [], responses: {}, posted: {}, items: ['a', 'b', 'c'].map((id) => item(id)), description: null, ...overrides }
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

describe('actionableItems', () => {
  it('lists the open items, then the self-review findings', () => {
    const findings = [item('self-1', 'finding')]
    expect(actionableItems([item('a')], { selfReview: { verdict: '', reportMarkdown: '', findings } }).map((i) => i.id)).toEqual(['a', 'self-1'])
    expect(actionableItems([item('a')], null).map((i) => i.id)).toEqual(['a'])
  })
})

describe('pendingReplies on findings', () => {
  it('leaves out replies Rally can never post, so a fixed finding does not pin the PR in progress', () => {
    const s = session({ items: [item('self-1', 'finding')], responses: { 'self-1': response('self-1', 'Fixed in abc') } })
    expect(pendingReplies(s)).toEqual([])
    expect(hasPendingWork(s)).toBe(false)
  })
})

describe('handledFindingIds', () => {
  it('lists findings Claude answered, leaving out ones without a response, still waiting on a commit, or whose commit failed', () => {
    const findings = ['self-1', 'self-2', 'self-3', 'self-4'].map((id) => item(id, 'finding'))
    const responses = {
      'self-1': itemResponse('self-1', '', { action: 'push_back' }),
      'self-2': itemResponse('self-2', '', { action: 'fix', pendingCommit: true }),
      'self-4': itemResponse('self-4', '', { action: 'fix', commitError: 'Nothing to commit' }),
      T1: itemResponse('T1', 'Done'),
    }
    expect(handledFindingIds({ selfReview: { verdict: '', reportMarkdown: '', findings }, responses })).toEqual(['self-1'])
    expect(handledFindingIds({ selfReview: null, responses })).toEqual([])
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
  it('ignores the last turn status and counts only uncommitted edits, unpushed commits, unposted replies, and a description update', () => {
    expect(hasUnsharedWork(session({ status: 'error' }))).toBe(false)
    expect(hasUnsharedWork(session({ uncommitted: ['a.ts'] }))).toBe(true)
    expect(hasUnsharedWork(session({ commits: [{ oid: 'a', subject: 'fix' }] }))).toBe(true)
    expect(hasUnsharedWork(session({ responses: { a: response('a', 'Done') } }))).toBe(true)
    expect(hasUnsharedWork(session({ description: DESCRIPTION }))).toBe(true)
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

  it('is true with commits or a description update and no open merge, even with uncommitted files', () => {
    expect(canPush({ commits, mergeConflicts: [], description: null })).toBe(true)
    expect(canPush({ commits: [], mergeConflicts: [], description: DESCRIPTION })).toBe(true)
    expect(canPush({ commits: [], mergeConflicts: [], description: null })).toBe(false)
    expect(canPush({ commits, mergeConflicts: ['a.ts'], description: DESCRIPTION })).toBe(false)
  })
})

describe('pendingChangeCount', () => {
  it('counts committable files, unpushed commits, and a description update', () => {
    const commits = [{ oid: 'a', subject: 'fix' }]
    expect(pendingChangeCount({ commits, uncommitted: ['a.ts'], mergeConflicts: [], description: DESCRIPTION })).toBe(3)
    expect(pendingChangeCount({ commits: [], uncommitted: [], mergeConflicts: [], description: null })).toBe(0)
  })
})

describe('sameDescription', () => {
  it('ignores CRLF line endings and outer whitespace', () => {
    expect(sameDescription({ title: ' Fix ', body: 'a\r\nb\r\n' }, { title: 'Fix', body: 'a\nb' })).toBe(true)
    expect(sameDescription({ title: 'Fix', body: 'a' }, { title: 'Fix', body: 'b' })).toBe(false)
    expect(sameDescription({ title: 'Fix', body: 'a' }, { title: 'Fix it', body: 'a' })).toBe(false)
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

describe('discardQuestion', () => {
  const clone = { path: '/w/api', branch: 'feature', baseRef: 'origin/main' }

  it('counts the files for the temp clone', () => {
    expect(discardQuestion(clone, ['a.ts', 'b.ts'])).toBe('Discard 2 uncommitted files in the clone?')
  })

  it('names the worktree folder and lists the files, up to ten', () => {
    const files = Array.from({ length: 12 }, (_, i) => `f${i}.ts`)
    const question = discardQuestion({ ...clone, kind: 'local_worktree' }, files)
    expect(question).toContain('Discard 12 uncommitted files in the worktree at /w/api?')
    expect(question).toContain('  f9.ts')
    expect(question).not.toContain('f10.ts')
    expect(question).toContain('and 2 more')
  })
})

describe('startOverQuestion', () => {
  const clone = { path: '/w/api', branch: 'feature', baseRef: 'origin/main' }

  it('names what discarding deletes for each kind of checkout', () => {
    expect(startOverQuestion(null)).toBe('Discard this session, its unposted replies, and description update?')
    expect(startOverQuestion(clone)).toContain('its clone, unpushed commits')
    expect(startOverQuestion({ ...clone, kind: 'local_worktree' })).toContain('Your worktree at /w/api keeps its edits and commits')
    expect(startOverQuestion({ ...clone, kind: 'rally_worktree', createdBranch: true })).toContain('with its edits and unpushed commits')
    expect(startOverQuestion({ ...clone, kind: 'rally_worktree', createdBranch: false })).toContain('Commits stay on feature')
  })

  it('calls a worktree a worktree and anything else the clone', () => {
    expect(checkoutNoun({ ...clone, kind: 'rally_worktree' })).toBe('worktree')
    expect(checkoutNoun(clone)).toBe('clone')
    expect(checkoutNoun(null)).toBe('clone')
  })
})
