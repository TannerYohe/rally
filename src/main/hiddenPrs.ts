import type { HideMode, Pr, StoredHide } from '@shared/types'

export const UNLISTED_HIDE_RETENTION_DAYS = 30

type HideTarget = Pick<Pr, 'headRefOid' | 'reviewRequestedFromMe'>

export function newHide(pr: HideTarget, mode: HideMode, at: string): StoredHide {
  return { mode, at, headRefOid: pr.headRefOid, reviewRequested: pr.reviewRequestedFromMe, lastListedAt: at }
}

export function isHideActive(hide: StoredHide, pr: HideTarget): boolean {
  switch (hide.mode) {
    case 'indefinite':
      return true
    case 'snooze':
      return hide.headRefOid === pr.headRefOid && (hide.reviewRequested || !pr.reviewRequestedFromMe)
  }
}

export function refreshHide(hide: StoredHide, pr: HideTarget, now: string): StoredHide | null {
  if (!isHideActive(hide, pr)) return null
  return { ...hide, reviewRequested: pr.reviewRequestedFromMe, lastListedAt: now }
}

export function keepsUnlistedHide(hide: StoredHide, now: string): boolean {
  switch (hide.mode) {
    case 'snooze':
      return false
    case 'indefinite':
      return Date.parse(now) - Date.parse(hide.lastListedAt) < UNLISTED_HIDE_RETENTION_DAYS * 24 * 60 * 60_000
  }
}
