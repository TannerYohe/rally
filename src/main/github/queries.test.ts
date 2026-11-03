import { describe, expect, it } from 'vitest'
import { isReplyOnly } from './queries'

const reply = { replyTo: { id: 'c1' } }
const inline = { replyTo: null }

describe('isReplyOnly', () => {
  it('is true for an empty-body Comment review made only of thread replies', () => {
    expect(isReplyOnly({ state: 'COMMENTED', body: '' }, [reply])).toBe(true)
  })

  it('is false for an inline-only Comment review, which also has an empty body', () => {
    expect(isReplyOnly({ state: 'COMMENTED', body: '' }, [inline, inline])).toBe(false)
    expect(isReplyOnly({ state: 'COMMENTED', body: '' }, [reply, inline])).toBe(false)
  })

  it('is false for reviews with a body, other states, or no comments', () => {
    expect(isReplyOnly({ state: 'COMMENTED', body: 'Looks good' }, [reply])).toBe(false)
    expect(isReplyOnly({ state: 'APPROVED', body: '' }, [reply])).toBe(false)
    expect(isReplyOnly({ state: 'COMMENTED', body: '  ' }, [])).toBe(false)
  })
})
