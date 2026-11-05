import type { HideMode, Pr, PrHide } from '@shared/types'

export interface StoredHide extends PrHide {
  headRefOid: string
  reviewRequested: boolean
}

type HideTarget = Pick<Pr, 'headRefOid' | 'reviewRequestedFromMe'>

export function newHide(pr: HideTarget, mode: HideMode, at: string): StoredHide {
  return { mode, at, headRefOid: pr.headRefOid, reviewRequested: pr.reviewRequestedFromMe }
}

export function isHideActive(hide: StoredHide, pr: HideTarget): boolean {
  switch (hide.mode) {
    case 'hide':
      return true
    case 'snooze':
      return hide.headRefOid === pr.headRefOid && (hide.reviewRequested || !pr.reviewRequestedFromMe)
  }
}
