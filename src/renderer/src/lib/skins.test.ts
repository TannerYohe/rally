import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/types'
import { parseSkinId } from './skins'

describe('parseSkinId', () => {
  it('returns a known skin id', () => {
    expect(parseSkinId('tennis')).toBe('tennis')
  })

  it('falls back to the default skin for a missing or unknown id', () => {
    expect(parseSkinId(null)).toBe(DEFAULT_CONFIG.skin)
    expect(parseSkinId('bowling')).toBe(DEFAULT_CONFIG.skin)
  })
})
