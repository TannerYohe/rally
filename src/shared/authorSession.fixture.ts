import { newAuthorSession } from './authorSession'
import type { AuthorSession, FeedbackItem, ItemResponse, PrRef } from './types'

export const fixturePr = (number: number): PrRef => ({ owner: 'acme', repo: 'api', number, url: `https://github.com/acme/api/pull/${number}` })

export function feedbackItem(id: string, overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id,
    kind: 'thread',
    author: 'bob',
    authorIsBot: false,
    avatarUrl: null,
    path: 'a.ts',
    line: 3,
    url: 'https://github.com/acme/api/pull/1#discussion_r1',
    severity: null,
    outdated: false,
    answered: false,
    comments: [{ author: 'bob', avatarUrl: null, body: 'Rename this', createdAt: '2026-11-01T00:00:00Z', url: '' }],
    replyToCommentId: 1,
    reactionSubjectId: 'C1',
    ...overrides,
  }
}

export function itemResponse(itemId: string, reply: string, overrides: Partial<ItemResponse> = {}): ItemResponse {
  return {
    itemId,
    action: 'push_back',
    verdict: null,
    summary: '',
    reply,
    files: [],
    commitMessage: '',
    pendingCommit: false,
    commits: [],
    commitError: null,
    at: '2026-11-02T00:00:00Z',
    ...overrides,
  }
}

/** Returns a stored author session for PR `number`, with id `author-<number>`. */
export function authorSession(number: number, overrides: Partial<AuthorSession> = {}): AuthorSession {
  const pr = fixturePr(number)
  const at = '2026-11-01T00:00:00Z'
  const core = { id: `author-${number}`, pr, prKey: `acme/api#${number}`, sdkSessionId: null, status: 'awaiting_feedback' as const, error: null, timeline: [], createdAt: at, updatedAt: at }
  return { ...newAuthorSession(core), ...overrides }
}
