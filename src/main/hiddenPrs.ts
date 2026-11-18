import type { HideMode, Pr, StoredHide } from '@shared/types'

export const UNLISTED_RETENTION_DAYS = 30

type HideTarget = Pick<Pr, 'headRefOid' | 'reviewRequestedFromMe'>

export function newHide(pr: HideTarget, mode: HideMode, at: string): StoredHide {
  return { mode, at, headRefOid: pr.headRefOid, reviewRequestedWhenLastListed: pr.reviewRequestedFromMe, lastListedAt: at }
}

export function isHideActive(hide: StoredHide, pr: HideTarget): boolean {
  switch (hide.mode) {
    case 'indefinite':
      return true
    case 'snooze':
      return hide.headRefOid === pr.headRefOid && (hide.reviewRequestedWhenLastListed || !pr.reviewRequestedFromMe)
    default:
      return false
  }
}

export function refreshHide(hide: StoredHide, pr: HideTarget, now: string): StoredHide | null {
  if (!isHideActive(hide, pr)) return null
  return { ...hide, reviewRequestedWhenLastListed: pr.reviewRequestedFromMe, lastListedAt: now }
}

/** Returns whether state kept for a PR last listed at lastListedAt, such as a hide or a hand link, is inside the retention window. */
export function withinUnlistedRetention(lastListedAt: string, now: string): boolean {
  return Date.parse(now) - Date.parse(lastListedAt) < UNLISTED_RETENTION_DAYS * 24 * 60 * 60_000
}

export function keepsUnlistedHide(hide: StoredHide, now: string): boolean {
  switch (hide.mode) {
    case 'snooze':
      return false
    case 'indefinite':
      return withinUnlistedRetention(hide.lastListedAt, now)
    default:
      return false
  }
}
