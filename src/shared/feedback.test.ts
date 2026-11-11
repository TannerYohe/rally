import { describe, expect, it } from 'vitest'
import type { Drafts } from './types'
import {
  commentLocation,
  feedbackMessage,
  finalReview,
  foldIntoBody,
  isEmptyCommentReview,
  keptCommentCount,
  SUBMIT_WITH_INSTRUCTIONS_ERROR,
  submitBlockedReason,
  type DraftChanges,
} from './feedback'

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
    const message = feedbackMessage(drafts, { edits: { '1': { body: 'shorter' }, '3': { dropped: true } }, summaryBodyEdit: undefined, instructions: 'make 2 a nitpick' })
    expect(message).toBe(
      'Edits I made in Rally:\n- I rewrote #1; use this as final wording:\n  """shorter"""\n- Drop #3.\n\nmake 2 a nitpick',
    )
  })

  it('ignores edits that match the original body', () => {
    expect(feedbackMessage(drafts, { edits: { '2': { body: 'original 2' } }, summaryBodyEdit: '', instructions: '' })).toBe('')
  })

  it('lists a review body rewrite first', () => {
    expect(feedbackMessage(drafts, { edits: { '3': { dropped: true } }, summaryBodyEdit: 'Looks close.', instructions: '' })).toBe(
      'Edits I made in Rally:\n- I rewrote the review body; use this as final wording:\n  """Looks close."""\n- Drop #3.',
    )
  })

  it('ignores comment edits that only change surrounding whitespace', () => {
    expect(feedbackMessage(drafts, { edits: { '2': { body: 'original 2\n' } }, summaryBodyEdit: undefined, instructions: '' })).toBe('')
  })

  it('ignores whitespace typed where no review body was drafted', () => {
    expect(feedbackMessage(drafts, { edits: {}, summaryBodyEdit: ' \n ', instructions: '' })).toBe('')
  })

  describe('with a drafted review body', () => {
    const withBody = { ...drafts, summaryBody: 'Nice work.' }

    it('sends nothing when the body is untouched', () => {
      expect(feedbackMessage(withBody, { edits: {}, summaryBodyEdit: undefined, instructions: '' })).toBe('')
    })

    it('ignores an edit that only adds a trailing newline', () => {
      expect(feedbackMessage(withBody, { edits: {}, summaryBodyEdit: 'Nice work.\n', instructions: '' })).toBe('')
    })

    it('passes a rewrite as final wording', () => {
      expect(feedbackMessage(withBody, { edits: {}, summaryBodyEdit: 'Nice work, one blocker.', instructions: '' })).toBe(
        'Edits I made in Rally:\n- I rewrote the review body; use this as final wording:\n  """Nice work, one blocker."""',
      )
    })
  })

  it('asks to remove a review body cleared to whitespace', () => {
    expect(feedbackMessage({ ...drafts, summaryBody: 'Nice work.' }, { edits: {}, summaryBodyEdit: '  ', instructions: '' })).toBe('Edits I made in Rally:\n- Remove the review body.')
  })
})

describe('isEmptyCommentReview', () => {
  const unchanged: DraftChanges = { edits: {}, summaryBodyEdit: undefined, instructions: '' }
  const dropAll: DraftChanges = { ...unchanged, edits: { '1': { dropped: true }, '2': { dropped: true }, '3': { dropped: true } } }

  it('is true for a Comment with every draft dropped, no body, and no instructions', () => {
    expect(isEmptyCommentReview('COMMENT', drafts, dropAll)).toBe(true)
  })

  it('is false while a draft is kept or a body is set', () => {
    expect(isEmptyCommentReview('COMMENT', drafts, unchanged)).toBe(false)
    expect(isEmptyCommentReview('COMMENT', drafts, { ...dropAll, summaryBodyEdit: 'Thanks.' })).toBe(false)
  })

  it('uses the edited body over the published one', () => {
    expect(isEmptyCommentReview('COMMENT', { ...drafts, summaryBody: 'Nice.' }, dropAll)).toBe(false)
    expect(isEmptyCommentReview('COMMENT', { ...drafts, summaryBody: 'Nice.' }, { ...dropAll, summaryBodyEdit: ' ' })).toBe(true)
  })

  it('is false for Approve and Request changes', () => {
    expect(isEmptyCommentReview('APPROVE', drafts, dropAll)).toBe(false)
    expect(isEmptyCommentReview('REQUEST_CHANGES', drafts, dropAll)).toBe(false)
  })
})

describe('finalReview', () => {
  const reply = { ...drafts.comments[0], id: '4', kind: 'reply' as const, path: null, line: null, body: 'Did this land?', replyToCommentId: 99 }
  const summaryOnly = { ...drafts.comments[0], id: '5', path: null, line: null, body: 'General point.' }
  const mixed: Drafts = { ...drafts, summaryBody: ' Looks close. ', comments: [...drafts.comments, reply, summaryOnly] }

  it('applies rewrites and drops and splits inline comments from replies', () => {
    const review = finalReview(mixed, { edits: { '1': { body: 'shorter\n' }, '2': { dropped: true } }, summaryBodyEdit: undefined })
    expect(review.body).toBe('Looks close.')
    expect(review.inline.map((c) => [c.id, c.body])).toEqual([
      ['1', 'shorter'],
      ['3', 'original 3'],
    ])
    expect(review.replies.map((c) => [c.id, c.replyToCommentId])).toEqual([['4', 99]])
    expect(review.folded.map((c) => c.id)).toEqual(['5'])
  })

  it('uses the edited review body', () => {
    expect(finalReview(mixed, { edits: {}, summaryBodyEdit: '' }).body).toBe('')
  })

  it('treats a draft whose final body is blank as dropped', () => {
    const review = finalReview(mixed, { edits: { '1': { body: '  ' }, '4': { body: '' } }, summaryBodyEdit: undefined })
    expect(review.inline.map((c) => c.id)).toEqual(['2', '3'])
    expect(review.replies).toEqual([])
    expect(keptCommentCount(mixed, { '1': { body: '  ' }, '4': { body: '' } })).toBe(3)
  })

  it('folds a reply with no target comment', () => {
    const orphan = { ...reply, id: '6', replyToCommentId: null }
    const review = finalReview({ ...mixed, comments: [orphan] }, { edits: {}, summaryBodyEdit: undefined })
    expect(review.replies).toEqual([])
    expect(review.folded.map((c) => c.id)).toEqual(['6'])
  })
})

describe('foldIntoBody', () => {
  const base = drafts.comments[0]
  const prUrl = 'https://github.com/acme/api/pull/12'

  it('appends each comment under its location', () => {
    const ranged = { ...base, path: 'b.rb', startLine: 3, line: 5, body: 'Range note.' }
    expect(foldIntoBody('Summary.', [base, ranged, { ...base, path: null, line: null, body: 'Loose note.' }], prUrl)).toBe(
      'Summary.\n\n**`a.rb:1`**\n\noriginal 1\n\n**`b.rb:3-5`**\n\nRange note.\n\nLoose note.',
    )
  })

  it('skips an empty body', () => {
    expect(foldIntoBody('', [base], prUrl)).toBe('**`a.rb:1`**\n\noriginal 1')
  })

  it('heads a folded reply with a link to the comment it answers', () => {
    const reply = { ...base, kind: 'reply' as const, path: null, line: null, body: 'Still broken.', replyToCommentId: 501 }
    expect(foldIntoBody('', [reply, { ...reply, replyToCommentId: null, body: 'Orphan.' }], prUrl)).toBe(
      '**Reply to [this comment](https://github.com/acme/api/pull/12#discussion_r501)**\n\nStill broken.\n\nOrphan.',
    )
  })
})

describe('commentLocation', () => {
  const base = drafts.comments[0]

  it('formats a line, a range, a file, and comments with no location', () => {
    expect(commentLocation(base)).toBe('a.rb:1')
    expect(commentLocation({ ...base, startLine: 3, line: 5 })).toBe('a.rb:3-5')
    expect(commentLocation({ ...base, line: null })).toBe('a.rb')
    expect(commentLocation({ ...base, path: null })).toBe('General comment')
    expect(commentLocation({ ...base, kind: 'reply', replyToCommentId: 7 })).toBe('Reply to comment 7')
    expect(commentLocation({ ...base, kind: 'reply' })).toBe('Reply to comment ?')
  })

  it('names the author and location of the comment a reply answers once Rally has looked it up', () => {
    const target = { author: 'octocat', path: 'b.rb', line: 9, excerpt: 'Why?', url: 'https://github.com/acme/api/pull/12#discussion_r7' }
    const reply = { ...base, kind: 'reply' as const, replyToCommentId: 7 }
    expect(commentLocation({ ...reply, replyTarget: target })).toBe('Reply to @octocat on b.rb:9')
    expect(commentLocation({ ...reply, replyTarget: { ...target, author: null, line: null } })).toBe('Reply on b.rb')
    expect(commentLocation({ ...reply, replyTarget: null })).toBe('Reply to comment 7')
  })
})

describe('submitBlockedReason', () => {
  it('blocks submit only while there is free-text feedback', () => {
    expect(submitBlockedReason(' \n ')).toBeNull()
    expect(submitBlockedReason('make 2 shorter')).toBe(SUBMIT_WITH_INSTRUCTIONS_ERROR)
  })
})
