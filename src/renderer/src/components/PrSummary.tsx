import type { Pr } from '@shared/types'

/** Shows a PR's one-line summary, or that it is still being written or failed. */
export function PrSummary({ pr, className = '' }: { pr: Pick<Pr, 'summary' | 'summaryError'>; className?: string }) {
  return (
    <p className={`text-sm text-ink-400 ${className}`}>
      <span className="mr-1.5 text-secondary-400">✦</span>
      {pr.summary ??
        (pr.summaryError ? (
          <span className="italic text-ink-600" title={pr.summaryError}>
            Summary unavailable
          </span>
        ) : (
          <span className="italic text-ink-600">Summarizing…</span>
        ))}
    </p>
  )
}
