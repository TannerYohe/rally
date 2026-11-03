import { PHASE_LABELS, type Phase } from '@shared/types'
import { PHASE_THEME } from '../lib/theme'

export function PhaseBadge({ phase }: { phase: Phase }) {
  const theme = PHASE_THEME[phase]
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${theme.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${theme.dot}`} />
      {PHASE_LABELS[phase]}
    </span>
  )
}
