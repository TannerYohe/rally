import type { AuthorPhase, PrFeedback, ReviewDecision, ReviewState } from '@shared/types'
import { isViewer, pendingConversation, threadAcknowledged, type RawConversationComment, type RawReviewBody, type RawThreadTail } from './acknowledgment'

export interface RawAuthorFields {
  reviewDecision: ReviewDecision | null
  latestOpinionatedReviews: { nodes: { state: ReviewState; author: { login: string } | null }[] }
  reviewThreads: { nodes: { isResolved: boolean; comments: { nodes: RawThreadTail[] } }[] }
  comments: { nodes: RawConversationComment[] }
  allReviews: { nodes: RawReviewBody[] }
}

/** Summarizes reviewer activity on the viewer's own PR. */
export function authorFeedback(raw: RawAuthorFields, viewer: string): PrFeedback {
  const openThreads = raw.reviewThreads.nodes.filter((thread) => !thread.isResolved)
  const unansweredThreads = openThreads.filter((thread) => !threadAcknowledged(thread.comments.nodes.at(-1), viewer))
  const pending = pendingConversation(raw.comments.nodes, raw.allReviews.nodes, viewer)
  const decisions = raw.latestOpinionatedReviews.nodes.filter((r) => r.author && !isViewer(r.author, viewer))
  const loginsWith = (state: ReviewState) => decisions.filter((r) => r.state === state).map((r) => r.author!.login)
  return {
    reviewDecision: raw.reviewDecision,
    openThreads: openThreads.length,
    unacknowledged: unansweredThreads.length + pending.comments.length + pending.reviews.length,
    changesRequestedBy: loginsWith('CHANGES_REQUESTED'),
    approvedBy: loginsWith('APPROVED'),
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
