import { useState } from 'react'
import { HIDE_MODE_LABELS, type Pr } from '@shared/types'
import { age, fullTime } from '../lib/format'

const BUTTON_CLASS = 'rounded-md px-2 py-0.5 text-xs text-ink-400 ring-1 ring-ink-800 hover:bg-ink-800 hover:text-ink-100'

export function HideControls({ pr, className = '' }: { pr: Pr; className?: string }) {
  const [error, setError] = useState<string | null>(null)
  if (pr.phase === 'in_progress') return null

  const run = async (action: () => Promise<void>) => {
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const errorNote = error && (
    <span className="max-w-64 truncate text-xs text-rose-300" title={error}>
      {error}
    </span>
  )

  if (pr.hidden) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {errorNote}
        <span className="text-xs text-ink-500" title={fullTime(pr.hidden.at)}>
          {HIDE_MODE_LABELS[pr.hidden.mode]} · {age(pr.hidden.at)} ago
        </span>
        <button className={BUTTON_CLASS} onClick={() => run(() => window.rally.unhidePr(pr.id))}>
          Unhide
        </button>
      </div>
    )
  }
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {errorNote}
      <button
        className={BUTTON_CLASS}
        title="Hide until the author pushes new commits or requests your review"
        onClick={() => run(() => window.rally.hidePr(pr.id, 'snooze'))}
      >
        Snooze
      </button>
      <button className={BUTTON_CLASS} title="Hide until you unhide it" onClick={() => run(() => window.rally.hidePr(pr.id, 'indefinite'))}>
        Hide
      </button>
    </div>
  )
}
