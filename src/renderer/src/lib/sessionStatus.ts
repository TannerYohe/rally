import type { ReviewSession, SessionStatus, TimelineEntry } from '@shared/types'

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  running: 'Claude is working…',
  submitting: 'Posting and submitting the review…',
  awaiting_feedback: 'Waiting for your feedback',
  submitted: 'Review submitted',
  error: 'Error',
  cancelled: 'Cancelled',
}

export const BUSY_STATUSES: SessionStatus[] = ['running', 'submitting']

const FAILED_STATUSES: SessionStatus[] = ['error', 'cancelled']

type TurnTiming = Pick<ReviewSession, 'timeline' | 'createdAt' | 'status'>

function turnSucceeded(turn: TimelineEntry[], isLatest: boolean, status: SessionStatus): boolean {
  const result = turn.findLast((entry) => entry.kind === 'result')
  if (result) return result.ok
  return isLatest && !FAILED_STATUSES.includes(status)
}

/** Returns when the latest turn that didn't fail or get cancelled started, counting a turn still in progress. */
export function lastSuccessfulTurnStartedAt(session: TurnTiming): string {
  const { timeline } = session
  let end = timeline.length
  for (let start = end - 1; start >= 0; start--) {
    const entry = timeline[start]
    if (entry.kind !== 'user') continue
    if (turnSucceeded(timeline.slice(start + 1, end), end === timeline.length, session.status)) return entry.at
    end = start
  }
  return session.createdAt
}

export function isSubmitted(session: Pick<ReviewSession, 'status' | 'submitted'>): boolean {
  return session.submitted !== null || session.status === 'submitted'
}

export function prUpdatedSinceLastSuccessfulTurn(
  session: TurnTiming & Pick<ReviewSession, 'status' | 'submitted'>,
  prUpdatedAt: string | null,
): boolean {
  if (isSubmitted(session) || prUpdatedAt === null) return false
  return Date.parse(prUpdatedAt) > Date.parse(lastSuccessfulTurnStartedAt(session))
}
