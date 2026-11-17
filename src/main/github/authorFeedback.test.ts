import { describe, expect, it } from 'vitest'
import { feedbackItems, type RawFeedbackComment, type RawFeedbackReview, type RawFeedbackThread } from './authorFeedback'

const PR = 'https://github.com/acme/api/pull/1'

const actor = (login: string, __typename = 'User') => ({ login, __typename, avatarUrl: '' })

const threadComment = (login: string, createdAt: string, databaseId = 1, reacted = false) => ({
  id: `C${databaseId}`,
  databaseId,
  url: `${PR}#discussion_r${databaseId}`,
  body: `from ${login}`,
  createdAt,
  author: actor(login),
  reactionGroups: [{ viewerHasReacted: reacted }],
})

function thread(id: string, overrides: Partial<RawFeedbackThread> = {}, ...comments: ReturnType<typeof threadComment>[]): RawFeedbackThread {
  return { id, isResolved: false, isOutdated: false, path: 'a.ts', line: 3, originalLine: 2, comments: { nodes: comments }, ...overrides }
}

const prComment = (id: number, login: string, body: string, kind = 'User'): RawFeedbackComment => ({
  id: `IC${id}`,
  url: `${PR}#issuecomment-${id}`,
  body,
  createdAt: `2026-11-0${id}T00:00:00Z`,
  author: actor(login, kind),
  reactionGroups: [],
})

const review = (id: number, state: string, login: string, body = 'Please fix'): RawFeedbackReview => ({
  id: `R${id}`,
  url: `${PR}#pullrequestreview-${id}`,
  body,
  state,
  submittedAt: '2026-11-03T00:00:00Z',
  author: actor(login),
  reactionGroups: [],
})

describe('feedbackItems', () => {
  it('keeps open threads and marks ones I replied to or reacted to last as answered', () => {
    const items = feedbackItems(
      [
        thread('T1', {}, threadComment('bob', '2026-11-01T00:00:00Z', 11)),
        thread('T2', {}, threadComment('bob', '2026-11-01T00:00:00Z', 21), threadComment('Me', '2026-11-02T00:00:00Z', 22)),
        thread('T3', {}, threadComment('bob', '2026-11-01T00:00:00Z', 31, true)),
        thread('T4', { isResolved: true }, threadComment('bob', '2026-11-01T00:00:00Z')),
      ],
      [],
      [],
      'me',
    )
    expect(items.map((i) => [i.id, i.answered])).toEqual([
      ['T1', false],
      ['T2', true],
      ['T3', true],
    ])
    expect(items[0]).toMatchObject({ kind: 'thread', author: 'bob', path: 'a.ts', line: 3, replyToCommentId: 11, reactionSubjectId: 'C11' })
    expect(items[1].reactionSubjectId).toBe('C22')
  })

  it('falls back to the original line on outdated threads', () => {
    const [item] = feedbackItems([thread('T1', { line: null, isOutdated: true }, threadComment('bob', '2026-11-01T00:00:00Z'))], [], [], 'me')
    expect(item).toMatchObject({ line: 2, outdated: true })
  })

  it('lists unacknowledged PR comments and review bodies of any state', () => {
    const items = feedbackItems(
      [],
      [prComment(1, 'bob', 'Why not reuse the helper?'), prComment(2, 'codecov', 'Coverage', 'Bot')],
      [review(10, 'CHANGES_REQUESTED', 'carol'), review(11, 'APPROVED', 'dan', 'LGTM, one nit'), review(12, 'APPROVED', 'erin', '')],
      'me',
    )
    expect(items.map((i) => [i.id, i.kind])).toEqual([
      ['R10', 'review'],
      ['R11', 'review'],
      ['IC1', 'comment'],
    ])
    expect(items[2]).toMatchObject({ author: 'bob', path: null, reactionSubjectId: 'IC1', url: `${PR}#issuecomment-1` })
  })

  it('orders unanswered items by newest activity', () => {
    const items = feedbackItems(
      [thread('old', {}, threadComment('bob', '2026-11-01T00:00:00Z')), thread('new', {}, threadComment('bob', '2026-11-05T00:00:00Z'))],
      [],
      [],
      'me',
    )
    expect(items.map((i) => i.id)).toEqual(['new', 'old'])
  })
})
