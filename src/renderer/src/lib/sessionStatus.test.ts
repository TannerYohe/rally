import { describe, expect, it } from 'vitest'
import type { TimelineEntry } from '@shared/types'
import { lastTurnStartedAt } from './sessionStatus'

const createdAt = '2026-11-04T18:00:00.000Z'
const user = (id: string, at: string): TimelineEntry => ({ kind: 'user', id, text: id, at })
const text = (id: string, at: string): TimelineEntry => ({ kind: 'text', id, text: id, at })

describe('lastTurnStartedAt', () => {
  it('falls back to the session start before any turn', () => {
    expect(lastTurnStartedAt({ createdAt, timeline: [] })).toBe(createdAt)
  })

  it('returns the time of the most recent user turn', () => {
    const timeline = [
      user('review', '2026-11-04T18:00:01.000Z'),
      text('reply', '2026-11-04T18:05:00.000Z'),
      user('feedback', '2026-11-04T19:00:00.000Z'),
      text('reply-2', '2026-11-04T19:02:00.000Z'),
    ]
    expect(lastTurnStartedAt({ createdAt, timeline })).toBe('2026-11-04T19:00:00.000Z')
  })
})
