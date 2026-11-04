import { useSyncExternalStore } from 'react'
import { DEFAULT_CONFIG, type SkinId } from '@shared/types'

export interface Skin {
  name: string
  mark: string | null
  tagline: string
}

export const SKINS: Record<SkinId, Skin> = {
  classic: { name: 'Classic', mark: null, tagline: 'Night sky, neon gradients.' },
  tennis: { name: 'Centre Court', mark: '🎾', tagline: 'Grass court, optic-yellow ball, Wimbledon purple.' },
  motorsport: { name: 'Special Stage', mark: '🏁', tagline: 'Gravel, livery orange, checkered flag.' },
  pep: { name: 'Pep Rally', mark: '📣', tagline: 'Navy bleachers, pom-poms, confetti.' },
}

export const SKIN_IDS = Object.keys(SKINS) as SkinId[]

const listeners = new Set<() => void>()

export function parseSkinId(value: string | null | undefined): SkinId {
  return SKIN_IDS.find((id) => id === value) ?? DEFAULT_CONFIG.skin
}

export function applySkin(value: string | null | undefined): void {
  document.documentElement.dataset.skin = parseSkinId(value)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSkin(): Skin {
  return SKINS[useSyncExternalStore(subscribe, () => parseSkinId(document.documentElement.dataset.skin))]
}
