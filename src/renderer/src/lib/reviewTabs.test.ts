import { describe, expect, it } from 'vitest'
import { automaticReviewTab, emptyReviewTabs, INITIAL_REVIEW_TAB_STATE, reviewTabForKey, reviewTabReducer, selectedReviewTab, type ReviewTabState } from './reviewTabs'

describe('automaticReviewTab', () => {
  it('shows Activity while Claude is working', () => {
    expect(automaticReviewTab({ busy: true, hasDrafts: true })).toBe('activity')
  })

  it('shows Activity before any drafts exist', () => {
    expect(automaticReviewTab({ busy: false, hasDrafts: false })).toBe('activity')
  })

  it('shows Drafts once a turn finishes with drafts', () => {
    expect(automaticReviewTab({ busy: false, hasDrafts: true })).toBe('drafts')
  })
})

describe('selectedReviewTab', () => {
  it('keeps the tab the user picked', () => {
    expect(selectedReviewTab('report', { busy: true, hasDrafts: true })).toBe('report')
  })

  it('falls back to the automatic tab when nothing is picked', () => {
    expect(selectedReviewTab(null, { busy: false, hasDrafts: true })).toBe('drafts')
  })
})

describe('reviewTabForKey', () => {
  it('moves right and left, wrapping at the ends', () => {
    expect(reviewTabForKey('activity', 'ArrowRight')).toBe('report')
    expect(reviewTabForKey('drafts', 'ArrowRight')).toBe('activity')
    expect(reviewTabForKey('report', 'ArrowLeft')).toBe('activity')
    expect(reviewTabForKey('activity', 'ArrowLeft')).toBe('drafts')
  })

  it('jumps to the first and last tab', () => {
    expect(reviewTabForKey('threads', 'Home')).toBe('activity')
    expect(reviewTabForKey('report', 'End')).toBe('drafts')
  })

  it('ignores other keys', () => {
    expect(reviewTabForKey('report', 'Enter')).toBeNull()
  })
})

describe('reviewTabReducer', () => {
  const following: ReviewTabState = { chosen: 'activity', following: true }

  it('keeps a tab picked during a turn until the turn ends, then shows Drafts', () => {
    const picked = reviewTabReducer(INITIAL_REVIEW_TAB_STATE, { type: 'select', tab: 'report' })
    expect(selectedReviewTab(picked.chosen, { busy: true, hasDrafts: true })).toBe('report')
    const ended = reviewTabReducer(picked, { type: 'busyChanged', busy: false })
    expect(selectedReviewTab(ended.chosen, { busy: false, hasDrafts: true })).toBe('drafts')
  })

  it('switches to Activity and follows on send', () => {
    expect(reviewTabReducer({ chosen: 'drafts', following: false }, { type: 'follow' })).toEqual(following)
  })

  it('keeps following when the turn starts and stops when it ends', () => {
    expect(reviewTabReducer(following, { type: 'busyChanged', busy: true })).toEqual({ chosen: null, following: true })
    expect(reviewTabReducer(following, { type: 'busyChanged', busy: false })).toEqual(INITIAL_REVIEW_TAB_STATE)
  })

  it('does not start following when a turn starts without a send', () => {
    expect(reviewTabReducer(INITIAL_REVIEW_TAB_STATE, { type: 'busyChanged', busy: true })).toEqual(INITIAL_REVIEW_TAB_STATE)
  })

  it('returns to the automatic tab when a send fails', () => {
    expect(reviewTabReducer(following, { type: 'sendFailed' })).toEqual(INITIAL_REVIEW_TAB_STATE)
  })

  it('stops following on scroll up without leaving Activity', () => {
    expect(reviewTabReducer(following, { type: 'scrolledUp' })).toEqual({ chosen: 'activity', following: false })
  })

  it('stops following when another tab is picked', () => {
    expect(reviewTabReducer(following, { type: 'select', tab: 'drafts' })).toEqual({ chosen: 'drafts', following: false })
    expect(reviewTabReducer(following, { type: 'select', tab: 'activity' })).toEqual(following)
  })

  it('does not start following when Activity is picked by hand', () => {
    expect(reviewTabReducer({ chosen: 'activity', following: false }, { type: 'select', tab: 'activity' })).toEqual({
      chosen: 'activity',
      following: false,
    })
  })
})

describe('emptyReviewTabs', () => {
  it('marks Report and Drafts empty until drafts exist, and never Activity', () => {
    expect(emptyReviewTabs({ hasDrafts: false, commentCount: 0, threadCount: 1 })).toEqual({ activity: false, report: true, threads: false, drafts: true })
  })

  it('marks Drafts empty when the review has no comments', () => {
    expect(emptyReviewTabs({ hasDrafts: true, commentCount: 0, threadCount: 1 })).toEqual({ activity: false, report: false, threads: false, drafts: true })
  })

  it('marks Threads empty when there are no earlier comments', () => {
    expect(emptyReviewTabs({ hasDrafts: true, commentCount: 2, threadCount: 0 })).toEqual({ activity: false, report: false, threads: true, drafts: false })
  })
})
