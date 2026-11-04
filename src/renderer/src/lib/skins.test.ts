import { describe, expect, it } from 'vitest'
import { SKINS, findSkin } from './skins'

describe('findSkin', () => {
  it('returns the skin with a known id', () => {
    expect(findSkin('tennis').id).toBe('tennis')
  })

  it('falls back to the first skin for a missing or unknown id', () => {
    expect(findSkin(null)).toBe(SKINS[0])
    expect(findSkin('bowling')).toBe(SKINS[0])
  })
})
