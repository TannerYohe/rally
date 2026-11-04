import { describe, expect, it } from 'vitest'
import { DEFAULT_SKIN, parseSkin } from './skins'

describe('parseSkin', () => {
  it('returns a known skin id', () => {
    expect(parseSkin('tennis')).toBe('tennis')
  })

  it('falls back to the default for a missing or unknown value', () => {
    expect(parseSkin(null)).toBe(DEFAULT_SKIN)
    expect(parseSkin('bowling')).toBe(DEFAULT_SKIN)
  })
})
