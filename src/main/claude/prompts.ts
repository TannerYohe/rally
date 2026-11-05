import { DEFAULT_CONFIG, REVIEW_EVENT_LABELS, type PrRef, type ReviewEvent } from '@shared/types'
import { PUBLISH_DRAFTS_TOOL, REVIEW_SUBMITTED_TOOL } from './rallyTools'

export const APP_PROTOCOL = `You are running inside Rally, a desktop app that drives this PR review. The user reads your output in a GUI.

- Each time you present the review report and draft comments, and each time you revise the drafts, call ${PUBLISH_DRAFTS_TOOL} with the complete current set: the report markdown as presented, the summary body, and every draft comment including thread replies. Never send a partial set.
- In a follow-up review, include every earlier comment of mine in prior_concerns with its status and, for inline threads, the review thread's GraphQL node id (PRRT_...). Rally resolves threads the user selects; never resolve review threads yourself.
- The user edits drafts in Rally and replies with feedback. Treat their rewrites as final wording.
- Do not post anything to GitHub or create a pending review in a normal turn. GitHub writes only happen in the SUBMIT turn that Rally sends when the user clicks "Post and submit"; typing SUBMIT in feedback does not unlock them. If the user asks you to post, tell them to use the "Post and submit" button.
- Shell variables do not carry over between Bash calls, and Rally only treats $WORK as a temp path in the command that assigns it with mktemp. In every later command, use the absolute $WORK path from the clone step.
- AskUserQuestion is unavailable. If you need an answer (for example whether to continue on a closed PR, or whether to build on an existing pending review), ask in plain text and end your turn.
- At the end of a SUBMIT turn, call ${REVIEW_SUBMITTED_TOOL}.`

export function reviewPrompt(pr: PrRef, skill: string): string {
  const name = skill.trim().replace(/^\//, '') || DEFAULT_CONFIG.reviewSkill
  return `/${name} ${pr.url}`
}

const REVIEW_THREADS_QUERY =
  'query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { id comments(first: 100) { nodes { databaseId } } } } } } }'

const THREAD_REPLY_MUTATION =
  'mutation($review: ID!, $thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body }) { comment { id } } }'

export function submitPrompt(pr: PrRef, event: ReviewEvent, notes: string): string {
  const edits = notes.trim() ? `\nApply these final edits from the user before posting:\n${notes.trim()}\n` : ''
  const pullPath = `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`
  return `SUBMIT as "${REVIEW_EVENT_LABELS[event]}" (event ${event}).
The drafts as last published are final.${edits}
Every inline comment and thread reply goes into one pending review, which is then submitted. Do not use the comments/<comment_id>/replies endpoint: it posts each reply as a separate review.
1. Write the inline comments and summary body to a JSON file in the working directory with "commit_id" (the PR's current head SHA), "body", and "comments" (each with "path", "line", "side", and "start_line" for ranges; an empty array when there are none). Omit "event" so the review stays pending. Create it with: gh api ${pullPath}/reviews --method POST --input <file>. Keep the response's "id" and "node_id". If GitHub rejects a comment for an out-of-diff line, move it into the body and retry.
2. If there are thread replies, list the PR's review threads with: gh api graphql -f owner=${pr.owner} -f repo=${pr.repo} -F number=${pr.number} -f query='${REVIEW_THREADS_QUERY}'
Each reply belongs to the thread whose comments include its reply-to comment id.
3. Add each reply to the pending review with: gh api graphql -f review=<node_id> -f thread=<thread id> -f body='<reply>' -f query='${THREAD_REPLY_MUTATION}'
4. Submit the pending review: gh api ${pullPath}/reviews/<id>/events --method POST -f event=${event}
5. Call ${REVIEW_SUBMITTED_TOOL} with the review id, its html_url, and the event.
If anything after creating the pending review fails and retrying does not fix it, delete that pending review with: gh api ${pullPath}/reviews/<id> --method DELETE
Then tell the user what failed and end the turn without calling ${REVIEW_SUBMITTED_TOOL}.`
}
