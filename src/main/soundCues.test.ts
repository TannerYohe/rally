import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type Config, type MyReview, type Phase, type Pr, type PrFeedback, type SoundPlayback } from '@shared/types'
import { EventEmitter } from 'node:events'
import { connectSoundCues, cueEnabled, prListCue, snapshotPrs, SoundCues } from './soundCues'

type PrFields = Pick<Pr, 'id' | 'phase' | 'isDraft' | 'hidden' | 'myReviews' | 'feedback'>

function pr(phase: Phase, overrides: Partial<PrFields> = {}): PrFields {
  return { id: 'pr1', phase, isDraft: false, hidden: null, myReviews: [], feedback: null, ...overrides }
}

function feedback(approvedBy: string[]): PrFeedback {
  return { reviewDecision: null, openThreads: 0, unacknowledged: 0, changesRequestedBy: [], approvedBy }
}

const reviewing = (prs: PrFields[]) => snapshotPrs('reviewing', prs)
const authored = (prs: PrFields[]) => snapshotPrs('authored', prs)

function approval(databaseId: number): MyReview {
  return { databaseId, state: 'APPROVED', submittedAt: '2026-11-01T00:00:00Z', commitOid: 'abc', replyOnly: false }
}

describe('prListCue for PRs you review', () => {
  it('cues attention when a PR moves into an attention phase', () => {
    expect(prListCue('reviewing', reviewing([pr('pending_changes')]), [pr('awaiting_rereview')])).toBe('needsAttention')
    expect(prListCue('reviewing', reviewing([pr('approved')]), [pr('awaiting_rereview')])).toBe('needsAttention')
  })

  it('cues attention when a new PR is listed unreviewed', () => {
    expect(prListCue('reviewing', reviewing([]), [pr('unreviewed')])).toBe('needsAttention')
  })

  it('stays quiet when nothing changed or the PR left an attention phase', () => {
    expect(prListCue('reviewing', reviewing([pr('unreviewed')]), [pr('unreviewed')])).toBeNull()
    expect(prListCue('reviewing', reviewing([pr('awaiting_rereview')]), [pr('pending_changes')])).toBeNull()
    expect(prListCue('reviewing', reviewing([]), [pr('pending_changes')])).toBeNull()
  })

  it('stays quiet when a review session ends', () => {
    expect(prListCue('reviewing', reviewing([pr('in_progress')]), [pr('unreviewed')])).toBeNull()
    expect(prListCue('reviewing', reviewing([pr('in_progress')]), [pr('awaiting_rereview')])).toBeNull()
  })

  it('skips hidden and draft PRs', () => {
    expect(prListCue('reviewing', reviewing([]), [pr('unreviewed', { isDraft: true })])).toBeNull()
    expect(prListCue('reviewing', reviewing([]), [pr('unreviewed', { hidden: { mode: 'snooze', at: '2026-11-01T00:00:00Z' } })])).toBeNull()
  })

  it('cues attention when a draft is marked ready or a hidden PR resurfaces', () => {
    expect(prListCue('reviewing', reviewing([pr('unreviewed', { isDraft: true })]), [pr('unreviewed')])).toBe('needsAttention')
    const snoozed = pr('awaiting_rereview', { hidden: { mode: 'snooze', at: '2026-11-01T00:00:00Z' } })
    expect(prListCue('reviewing', reviewing([snoozed]), [pr('awaiting_rereview')])).toBe('needsAttention')
    expect(prListCue('authored', authored([pr('needs_response', { isDraft: true })]), [pr('needs_response')])).toBe('needsAttention')
  })

  it('cues approved when a new approval of yours appears on a listed PR', () => {
    expect(prListCue('reviewing', reviewing([pr('unreviewed')]), [pr('approved', { myReviews: [approval(1)] })])).toBe('approved')
    expect(prListCue('reviewing', reviewing([pr('approved', { myReviews: [approval(1)] })]), [pr('approved', { myReviews: [approval(1), approval(2)] })])).toBe(
      'approved',
    )
  })

  it('does not cue approved for an approval already seen or a newly listed PR', () => {
    expect(prListCue('reviewing', reviewing([pr('approved', { myReviews: [approval(1)] })]), [pr('approved', { myReviews: [approval(1)] })])).toBeNull()
    expect(prListCue('reviewing', reviewing([]), [pr('approved', { myReviews: [approval(1)] })])).toBeNull()
  })

  it('prefers approved over attention in the same update', () => {
    const before = reviewing([pr('pending_changes'), pr('unreviewed', { id: 'pr2' })])
    const after = [pr('awaiting_rereview'), pr('approved', { id: 'pr2', myReviews: [approval(5)] })]
    expect(prListCue('reviewing', before, after)).toBe('approved')
  })
})

describe('prListCue for your own PRs', () => {
  it('cues attention when a PR moves to needs response', () => {
    expect(prListCue('authored', authored([pr('awaiting_reviews')]), [pr('needs_response')])).toBe('needsAttention')
    expect(prListCue('authored', authored([pr('approved')]), [pr('needs_response')])).toBe('needsAttention')
    expect(prListCue('authored', authored([]), [pr('needs_response')])).toBe('needsAttention')
  })

  it('stays quiet for phases that need nothing from you', () => {
    expect(prListCue('authored', authored([pr('needs_response')]), [pr('awaiting_reviews')])).toBeNull()
    expect(prListCue('authored', authored([pr('in_progress')]), [pr('needs_response')])).toBeNull()
    expect(prListCue('authored', authored([pr('awaiting_reviews')]), [pr('unreviewed')])).toBeNull()
  })

  it('cues approved when a new reviewer approves', () => {
    expect(prListCue('authored', authored([pr('awaiting_reviews')]), [pr('approved', { feedback: feedback(['bob']) })])).toBe('approved')
    expect(
      prListCue('authored', authored([pr('approved', { feedback: feedback(['bob']) })]), [pr('approved', { feedback: feedback(['Bob', 'carol']) })]),
    ).toBe('approved')
  })

  it('does not cue approved for an approver already seen or a newly listed PR', () => {
    expect(prListCue('authored', authored([pr('approved', { feedback: feedback(['bob']) })]), [pr('approved', { feedback: feedback(['Bob']) })])).toBeNull()
    expect(prListCue('authored', authored([]), [pr('approved', { feedback: feedback(['bob']) })])).toBeNull()
  })

  it('ignores your own approval ids on a PR you authored', () => {
    expect(prListCue('authored', authored([pr('awaiting_reviews')]), [pr('awaiting_reviews', { myReviews: [approval(1)] })])).toBeNull()
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
    const cues = new SoundCues({ reviewing: [pr('pending_changes')], authored: [pr('awaiting_reviews', { id: 'mine' })] }, () => config, (playback) => played.push(playback))
    return { cues, played }
  }

  it('plays the cue with the skin pack and volume', () => {
    const { cues, played } = setup()
    cues.prsChanged('reviewing', [pr('awaiting_rereview')])
    expect(played).toEqual([{ cue: 'needsAttention', pack: 'tennis', volume: 60 }])
  })

  it('uses the chosen sound pack over the skin', () => {
    const { cues, played } = setup({ soundPack: 'pep' })
    cues.prsChanged('reviewing', [pr('awaiting_rereview')])
    expect(played[0].pack).toBe('pep')
  })

  it('compares each update with the one before it', () => {
    const { cues, played } = setup()
    cues.prsChanged('reviewing', [pr('awaiting_rereview')])
    cues.prsChanged('reviewing', [pr('awaiting_rereview')])
    expect(played).toHaveLength(1)
  })

  it('plays nothing for a disabled cue', () => {
    const { cues, played } = setup({ attentionSound: false })
    cues.prsChanged('reviewing', [pr('awaiting_rereview')])
    expect(played).toEqual([])
  })

  it('keeps a separate baseline for each list', () => {
    const { cues, played } = setup()
    cues.prsChanged('authored', [pr('needs_response', { id: 'mine' })])
    cues.prsChanged('reviewing', [pr('pending_changes')])
    expect(played.map((p) => p.cue)).toEqual(['needsAttention'])
  })

  it('cues review done when a turn finishes or fails', () => {
    const { cues, played } = setup()
    cues.sessionChanged('a', 'running')
    cues.sessionChanged('a', 'awaiting_feedback')
    cues.sessionChanged('a', 'running')
    cues.sessionChanged('a', 'error')
    expect(played.map((p) => p.cue)).toEqual(['reviewDone', 'reviewDone'])
  })

  it('plays only the approval across a submit, its stale refresh, and the approved refresh', () => {
    const { cues, played } = setup()
    cues.prsChanged('reviewing', [pr('in_progress')])
    cues.prsChanged('reviewing', [pr('unreviewed')])
    cues.prsChanged('reviewing', [pr('approved', { myReviews: [approval(9)] })])
    expect(played.map((p) => p.cue)).toEqual(['approved'])
  })

  it('stays quiet when a submit fails', () => {
    const { cues, played } = setup()
    cues.sessionChanged('a', 'awaiting_feedback')
    cues.sessionChanged('a', 'submitting')
    cues.sessionChanged('a', 'error')
    expect(played).toEqual([])
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

  it('waits for author sessions too in last mode', () => {
    const { cues, played } = setup({ reviewDoneSound: 'last' })
    cues.sessionChanged('reviewing:a', 'running')
    cues.sessionChanged('authored:a', 'running')
    cues.sessionChanged('reviewing:a', 'awaiting_feedback')
    expect(played).toEqual([])
    cues.sessionChanged('authored:a', 'error')
    expect(played.map((p) => p.cue)).toEqual(['reviewDone'])
  })

  it('stops waiting for a cancelled peer in last mode', () => {
    const { cues, played } = setup({ reviewDoneSound: 'last' })
    cues.sessionChanged('a', 'running')
    cues.sessionChanged('b', 'running')
    cues.sessionChanged('b', 'cancelled')
    expect(played).toEqual([])
    cues.sessionChanged('a', 'awaiting_feedback')
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

describe('connectSoundCues', () => {
  class FakeList extends EventEmitter {
    constructor(
      public prs: PrFields[],
      private readonly recomputed: PrFields[],
    ) {
      super()
    }

    get() {
      return { prs: this.prs }
    }

    setSessionLookup(): void {
      this.prs = this.recomputed
      this.emit('changed', { prs: this.prs })
    }
  }

  class FakeSessions extends EventEmitter {
    sessionState() {
      return null
    }
  }

  function connect() {
    const played: SoundPlayback[] = []
    const reviewing = new FakeList([pr('pending_changes')], [pr('awaiting_rereview')])
    const authored = new FakeList([pr('awaiting_reviews', { id: 'mine' })], [pr('needs_response', { id: 'mine' })])
    const reviewSessions = new FakeSessions()
    connectSoundCues(
      { reviewing: { list: reviewing, sessions: reviewSessions }, authored: { list: authored, sessions: new FakeSessions() } },
      () => DEFAULT_CONFIG,
      (playback) => played.push(playback),
    )
    return { played, reviewing, reviewSessions }
  }

  it('plays nothing for the phase recompute when the lists connect to their sessions', () => {
    expect(connect().played).toEqual([])
  })

  it('plays cues for list and session changes after connecting', () => {
    const { played, reviewing, reviewSessions } = connect()
    reviewing.emit('changed', { prs: [pr('approved', { myReviews: [approval(3)] })] })
    reviewSessions.emit('changed', { prKey: 'acme/api#1', status: 'running' })
    reviewSessions.emit('changed', { prKey: 'acme/api#1', status: 'awaiting_feedback' })
    expect(played.map((p) => p.cue)).toEqual(['approved', 'reviewDone'])
  })
})
