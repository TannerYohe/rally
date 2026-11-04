import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/types'
import indexCss from '../index.css?raw'
import skinsCss from '../skins.css?raw'
import { SKIN_IDS, parseSkinId } from './skins'

describe('parseSkinId', () => {
  it('returns a known skin id', () => {
    expect(parseSkinId('tennis')).toBe('tennis')
  })

  it('falls back to the default skin for a missing or unknown id', () => {
    expect(parseSkinId(null)).toBe(DEFAULT_CONFIG.skin)
    expect(parseSkinId('bowling')).toBe(DEFAULT_CONFIG.skin)
  })
})

describe('skins.css', () => {
  const themeBlock = indexCss.match(/@theme \{([^}]*)\}/)![1]
  const scaleVariables = [...themeBlock.matchAll(/(--color-[a-z]+-\d+):/g)].map((m) => m[1])
  const skinBlocks = new Map([...skinsCss.matchAll(/:root\[data-skin='([a-z]+)'\] \{([^}]*)\}/g)].map((m) => [m[1], m[2]]))

  it('reads the semantic scales from index.css', () => {
    expect(scaleVariables).toHaveLength(44)
  })

  it.each(SKIN_IDS.filter((id) => id !== 'classic'))('defines every semantic scale variable for %s', (id) => {
    const block = skinBlocks.get(id)
    expect(block, `no :root[data-skin='${id}'] block`).toBeDefined()
    const missing = scaleVariables.filter((variable) => !block!.includes(`${variable}:`))
    expect(missing).toEqual([])
  })

  it('only styles known skin ids', () => {
    const styledIds = [...skinsCss.matchAll(/data-skin='([a-z]+)'/g)].map((m) => m[1])
    expect(styledIds.filter((id) => !SKIN_IDS.includes(id as never))).toEqual([])
  })
})
