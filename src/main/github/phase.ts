import type { MyReview, Phase } from '@shared/types'

const COUNTED_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'])
const DECISION_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED'])

interface PhaseInput {
  reviewInProgress: boolean
  headRefOid: string
  headKnownSince: string | null
  reviewRequestedFromMe: boolean
  myReviews: MyReview[]
}

export function countsAsReview(review: MyReview, states = COUNTED_STATES): boolean {
  return states.has(review.state) && review.submittedAt !== null && !review.replyOnly
}

export function latestSubmittedReview(reviews: MyReview[], states = COUNTED_STATES): MyReview | null {
  const counted = reviews.filter((r) => countsAsReview(r, states))
  counted.sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!))
  return counted.at(-1) ?? null
}

function headChangedSince(review: MyReview, pr: PhaseInput): boolean {
  if (review.commitOid === pr.headRefOid) return false
  return !pr.headKnownSince || pr.headKnownSince > review.submittedAt!
}

export function computePhase(pr: PhaseInput): Phase {
  if (pr.reviewInProgress) return 'in_progress'
  const last = latestSubmittedReview(pr.myReviews)
  if (!last) return 'unreviewed'
  if (pr.reviewRequestedFromMe || headChangedSince(last, pr)) return 'awaiting_rereview'
  if (latestSubmittedReview(pr.myReviews, DECISION_STATES)?.state === 'APPROVED') return 'approved'
  return 'pending_changes'
}
