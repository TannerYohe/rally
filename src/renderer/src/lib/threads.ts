import { RESOLVABLE_CONCERN_STATUSES, type PriorConcern, type ReviewThread } from '@shared/types'

export interface ConcernRow {
  concern: PriorConcern
  thread: ReviewThread | null
}

export function concernRows(concerns: PriorConcern[], threads: ReviewThread[]): ConcernRow[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  return concerns.map((concern) => ({ concern, thread: (concern.threadId && byId.get(concern.threadId)) || null }))
}

export function isResolvable(row: ConcernRow): row is ConcernRow & { thread: ReviewThread } {
  return row.thread !== null && !row.thread.isResolved
}

export function isSelected(row: ConcernRow, overrides: Record<string, boolean>): boolean {
  if (!isResolvable(row)) return false
  return overrides[row.thread.id] ?? (row.concern.status !== undefined && RESOLVABLE_CONCERN_STATUSES.includes(row.concern.status))
}

export function selectedThreadIds(rows: ConcernRow[], overrides: Record<string, boolean>): string[] {
  return rows.flatMap((row) => (isResolvable(row) && isSelected(row, overrides) ? [row.thread.id] : []))
}
