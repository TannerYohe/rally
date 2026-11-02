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

export function latestSubmittedReview(reviews: MyReview[], states = COUNTED_STATES): MyReview | null {
  const submitted = reviews.filter((r) => states.has(r.state) && r.submittedAt && !r.replyOnly)
  submitted.sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!))
  return submitted.at(-1) ?? null
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
