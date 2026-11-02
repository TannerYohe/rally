import { PHASE_LABELS, type Phase } from '@shared/types'

const PHASE_STYLES: Record<Phase, string> = {
  awaiting_rereview: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  unreviewed: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  pending_changes: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
  approved: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
}

export function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${PHASE_STYLES[phase]}`}>
      {PHASE_LABELS[phase]}
    </span>
  )
}
