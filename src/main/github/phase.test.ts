import { describe, expect, it } from 'vitest'
import type { MyReview } from '@shared/types'
import { computePhase } from './phase'

const HEAD = 'head-sha'

function review(state: MyReview['state'], commitOid: string, submittedAt: string | null = '2026-10-01T00:00:00Z'): MyReview {
  return { state, commitOid, submittedAt }
}

function phase(myReviews: MyReview[], reviewRequestedFromMe = false, reviewInProgress = false, headKnownSince: string | null = null) {
  return computePhase({ headRefOid: HEAD, headKnownSince, reviewRequestedFromMe, myReviews, reviewInProgress })
}

describe('computePhase', () => {
  it('is unreviewed with no reviews', () => {
    expect(phase([])).toBe('unreviewed')
  })

  it('is unreviewed when my only review is a pending draft', () => {
    expect(phase([review('PENDING', HEAD, null)])).toBe('unreviewed')
  })

  it('is unreviewed when my only review was dismissed', () => {
    expect(phase([review('DISMISSED', HEAD)])).toBe('unreviewed')
  })

  it('is approved when I approved the current head', () => {
    expect(phase([review('APPROVED', HEAD)])).toBe('approved')
  })

  it('is awaiting re-review when commits landed after my approval', () => {
    expect(phase([review('APPROVED', 'old-sha')])).toBe('awaiting_rereview')
  })

  it('is pending changes when I requested changes on the current head', () => {
    expect(phase([review('CHANGES_REQUESTED', HEAD)])).toBe('pending_changes')
  })

  it('is pending changes when I commented on the current head', () => {
    expect(phase([review('COMMENTED', HEAD)])).toBe('pending_changes')
  })

  it('is awaiting re-review when the author re-requested me without pushing', () => {
    expect(phase([review('CHANGES_REQUESTED', HEAD)], true)).toBe('awaiting_rereview')
  })

  it('is awaiting re-review when commits landed after my comment review', () => {
    expect(phase([review('COMMENTED', 'old-sha')])).toBe('awaiting_rereview')
  })

  it('is in progress while I have an unsubmitted Rally review, whatever GitHub says', () => {
    expect(phase([], false, true)).toBe('in_progress')
    expect(phase([review('APPROVED', 'old-sha')], true, true)).toBe('in_progress')
  })

  it('counts a review submitted after the current head existed as reviewing it, even if GitHub stamped an older commit', () => {
    expect(phase([review('COMMENTED', 'old-sha', '2026-10-02T00:00:00Z')], false, false, '2026-10-01T12:00:00Z')).toBe('pending_changes')
  })

  it('is awaiting re-review when the head appeared after my review', () => {
    expect(phase([review('COMMENTED', 'old-sha', '2026-10-01T00:00:00Z')], false, false, '2026-10-01T12:00:00Z')).toBe('awaiting_rereview')
  })

  it('uses my most recent submitted review', () => {
    const reviews = [
      review('APPROVED', HEAD, '2026-10-03T00:00:00Z'),
      review('CHANGES_REQUESTED', 'old-sha', '2026-10-01T00:00:00Z'),
      review('PENDING', HEAD, null),
    ]
    expect(phase(reviews)).toBe('approved')
  })
})
