import type { AuthorPhase, PrFeedback, ReviewDecision } from '@shared/types'
import { pendingConversation, threadAcknowledged, type RawConversationComment, type RawReviewBody, type RawThreadTail } from './acknowledgment'
import { reviewersWithDecision, type RawConnection, type RawDecision } from './feedbackFields'

export interface RawAuthorFields {
  reviewDecision: ReviewDecision | null
  latestOpinionatedReviews: { nodes: RawDecision[] }
  reviewThreads: RawConnection<{ isResolved: boolean; latest: { nodes: RawThreadTail[] } }>
  comments: RawConnection<RawConversationComment>
  allReviews: RawConnection<RawReviewBody>
}

/** Summarizes reviewer activity on the viewer's own PR. */
export function authorFeedback(raw: RawAuthorFields, viewer: string): PrFeedback {
  const openThreads = raw.reviewThreads.nodes.filter((thread) => !thread.isResolved)
  const unansweredThreads = openThreads.filter((thread) => !threadAcknowledged(thread.latest.nodes[0], viewer))
  const pending = pendingConversation(raw.comments.nodes, raw.allReviews.nodes, viewer)
  return {
    reviewDecision: raw.reviewDecision,
    openThreads: openThreads.length,
    unacknowledged: unansweredThreads.length + pending.comments.length + pending.reviews.length,
    changesRequestedBy: reviewersWithDecision(raw.latestOpinionatedReviews.nodes, 'CHANGES_REQUESTED', viewer),
    approvedBy: reviewersWithDecision(raw.latestOpinionatedReviews.nodes, 'APPROVED', viewer),
    truncated: Boolean(
      raw.reviewThreads.pageInfo.hasNextPage || raw.comments.pageInfo.hasPreviousPage || raw.allReviews.pageInfo.hasPreviousPage,
    ),
  }
}

function isApproved(feedback: PrFeedback): boolean {
  if (feedback.reviewDecision !== null) return feedback.reviewDecision === 'APPROVED'
  return feedback.approvedBy.length > 0
}

export interface AuthorSessionPhaseInput {
  active: boolean
  openFindings: number
}

/** Returns the author-side phase; an unacknowledged comment, an open self-review finding, or more activity than one query reads outranks an approval. */
export function computeAuthorPhase(feedback: PrFeedback | null, session: AuthorSessionPhaseInput): AuthorPhase {
  if (session.active) return 'in_progress'
  if (session.openFindings > 0 || feedback?.unacknowledged || feedback?.truncated) return 'needs_response'
  if (feedback && isApproved(feedback)) return 'approved'
  return 'awaiting_reviews'
}
