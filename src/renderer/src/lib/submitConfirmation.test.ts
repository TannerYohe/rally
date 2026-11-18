import { describe, expect, it } from 'vitest'
import { submitConfirmation } from './submitConfirmation'

describe('submitConfirmation', () => {
  it('counts one PR', () => {
    expect(submitConfirmation([{ prKey: 'a/x#1', event: 'APPROVE' }], [{ prKey: 'a/x#1', commentCount: 2, threadCount: 1 }])).toBe(
      'Post 2 comment(s) and submit the review as "Approve", then resolve 1 review thread(s)?',
    )
  })

  it('leaves out the comments and threads of skipped PRs and keeps threads of PRs that already posted', () => {
    const members = [
      { prKey: 'a/x#1', commentCount: 2, threadCount: 1 },
      { prKey: 'a/y#2', commentCount: 5, threadCount: 3 },
      { prKey: 'a/z#3', commentCount: 7, threadCount: 4 },
    ]
    const verdicts = [
      { prKey: 'a/x#1', event: 'COMMENT' as const },
      { prKey: 'a/y#2', event: 'SKIP' as const },
    ]
    expect(submitConfirmation(verdicts, members)).toBe('Post 2 comment(s), submit a/x#1 as "Comment", skip a/y#2, then resolve 5 review thread(s)?')
  })
})
