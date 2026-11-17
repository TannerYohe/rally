import { describe, expect, it } from 'vitest'
import { pendingConversation, threadAcknowledged, type RawConversationComment, type RawReviewBody } from './acknowledgment'

const PR = 'https://github.com/acme/api/pull/1'

const comment = (id: number, login: string, body: string, overrides: Partial<RawConversationComment> = {}): RawConversationComment => ({
  url: `${PR}#issuecomment-${id}`,
  body,
  createdAt: `2026-11-0${id}T00:00:00Z`,
  author: { login, __typename: 'User' },
  reactionGroups: [],
  ...overrides,
})

const review = (id: number, login: string, body: string, overrides: Partial<RawReviewBody> = {}): RawReviewBody => ({
  url: `${PR}#pullrequestreview-${id}`,
  body,
  state: 'COMMENTED',
  submittedAt: '2026-11-01T00:00:00Z',
  author: { login, __typename: 'User' },
  reactionGroups: [],
  ...overrides,
})

describe('threadAcknowledged', () => {
  it('is true when my comment is last or I reacted to the last comment', () => {
    expect(threadAcknowledged({ author: { login: 'Me' } }, 'me')).toBe(true)
    expect(threadAcknowledged({ author: { login: 'bob' }, reactionGroups: [{ viewerHasReacted: true }] }, 'me')).toBe(true)
    expect(threadAcknowledged({ author: { login: 'bob' }, reactionGroups: [{ viewerHasReacted: false }] }, 'me')).toBe(false)
    expect(threadAcknowledged(undefined, 'me')).toBe(false)
  })
})

describe('pendingConversation', () => {
  it('keeps comments and review bodies from people until I react or link to them', () => {
    const comments = [
      comment(1, 'bob', 'Why this approach?'),
      comment(2, 'carol', 'Nice', { reactionGroups: [{ viewerHasReacted: true }] }),
      comment(3, 'dan', 'Can you split this?'),
      comment(4, 'me', `In reply to @dan's [comment](${PR}#issuecomment-3): sure`),
      comment(5, 'codecov', 'Coverage report', { author: { login: 'codecov', __typename: 'Bot' } }),
      comment(6, 'erin', 'spam', { isMinimized: true }),
    ]
    const reviews = [
      review(10, 'bob', 'Overall looks good, a few questions'),
      review(11, 'carol', '', { state: 'APPROVED' }),
      review(12, 'dan', 'LGTM', { state: 'APPROVED' }),
      review(13, 'copilot', 'Copilot reviewed 4 files', { author: { login: 'copilot', __typename: 'Bot' } }),
    ]
    const mine = [...comments, comment(7, 'me', 'Re pullrequestreview-12: thanks!')]
    const pending = pendingConversation(mine, reviews, 'me')
    expect(pending.comments.map((c) => c.url)).toEqual([`${PR}#issuecomment-1`])
    expect(pending.reviews.map((r) => r.url)).toEqual([`${PR}#pullrequestreview-10`])
  })
})
