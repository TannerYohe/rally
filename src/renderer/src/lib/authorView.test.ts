import { describe, expect, it } from 'vitest'
import { authorSession, feedbackItem, itemResponse } from '@shared/authorSession.fixture'
import type { AuthorSession, FeedbackItem } from '@shared/types'

const item = (id: string, kind: FeedbackItem['kind'] = 'thread') => feedbackItem(id, { kind, line: 1, url: null, comments: [], reactionSubjectId: null })
const response = (itemId: string, reply: string) => itemResponse(itemId, reply)
const session = (overrides: Partial<AuthorSession> = {}) => authorSession(1, overrides)
import { feedbackRows, replyPosts, splitWaitingRows } from './authorView'

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
