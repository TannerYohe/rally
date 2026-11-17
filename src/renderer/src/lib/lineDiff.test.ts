import { describe, expect, it } from 'vitest'
import { lineDiff } from './lineDiff'

describe('lineDiff', () => {
  it('keeps shared lines as context and marks the rest removed or added', () => {
    expect(lineDiff('## Summary\nOld line\nKept', '## Summary\nNew line\nKept\nAdded')).toEqual([
      { kind: 'context', text: '## Summary' },
      { kind: 'remove', text: 'Old line' },
      { kind: 'add', text: 'New line' },
      { kind: 'context', text: 'Kept' },
      { kind: 'add', text: 'Added' },
    ])
  })

  it('treats an empty side as no lines and CRLF as LF', () => {
    expect(lineDiff('', 'First')).toEqual([{ kind: 'add', text: 'First' }])
    expect(lineDiff('a\r\nb', 'a\nb')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'context', text: 'b' },
    ])
  })
})
