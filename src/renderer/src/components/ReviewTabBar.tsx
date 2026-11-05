import type { ReactNode } from 'react'
import { REVIEW_TAB_LABELS, REVIEW_TABS, type ReviewTab } from '../lib/reviewTabs'

function reviewTabId(tab: ReviewTab): string {
  return `review-tab-${tab}`
}

function reviewPanelId(tab: ReviewTab): string {
  return `review-panel-${tab}`
}

interface Props {
  tab: ReviewTab
  badges: Record<ReviewTab, ReactNode>
  empty: Record<ReviewTab, boolean>
  onSelect(tab: ReviewTab): void
}

export function ReviewTabBar({ tab, badges, empty, onSelect }: Props) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-white/5">
      {REVIEW_TABS.map((id) => {
        const selected = id === tab
        const tone = selected ? 'border-primary-400 text-white' : empty[id] ? 'border-transparent text-ink-600 hover:text-ink-400' : 'border-transparent text-ink-400 hover:text-ink-100'
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={reviewTabId(id)}
            aria-selected={selected}
            aria-controls={reviewPanelId(id)}
            className={`-mb-px flex min-w-0 items-center gap-2 border-b-2 px-3 py-2 text-sm transition ${tone}`}
            onClick={() => onSelect(id)}
          >
            {REVIEW_TAB_LABELS[id]}
            {badges[id]}
          </button>
        )
      })}
    </div>
  )
}

export function ReviewTabPanel({ id, tab, children }: { id: ReviewTab; tab: ReviewTab; children: ReactNode }) {
  return (
    <div role="tabpanel" id={reviewPanelId(id)} aria-labelledby={reviewTabId(id)} hidden={id !== tab}>
      {children}
    </div>
  )
}
