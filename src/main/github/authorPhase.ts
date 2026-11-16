import type { AuthorPhase, PrFeedback, ReviewDecision, ReviewState } from '@shared/types'
import { sameLogin } from './threads'

export interface RawAuthorFields {
  reviewDecision: ReviewDecision | null
  latestOpinionatedReviews: { nodes: { state: ReviewState; submittedAt: string | null; author: { login: string } | null }[] }
  reviewThreads: { nodes: { isResolved: boolean; comments: { nodes: { author: { login: string } | null }[] } }[] }
  commits: { nodes: { commit: { committedDate: string } }[] }
}

/** Summarizes reviewer activity on the viewer's own PR. */
export function authorFeedback(raw: RawAuthorFields, requestedReviewers: string[], viewer: string): PrFeedback {
  const openThreads = raw.reviewThreads.nodes.filter((thread) => !thread.isResolved)
  const unansweredThreads = openThreads.filter((thread) => {
    const last = thread.comments.nodes.at(-1)
    return !last?.author || !sameLogin(last.author.login, viewer)
  })
  const headCommittedAt = raw.commits.nodes.at(-1)?.commit.committedDate ?? null
  const reviews = raw.latestOpinionatedReviews.nodes.flatMap((review) =>
    review.author && !sameLogin(review.author.login, viewer) ? [{ ...review, login: review.author.login }] : [],
  )
  const reRequested = (login: string) => requestedReviewers.some((requested) => sameLogin(requested, login))
  const changesRequestedBy = reviews
    .filter((r) => r.state === 'CHANGES_REQUESTED' && !reRequested(r.login))
    .filter((r) => !headCommittedAt || !r.submittedAt || r.submittedAt > headCommittedAt)
    .map((r) => r.login)
  return {
    reviewDecision: raw.reviewDecision,
    openThreads: openThreads.length,
    unansweredThreads: unansweredThreads.length,
    changesRequestedBy,
    approvedBy: reviews.filter((r) => r.state === 'APPROVED').map((r) => r.login),
    headCommittedAt,
  }
}

function isApproved(feedback: PrFeedback): boolean {
  if (feedback.reviewDecision !== null) return feedback.reviewDecision === 'APPROVED'
  return feedback.approvedBy.length > 0
}

export function computeAuthorPhase(feedback: PrFeedback, sessionActive: boolean): AuthorPhase {
  if (sessionActive) return 'in_progress'
  if (feedback.unansweredThreads > 0 || feedback.changesRequestedBy.length > 0) return 'needs_response'
  if (isApproved(feedback)) return 'approved'
  return 'awaiting_reviews'
}
