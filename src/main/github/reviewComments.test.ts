import { describe, expect, it } from 'vitest'
import { excerpt, replyTarget, type RawReviewComment } from './reviewComments'

const raw = (overrides: Partial<RawReviewComment> = {}): RawReviewComment => ({
  databaseId: 501,
  url: 'https://github.com/acme/api/pull/12#discussion_r501',
  path: 'app/models/loan.rb',
  line: 42,
  originalLine: 40,
  bodyText: 'Should this be memoized?',
  author: { login: 'octocat' },
  ...overrides,
})

describe('excerpt', () => {
  it('collapses whitespace onto one line', () => {
    expect(excerpt('  First line.\n\n  Second   line. ')).toBe('First line. Second line.')
  })

  it('truncates long text with an ellipsis', () => {
    const result = excerpt('word '.repeat(100))
    expect(result.length).toBeLessThanOrEqual(160)
    expect(result.endsWith('word…')).toBe(true)
  })
})

describe('replyTarget', () => {
  it('describes the comment being replied to', () => {
    expect(replyTarget(raw())).toEqual({
      author: 'octocat',
      path: 'app/models/loan.rb',
      line: 42,
      excerpt: 'Should this be memoized?',
      url: 'https://github.com/acme/api/pull/12#discussion_r501',
    })
  })

  it('falls back to the original line on an outdated comment and tolerates a deleted author', () => {
    expect(replyTarget(raw({ line: null, author: null }))).toMatchObject({ author: null, line: 40 })
  })
})
