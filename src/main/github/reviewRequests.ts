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

const APPROVERS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) { latestOpinionatedReviews(first: 50, writersOnly: true) { nodes { state author { login } } } }
    }
  }
`

interface ApproversResponse {
  repository: { pullRequest: { latestOpinionatedReviews: { nodes: { state: string; author: { login: string } | null }[] } } }
}

export interface ReRequestSplit {
  ready: string[]
  waiting: string[]
  approved: string[]
}

/** Splits pending reviewers into those who already approved, those with an unanswered comment left among the open items, and the rest, who are ready. */
export function reviewersReady(pending: string[], openItems: Pick<FeedbackItem, 'author' | 'answered'>[], approvers: string[]): ReRequestSplit {
  const approved = (login: string) => approvers.some((approver) => sameLogin(approver, login))
  const owed = (login: string) => openItems.some((item) => !item.answered && item.author !== null && sameLogin(item.author, login))
  return {
    ready: pending.filter((login) => !approved(login) && !owed(login)),
    waiting: pending.filter((login) => !approved(login) && owed(login)),
    approved: pending.filter(approved),
  }
}

/** Returns the reviewers whose latest decision on the PR is an approval. */
export async function fetchApprovers(pr: PrRef): Promise<string[]> {
  const gh = await github()
  const response = await gh.graphql<ApproversResponse>(APPROVERS_QUERY, { owner: pr.owner, repo: pr.repo, number: pr.number, request: timeoutRequest() })
  return response.repository.pullRequest.latestOpinionatedReviews.nodes.flatMap((r) => (r.state === 'APPROVED' && r.author ? [r.author.login] : []))
}

export async function requestReviews(pr: PrRef, reviewers: string[]): Promise<void> {
  const gh = await github()
  await gh.rest.pulls.requestReviewers({ ...pullParams(pr), reviewers, request: timeoutRequest() })
}
