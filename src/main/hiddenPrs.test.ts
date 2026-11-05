import { describe, expect, it } from 'vitest'
import type { StoredHide } from '@shared/types'
import { isHideActive, keepsUnlistedHide, newHide, refreshHide } from './hiddenPrs'

const pr = { headRefOid: 'abc', reviewRequestedFromMe: false }
const AT = '2026-11-01T00:00:00Z'

describe('isHideActive', () => {
  it('keeps an indefinite hide through new commits and review requests', () => {
    const hide = newHide(pr, 'indefinite', AT)
    expect(isHideActive(hide, { headRefOid: 'def', reviewRequestedFromMe: true })).toBe(true)
  })

  it('keeps a snooze while the PR is unchanged', () => {
    expect(isHideActive(newHide(pr, 'snooze', AT), pr)).toBe(true)
  })

  it('ends a snooze when the head changes', () => {
    expect(isHideActive(newHide(pr, 'snooze', AT), { ...pr, headRefOid: 'def' })).toBe(false)
  })

  it('ends a snooze when the author requests a review', () => {
    expect(isHideActive(newHide(pr, 'snooze', AT), { ...pr, reviewRequestedFromMe: true })).toBe(false)
  })

  it('drops records with a mode it does not know', () => {
    const legacy = { ...newHide(pr, 'indefinite', AT), mode: 'hide' } as unknown as StoredHide
    expect(isHideActive(legacy, pr)).toBe(false)
    expect(keepsUnlistedHide(legacy, AT)).toBe(false)
  })

  it('keeps a snooze taken while a review request was already open', () => {
    const requested = { ...pr, reviewRequestedFromMe: true }
    expect(isHideActive(newHide(requested, 'snooze', AT), requested)).toBe(true)
  })
})

describe('refreshHide', () => {
  it('drops an expired snooze', () => {
    expect(refreshHide(newHide(pr, 'snooze', AT), { ...pr, headRefOid: 'def' }, AT)).toBeNull()
  })

  it('ends a snooze on a re-request after the request it was taken under cleared', () => {
    const requested = { ...pr, reviewRequestedFromMe: true }
    const cleared = refreshHide(newHide(requested, 'snooze', AT), pr, AT)
    expect(cleared).toMatchObject({ reviewRequestedWhenLastListed: false })
    expect(isHideActive(cleared!, requested)).toBe(false)
  })

  it('records when the PR was last listed', () => {
    expect(refreshHide(newHide(pr, 'indefinite', AT), pr, '2026-11-04T00:00:00Z')).toMatchObject({ lastListedAt: '2026-11-04T00:00:00Z' })
  })
})

describe('keepsUnlistedHide', () => {
  it('drops a snooze for a PR that is no longer listed', () => {
    expect(keepsUnlistedHide(newHide(pr, 'snooze', AT), AT)).toBe(false)
  })

  it('keeps an indefinite hide for an unlisted PR for 30 days', () => {
    const hide = newHide(pr, 'indefinite', AT)
    expect(keepsUnlistedHide(hide, '2026-11-30T00:00:00Z')).toBe(true)
    expect(keepsUnlistedHide(hide, '2026-12-01T00:00:00Z')).toBe(false)
  })
})
