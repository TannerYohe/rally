import type { AuthorPhase, PrFeedback, ReviewDecision } from '@shared/types'
import { pendingConversation, threadAcknowledged, type RawConversationComment, type RawReviewBody, type RawThreadTail } from './acknowledgment'
import { reviewersWithDecision, type RawDecision } from './feedbackFields'

export interface RawAuthorFields {
  reviewDecision: ReviewDecision | null
  latestOpinionatedReviews: { nodes: RawDecision[] }
  reviewThreads: { nodes: { isResolved: boolean; comments: { nodes: RawThreadTail[] } }[] }
  comments: { nodes: RawConversationComment[] }
  allReviews: { nodes: RawReviewBody[] }
}

/** Summarizes reviewer activity on the viewer's own PR. */
export function authorFeedback(raw: RawAuthorFields, viewer: string): PrFeedback {
  const openThreads = raw.reviewThreads.nodes.filter((thread) => !thread.isResolved)
  const unansweredThreads = openThreads.filter((thread) => !threadAcknowledged(thread.comments.nodes.at(-1), viewer))
  const pending = pendingConversation(raw.comments.nodes, raw.allReviews.nodes, viewer)
  return {
    reviewDecision: raw.reviewDecision,
    openThreads: openThreads.length,
    unacknowledged: unansweredThreads.length + pending.comments.length + pending.reviews.length,
    changesRequestedBy: reviewersWithDecision(raw.latestOpinionatedReviews.nodes, 'CHANGES_REQUESTED', viewer),
    approvedBy: reviewersWithDecision(raw.latestOpinionatedReviews.nodes, 'APPROVED', viewer),
  }
}

function isApproved(feedback: PrFeedback): boolean {
  if (feedback.reviewDecision !== null) return feedback.reviewDecision === 'APPROVED'
  return feedback.approvedBy.length > 0
}

/** Returns the author-side phase; an unacknowledged comment outranks an approval. */
export function computeAuthorPhase(feedback: PrFeedback, sessionActive: boolean): AuthorPhase {
  if (sessionActive) return 'in_progress'
  if (feedback.unacknowledged > 0) return 'needs_response'
  if (isApproved(feedback)) return 'approved'
  return 'awaiting_reviews'
}
