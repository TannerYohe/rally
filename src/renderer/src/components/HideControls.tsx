import { useState } from 'react'
import { HIDE_MODE_LABELS, type Phase, type PrHide, type PrListKind } from '@shared/types'
import { age, fullTime } from '../lib/format'
import { SMALL_BUTTON_CLASS } from '../lib/theme'


const SNOOZE_TITLES: Record<PrListKind, string> = {
  reviewing: 'Hide until the author pushes new commits or requests your review',
  authored: 'Hide until you push new commits',
}

interface Props {
  list: PrListKind
  /** The ids of every PR that snoozing or hiding applies to. */
  ids: string[]
  hidden: PrHide | null
  phase: Phase
  className?: string
}

export function HideControls({ list, ids, hidden, phase, className = '' }: Props) {
  const [error, setError] = useState<string | null>(null)
  if (phase === 'in_progress') return null

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

  if (hidden) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {errorNote}
        <span className="text-xs text-ink-500" title={fullTime(hidden.at)}>
          {HIDE_MODE_LABELS[hidden.mode]} · {age(hidden.at)} ago
        </span>
        <button className={SMALL_BUTTON_CLASS} onClick={() => run(() => window.rally.unhidePr(list, ids))}>
          Unhide
        </button>
      </div>
    )
  }
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {errorNote}
      <button
        className={SMALL_BUTTON_CLASS}
        title={SNOOZE_TITLES[list]}
        onClick={() => run(() => window.rally.hidePr(list, ids, 'snooze'))}
      >
        Snooze
      </button>
      <button className={SMALL_BUTTON_CLASS} title="Hide until you unhide it" onClick={() => run(() => window.rally.hidePr(list, ids, 'indefinite'))}>
        Hide
      </button>
    </div>
  )
}
