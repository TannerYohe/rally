import type { ConcernStatus, PriorConcern, ReviewThread } from '@shared/types'

const RESOLVE_BY_DEFAULT: ConcernStatus[] = ['addressed', 'moot', 'pushed_back_accept']

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
  return overrides[row.thread.id] ?? (row.concern.status !== undefined && RESOLVE_BY_DEFAULT.includes(row.concern.status))
}

export function selectedThreadIds(rows: ConcernRow[], overrides: Record<string, boolean>): string[] {
  return rows.flatMap((row) => (isResolvable(row) && isSelected(row, overrides) ? [row.thread.id] : []))
}
