import { describe, expect, it } from 'vitest'
import { authorSession, feedbackItem, itemResponse } from '@shared/authorSession.fixture'
import type { AuthorSession, FeedbackItem } from '@shared/types'

const item = (id: string, kind: FeedbackItem['kind'] = 'thread') => feedbackItem(id, { kind, line: 1, url: null, comments: [], reactionSubjectId: null })
const response = (itemId: string, reply: string) => itemResponse(itemId, reply)
const session = (overrides: Partial<AuthorSession> = {}) => authorSession(1, overrides)
import { actionRequests, feedbackRows, replyPosts, splitWaitingRows } from './authorView'

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

describe('feedbackRows with findings', () => {
  it('lists a finding Claude answered once, as a finding', () => {
    const finding = item('self-1', 'finding')
    const s = session({ items: [finding], responses: { 'self-1': response('self-1', 'Fixed') }, selfReview: { verdict: '', reportMarkdown: '', findings: [finding] } })
    expect(feedbackRows([], s).map((r) => [r.item.id, r.closedOnGithub])).toEqual([['self-1', false]])
  })
})

describe('actionRequests', () => {
  it('sends picks on open comments and listed findings, and skips closed comments and dismissed findings', () => {
    const s = session({
      items: [item('open'), item('closedPending')],
      responses: { closedPending: response('closedPending', 'b') },
      selfReview: { verdict: '', reportMarkdown: '', findings: [item('self-1', 'finding')] },
    })
    const picks = {
      open: { action: 'fix' as const, note: 'n' },
      closedPending: { action: 'fix' as const, note: '' },
      'self-1': { action: 'investigate' as const, note: '' },
      'self-2': { action: 'fix' as const, note: '' },
    }
    expect(actionRequests(picks, [item('open')], s)).toEqual([
      { itemId: 'open', action: 'fix', note: 'n' },
      { itemId: 'self-1', action: 'investigate', note: '' },
    ])
  })

  it('sends picks on open comments before a session exists', () => {
    expect(actionRequests({ fresh: { action: 'fix', note: '' } }, [item('fresh')], null)).toEqual([{ itemId: 'fresh', action: 'fix', note: '' }])
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
