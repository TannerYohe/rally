import { describe, expect, it } from 'vitest'
import { isHideActive, newHide } from './hiddenPrs'

const pr = { headRefOid: 'abc', reviewRequestedFromMe: false }

describe('isHideActive', () => {
  it('keeps a hide through new commits and review requests', () => {
    const hide = newHide(pr, 'hide', '2026-11-01T00:00:00Z')
    expect(isHideActive(hide, { headRefOid: 'def', reviewRequestedFromMe: true })).toBe(true)
  })

  it('keeps a snooze while the PR is unchanged', () => {
    expect(isHideActive(newHide(pr, 'snooze', '2026-11-01T00:00:00Z'), pr)).toBe(true)
  })

  it('ends a snooze when the head changes', () => {
    const hide = newHide(pr, 'snooze', '2026-11-01T00:00:00Z')
    expect(isHideActive(hide, { ...pr, headRefOid: 'def' })).toBe(false)
  })

  it('ends a snooze when the author requests a review', () => {
    const hide = newHide(pr, 'snooze', '2026-11-01T00:00:00Z')
    expect(isHideActive(hide, { ...pr, reviewRequestedFromMe: true })).toBe(false)
  })

  it('keeps a snooze taken while a review request was already open', () => {
    const requested = { ...pr, reviewRequestedFromMe: true }
    expect(isHideActive(newHide(requested, 'snooze', '2026-11-01T00:00:00Z'), requested)).toBe(true)
  })
})
