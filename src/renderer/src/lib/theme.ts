import type { Phase } from '@shared/types'

interface PhaseTheme {
  accent: string
  badge: string
  dot: string
  ring: string
  chipActive: string
}

export const PHASE_THEME: Record<Phase, PhaseTheme> = {
  in_progress: {
    accent: 'bg-fuchsia-400',
    badge: 'bg-fuchsia-400/10 text-fuchsia-300 ring-fuchsia-400/30',
    dot: 'bg-fuchsia-400',
    ring: 'ring-fuchsia-400/50',
    chipActive: 'bg-fuchsia-400/15 text-fuchsia-200 ring-fuchsia-400/40',
  },
  awaiting_rereview: {
    accent: 'bg-amber-400',
    badge: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
    dot: 'bg-amber-400',
    ring: 'ring-amber-400/50',
    chipActive: 'bg-amber-400/15 text-amber-200 ring-amber-400/40',
  },
  unreviewed: {
    accent: 'bg-sky-400',
    badge: 'bg-sky-400/10 text-sky-300 ring-sky-400/30',
    dot: 'bg-sky-400',
    ring: 'ring-sky-400/50',
    chipActive: 'bg-sky-400/15 text-sky-200 ring-sky-400/40',
  },
  pending_changes: {
    accent: 'bg-violet-400',
    badge: 'bg-violet-400/10 text-violet-300 ring-violet-400/30',
    dot: 'bg-violet-400',
    ring: 'ring-violet-400/50',
    chipActive: 'bg-violet-400/15 text-violet-200 ring-violet-400/40',
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
