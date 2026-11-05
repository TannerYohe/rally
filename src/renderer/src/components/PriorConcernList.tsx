import { CONCERN_STATUS_LABELS, RESOLVABLE_CONCERN_STATUSES, type ConcernStatus, type ThreadResolution } from '@shared/types'
import type { ThreadResolutionState } from '../lib/hooks'
import { isResolvable, isSelected, type ConcernRow } from '../lib/threads'
import { SECONDARY_BUTTON_CLASS } from '../lib/theme'

function statusStyle(status: ConcernStatus): string {
  if (RESOLVABLE_CONCERN_STATUSES.includes(status)) return 'bg-emerald-500/15 text-emerald-300'
  if (status === 'partly') return 'bg-yellow-500/15 text-yellow-200'
  return 'bg-rose-500/15 text-rose-300'
}

interface Props {
  state: ThreadResolutionState
  resolution: ThreadResolution | null
  disabled: boolean
  submitted: boolean
}

function ThreadState({ row, loaded }: { row: ConcernRow; loaded: boolean }) {
  if (!row.concern.threadId) return null
  if (!row.thread) return loaded ? <span className="text-ink-500">not your thread</span> : null
  return (
    <>
      {row.thread.isResolved && <span className="text-emerald-300">resolved</span>}
      {row.thread.isOutdated && <span className="text-ink-500">outdated</span>}
      <a className="text-primary-400 hover:text-primary-300" href={row.thread.url} target="_blank" rel="noreferrer">
        Thread ↗
      </a>
    </>
  )
}

export function PriorConcernList({ state, resolution, disabled, submitted }: Props) {
  const { rows, overrides, selectedIds, threadsLoaded, threadsError, resolveError, select, resolveSelected } = state
  const concernId = (threadId: string) => rows.find((row) => row.concern.threadId === threadId)?.concern.id ?? threadId
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.concern.id} className="flex gap-3 rounded-xl border border-white/5 bg-ink-900/60 p-3 text-sm">
            {isResolvable(row) ? (
              <input
                type="checkbox"
                className="mt-1"
                aria-label={`Resolve ${row.concern.id}`}
                checked={isSelected(row, overrides)}
                disabled={disabled}
                onChange={(e) => select(row.thread.id, e.target.checked)}
              />
            ) : (
              <span className="w-[13px] shrink-0" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-ink-200">{row.concern.id}</span>
                {row.concern.status && (
                  <span className={`rounded px-1.5 py-0.5 ${statusStyle(row.concern.status)}`}>{CONCERN_STATUS_LABELS[row.concern.status]}</span>
                )}
                <span className="truncate font-mono text-ink-400">{row.concern.location}</span>
                <span className="ml-auto flex gap-2">
                  <ThreadState row={row} loaded={threadsLoaded} />
                </span>
              </div>
              <div className="text-ink-200">{row.concern.gist}</div>
              {row.concern.verdict && <div className="text-ink-400">{row.concern.verdict}</div>}
            </div>
          </li>
        ))}
      </ul>
      {threadsError && <div className="text-sm text-rose-300">Couldn't load review threads: {threadsError}</div>}
      {resolveError && <div className="text-sm text-rose-300">Couldn't resolve threads: {resolveError}</div>}
      {resolution && (
        <div className="space-y-1 text-sm">
          {resolution.resolved.length > 0 && <div className="text-emerald-300">Resolved {resolution.resolved.length} thread(s).</div>}
          {resolution.failed.map((failure) => (
            <div key={failure.threadId} className="text-rose-300">
              Couldn't resolve {concernId(failure.threadId)}: {failure.error}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-end gap-3">
        {!submitted && <span className="text-xs text-ink-500">Selected threads are also resolved when you post and submit.</span>}
        <button
          className={SECONDARY_BUTTON_CLASS}
          disabled={disabled || selectedIds.length === 0}
          onClick={resolveSelected}
        >
          Resolve selected ({selectedIds.length})
        </button>
      </div>
    </div>
  )
}
