export type SkinId = 'classic' | 'tennis' | 'motorsport' | 'pep'

export interface Skin {
  id: SkinId
  name: string
  mark: string
  tagline: string
}

export const SKINS: Skin[] = [
  { id: 'classic', name: 'Classic', mark: '✨', tagline: 'Night sky, neon gradients.' },
  { id: 'tennis', name: 'Centre Court', mark: '🎾', tagline: 'Grass court, optic-yellow ball, Wimbledon purple.' },
  { id: 'motorsport', name: 'Special Stage', mark: '🏁', tagline: 'Gravel, livery orange, checkered flag.' },
  { id: 'pep', name: 'Pep Rally', mark: '📣', tagline: 'Navy bleachers, pom-poms, confetti.' },
]

export const DEFAULT_SKIN: SkinId = 'classic'

const STORAGE_KEY = 'rally.skin'

export function parseSkin(value: string | null): SkinId {
  return SKINS.find((skin) => skin.id === value)?.id ?? DEFAULT_SKIN
}

export function loadSkin(): SkinId {
  return parseSkin(localStorage.getItem(STORAGE_KEY))
}

export function applySkin(id: SkinId): void {
  document.documentElement.dataset.skin = id
}

export function saveSkin(id: SkinId): void {
  localStorage.setItem(STORAGE_KEY, id)
  applySkin(id)
}
