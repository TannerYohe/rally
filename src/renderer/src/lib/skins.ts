import { useSyncExternalStore } from 'react'

export type SkinId = 'classic' | 'tennis' | 'motorsport' | 'pep'

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

const STORAGE_KEY = 'rally.skin'

const listeners = new Set<() => void>()

export function findSkin(id: string | null | undefined): Skin {
  return SKINS.find((skin) => skin.id === id) ?? SKINS[0]
}

export function loadSkin(): void {
  document.documentElement.dataset.skin = findSkin(localStorage.getItem(STORAGE_KEY)).id
}

export function saveSkin(id: SkinId): void {
  localStorage.setItem(STORAGE_KEY, id)
  document.documentElement.dataset.skin = id
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSkin(): Skin {
  return useSyncExternalStore(subscribe, () => findSkin(document.documentElement.dataset.skin))
}
