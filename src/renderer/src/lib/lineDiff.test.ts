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

  it('keeps a long shared header and footer as context around a change', () => {
    const header = Array.from({ length: 3000 }, (_, n) => `header ${n}`)
    const footer = Array.from({ length: 3000 }, (_, n) => `footer ${n}`)
    const diff = lineDiff([...header, 'old', ...footer].join('\n'), [...header, 'new', ...footer].join('\n'))
    expect(diff).toHaveLength(6002)
    expect(diff.slice(2999, 3003)).toEqual([
      { kind: 'context', text: 'header 2999' },
      { kind: 'remove', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'context', text: 'footer 0' },
    ])
  })
})
