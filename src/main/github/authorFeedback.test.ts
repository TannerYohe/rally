import { describe, expect, it } from 'vitest'
import { feedbackItems, type RawFeedbackThread, type RawOpinionatedReview } from './authorFeedback'

const comment = (login: string, createdAt: string, databaseId = 1) => ({
  databaseId,
  url: `https://github.com/acme/api/pull/1#discussion_r${databaseId}`,
  body: `from ${login}`,
  createdAt,
  author: { login, avatarUrl: '' },
})

function thread(id: string, overrides: Partial<RawFeedbackThread> = {}, ...comments: ReturnType<typeof comment>[]): RawFeedbackThread {
  return { id, isResolved: false, isOutdated: false, path: 'a.ts', line: 3, originalLine: 2, comments: { nodes: comments }, ...overrides }
}

function review(id: string, state: string, login: string, body = 'Please fix'): RawOpinionatedReview {
  return { id, url: `https://github.com/acme/api/pull/1#${id}`, body, state, submittedAt: '2026-11-03T00:00:00Z', author: { login, avatarUrl: '' } }
}

describe('feedbackItems', () => {
  it('keeps open threads and marks the ones I replied to last as answered', () => {
    const items = feedbackItems(
      [
        thread('T1', {}, comment('bob', '2026-11-01T00:00:00Z', 11)),
        thread('T2', {}, comment('bob', '2026-11-01T00:00:00Z', 21), comment('Me', '2026-11-02T00:00:00Z', 22)),
        thread('T3', { isResolved: true }, comment('bob', '2026-11-01T00:00:00Z')),
      ],
      [],
      'me',
    )
    expect(items.map((i) => [i.id, i.answered])).toEqual([
      ['T1', false],
      ['T2', true],
    ])
    expect(items[0]).toMatchObject({ kind: 'thread', author: 'bob', path: 'a.ts', line: 3, replyToCommentId: 11 })
  })

  it('falls back to the original line on outdated threads', () => {
    const [item] = feedbackItems([thread('T1', { line: null, isOutdated: true }, comment('bob', '2026-11-01T00:00:00Z'))], [], 'me')
    expect(item).toMatchObject({ line: 2, outdated: true })
  })

  it('lists change requests from others that have a body', () => {
    const items = feedbackItems(
      [],
      [review('R1', 'CHANGES_REQUESTED', 'bob'), review('R2', 'APPROVED', 'carol'), review('R3', 'CHANGES_REQUESTED', 'dan', ' ')],
      'me',
    )
    expect(items.map((i) => i.id)).toEqual(['R1'])
    expect(items[0]).toMatchObject({ kind: 'review', author: 'bob', path: null })
  })

  it('orders unanswered items by newest activity', () => {
    const items = feedbackItems(
      [thread('old', {}, comment('bob', '2026-11-01T00:00:00Z')), thread('new', {}, comment('bob', '2026-11-05T00:00:00Z'))],
      [],
      'me',
    )
    expect(items.map((i) => i.id)).toEqual(['new', 'old'])
  })
})
