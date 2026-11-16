import type { KeyboardEvent, ReactNode } from 'react'
import { tabForKey } from '../lib/tabs'

interface Props<T extends string> {
  name: string
  tabs: readonly T[]
  labels: Record<T, string>
  tab: T
  badges: Record<T, ReactNode>
  empty: Record<T, boolean>
  onSelect(tab: T): void
}

const tabId = (name: string, tab: string) => `${name}-tab-${tab}`
const panelId = (name: string, tab: string) => `${name}-panel-${tab}`

export function TabBar<T extends string>({ name, tabs, labels, tab, badges, empty, onSelect }: Props<T>) {
  const moveWithKeys = (event: KeyboardEvent<HTMLButtonElement>, id: T) => {
    const next = tabForKey(tabs, id, event.key)
    if (!next) return
    event.preventDefault()
    onSelect(next)
    document.getElementById(tabId(name, next))?.focus()
  }
  return (
    <div role="tablist" aria-label={name} className="flex gap-1 border-b border-white/5">
      {tabs.map((id) => {
        const selected = id === tab
        const tone = selected ? 'border-primary-400 text-white' : empty[id] ? 'border-transparent text-ink-600 hover:text-ink-400' : 'border-transparent text-ink-400 hover:text-ink-100'
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(name, id)}
            aria-selected={selected}
            aria-controls={panelId(name, id)}
            tabIndex={selected ? 0 : -1}
            className={`-mb-px flex min-w-0 items-center gap-2 border-b-2 px-3 py-2 text-sm transition ${tone}`}
            onClick={() => onSelect(id)}
            onKeyDown={(event) => moveWithKeys(event, id)}
          >
            {labels[id]}
            {badges[id]}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel<T extends string>({ name, id, tab, children }: { name: string; id: T; tab: T; children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(name, id)} aria-labelledby={tabId(name, id)} hidden={id !== tab}>
      {children}
    </div>
  )
}

export function TabCount({ count }: { count: number }) {
  return <span className="rounded-full bg-white/10 px-1.5 text-xs font-normal text-ink-200">{count}</span>
}

export function EmptyTab({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-500">{children}</p>
}
