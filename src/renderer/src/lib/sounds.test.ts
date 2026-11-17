import { describe, expect, it } from 'vitest'
import { SOUND_CUES } from '@shared/types'
import { SKIN_IDS } from './skins'
import { NOISE_SECONDS, SOUND_PACKS, soundLength } from './sounds'

describe('SOUND_PACKS', () => {
  const sounds = SKIN_IDS.flatMap((pack) => SOUND_CUES.map((cue) => ({ pack, cue, voices: SOUND_PACKS[pack][cue] })))

  it.each(sounds)('$pack $cue is short and within gain limits', ({ voices }) => {
    expect(voices.length).toBeGreaterThan(0)
    expect(soundLength(voices)).toBeLessThanOrEqual(2)
    for (const voice of voices) {
      expect(voice.at).toBeGreaterThanOrEqual(0)
      expect(voice.duration).toBeGreaterThan(0)
      expect(voice.gain).toBeGreaterThan(0)
      expect(voice.gain).toBeLessThanOrEqual(1)
      if (voice.kind === 'noise') expect(voice.duration).toBeLessThanOrEqual(NOISE_SECONDS)
    }
  })

  it('gives each cue in a pack its own sound', () => {
    for (const pack of SKIN_IDS) {
      const distinct = new Set(SOUND_CUES.map((cue) => JSON.stringify(SOUND_PACKS[pack][cue])))
      expect(distinct.size).toBe(SOUND_CUES.length)
    }
  })
})
