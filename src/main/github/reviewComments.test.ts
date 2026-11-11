import { describe, expect, it } from 'vitest'
import type { DraftComment, Drafts } from '@shared/types'
import { attachReplyTargets, excerpt, hasReplies, repliedComment, type RawReviewComment } from './reviewComments'

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

describe('repliedComment', () => {
  it('describes the comment being replied to', () => {
    expect(repliedComment(raw())).toEqual({
      author: 'octocat',
      path: 'app/models/loan.rb',
      line: 42,
      excerpt: 'Should this be memoized?',
      url: 'https://github.com/acme/api/pull/12#discussion_r501',
    })
  })

  it('falls back to the original line on an outdated comment and tolerates a deleted author', () => {
    expect(repliedComment(raw({ line: null, author: null }))).toMatchObject({ author: null, line: 40 })
  })
})

describe('attachReplyTargets', () => {
  const draft = (overrides: Partial<DraftComment>): DraftComment => ({
    id: '1',
    kind: 'reply',
    path: null,
    line: null,
    startLine: null,
    side: 'RIGHT',
    severity: 'medium',
    body: 'Done?',
    replyToCommentId: 501,
    ...overrides,
  })
  const drafts = (comments: DraftComment[]): Drafts => ({ mode: 'followup', verdict: '', reportMarkdown: '', summaryBody: '', comments, priorConcerns: [] })
  const replied = repliedComment(raw())
  const reviewComments = new Map([[501, { threadId: 'PRRT_1', comment: replied }]])

  it('describes replies and marks ones whose comment is not in a review thread', () => {
    const inline = draft({ id: '3', kind: 'inline', path: 'a.rb', line: 1, replyToCommentId: null })
    const result = attachReplyTargets(drafts([draft({}), draft({ id: '2', replyToCommentId: 999 }), inline]), reviewComments)
    expect(result.comments.map((c) => c.replyTarget)).toEqual([{ found: true, comment: replied }, { found: false }, undefined])
  })

  it('only looks up drafts that reply to a comment', () => {
    expect(hasReplies(drafts([draft({ replyToCommentId: null })]))).toBe(false)
    expect(hasReplies(drafts([draft({})]))).toBe(true)
  })
})
