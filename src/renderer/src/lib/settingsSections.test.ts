import { describe, expect, it } from 'vitest'
import { blocksLeavingSettings, sectionFromParam, settingsPath } from './settingsSections'

describe('sectionFromParam', () => {
  it('returns a known section', () => {
    expect(sectionFromParam('reviews')).toBe('reviews')
  })

  it('falls back to pull requests for a missing or unknown section', () => {
    expect(sectionFromParam(undefined)).toBe('pull-requests')
    expect(sectionFromParam('nope')).toBe('pull-requests')
  })
})

describe('settingsPath', () => {
  it('builds the route for a section', () => {
    expect(settingsPath('accounts')).toBe('/settings/accounts')
  })
})

describe('blocksLeavingSettings', () => {
  it('blocks leaving Settings with unsaved changes', () => {
    expect(blocksLeavingSettings(true, '/')).toBe(true)
    expect(blocksLeavingSettings(true, '/pr/acme/api/1')).toBe(true)
    expect(blocksLeavingSettings(true, '/settingsx')).toBe(true)
  })

  it('allows switching Settings tabs with unsaved changes', () => {
    expect(blocksLeavingSettings(true, '/settings')).toBe(false)
    expect(blocksLeavingSettings(true, '/settings/reviews')).toBe(false)
  })

  it('allows leaving when nothing changed', () => {
    expect(blocksLeavingSettings(false, '/')).toBe(false)
  })
})
