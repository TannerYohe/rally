import { describe, expect, it } from 'vitest'
import type { AuthorSession, FeedbackItem, ItemResponse } from '@shared/types'
import { feedbackRows, replyPosts, splitWaitingRows } from './authorView'

const item = (id: string, kind: FeedbackItem['kind'] = 'thread'): FeedbackItem => ({
  id,
  kind,
  author: 'bob',
  avatarUrl: null,
  path: 'a.ts',
  line: 1,
  url: null,
  severity: null,
  outdated: false,
  answered: false,
  comments: [],
  replyToCommentId: 1,
  reactionSubjectId: null,
})

const response = (itemId: string, reply: string): ItemResponse => ({ itemId, action: 'push_back', verdict: null, summary: '', reply, commits: [], at: '2026-11-02T00:00:00Z' })

function session(overrides: Partial<AuthorSession> = {}): AuthorSession {
  return {
    id: 's',
    pr: { owner: 'acme', repo: 'api', number: 1, url: '' },
    prKey: 'acme/api#1',
    sdkSessionId: null,
    status: 'awaiting_feedback',
    error: null,
    timeline: [],
    createdAt: '',
    updatedAt: '',
    clone: null,
    items: [],
    responses: {},
    posted: {},
    selfReview: null,
    commits: [],
    uncommitted: [],
    lastPush: null,
    remoteMoved: false,
    ...overrides,
  }
}

describe('feedbackRows', () => {
  it('keeps closed items only while they have an unposted reply, and lists findings last', () => {
    const s = session({
      items: [item('open'), item('closedPending'), item('closedDone')],
      responses: { open: response('open', 'a'), closedPending: response('closedPending', 'b'), closedDone: response('closedDone', '') },
      selfReview: { verdict: '', reportMarkdown: '', findings: [item('self-1', 'finding')] },
    })
    const rows = feedbackRows([item('open')], s)
    expect(rows.map((r) => [r.item.id, r.closedOnGithub, r.response?.reply ?? null])).toEqual([
      ['open', false, 'a'],
      ['closedPending', true, 'b'],
      ['self-1', false, null],
    ])
  })
})

describe('replyPosts', () => {
  it('applies edits and resolve choices to pending replies and skips findings and blanked replies', () => {
    const s = session({
      items: [item('T1'), item('T2'), item('self-1', 'finding')],
      responses: { T1: response('T1', 'Done'), T2: response('T2', 'Nope'), 'self-1': response('self-1', 'n/a') },
    })
    expect(replyPosts(s, { T2: '  ' }, { T1: true })).toEqual([{ itemId: 'T1', body: 'Done', resolve: true }])
  })
})

describe('splitWaitingRows', () => {
  it('moves answered items without a pending reply to waiting', () => {
    const s = session({ items: [item('T2')], responses: { T2: response('T2', 'More') } })
    const rows = feedbackRows([item('T1'), { ...item('T2'), answered: true }, { ...item('T3'), answered: true }], s)
    const { open, waiting } = splitWaitingRows(rows)
    expect(open.map((r) => r.item.id)).toEqual(['T1', 'T2'])
    expect(waiting.map((r) => r.item.id)).toEqual(['T3'])
  })
})
