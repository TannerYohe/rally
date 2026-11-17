import { describe, expect, it } from 'vitest'
import { calendarDate, clockTime, fullTime, megabytes } from './format'

const startedAt = new Date(2026, 10, 4, 15, 12)
const iso = startedAt.toISOString()
const time = startedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const day = startedAt.toLocaleDateString([], { month: 'short', day: 'numeric' })

describe('clockTime', () => {
  it('shows only the time for a timestamp from today', () => {
    expect(clockTime(iso, new Date(2026, 10, 4, 23, 59))).toBe(time)
  })

  it('includes the date for a timestamp from an earlier day', () => {
    expect(clockTime(iso, new Date(2026, 10, 5, 0, 1))).toBe(`${day}, ${time}`)
  })
})

describe('fullTime', () => {
  it('formats the date and time in the local locale', () => {
    expect(fullTime(iso)).toBe(startedAt.toLocaleString())
  })
})

describe('megabytes', () => {
  it('shows bytes as decimal megabytes with one place', () => {
    expect(megabytes(256_774_318)).toBe('256.8 MB')
    expect(megabytes(0)).toBe('0.0 MB')
  })
})

describe('calendarDate', () => {
  it('shows the day without a time', () => {
    const shown = calendarDate('2026-11-05T12:00:00')
    expect(shown).toContain('2026')
    expect(shown).not.toMatch(/\d:\d\d/)
  })
})
