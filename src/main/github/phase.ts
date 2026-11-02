import type { MyReview, Phase } from '@shared/types'

const COUNTED_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'])

interface PhaseInput {
  headRefOid: string
  reviewRequestedFromMe: boolean
  myReviews: MyReview[]
}

export function latestSubmittedReview(reviews: MyReview[]): MyReview | null {
  const submitted = reviews.filter((r) => COUNTED_STATES.has(r.state) && r.submittedAt)
  submitted.sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!))
  return submitted.at(-1) ?? null
}

export function computePhase(pr: PhaseInput): Phase {
  const last = latestSubmittedReview(pr.myReviews)
  if (!last) return 'unreviewed'
  if (pr.reviewRequestedFromMe || last.commitOid !== pr.headRefOid) return 'awaiting_rereview'
  if (last.state === 'APPROVED') return 'approved'
  return 'pending_changes'
}
