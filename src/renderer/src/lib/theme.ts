import type { Phase } from '@shared/types'

export const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-gradient-to-r from-primary-500 to-secondary-500 font-medium text-white shadow-lg shadow-secondary-500/20 hover:from-primary-400 hover:to-secondary-400 disabled:opacity-50'

interface PhaseTheme {
  accent: string
  badge: string
  dot: string
  ring: string
  chipActive: string
}

export const PHASE_THEME: Record<Phase, PhaseTheme> = {
  in_progress: {
    accent: 'bg-highlight-400',
    badge: 'bg-highlight-400/10 text-highlight-300 ring-highlight-400/30',
    dot: 'bg-highlight-400',
    ring: 'ring-highlight-400/50',
    chipActive: 'bg-highlight-400/15 text-highlight-200 ring-highlight-400/40',
  },
  awaiting_rereview: {
    accent: 'bg-amber-400',
    badge: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
    dot: 'bg-amber-400',
    ring: 'ring-amber-400/50',
    chipActive: 'bg-amber-400/15 text-amber-200 ring-amber-400/40',
  },
  unreviewed: {
    accent: 'bg-primary-400',
    badge: 'bg-primary-400/10 text-primary-300 ring-primary-400/30',
    dot: 'bg-primary-400',
    ring: 'ring-primary-400/50',
    chipActive: 'bg-primary-400/15 text-primary-200 ring-primary-400/40',
  },
  pending_changes: {
    accent: 'bg-secondary-400',
    badge: 'bg-secondary-400/10 text-secondary-300 ring-secondary-400/30',
    dot: 'bg-secondary-400',
    ring: 'ring-secondary-400/50',
    chipActive: 'bg-secondary-400/15 text-secondary-200 ring-secondary-400/40',
  },
  approved: {
    accent: 'bg-emerald-400',
    badge: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30',
    dot: 'bg-emerald-400',
    ring: 'ring-emerald-400/50',
    chipActive: 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/40',
  },
}

const REPO_CHIPS = [
  'bg-rose-500/10 text-rose-300 ring-rose-500/25',
  'bg-orange-500/10 text-orange-300 ring-orange-500/25',
  'bg-lime-500/10 text-lime-300 ring-lime-500/25',
  'bg-teal-500/10 text-teal-300 ring-teal-500/25',
  'bg-cyan-500/10 text-cyan-300 ring-cyan-500/25',
  'bg-indigo-500/10 text-indigo-300 ring-indigo-500/25',
  'bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/25',
  'bg-pink-500/10 text-pink-300 ring-pink-500/25',
]

export function repoChipClass(repo: string): string {
  let hash = 0
  for (const ch of repo) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return REPO_CHIPS[hash % REPO_CHIPS.length]
}
