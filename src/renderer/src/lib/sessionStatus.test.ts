import { describe, expect, it } from 'vitest'
import type { ReviewSession, TimelineEntry, TurnMode } from '@shared/types'
import { isSubmitted, lastSuccessfulTurnStartedAt, prUpdatedSinceLastSuccessfulTurn } from './sessionStatus'

const createdAt = '2026-11-04T18:00:00.000Z'
const user = (id: string, at: string, turn?: TurnMode): TimelineEntry => ({ kind: 'user', id, text: id, at, turn })
const text = (id: string, at: string): TimelineEntry => ({ kind: 'text', id, text: id, at })
const result = (id: string, at: string, ok: boolean): TimelineEntry => ({ kind: 'result', id, ok, text: '', costUsd: 0, durationMs: 0, at })

describe('lastSuccessfulTurnStartedAt', () => {
  const status = 'awaiting_feedback' as const

  it('falls back to the session start before any turn', () => {
    expect(lastSuccessfulTurnStartedAt({ createdAt, status, timeline: [] })).toBe(createdAt)
  })

  it('falls back to the session start when the timeline has no user entries', () => {
    const timeline = [text('reply', '2026-11-04T18:05:00.000Z')]
    expect(lastSuccessfulTurnStartedAt({ createdAt, status, timeline })).toBe(createdAt)
  })

  it('returns the time of the most recent user turn', () => {
    const timeline = [
      user('review', '2026-11-04T18:00:01.000Z', 'review'),
      text('reply', '2026-11-04T18:05:00.000Z'),
      result('result', '2026-11-04T18:06:00.000Z', true),
      user('feedback', '2026-11-04T19:00:00.000Z', 'refine'),
      text('reply-2', '2026-11-04T19:02:00.000Z'),
    ]
    expect(lastSuccessfulTurnStartedAt({ createdAt, status, timeline })).toBe('2026-11-04T19:00:00.000Z')
  })

  it('counts a turn that is still running', () => {
    const timeline = [user('review', '2026-11-04T18:00:01.000Z', 'review')]
    expect(lastSuccessfulTurnStartedAt({ createdAt, status: 'running', timeline })).toBe('2026-11-04T18:00:01.000Z')
  })

  describe('skips a turn that did not succeed', () => {
    const succeeded = [
      user('review', '2026-11-04T18:00:01.000Z', 'review'),
      result('result', '2026-11-04T18:06:00.000Z', true),
    ]

    it('when it ended with an error result', () => {
      const timeline = [...succeeded, user('pull', '2026-11-04T19:00:00.000Z', 'refine'), result('failed', '2026-11-04T19:01:00.000Z', false)]
      expect(lastSuccessfulTurnStartedAt({ createdAt, status: 'error', timeline })).toBe('2026-11-04T18:00:01.000Z')
    })

    it('when it threw or was cancelled before a result', () => {
      const timeline = [...succeeded, user('pull', '2026-11-04T19:00:00.000Z', 'refine'), text('reading', '2026-11-04T19:00:30.000Z')]
      expect(lastSuccessfulTurnStartedAt({ createdAt, status: 'error', timeline })).toBe('2026-11-04T18:00:01.000Z')
      expect(lastSuccessfulTurnStartedAt({ createdAt, status: 'cancelled', timeline })).toBe('2026-11-04T18:00:01.000Z')
    })

    it('when an earlier turn failed and a later one is also failing', () => {
      const timeline = [
        ...succeeded,
        user('pull', '2026-11-04T19:00:00.000Z', 'refine'),
        user('retry', '2026-11-04T19:05:00.000Z', 'refine'),
        result('failed', '2026-11-04T19:06:00.000Z', false),
      ]
      expect(lastSuccessfulTurnStartedAt({ createdAt, status: 'error', timeline })).toBe('2026-11-04T18:00:01.000Z')
    })
  })
})

describe('prUpdatedSinceLastSuccessfulTurn', () => {
  const session = (overrides: Partial<ReviewSession> = {}) => ({
    createdAt,
    status: 'awaiting_feedback' as const,
    submitted: null,
    timeline: [user('review', '2026-11-04T19:00:00.500Z', 'review')],
    ...overrides,
  })

  it('is true when the PR changed after the last turn started', () => {
    expect(prUpdatedSinceLastSuccessfulTurn(session(), '2026-11-04T19:00:01Z')).toBe(true)
  })

  it('is false when the PR changed earlier in the same second as the turn start', () => {
    expect(prUpdatedSinceLastSuccessfulTurn(session(), '2026-11-04T19:00:00Z')).toBe(false)
  })

  it('is false without a PR update time', () => {
    expect(prUpdatedSinceLastSuccessfulTurn(session(), null)).toBe(false)
  })

  it('is true after a turn that started after the update fails', () => {
    const timeline = [
      user('review', '2026-11-04T19:00:00.500Z', 'review'),
      result('result', '2026-11-04T19:05:00.000Z', true),
      user('pull', '2026-11-04T19:20:00.000Z', 'refine'),
    ]
    expect(prUpdatedSinceLastSuccessfulTurn(session({ timeline, status: 'cancelled' }), '2026-11-04T19:10:00Z')).toBe(true)
  })

  it('is false once the review is submitted, even if the session later errored', () => {
    const timeline = [user('review', '2026-11-04T19:00:00.000Z', 'review')]
    const submitted = { reviewId: 1, url: 'https://github.com/o/r/pull/1#review', event: 'COMMENT' as const }
    expect(prUpdatedSinceLastSuccessfulTurn(session({ timeline, status: 'error', submitted }), '2026-11-04T19:10:05Z')).toBe(false)
  })
})

describe('isSubmitted', () => {
  const submitted = { reviewId: 1, url: 'https://github.com/o/r/pull/1#review', event: 'COMMENT' as const }

  it('is true when the status is submitted or a submitted review is recorded', () => {
    expect(isSubmitted({ status: 'submitted', submitted })).toBe(true)
    expect(isSubmitted({ status: 'error', submitted })).toBe(true)
  })

  it('is false before a review is submitted', () => {
    expect(isSubmitted({ status: 'awaiting_feedback', submitted: null })).toBe(false)
  })
})
