import { describe, expect, it } from 'vitest'
import type { PrFeedback } from '@shared/types'
import { authorFeedback, computeAuthorPhase, type RawAuthorFields } from './authorPhase'

const PR = 'https://github.com/acme/api/pull/1'

function raw(overrides: Partial<RawAuthorFields> = {}): RawAuthorFields {
  return {
    reviewDecision: null,
    latestOpinionatedReviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    allReviews: { nodes: [] },
    ...overrides,
  }
}

const thread = (isResolved: boolean, last: string | null, reacted = false) => ({
  isResolved,
  comments: { nodes: [{ author: last ? { login: last } : null, reactionGroups: [{ viewerHasReacted: reacted }] }] },
})

const decision = (state: 'APPROVED' | 'CHANGES_REQUESTED', login: string) => ({ state, author: { login } })

const feedback = (overrides: Partial<PrFeedback> = {}): PrFeedback => ({
  reviewDecision: null,
  openThreads: 0,
  unacknowledged: 0,
  changesRequestedBy: [],
  approvedBy: [],
  ...overrides,
})

describe('authorFeedback', () => {
  it('counts open threads not ending in my reply or reaction, plus unacknowledged PR comments and review bodies', () => {
    const result = authorFeedback(
      raw({
        reviewThreads: { nodes: [thread(false, 'bob'), thread(false, 'Me'), thread(false, 'bob', true), thread(true, 'bob'), thread(false, null)] },
        comments: {
          nodes: [
            { url: `${PR}#issuecomment-1`, body: 'Question?', createdAt: '', author: { login: 'carol', __typename: 'User' } },
            { url: `${PR}#issuecomment-2`, body: 'Coverage', createdAt: '', author: { login: 'codecov', __typename: 'Bot' } },
          ],
        },
        allReviews: { nodes: [{ url: `${PR}#pullrequestreview-5`, body: 'LGTM', state: 'APPROVED', submittedAt: '', author: { login: 'dan' } }] },
      }),
      'me',
    )
    expect(result).toMatchObject({ openThreads: 4, unacknowledged: 4 })
  })

  it('lists reviewers by their latest decision, leaving me out', () => {
    const result = authorFeedback(
      raw({ latestOpinionatedReviews: { nodes: [decision('CHANGES_REQUESTED', 'bob'), decision('APPROVED', 'carol'), decision('APPROVED', 'me')] } }),
      'me',
    )
    expect(result).toMatchObject({ changesRequestedBy: ['bob'], approvedBy: ['carol'] })
  })
})

describe('computeAuthorPhase', () => {
  it('is in progress while a Rally session has work', () => {
    expect(computeAuthorPhase(feedback({ unacknowledged: 2 }), true)).toBe('in_progress')
  })

  it('needs a response for any unacknowledged comment, even when approved', () => {
    expect(computeAuthorPhase(feedback({ unacknowledged: 1, reviewDecision: 'APPROVED', approvedBy: ['bob'] }), false)).toBe('needs_response')
  })

  it('is approved when GitHub says so', () => {
    expect(computeAuthorPhase(feedback({ reviewDecision: 'APPROVED' }), false)).toBe('approved')
  })

  it('is approved by any approval when the repo requires no reviews', () => {
    expect(computeAuthorPhase(feedback({ approvedBy: ['bob'] }), false)).toBe('approved')
  })

  it('awaits reviews once every comment is acknowledged, even with changes requested', () => {
    expect(computeAuthorPhase(feedback({ reviewDecision: 'CHANGES_REQUESTED', changesRequestedBy: ['bob'], openThreads: 2 }), false)).toBe(
      'awaiting_reviews',
    )
  })
})
