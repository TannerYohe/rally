import { describe, expect, it } from 'vitest'
import { reviewReplyBody } from './authorReplies'

describe('reviewReplyBody', () => {
  it('links the review it answers', () => {
    expect(reviewReplyBody({ author: 'bob', url: 'https://github.com/acme/api/pull/1#pullrequestreview-9' }, 'Done.')).toBe(
      "In reply to @bob's [review](https://github.com/acme/api/pull/1#pullrequestreview-9):\n\nDone.",
    )
  })
})
