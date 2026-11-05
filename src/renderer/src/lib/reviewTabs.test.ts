import { describe, expect, it } from 'vitest'
import { automaticReviewTab, emptyReviewTabs, selectedReviewTab } from './reviewTabs'

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

describe('emptyReviewTabs', () => {
  it('marks Report and Drafts empty until drafts exist, and never Activity', () => {
    expect(emptyReviewTabs({ hasDrafts: false, threadCount: 1 })).toEqual({ activity: false, report: true, threads: false, drafts: true })
  })

  it('marks Threads empty when there are no earlier comments', () => {
    expect(emptyReviewTabs({ hasDrafts: true, threadCount: 0 })).toEqual({ activity: false, report: false, threads: true, drafts: false })
  })
})
