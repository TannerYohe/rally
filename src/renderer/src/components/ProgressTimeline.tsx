import type { TimelineEntry } from '@shared/types'
import { duration, usd } from '../lib/format'
import { Markdown } from './Markdown'

function Spinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-500 border-t-transparent" />
}

function StatusDot({ done }: { done: boolean }) {
  return done ? <span className="text-emerald-400">✓</span> : <Spinner />
}

function Entry({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-sm whitespace-pre-wrap text-ink-300">
          <span className="mr-2 text-xs uppercase tracking-wide text-ink-500">You</span>
          {entry.text}
        </div>
      )
    case 'text':
      return (
        <details className="text-sm text-ink-300" open={entry.text.length < 400}>
          <summary className="cursor-pointer text-ink-400">{entry.text.split('\n')[0].slice(0, 140)}</summary>
          <div className="mt-2 pl-4">
            <Markdown>{entry.text}</Markdown>
          </div>
        </details>
      )
    case 'step':
      return (
        <div className="flex items-center gap-2 text-sm" title={entry.detail}>
          <StatusDot done={entry.done} />
          <span>{entry.label}</span>
          {entry.detail && <span className="truncate font-mono text-xs text-ink-500">{entry.detail.split('\n')[0]}</span>}
        </div>
      )
    case 'agent':
      return (
        <div className="flex items-center gap-2 text-sm">
          <StatusDot done={entry.done} />
          <span className="rounded bg-secondary-500/15 px-1.5 text-xs text-secondary-300">agent</span>
          <span>{entry.label}</span>
          <span className="text-xs text-ink-500">{entry.activity} tool calls</span>
        </div>
      )
    case 'denied':
      return <div className="text-sm text-rose-300">⛔ Blocked: {entry.label}</div>
    case 'result':
      return (
        <div className={`text-xs ${entry.ok ? 'text-ink-500' : 'text-rose-300'}`}>
          Turn {entry.ok ? 'finished' : `failed${entry.text ? `: ${entry.text}` : ''}`} in {duration(entry.durationMs)} · session cost{' '}
          {usd(entry.costUsd)}
        </div>
      )
  }
}

export function ProgressTimeline({ timeline }: { timeline: TimelineEntry[] }) {
  return (
    <div className="space-y-2">
      {timeline.map((entry) => (
        <Entry key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
