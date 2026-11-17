import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type Config, type MyReview, type Phase, type Pr, type SoundPlayback } from '@shared/types'
import { cueEnabled, prListCue, snapshotPrs, SoundCues } from './soundCues'

type PrFields = Pick<Pr, 'id' | 'phase' | 'isDraft' | 'hidden' | 'myReviews'>

function pr(phase: Phase, overrides: Partial<PrFields> = {}): PrFields {
  return { id: 'pr1', phase, isDraft: false, hidden: null, myReviews: [], ...overrides }
}

function approval(databaseId: number): MyReview {
  return { databaseId, state: 'APPROVED', submittedAt: '2026-11-01T00:00:00Z', commitOid: 'abc', replyOnly: false }
}

describe('prListCue', () => {
  it('cues attention when a PR moves into an attention phase', () => {
    expect(prListCue(snapshotPrs([pr('pending_changes')]), [pr('awaiting_rereview')])).toBe('needsAttention')
    expect(prListCue(snapshotPrs([pr('approved')]), [pr('awaiting_rereview')])).toBe('needsAttention')
  })

  it('cues attention when a new PR is listed unreviewed', () => {
    expect(prListCue(snapshotPrs([]), [pr('unreviewed')])).toBe('needsAttention')
  })

  it('stays quiet when nothing changed or the PR left an attention phase', () => {
    expect(prListCue(snapshotPrs([pr('unreviewed')]), [pr('unreviewed')])).toBeNull()
    expect(prListCue(snapshotPrs([pr('awaiting_rereview')]), [pr('pending_changes')])).toBeNull()
    expect(prListCue(snapshotPrs([]), [pr('pending_changes')])).toBeNull()
  })

  it('stays quiet when a review session ends', () => {
    expect(prListCue(snapshotPrs([pr('in_progress')]), [pr('unreviewed')])).toBeNull()
    expect(prListCue(snapshotPrs([pr('in_progress')]), [pr('awaiting_rereview')])).toBeNull()
  })

  it('skips hidden and draft PRs', () => {
    expect(prListCue(snapshotPrs([]), [pr('unreviewed', { isDraft: true })])).toBeNull()
    expect(prListCue(snapshotPrs([]), [pr('unreviewed', { hidden: { mode: 'snooze', at: '2026-11-01T00:00:00Z' } })])).toBeNull()
  })

  it('cues approved when a new approval of yours appears on a listed PR', () => {
    expect(prListCue(snapshotPrs([pr('unreviewed')]), [pr('approved', { myReviews: [approval(1)] })])).toBe('approved')
    expect(prListCue(snapshotPrs([pr('approved', { myReviews: [approval(1)] })]), [pr('approved', { myReviews: [approval(1), approval(2)] })])).toBe(
      'approved',
    )
  })

  it('does not cue approved for an approval already seen or a newly listed PR', () => {
    expect(prListCue(snapshotPrs([pr('approved', { myReviews: [approval(1)] })]), [pr('approved', { myReviews: [approval(1)] })])).toBeNull()
    expect(prListCue(snapshotPrs([]), [pr('approved', { myReviews: [approval(1)] })])).toBeNull()
  })

  it('prefers approved over attention in the same update', () => {
    const before = snapshotPrs([pr('pending_changes'), pr('unreviewed', { id: 'pr2' })])
    const after = [pr('awaiting_rereview'), pr('approved', { id: 'pr2', myReviews: [approval(5)] })]
    expect(prListCue(before, after)).toBe('approved')
  })
})

describe('cueEnabled', () => {
  it('respects the master switch and volume', () => {
    expect(cueEnabled('approved', DEFAULT_CONFIG)).toBe(true)
    expect(cueEnabled('approved', { ...DEFAULT_CONFIG, soundsEnabled: false })).toBe(false)
    expect(cueEnabled('approved', { ...DEFAULT_CONFIG, soundVolume: 0 })).toBe(false)
  })

  it('respects each cue setting', () => {
    expect(cueEnabled('reviewDone', { ...DEFAULT_CONFIG, reviewDoneSound: 'off' })).toBe(false)
    expect(cueEnabled('needsAttention', { ...DEFAULT_CONFIG, attentionSound: false })).toBe(false)
    expect(cueEnabled('approved', { ...DEFAULT_CONFIG, approvedSound: false })).toBe(false)
  })
})

describe('SoundCues', () => {
  function setup(overrides: Partial<Config> = {}) {
    const played: SoundPlayback[] = []
    const config = { ...DEFAULT_CONFIG, skin: 'tennis' as const, ...overrides }
    const cues = new SoundCues([pr('pending_changes')], () => config, (playback) => played.push(playback))
    return { cues, played }
  }

  it('plays the cue with the skin pack and volume', () => {
    const { cues, played } = setup()
    cues.prsChanged([pr('awaiting_rereview')])
    expect(played).toEqual([{ cue: 'needsAttention', pack: 'tennis', volume: 60 }])
  })

  it('uses the chosen sound pack over the skin', () => {
    const { cues, played } = setup({ soundPack: 'pep' })
    cues.prsChanged([pr('awaiting_rereview')])
    expect(played[0].pack).toBe('pep')
  })

  it('compares each update with the one before it', () => {
    const { cues, played } = setup()
    cues.prsChanged([pr('awaiting_rereview')])
    cues.prsChanged([pr('awaiting_rereview')])
    expect(played).toHaveLength(1)
  })

  it('plays nothing for a disabled cue', () => {
    const { cues, played } = setup({ attentionSound: false })
    cues.prsChanged([pr('awaiting_rereview')])
    expect(played).toEqual([])
  })

  it('cues review done when a turn finishes or fails', () => {
    const { cues, played } = setup()
    cues.sessionChanged('a', 'running')
    cues.sessionChanged('a', 'awaiting_feedback')
    cues.sessionChanged('a', 'running')
    cues.sessionChanged('a', 'error')
    expect(played.map((p) => p.cue)).toEqual(['reviewDone', 'reviewDone'])
  })

  it('stays quiet for a cancelled turn, a repeated status, or a session first seen idle', () => {
    const { cues, played } = setup()
    cues.sessionChanged('a', 'awaiting_feedback')
    cues.sessionChanged('a', 'running')
    cues.sessionChanged('a', 'running')
    cues.sessionChanged('a', 'cancelled')
    expect(played).toEqual([])
  })

  it('waits for the last running review in last mode', () => {
    const { cues, played } = setup({ reviewDoneSound: 'last' })
    cues.sessionChanged('a', 'running')
    cues.sessionChanged('b', 'running')
    cues.sessionChanged('a', 'awaiting_feedback')
    expect(played).toEqual([])
    cues.sessionChanged('b', 'awaiting_feedback')
    expect(played.map((p) => p.cue)).toEqual(['reviewDone'])
  })

  it('forgets a removed session in last mode', () => {
    const { cues, played } = setup({ reviewDoneSound: 'last' })
    cues.sessionChanged('a', 'running')
    cues.sessionChanged('b', 'running')
    cues.sessionRemoved('b')
    cues.sessionChanged('a', 'awaiting_feedback')
    expect(played.map((p) => p.cue)).toEqual(['reviewDone'])
  })
})
