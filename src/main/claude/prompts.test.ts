import { describe, expect, it } from 'vitest'
import type { FeedbackItem } from '@shared/types'
import { authorActionsPrompt, reviewPrompt } from './prompts'

const pr = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }

describe('reviewPrompt', () => {
  it('invokes the configured skill with the PR URL', () => {
    expect(reviewPrompt(pr, 'code-review')).toBe('/code-review https://github.com/acme/api/pull/12')
  })

  it('accepts a skill name with a leading slash or surrounding spaces', () => {
    expect(reviewPrompt(pr, ' /code-review ')).toBe('/code-review https://github.com/acme/api/pull/12')
  })

  it('falls back to review-pr when the skill is blank', () => {
    expect(reviewPrompt(pr, '  ')).toBe('/review-pr https://github.com/acme/api/pull/12')
  })
})

describe('authorActionsPrompt', () => {
  const clone = { path: '/tmp/rally/s1/repo', branch: 'feature', baseRef: 'origin/main' }
  const item: FeedbackItem = {
    id: 'PRRT_1',
    kind: 'thread',
    author: 'bob',
    avatarUrl: null,
    path: 'a.ts',
    line: 3,
    url: null,
    severity: null,
    outdated: true,
    answered: false,
    comments: [
      { author: 'bob', avatarUrl: null, body: 'Rename this.\nIt is unclear.', createdAt: '', url: '' },
      { author: 'me', avatarUrl: null, body: 'Which name?', createdAt: '', url: '' },
    ],
    replyToCommentId: 1,
    reactionSubjectId: 'C2',
  }

  it('lists each requested item with its action, thread, and note', () => {
    const prompt = authorActionsPrompt(pr, clone, [item], [{ itemId: 'PRRT_1', action: 'push_back', note: 'it matches the API' }], '')
    expect(prompt).toContain('checked out at /tmp/rally/s1/repo')
    expect(prompt).toContain('## Item PRRT_1: Push back')
    expect(prompt).toContain('Thread by @bob on a.ts:3 (outdated)')
    expect(prompt).toContain('@bob:\n> Rename this.\n> It is unclear.')
    expect(prompt).toContain('Note from me: it matches the API')
    expect(prompt).not.toContain('Also:')
  })

  it('skips requests for unknown items and appends a general note', () => {
    const prompt = authorActionsPrompt(pr, clone, [item], [{ itemId: 'gone', action: 'fix', note: '' }], 'run the linter')
    expect(prompt).not.toContain('## Item')
    expect(prompt).toContain('Also: run the linter')
  })
})
