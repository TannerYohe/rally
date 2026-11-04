import { describe, expect, it } from 'vitest'
import type { ReviewSession, TimelineEntry, TurnMode } from '@shared/types'
import { lastTurnStartedAt, prUpdatedSinceLastTurn } from './sessionStatus'

const createdAt = '2026-11-04T18:00:00.000Z'
const user = (id: string, at: string, turn?: TurnMode): TimelineEntry => ({ kind: 'user', id, text: id, at, turn })
const text = (id: string, at: string): TimelineEntry => ({ kind: 'text', id, text: id, at })

describe('lastTurnStartedAt', () => {
  it('falls back to the session start before any turn', () => {
    expect(lastTurnStartedAt({ createdAt, timeline: [] })).toBe(createdAt)
  })

  it('falls back to the session start when the timeline has no user entries', () => {
    const timeline = [text('reply', '2026-11-04T18:05:00.000Z')]
    expect(lastTurnStartedAt({ createdAt, timeline })).toBe(createdAt)
  })

  it('returns the time of the most recent user turn', () => {
    const timeline = [
      user('review', '2026-11-04T18:00:01.000Z', 'review'),
      text('reply', '2026-11-04T18:05:00.000Z'),
      user('feedback', '2026-11-04T19:00:00.000Z', 'refine'),
      text('reply-2', '2026-11-04T19:02:00.000Z'),
    ]
    expect(lastTurnStartedAt({ createdAt, timeline })).toBe('2026-11-04T19:00:00.000Z')
  })

  it('skips submit turns', () => {
    const timeline = [user('feedback', '2026-11-04T19:00:00.000Z', 'refine'), user('submit', '2026-11-04T19:10:00.000Z', 'submit')]
    expect(lastTurnStartedAt({ createdAt, timeline })).toBe('2026-11-04T19:00:00.000Z')
  })
})

describe('prUpdatedSinceLastTurn', () => {
  const session = (overrides: Partial<ReviewSession> = {}) => ({
    createdAt,
    status: 'awaiting_feedback' as const,
    submitted: null,
    timeline: [user('review', '2026-11-04T19:00:00.500Z', 'review')],
    ...overrides,
  })

  it('is true when the PR changed after the last turn started', () => {
    expect(prUpdatedSinceLastTurn(session(), '2026-11-04T19:00:01Z')).toBe(true)
  })

  it('is false when the PR changed earlier in the same second as the turn start', () => {
    expect(prUpdatedSinceLastTurn(session(), '2026-11-04T19:00:00Z')).toBe(false)
  })

  it('is false without a PR update time', () => {
    expect(prUpdatedSinceLastTurn(session(), null)).toBe(false)
  })

  it('ignores a submit turn that posted to GitHub before erroring', () => {
    const timeline = [user('review', '2026-11-04T19:00:00.000Z', 'review'), user('submit', '2026-11-04T19:10:00.000Z', 'submit')]
    const submitted = { reviewId: 1, url: 'https://github.com/o/r/pull/1#review', event: 'COMMENT' as const }
    expect(prUpdatedSinceLastTurn(session({ timeline, status: 'error', submitted }), '2026-11-04T19:10:05Z')).toBe(false)
  })
})
