import type { MyReview, Phase } from '@shared/types'

export const MY_REVIEW_WINDOW = 20

const COUNTED_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'])
const DECISION_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED'])

interface PhaseInput {
  reviewInProgress: boolean
  headRefOid: string
  headKnownSince: string | null
  reviewRequestedFromMe: boolean
  myReviews: MyReview[]
  rallySubmittedReviewId: number | null
}

function isRallySubmitted(review: MyReview, rallySubmittedReviewId: number | null): boolean {
  return rallySubmittedReviewId !== null && review.databaseId === rallySubmittedReviewId
}

export function latestSubmittedReview(
  reviews: MyReview[],
  rallySubmittedReviewId: number | null,
  states = COUNTED_STATES,
): MyReview | null {
  const submitted = reviews.filter((r) => states.has(r.state) && r.submittedAt)
  submitted.sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!))
  const counted = submitted.filter((r) => !r.replyOnly || isRallySubmitted(r, rallySubmittedReviewId))
  if (counted.length > 0 || reviews.length < MY_REVIEW_WINDOW) return counted.at(-1) ?? null
  return submitted.at(-1) ?? null
}

function headChangedSince(review: MyReview, pr: PhaseInput): boolean {
  if (review.commitOid === pr.headRefOid) return false
  return !pr.headKnownSince || pr.headKnownSince > review.submittedAt!
}

export function computePhase(pr: PhaseInput): Phase {
  if (pr.reviewInProgress) return 'in_progress'
  const last = latestSubmittedReview(pr.myReviews, pr.rallySubmittedReviewId)
  if (!last) return 'unreviewed'
  if (pr.reviewRequestedFromMe || headChangedSince(last, pr)) return 'awaiting_rereview'
  if (latestSubmittedReview(pr.myReviews, pr.rallySubmittedReviewId, DECISION_STATES)?.state === 'APPROVED') return 'approved'
  return 'pending_changes'
}
