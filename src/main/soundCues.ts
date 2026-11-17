import type { Config, Phase, Pr, SessionStatus, SoundCue, SoundPlayback } from '@shared/types'

export const ATTENTION_PHASES: Phase[] = ['unreviewed', 'awaiting_rereview']

const TURN_END_STATUSES: SessionStatus[] = ['awaiting_feedback', 'error']

interface PrSnapshot {
  phase: Phase
  approvalIds: number[]
}

type PrFields = Pick<Pr, 'id' | 'phase' | 'isDraft' | 'hidden' | 'myReviews'>

export function snapshotPrs(prs: PrFields[]): Map<string, PrSnapshot> {
  return new Map(prs.map((pr) => [pr.id, { phase: pr.phase, approvalIds: approvalIds(pr) }]))
}

function approvalIds(pr: Pick<Pr, 'myReviews'>): number[] {
  return pr.myReviews.flatMap((r) => (r.state === 'APPROVED' && r.databaseId !== null ? [r.databaseId] : []))
}

function gainedApproval(before: PrSnapshot, pr: PrFields): boolean {
  return approvalIds(pr).some((id) => !before.approvalIds.includes(id))
}

/** True when the PR is newly listed in an attention phase or moved into one from any phase but In progress. */
function enteredAttentionPhase(before: PrSnapshot | undefined, pr: PrFields): boolean {
  if (!ATTENTION_PHASES.includes(pr.phase)) return false
  return before === undefined || (before.phase !== pr.phase && before.phase !== 'in_progress')
}

/** Returns the cue for one PR list update; an approval outranks a PR needing attention. */
export function prListCue(previous: ReadonlyMap<string, PrSnapshot>, prs: PrFields[]): SoundCue | null {
  let cue: SoundCue | null = null
  for (const pr of prs) {
    if (pr.hidden || pr.isDraft) continue
    const before = previous.get(pr.id)
    if (before && gainedApproval(before, pr)) return 'approved'
    if (enteredAttentionPhase(before, pr)) cue = 'needsAttention'
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
  private prs: Map<string, PrSnapshot>
  private sessionStatuses = new Map<string, SessionStatus>()

  constructor(
    prs: PrFields[],
    private readonly config: () => Config,
    private readonly play: (playback: SoundPlayback) => void,
  ) {
    this.prs = snapshotPrs(prs)
  }

  prsChanged(prs: PrFields[]): void {
    const cue = prListCue(this.prs, prs)
    this.prs = snapshotPrs(prs)
    if (cue) this.cue(cue)
  }

  sessionChanged(prKey: string, status: SessionStatus): void {
    const previous = this.sessionStatuses.get(prKey)
    this.sessionStatuses.set(prKey, status)
    if (previous !== 'running' || !TURN_END_STATUSES.includes(status)) return
    if (this.config().reviewDoneSound === 'last' && [...this.sessionStatuses.values()].includes('running')) return
    this.cue('reviewDone')
  }

  sessionRemoved(prKey: string): void {
    this.sessionStatuses.delete(prKey)
  }

  private cue(cue: SoundCue): void {
    const config = this.config()
    if (cueEnabled(cue, config)) this.play(soundPlayback(cue, config))
  }
}
