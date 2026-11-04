import { describe, expect, it } from 'vitest'
import { addEntries, entriesFromPaste, splitEntries } from './tagEntries'

describe('splitEntries', () => {
  it('splits on commas, spaces, and newlines', () => {
    expect(splitEntries('alice, bob\ncarol  dave')).toEqual(['alice', 'bob', 'carol', 'dave'])
  })

  it('drops empty entries', () => {
    expect(splitEntries(' ,\n, ')).toEqual([])
  })
})

describe('entriesFromPaste', () => {
  it('keeps the typed draft ahead of a pasted list', () => {
    expect(entriesFromPaste('alice', 'bob\ncarol')).toEqual(['alice', 'bob', 'carol'])
  })

  it('returns the pasted list when nothing is typed', () => {
    expect(entriesFromPaste('', 'bob, carol')).toEqual(['bob', 'carol'])
  })

  it('returns null for a single entry so it pastes as text', () => {
    expect(entriesFromPaste('ali', 'ce')).toBeNull()
    expect(entriesFromPaste('', '  ')).toBeNull()
  })
})

describe('addEntries', () => {
  it('appends new entries in order', () => {
    expect(addEntries(['alice'], ['bob', 'carol'])).toEqual(['alice', 'bob', 'carol'])
  })

  it('skips entries already present, ignoring case', () => {
    expect(addEntries(['Alice', 'acme/*'], ['alice', 'ACME/*', 'bob'])).toEqual(['Alice', 'acme/*', 'bob'])
  })

  it('dedupes within the added entries', () => {
    expect(addEntries([], ['bob', 'Bob', 'bob'])).toEqual(['bob'])
  })

  it('returns the same values when nothing is new', () => {
    expect(addEntries(['alice'], ['ALICE'])).toEqual(['alice'])
  })
})
