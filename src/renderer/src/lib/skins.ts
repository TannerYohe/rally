import { useSyncExternalStore } from 'react'
import type { SkinId } from '@shared/types'

export interface Skin {
  id: SkinId
  name: string
  mark: string | null
  tagline: string
}

export const SKINS: Skin[] = [
  { id: 'classic', name: 'Classic', mark: null, tagline: 'Night sky, neon gradients.' },
  { id: 'tennis', name: 'Centre Court', mark: '🎾', tagline: 'Grass court, optic-yellow ball, Wimbledon purple.' },
  { id: 'motorsport', name: 'Special Stage', mark: '🏁', tagline: 'Gravel, livery orange, checkered flag.' },
  { id: 'pep', name: 'Pep Rally', mark: '📣', tagline: 'Navy bleachers, pom-poms, confetti.' },
]

const listeners = new Set<() => void>()

export function findSkin(id: string | null | undefined): Skin {
  return SKINS.find((skin) => skin.id === id) ?? SKINS[0]
}

export function applySkin(id: string | null | undefined): void {
  document.documentElement.dataset.skin = findSkin(id).id
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSkin(): Skin {
  return useSyncExternalStore(subscribe, () => findSkin(document.documentElement.dataset.skin))
}
