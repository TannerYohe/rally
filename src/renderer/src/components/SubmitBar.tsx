import { useState } from 'react'
import { REVIEW_EVENT_LABELS, type ReviewEvent } from '@shared/types'

const EVENTS: ReviewEvent[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']

interface Props {
  disabled: boolean
  commentCount: number
  threadCount: number
  onSubmit(event: ReviewEvent): void
}

export function SubmitBar({ disabled, commentCount, threadCount, onSubmit }: Props) {
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const submit = () => {
    const label = REVIEW_EVENT_LABELS[event]
    const resolve = threadCount > 0 ? `, then resolve ${threadCount} review thread(s)` : ''
    if (window.confirm(`Post ${commentCount} comment(s) and submit the review as "${label}"${resolve}?`)) onSubmit(event)
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-800 bg-ink-900 p-3">
      <span className="text-sm text-ink-400">Submit as</span>
      {EVENTS.map((option) => (
        <label key={option} className="flex items-center gap-1.5 text-sm">
          <input type="radio" name="event" checked={event === option} disabled={disabled} onChange={() => setEvent(option)} />
          {REVIEW_EVENT_LABELS[option]}
        </label>
      ))}
      <button
        className="ml-auto rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        disabled={disabled}
        onClick={submit}
      >
        Post and submit
      </button>
    </div>
  )
}
