import { describe, expect, it } from 'vitest'
import type { PrFeedback } from '@shared/types'
import { authorFeedback, computeAuthorPhase, type RawAuthorFields } from './authorPhase'

const HEAD_AT = '2026-11-01T12:00:00Z'

function raw(overrides: Partial<RawAuthorFields> = {}): RawAuthorFields {
  return {
    reviewDecision: null,
    latestOpinionatedReviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    commits: { nodes: [{ commit: { committedDate: HEAD_AT } }] },
    ...overrides,
  }
}

const thread = (isResolved: boolean, ...authors: (string | null)[]) => ({
  isResolved,
  comments: { nodes: authors.map((login) => ({ author: login ? { login } : null })) },
})

const review = (state: 'APPROVED' | 'CHANGES_REQUESTED', login: string, submittedAt: string) => ({ state, submittedAt, author: { login } })

const feedback = (overrides: Partial<PrFeedback> = {}): PrFeedback => ({
  reviewDecision: null,
  openThreads: 0,
  unansweredThreads: 0,
  changesRequestedBy: [],
  approvedBy: [],
  headCommittedAt: HEAD_AT,
  ...overrides,
})

describe('authorFeedback', () => {
  it('counts open threads whose last comment is not mine as unanswered', () => {
    const result = authorFeedback(
      raw({ reviewThreads: { nodes: [thread(false, 'bob'), thread(false, 'bob', 'Me'), thread(true, 'bob'), thread(false, null)] } }),
      [],
      'me',
    )
    expect(result).toMatchObject({ openThreads: 3, unansweredThreads: 2 })
  })

  it('lists change requests submitted after the head commit', () => {
    const result = authorFeedback(
      raw({
        latestOpinionatedReviews: {
          nodes: [review('CHANGES_REQUESTED', 'bob', '2026-11-02T00:00:00Z'), review('CHANGES_REQUESTED', 'carol', '2026-10-30T00:00:00Z')],
        },
      }),
      [],
      'me',
    )
    expect(result.changesRequestedBy).toEqual(['bob'])
  })

  it('drops change requests from reviewers I re-requested', () => {
    const result = authorFeedback(
      raw({ latestOpinionatedReviews: { nodes: [review('CHANGES_REQUESTED', 'bob', '2026-11-02T00:00:00Z')] } }),
      ['Bob'],
      'me',
    )
    expect(result.changesRequestedBy).toEqual([])
  })

  it('lists approvers', () => {
    const result = authorFeedback(raw({ latestOpinionatedReviews: { nodes: [review('APPROVED', 'bob', '2026-11-02T00:00:00Z')] } }), [], 'me')
    expect(result.approvedBy).toEqual(['bob'])
  })
})

describe('computeAuthorPhase', () => {
  it('is in progress while a Rally session has work', () => {
    expect(computeAuthorPhase(feedback({ unansweredThreads: 2 }), true)).toBe('in_progress')
  })

  it('needs a response for unanswered threads', () => {
    expect(computeAuthorPhase(feedback({ unansweredThreads: 1, reviewDecision: 'APPROVED' }), false)).toBe('needs_response')
  })

  it('needs a response for a fresh change request', () => {
    expect(computeAuthorPhase(feedback({ changesRequestedBy: ['bob'] }), false)).toBe('needs_response')
  })

  it('is approved when GitHub says so', () => {
    expect(computeAuthorPhase(feedback({ reviewDecision: 'APPROVED' }), false)).toBe('approved')
  })

  it('is approved by any approval when the repo requires no reviews', () => {
    expect(computeAuthorPhase(feedback({ approvedBy: ['bob'] }), false)).toBe('approved')
  })

  it('awaits reviews when the change request predates the last commit', () => {
    expect(computeAuthorPhase(feedback({ reviewDecision: 'CHANGES_REQUESTED' }), false)).toBe('awaiting_reviews')
  })

  it('awaits reviews with no activity', () => {
    expect(computeAuthorPhase(feedback(), false)).toBe('awaiting_reviews')
  })
})
