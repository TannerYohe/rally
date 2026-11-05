import { describe, expect, it } from 'vitest'
import { automaticReviewTab, isReviewTabEmpty, selectedReviewTab } from './reviewTabs'

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

describe('isReviewTabEmpty', () => {
  it('never marks Activity empty', () => {
    expect(isReviewTabEmpty('activity', { hasDrafts: false, threadCount: 0 })).toBe(false)
  })

  it('marks Report and Drafts empty until drafts exist', () => {
    expect(isReviewTabEmpty('report', { hasDrafts: false, threadCount: 0 })).toBe(true)
    expect(isReviewTabEmpty('drafts', { hasDrafts: false, threadCount: 0 })).toBe(true)
    expect(isReviewTabEmpty('drafts', { hasDrafts: true, threadCount: 0 })).toBe(false)
  })

  it('marks Threads empty when there are no earlier comments', () => {
    expect(isReviewTabEmpty('threads', { hasDrafts: true, threadCount: 0 })).toBe(true)
    expect(isReviewTabEmpty('threads', { hasDrafts: true, threadCount: 2 })).toBe(false)
  })
})
