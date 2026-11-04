import type { ReviewSession, SessionStatus } from '@shared/types'

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  running: 'Claude is working…',
  submitting: 'Posting and submitting the review…',
  awaiting_feedback: 'Waiting for your feedback',
  submitted: 'Review submitted',
  error: 'Error',
  cancelled: 'Cancelled',
}

export const BUSY_STATUSES: SessionStatus[] = ['running', 'submitting']

export function lastTurnStartedAt(session: Pick<ReviewSession, 'timeline' | 'createdAt'>): string {
  return session.timeline.findLast((entry) => entry.kind === 'user')?.at ?? session.createdAt
}
