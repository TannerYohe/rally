import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/types'
import { SKIN_IDS, parseSkinId } from './skins'

const readCss = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

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
  const themeBlock = readCss('index.css').match(/@theme \{([^}]*)\}/)![1]
  const scaleVariables = [...themeBlock.matchAll(/(--color-[a-z]+-\d+):/g)].map((m) => m[1])
  const skinsCss = readCss('skins.css')
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
