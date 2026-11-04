import { useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { addEntries, entriesFromPaste, splitEntries } from '../lib/tagEntries'

interface Props {
  values: string[]
  placeholder: string
  renderIcon?(value: string): ReactNode
  onChange(values: string[]): void
}

export function TagInput({ values, placeholder, renderIcon, onChange }: Props) {
  const [draft, setDraft] = useState('')

  const add = (entries: string[]) => {
    const next = addEntries(values, entries)
    if (next.length !== values.length) onChange(next)
    setDraft('')
  }
  const remove = (value: string) => onChange(values.filter((v) => v !== value))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && draft.trim()) {
      e.preventDefault()
      add(splitEntries(draft))
    } else if (e.key === 'Backspace' && !draft && values.length) {
      remove(values[values.length - 1])
    }
  }
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const entries = entriesFromPaste(draft, e.clipboardData.getData('text'))
    if (entries) {
      e.preventDefault()
      add(entries)
    }
  }

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg bg-zinc-950/60 p-1.5 ring-1 ring-zinc-800 focus-within:ring-violet-400/50">
      {values.map((value) => (
        <span key={value} className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/80 py-0.5 pl-1 pr-1 font-mono text-xs text-zinc-200 ring-1 ring-white/5">
          {renderIcon ? renderIcon(value) : <span className="w-1" />}
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={() => remove(value)}
            className="flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100"
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-40 flex-1 bg-transparent px-1.5 py-0.5 font-mono text-xs text-zinc-100 outline-none placeholder:font-sans placeholder:text-zinc-600"
        value={draft}
        placeholder={values.length ? 'Add another…' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => draft.trim() && add(splitEntries(draft))}
      />
    </div>
  )
}
