import { describe, expect, it } from 'vitest'
import type { Drafts } from './types'
import { feedbackMessage } from './feedback'

const drafts: Drafts = {
  mode: 'full',
  verdict: 'Needs changes',
  reportMarkdown: '',
  summaryBody: '',
  priorConcerns: [],
  comments: ['1', '2', '3'].map((id) => ({
    id,
    kind: 'inline' as const,
    path: 'a.rb',
    line: 1,
    startLine: null,
    side: 'RIGHT' as const,
    severity: 'medium' as const,
    body: `original ${id}`,
    replyToCommentId: null,
  })),
}

describe('feedbackMessage', () => {
  it('lists rewrites and drops before free text', () => {
    const message = feedbackMessage(drafts, { '1': { body: 'shorter' }, '3': { dropped: true } }, undefined, 'make 2 a nitpick')
    expect(message).toBe(
      'Edits I made in Rally:\n- I rewrote #1; use this as final wording:\n  """shorter"""\n- Drop #3.\n\nmake 2 a nitpick',
    )
  })

  it('ignores edits that match the original body', () => {
    expect(feedbackMessage(drafts, { '2': { body: 'original 2' } }, '', '')).toBe('')
  })

  it('lists a review body rewrite first', () => {
    expect(feedbackMessage(drafts, { '3': { dropped: true } }, 'Looks close.', '')).toBe(
      'Edits I made in Rally:\n- I rewrote the review body; use this as final wording:\n  """Looks close."""\n- Drop #3.',
    )
  })

  it('ignores comment edits that only change surrounding whitespace', () => {
    expect(feedbackMessage(drafts, { '2': { body: 'original 2\n' } }, undefined, '')).toBe('')
  })

  it('ignores whitespace typed where no review body was drafted', () => {
    expect(feedbackMessage(drafts, {}, ' \n ', '')).toBe('')
  })

  describe('with a drafted review body', () => {
    const withBody = { ...drafts, summaryBody: 'Nice work.' }

    it('sends nothing when the body is untouched', () => {
      expect(feedbackMessage(withBody, {}, undefined, '')).toBe('')
    })

    it('ignores an edit that only adds a trailing newline', () => {
      expect(feedbackMessage(withBody, {}, 'Nice work.\n', '')).toBe('')
    })

    it('passes a rewrite as final wording', () => {
      expect(feedbackMessage(withBody, {}, 'Nice work, one blocker.', '')).toBe(
        'Edits I made in Rally:\n- I rewrote the review body; use this as final wording:\n  """Nice work, one blocker."""',
      )
    })
  })

  it('asks to remove a review body cleared to whitespace', () => {
    expect(feedbackMessage({ ...drafts, summaryBody: 'Nice work.' }, {}, '  ', '')).toBe('Edits I made in Rally:\n- Remove the review body.')
  })
})
