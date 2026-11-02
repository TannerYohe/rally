import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonDir } from './jsonFile'

describe('JsonDir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rally-jsondir-'))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('skips files it cannot parse and keeps the rest', () => {
    const store = new JsonDir<{ id: number }>(dir)
    store.write('a', { id: 1 })
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(store.readAll()).toEqual([{ id: 1 }])
    expect(log).toHaveBeenCalledWith('Skipping unreadable JSON file', expect.objectContaining({ path: join(dir, 'broken.json') }))
  })
})
