import type { Config, Phase, Pr, PrListKind, SessionStatus, SoundCue, SoundPlayback } from '@shared/types'

export const ATTENTION_PHASES: Record<PrListKind, Phase[]> = {
  reviewing: ['unreviewed', 'awaiting_rereview'],
  authored: ['needs_response'],
}

const TURN_END_STATUSES: SessionStatus[] = ['awaiting_feedback', 'error']

interface PrSnapshot {
  phase: Phase
  approvals: string[]
}

type PrSnapshots = Map<string, PrSnapshot>

type PrFields = Pick<Pr, 'id' | 'phase' | 'isDraft' | 'hidden' | 'myReviews' | 'feedback'>

/** Returns your approval review ids on a PR you review, or the logins that approved a PR you authored. */
function approvals(kind: PrListKind, pr: PrFields): string[] {
  switch (kind) {
    case 'reviewing':
      return pr.myReviews.flatMap((r) => (r.state === 'APPROVED' && r.databaseId !== null ? [String(r.databaseId)] : []))
    case 'authored':
      return (pr.feedback?.approvedBy ?? []).map((login) => login.toLowerCase())
  }
}

function isShown(pr: PrFields): boolean {
  return !pr.hidden && !pr.isDraft
}

/** Records shown PRs only, so a draft marked ready or a hidden PR that resurfaces counts as newly listed. */
export function snapshotPrs(kind: PrListKind, prs: PrFields[]): PrSnapshots {
  return new Map(prs.filter(isShown).map((pr) => [pr.id, { phase: pr.phase, approvals: approvals(kind, pr) }]))
}

/** True when the PR left In progress, which only your own work in Rally ends (README.md#sounds). */
function leftOwnSession(before: PrSnapshot): boolean {
  return before.phase === 'in_progress'
}

/** True when the PR is newly listed in an attention phase or moved into one from another phase. */
function enteredAttentionPhase(kind: PrListKind, before: PrSnapshot | undefined, pr: PrFields): boolean {
  if (!ATTENTION_PHASES[kind].includes(pr.phase)) return false
  return before === undefined || (before.phase !== pr.phase && !leftOwnSession(before))
}

/** Returns the cue for one PR list update; an approval outranks a PR needing attention. */
export function prListCue(kind: PrListKind, previous: PrSnapshots, prs: PrFields[]): SoundCue | null {
  let cue: SoundCue | null = null
  for (const pr of prs.filter(isShown)) {
    const before = previous.get(pr.id)
    if (before && approvals(kind, pr).some((approval) => !before.approvals.includes(approval))) return 'approved'
    if (enteredAttentionPhase(kind, before, pr)) cue = 'needsAttention'
  }
  return cue
}

export function cueEnabled(cue: SoundCue, config: Config): boolean {
  if (!config.soundsEnabled || config.soundVolume <= 0) return false
  switch (cue) {
    case 'reviewDone':
      return config.reviewDoneSound !== 'off'
    case 'needsAttention':
      return config.attentionSound
    case 'approved':
      return config.approvedSound
  }
}

export function soundPlayback(cue: SoundCue, config: Config): SoundPlayback {
  return { cue, pack: config.soundPack ?? config.skin, volume: config.soundVolume }
}

export class SoundCues {
  private prs: Record<PrListKind, PrSnapshots>
  private sessionStatuses = new Map<string, SessionStatus>()

  constructor(
    lists: Record<PrListKind, PrFields[]>,
    private readonly config: () => Config,
    private readonly play: (playback: SoundPlayback) => void,
  ) {
    this.prs = { reviewing: snapshotPrs('reviewing', lists.reviewing), authored: snapshotPrs('authored', lists.authored) }
  }

  prsChanged(kind: PrListKind, prs: PrFields[]): void {
    const cue = prListCue(kind, this.prs[kind], prs)
    this.prs[kind] = snapshotPrs(kind, prs)
    if (cue) this.cue(cue)
  }

  /** Tracks a review or author session by a key unique across both kinds. */
  sessionChanged(key: string, status: SessionStatus): void {
    const previous = this.sessionStatuses.get(key)
    this.sessionStatuses.set(key, status)
    if (previous !== 'running' || !TURN_END_STATUSES.includes(status)) return
    if (this.config().reviewDoneSound === 'last' && [...this.sessionStatuses.values()].includes('running')) return
    this.cue('reviewDone')
  }

  sessionRemoved(key: string): void {
    this.sessionStatuses.delete(key)
  }

  private cue(cue: SoundCue): void {
    const config = this.config()
    if (cueEnabled(cue, config)) this.play(soundPlayback(cue, config))
  }
}
