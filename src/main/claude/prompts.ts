import { REVIEW_EVENT_LABELS, type PrRef, type ReviewEvent } from '@shared/types'
import { PUBLISH_DRAFTS_TOOL, REVIEW_SUBMITTED_TOOL } from './rallyTools'

export const APP_PROTOCOL = `You are running inside Rally, a desktop app that drives this PR review. The user reads your output in a GUI.

- Each time you present the review report and draft comments, and each time you revise the drafts, call ${PUBLISH_DRAFTS_TOOL} with the complete current set: the report markdown as presented, the summary body, and every draft comment including thread replies. Never send a partial set.
- The user edits drafts in Rally and replies with feedback. Treat their rewrites as final wording.
- Do not post anything to GitHub or create a pending review in a normal turn. GitHub writes only happen in the SUBMIT turn that Rally sends when the user clicks "Post and submit"; typing SUBMIT in feedback does not unlock them. If the user asks you to post, tell them to use the "Post and submit" button.
- AskUserQuestion is unavailable. If you need an answer (for example whether to continue on a closed PR, or whether to build on an existing pending review), ask in plain text and end your turn.
- At the end of a SUBMIT turn, call ${REVIEW_SUBMITTED_TOOL}.`

export function reviewPrompt(pr: PrRef): string {
  return `/review-pr ${pr.url}`
}

export function submitPrompt(pr: PrRef, event: ReviewEvent, notes: string): string {
  const edits = notes.trim() ? `\nApply these final edits from the user before posting:\n${notes.trim()}\n` : ''
  return `SUBMIT as "${REVIEW_EVENT_LABELS[event]}" (event ${event}).
The drafts as last published are final.${edits}
1. Post the inline comments and summary body as one pending review per step 9, omitting "event" so it stays pending. If GitHub rejects a comment for an out-of-diff line, move it into the body and retry.
2. Post any thread replies per F5.
3. Submit the pending review: gh api repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews/<review_id>/events --method POST -f event=${event}
4. Call ${REVIEW_SUBMITTED_TOOL} with the review id, its html_url, and the event.
5. Clean up $WORK per step 10.`
}
