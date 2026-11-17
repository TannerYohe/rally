import type { FeedbackItem, PrRef } from '@shared/types'
import { github, pullParams, timeoutRequest } from './client'
import { sameLogin } from './threads'

export function uniqueLogins(logins: string[]): string[] {
  return logins.filter((login, index) => logins.findIndex((other) => sameLogin(other, login)) === index)
}

/** Returns the people I replied to, leaving out bots, self-review findings, and duplicates. */
export function repliedReviewers(items: Pick<FeedbackItem, 'author' | 'authorIsBot' | 'kind'>[]): string[] {
  return uniqueLogins(items.flatMap((item) => (item.kind !== 'finding' && !item.authorIsBot && item.author ? [item.author] : [])))
}

/** Splits pending reviewers into those with no unanswered comment left among the open items and those still owed a response. */
export function reviewersReady(pending: string[], openItems: Pick<FeedbackItem, 'author' | 'answered'>[]): { ready: string[]; waiting: string[] } {
  const owed = (login: string) => openItems.some((item) => !item.answered && item.author !== null && sameLogin(item.author, login))
  return { ready: pending.filter((login) => !owed(login)), waiting: pending.filter(owed) }
}

export async function requestReviews(pr: PrRef, reviewers: string[]): Promise<void> {
  const gh = await github()
  await gh.rest.pulls.requestReviewers({ ...pullParams(pr), reviewers, request: timeoutRequest() })
}
