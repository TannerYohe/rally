import { describe, expect, it } from 'vitest'
import { conversationReplyBody } from './authorReplies'

describe('conversationReplyBody', () => {
  it('links the review or comment it answers', () => {
    expect(conversationReplyBody({ kind: 'review', author: 'bob', url: 'https://github.com/acme/api/pull/1#pullrequestreview-9' }, 'Done.')).toBe(
      "In reply to @bob's [review](https://github.com/acme/api/pull/1#pullrequestreview-9):\n\nDone.",
    )
    expect(conversationReplyBody({ kind: 'comment', author: 'bob', url: 'https://github.com/acme/api/pull/1#issuecomment-3' }, 'Yes.')).toBe(
      "In reply to @bob's [comment](https://github.com/acme/api/pull/1#issuecomment-3):\n\nYes.",
    )
  })
})
