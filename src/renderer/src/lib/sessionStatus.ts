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

type TurnTiming = Pick<ReviewSession, 'timeline' | 'createdAt'>

export function lastTurnStartedAt(session: TurnTiming): string {
  return session.timeline.findLast((entry) => entry.kind === 'user' && entry.turn !== 'submit')?.at ?? session.createdAt
}

export function prUpdatedSinceLastTurn(
  session: TurnTiming & Pick<ReviewSession, 'status' | 'submitted'>,
  prUpdatedAt: string | null,
): boolean {
  if (session.submitted || session.status === 'submitted' || prUpdatedAt === null) return false
  return Date.parse(prUpdatedAt) > Date.parse(lastTurnStartedAt(session))
}
