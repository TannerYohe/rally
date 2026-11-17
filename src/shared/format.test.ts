import { describe, expect, it } from 'vitest'
import { plural } from './format'

describe('plural', () => {
  it('uses the singular only for one', () => {
    expect(plural(1, 'file')).toBe('1 file')
    expect(plural(0, 'file')).toBe('0 files')
    expect(plural(2, 'reply', 'replies')).toBe('2 replies')
  })
})
