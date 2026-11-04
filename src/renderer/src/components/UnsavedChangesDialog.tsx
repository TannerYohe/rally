import { useEffect, useState } from 'react'
import type { Blocker } from 'react-router-dom'
import { PRIMARY_BUTTON_CLASS } from '../lib/theme'

interface Props {
  blocker: Blocker
  onSave(): Promise<string | null>
}

export function UnsavedChangesDialog({ blocker, onSave }: Props) {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && blocker.reset?.()
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [blocker])

  const saveAndLeave = async () => {
    const failure = await onSave()
    if (failure) setError(failure)
    else blocker.proceed?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => blocker.reset?.()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        className="w-96 space-y-4 rounded-xl border border-white/10 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h2 id="unsaved-changes-title" className="font-semibold">
            Unsaved changes
          </h2>
          <p className="text-sm text-zinc-400">Save your settings before leaving?</p>
          {error && <p className="text-sm text-rose-300">Couldn't save: {error}</p>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button autoFocus className="rounded-md px-3 py-1.5 text-zinc-400 hover:text-zinc-100" onClick={() => blocker.reset?.()}>
            Keep editing
          </button>
          <button className="ml-auto rounded-md px-3 py-1.5 text-rose-300 hover:bg-rose-500/10" onClick={() => blocker.proceed?.()}>
            Discard
          </button>
          <button
            className={`${PRIMARY_BUTTON_CLASS} px-4 py-1.5`}
            onClick={saveAndLeave}
          >
            Save and leave
          </button>
        </div>
      </div>
    </div>
  )
}
