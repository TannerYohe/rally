import { describe, expect, it } from 'vitest'
import { repliedReviewers, reviewersReady, uniqueLogins } from './reviewRequests'

describe('repliedReviewers', () => {
  it('keeps each person once and skips bots and findings', () => {
    expect(
      repliedReviewers([
        { kind: 'thread', author: 'bob', authorIsBot: false },
        { kind: 'comment', author: 'Bob', authorIsBot: false },
        { kind: 'review', author: 'carol', authorIsBot: false },
        { kind: 'thread', author: 'github-advanced-security', authorIsBot: true },
        { kind: 'finding', author: null, authorIsBot: false },
      ]),
    ).toEqual(['bob', 'carol'])
  })
})

describe('reviewersReady', () => {
  it('holds back a reviewer who still has an unanswered comment', () => {
    const open = [
      { author: 'bob', answered: true },
      { author: 'carol', answered: false },
    ]
    expect(reviewersReady(['bob', 'Carol'], open, [])).toEqual({ ready: ['bob'], waiting: ['Carol'], approved: [] })
  })

  it('skips reviewers who already approved, whether or not they are still owed a response', () => {
    const open = [{ author: 'carol', answered: false }]
    expect(reviewersReady(['bob', 'carol', 'dan'], open, ['Bob', 'carol'])).toEqual({ ready: ['dan'], waiting: [], approved: ['bob', 'carol'] })
  })
})

describe('uniqueLogins', () => {
  it('drops case-insensitive duplicates, keeping the first spelling', () => {
    expect(uniqueLogins(['Bob', 'carol', 'bob'])).toEqual(['Bob', 'carol'])
  })
})
