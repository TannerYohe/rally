import { CONCERN_STATUS_LABELS, type ConcernStatus, type ThreadResolution } from '@shared/types'
import { isResolvable, isSelected, type ConcernRow } from '../lib/threads'

const STATUS_STYLES: Record<ConcernStatus, string> = {
  addressed: 'bg-emerald-500/15 text-emerald-300',
  moot: 'bg-emerald-500/15 text-emerald-300',
  pushed_back_accept: 'bg-emerald-500/15 text-emerald-300',
  partly: 'bg-yellow-500/15 text-yellow-200',
  not_addressed: 'bg-rose-500/15 text-rose-300',
  pushed_back_hold: 'bg-rose-500/15 text-rose-300',
}

interface Props {
  rows: ConcernRow[]
  overrides: Record<string, boolean>
  selectedCount: number
  resolution: ThreadResolution | null
  threadsError: string | null
  disabled: boolean
  submitted: boolean
  onSelect(threadId: string, selected: boolean): void
  onResolveSelected(): void
}

function ThreadState({ row }: { row: ConcernRow }) {
  if (!row.concern.threadId) return null
  if (!row.thread) return <span className="text-zinc-500">not your thread</span>
  return (
    <>
      {row.thread.isResolved && <span className="text-emerald-300">resolved</span>}
      {row.thread.isOutdated && <span className="text-zinc-500">outdated</span>}
      <a className="text-sky-400 hover:text-sky-300" href={row.thread.url} target="_blank" rel="noreferrer">
        Thread ↗
      </a>
    </>
  )
}

export function PriorConcernList(props: Props) {
  const { rows, overrides, selectedCount, resolution, threadsError, disabled, submitted, onSelect, onResolveSelected } = props
  const concernId = (threadId: string) => rows.find((row) => row.concern.threadId === threadId)?.concern.id ?? threadId
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Earlier comments</h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.concern.id} className="flex gap-3 rounded-xl border border-white/5 bg-zinc-900/60 p-3 text-sm">
            {isResolvable(row) ? (
              <input
                type="checkbox"
                className="mt-1"
                aria-label={`Resolve ${row.concern.id}`}
                checked={isSelected(row, overrides)}
                disabled={disabled}
                onChange={(e) => onSelect(row.thread.id, e.target.checked)}
              />
            ) : (
              <span className="w-[13px] shrink-0" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-zinc-200">{row.concern.id}</span>
                {row.concern.status && (
                  <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLES[row.concern.status]}`}>{CONCERN_STATUS_LABELS[row.concern.status]}</span>
                )}
                <span className="truncate font-mono text-zinc-400">{row.concern.location}</span>
                <span className="ml-auto flex gap-2">
                  <ThreadState row={row} />
                </span>
              </div>
              <div className="text-zinc-200">{row.concern.gist}</div>
              {row.concern.verdict && <div className="text-zinc-400">{row.concern.verdict}</div>}
            </div>
          </li>
        ))}
      </ul>
      {threadsError && <div className="text-sm text-rose-300">Couldn't load review threads: {threadsError}</div>}
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
        {!submitted && <span className="text-xs text-zinc-500">Selected threads are also resolved when you post and submit.</span>}
        <button
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-40"
          disabled={disabled || selectedCount === 0}
          onClick={onResolveSelected}
        >
          Resolve selected ({selectedCount})
        </button>
      </div>
    </div>
  )
}
