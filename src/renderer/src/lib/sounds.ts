import type { SkinId, SoundCue, SoundPlayback } from '@shared/types'
import { parseSkinId } from './skins'

type Envelope = 'pluck' | 'hold'

interface ToneVoice {
  kind: 'tone'
  wave: OscillatorType
  at: number
  duration: number
  frequency: number
  endFrequency?: number
  gain: number
  envelope?: Envelope
  vibrato?: { rate: number; depth: number }
  lowpass?: number
}

interface NoiseVoice {
  kind: 'noise'
  at: number
  duration: number
  gain: number
  filter: 'bandpass' | 'highpass' | 'lowpass'
  frequency: number
  q?: number
  envelope?: Envelope
}

export type Voice = ToneVoice | NoiseVoice

export const NOISE_SECONDS = 2

const MASTER_GAIN = 0.6

const NOTE = {
  G4: 392.0,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  B5: 987.77,
  C6: 1046.5,
  D6: 1174.66,
}

function chime(at: number, frequency: number, duration: number, gain: number): ToneVoice[] {
  return [
    { kind: 'tone', wave: 'sine', at, duration, frequency, gain },
    { kind: 'tone', wave: 'triangle', at, duration: duration * 0.6, frequency: frequency * 2.005, gain: gain * 0.2 },
  ]
}

function ballStrike(at: number, frequency: number): Voice[] {
  return [
    { kind: 'tone', wave: 'sine', at, duration: 0.09, frequency, endFrequency: frequency * 0.5, gain: 0.9 },
    { kind: 'noise', at, duration: 0.025, gain: 0.35, filter: 'bandpass', frequency: 2500, q: 1.2 },
  ]
}

/** Returns a repeatable pseudo-random sequence in [0, 1) for the given seed. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function applause(duration: number, claps: number): Voice[] {
  const random = seededRandom(7)
  const clapVoices: Voice[] = Array.from({ length: claps }, () => {
    const at = random() * duration
    return {
      kind: 'noise',
      at,
      duration: 0.03,
      gain: 0.45 * (1 - at / (duration * 1.3)),
      filter: 'bandpass',
      frequency: 1000 + random() * 1400,
      q: 0.9,
    }
  })
  return [{ kind: 'noise', at: 0, duration, gain: 0.12, filter: 'lowpass', frequency: 900, envelope: 'hold' }, ...clapVoices]
}

function beep(at: number, frequency: number, duration: number): ToneVoice {
  return { kind: 'tone', wave: 'square', at, duration, frequency, gain: 0.22, envelope: 'hold', lowpass: 3000 }
}

function rev(at: number, low: number, high: number, climb: number, fall: number): ToneVoice[] {
  const engine = { kind: 'tone', wave: 'sawtooth', envelope: 'hold', lowpass: 1200 } as const
  return [
    { ...engine, at, duration: climb, frequency: low, endFrequency: high, gain: 0.3 },
    { ...engine, at, duration: climb, frequency: low * 1.5, endFrequency: high * 1.5, gain: 0.12 },
    { ...engine, at: at + climb, duration: fall, frequency: high, endFrequency: low * 1.3, gain: 0.3, envelope: 'pluck' },
  ]
}

function pomPomShake(at: number, gain: number): NoiseVoice {
  return { kind: 'noise', at, duration: 0.12, gain, filter: 'highpass', frequency: 4000 }
}

function whistle(at: number, duration: number): Voice[] {
  return [
    { kind: 'tone', wave: 'sine', at, duration, frequency: 2900, gain: 0.25, envelope: 'hold', vibrato: { rate: 28, depth: 120 } },
    { kind: 'noise', at, duration, gain: 0.05, filter: 'highpass', frequency: 6000, envelope: 'hold' },
  ]
}

function bugle(at: number, frequency: number, duration: number): ToneVoice {
  return { kind: 'tone', wave: 'sawtooth', at, duration, frequency, gain: 0.2, envelope: 'hold', lowpass: 2200 }
}

export const SOUND_PACKS: Record<SkinId, Record<SoundCue, Voice[]>> = {
  classic: {
    reviewDone: [...chime(0, NOTE.E5, 0.4, 0.5), ...chime(0.12, NOTE.B5, 0.6, 0.45)],
    needsAttention: [...chime(0, NOTE.A5, 0.25, 0.5), ...chime(0.16, NOTE.D6, 0.45, 0.5)],
    approved: [
      ...chime(0, NOTE.C5, 0.5, 0.35),
      ...chime(0.08, NOTE.E5, 0.5, 0.35),
      ...chime(0.16, NOTE.G5, 0.5, 0.35),
      ...chime(0.24, NOTE.C6, 0.9, 0.4),
    ],
  },
  tennis: {
    reviewDone: [...ballStrike(0, 320), ...ballStrike(0.32, 260)],
    needsAttention: [...chime(0, NOTE.G5, 0.5, 0.45), ...chime(0.28, NOTE.E5, 0.7, 0.45)],
    approved: [...ballStrike(0, 320), ...applause(1.4, 40)],
  },
  motorsport: {
    reviewDone: rev(0, 70, 220, 0.3, 0.45),
    needsAttention: [beep(0, 660, 0.12), beep(0.3, 660, 0.12), beep(0.6, 880, 0.35)],
    approved: [
      ...rev(0, 70, 280, 0.55, 0.3),
      beep(0.6, 415, 0.18),
      beep(0.6, 523, 0.18),
      beep(0.85, 415, 0.35),
      beep(0.85, 523, 0.35),
    ],
  },
  pep: {
    reviewDone: [pomPomShake(0, 0.5), pomPomShake(0.16, 0.4)],
    needsAttention: [...whistle(0, 0.14), ...whistle(0.2, 0.35)],
    approved: [
      bugle(0, NOTE.G4, 0.12),
      bugle(0.13, NOTE.C5, 0.12),
      bugle(0.26, NOTE.E5, 0.12),
      bugle(0.39, NOTE.G5, 0.18),
      bugle(0.6, NOTE.E5, 0.12),
      bugle(0.75, NOTE.G5, 0.6),
    ],
  },
}

export function soundLength(voices: Voice[]): number {
  return Math.max(...voices.map((v) => v.at + v.duration))
}

let context: AudioContext | null = null
let noiseBuffer: AudioBuffer | null = null

function audioContext(): AudioContext {
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  return context
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate)
  const samples = noiseBuffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
  return noiseBuffer
}

function shape(param: AudioParam, start: number, duration: number, peak: number, envelope: Envelope): void {
  const end = start + duration
  param.setValueAtTime(0.0001, start)
  switch (envelope) {
    case 'pluck':
      param.linearRampToValueAtTime(peak, start + 0.005)
      param.exponentialRampToValueAtTime(0.0001, end)
      break
    case 'hold':
      param.linearRampToValueAtTime(peak, start + 0.01)
      param.setValueAtTime(peak, Math.max(start + 0.01, end - 0.03))
      param.linearRampToValueAtTime(0.0001, end)
      break
  }
}

function playTone(ctx: AudioContext, voice: ToneVoice, start: number, output: AudioNode): void {
  const oscillator = ctx.createOscillator()
  oscillator.type = voice.wave
  oscillator.frequency.setValueAtTime(voice.frequency, start)
  if (voice.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(voice.endFrequency, start + voice.duration)
  const gain = ctx.createGain()
  shape(gain.gain, start, voice.duration, voice.gain, voice.envelope ?? 'pluck')
  let source: AudioNode = oscillator
  if (voice.lowpass) {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = voice.lowpass
    source = source.connect(filter)
  }
  source.connect(gain).connect(output)
  const stopAt = start + voice.duration + 0.05
  if (voice.vibrato) {
    const lfo = ctx.createOscillator()
    lfo.frequency.value = voice.vibrato.rate
    const depth = ctx.createGain()
    depth.gain.value = voice.vibrato.depth
    lfo.connect(depth).connect(oscillator.frequency)
    lfo.start(start)
    lfo.stop(stopAt)
  }
  oscillator.start(start)
  oscillator.stop(stopAt)
}

function playNoise(ctx: AudioContext, voice: NoiseVoice, start: number, output: AudioNode): void {
  const source = ctx.createBufferSource()
  source.buffer = whiteNoise(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = voice.filter
  filter.frequency.value = voice.frequency
  if (voice.q) filter.Q.value = voice.q
  const gain = ctx.createGain()
  shape(gain.gain, start, voice.duration, voice.gain, voice.envelope ?? 'pluck')
  source.connect(filter).connect(gain).connect(output)
  source.start(start)
  source.stop(start + voice.duration + 0.05)
}

/** Plays a cue from a sound pack; volume runs from 0 to 100. */
export function playSound({ cue, pack, volume }: SoundPlayback): void {
  const ctx = audioContext()
  const output = ctx.createGain()
  output.gain.value = (Math.min(100, Math.max(0, volume)) / 100) ** 2 * MASTER_GAIN
  output.connect(ctx.createDynamicsCompressor()).connect(ctx.destination)
  const start = ctx.currentTime + 0.02
  for (const voice of SOUND_PACKS[parseSkinId(pack)][cue]) {
    switch (voice.kind) {
      case 'tone':
        playTone(ctx, voice, start + voice.at, output)
        break
      case 'noise':
        playNoise(ctx, voice, start + voice.at, output)
        break
    }
  }
}
