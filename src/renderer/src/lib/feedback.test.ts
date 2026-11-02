import { describe, expect, it } from 'vitest'
import type { Drafts } from '@shared/types'
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
    const message = feedbackMessage(drafts, { '1': { body: 'shorter' }, '3': { dropped: true } }, 'make 2 a nitpick')
    expect(message).toBe(
      'Edits I made in Rally:\n- I rewrote #1; use this as final wording:\n  """shorter"""\n- Drop #3.\n\nmake 2 a nitpick',
    )
  })

  it('ignores edits that match the original body', () => {
    expect(feedbackMessage(drafts, { '2': { body: 'original 2' } }, '')).toBe('')
  })
})
