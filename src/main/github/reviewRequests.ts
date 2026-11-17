import type { FeedbackItem, PrRef } from '@shared/types'
import { github, pullParams, timeoutRequest } from './client'
import { decisionsField, reviewersWithDecision, type RawDecision } from './feedbackFields'
import { sameLogin, uniqueLogins } from './logins'

/** Returns the people I replied to, leaving out me, bots, self-review findings, and duplicates. */
export function repliedReviewers(items: Pick<FeedbackItem, 'author' | 'authorIsBot' | 'kind'>[], viewer: string): string[] {
  return uniqueLogins(
    items.flatMap((item) => (item.kind !== 'finding' && !item.authorIsBot && item.author && !sameLogin(item.author, viewer) ? [item.author] : [])),
  )
}

const APPROVERS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) { pullRequest(number: $number) { ${decisionsField()} } }
  }
`

interface ApproversResponse {
  repository: { pullRequest: { latestOpinionatedReviews: { nodes: RawDecision[] } } }
}

export interface ReRequestSplit {
  ready: string[]
  waiting: string[]
  skipped: string[]
}

/** Splits pending reviewers into those to skip because they are me or already approved, those with an unanswered comment left among the open items, and the rest, who are ready. */
export function reviewersReady(
  pending: string[],
  openItems: Pick<FeedbackItem, 'author' | 'answered'>[],
  approvers: string[],
  viewer: string,
): ReRequestSplit {
  const skip = (login: string) => sameLogin(login, viewer) || approvers.some((approver) => sameLogin(approver, login))
  const owed = (login: string) => openItems.some((item) => !item.answered && item.author !== null && sameLogin(item.author, login))
  return {
    ready: pending.filter((login) => !skip(login) && !owed(login)),
    waiting: pending.filter((login) => !skip(login) && owed(login)),
    skipped: pending.filter(skip),
  }
}

/** Returns the reviewers other than me whose latest decision on the PR is an approval. */
export async function fetchApprovers(pr: PrRef): Promise<string[]> {
  const gh = await github()
  const response = await gh.graphql<ApproversResponse>(APPROVERS_QUERY, { owner: pr.owner, repo: pr.repo, number: pr.number, request: timeoutRequest() })
  return reviewersWithDecision(response.repository.pullRequest.latestOpinionatedReviews.nodes, 'APPROVED', gh.login)
}

/** Returns whether GitHub refused a review request as invalid, such as for someone who can't review the repo. */
export function isRejectedRequest(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 422
}

export async function requestReview(pr: PrRef, reviewer: string): Promise<void> {
  const gh = await github()
  await gh.rest.pulls.requestReviewers({ ...pullParams(pr), reviewers: [reviewer], request: timeoutRequest() })
}
