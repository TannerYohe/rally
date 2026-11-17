import type { FeedbackItem, PrRef } from '@shared/types'
import type { CloneSource } from '../git/prClone'
import { github, pullParams, timeoutRequest } from './client'
import { resolveThread, sameLogin } from './threads'

/** Returns a PR comment body that answers a review body or PR comment and links it, which marks it acknowledged. */
export function conversationReplyBody(item: Pick<FeedbackItem, 'author' | 'url'> & { kind: 'review' | 'comment' }, body: string): string {
  const reviewer = item.author ? `@${item.author}'s` : 'the'
  const target = item.url ? `[${item.kind}](${item.url})` : item.kind
  return `In reply to ${reviewer} ${target}:\n\n${body}`
}

/** Posts a reply as the viewer: on the thread for a review comment, or as a PR comment for a review body or PR comment. Returns the reply's URL. */
export async function postAuthorReply(pr: PrRef, item: FeedbackItem, body: string): Promise<string> {
  const gh = await github()
  switch (item.kind) {
    case 'thread': {
      if (item.replyToCommentId === null) throw new Error('This thread has no comment to reply to.')
      const { data } = await gh.rest.pulls.createReplyForReviewComment({
        ...pullParams(pr),
        comment_id: item.replyToCommentId,
        body,
        request: timeoutRequest(),
      })
      return data.html_url
    }
    case 'review':
    case 'comment': {
      const { data } = await gh.rest.issues.createComment({
        owner: pr.owner,
        repo: pr.repo,
        issue_number: pr.number,
        body: conversationReplyBody({ ...item, kind: item.kind }, body),
        request: timeoutRequest(),
      })
      return data.html_url
    }
    case 'finding':
      throw new Error('Self-review findings have no thread to reply to.')
  }
}

export async function resolveFeedbackThread(threadId: string): Promise<void> {
  await resolveThread(await github(), threadId)
}

/** Returns where to clone the PR's head branch and base branch from, refusing PRs the viewer didn't open. */
export async function fetchCloneSource(pr: PrRef): Promise<CloneSource> {
  const gh = await github()
  const { data: pull } = await gh.rest.pulls.get({ ...pullParams(pr), request: timeoutRequest() })
  if (!pull.user || !sameLogin(pull.user.login, gh.login)) throw new Error('Rally only changes code on PRs you opened.')
  if (!pull.head.repo) throw new Error("The PR's head repository no longer exists.")
  return { headUrl: pull.head.repo.clone_url, branch: pull.head.ref, baseUrl: pull.base.repo.clone_url, baseBranch: pull.base.ref }
}
