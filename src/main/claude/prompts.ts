import { COMMIT_PLACEHOLDER, itemLocation } from '@shared/authorSession'
import { DEFAULT_CONFIG, RESPONSE_ACTION_LABELS, type ActionRequest, type CloneInfo, type FeedbackItem, type FeedbackItemKind, type PrRef } from '@shared/types'
import { PUBLISH_DESCRIPTION_TOOL, PUBLISH_RESPONSES_TOOL } from './authorTools'
import { PUBLISH_DRAFTS_TOOL } from './rallyTools'

const SHELL_AND_QUESTION_NOTES = `- Shell variables do not carry over between Bash calls, and Rally only treats $WORK as a temp path in the command that assigns it with mktemp. In every later command, use the absolute $WORK path from the clone step.
- AskUserQuestion is unavailable. If you need an answer (for example whether to continue on a closed PR), ask in plain text and end your turn.`

export const APP_PROTOCOL = `You are running inside Rally, a desktop app that drives this PR review. The user reads your output in a GUI.

- Each time you present the review report and draft comments, and each time you revise the drafts, call ${PUBLISH_DRAFTS_TOOL} with the complete current set: the report markdown as presented, the summary body, and every draft comment including thread replies. Never send a partial set.
- In a follow-up review, include every earlier comment of mine in prior_concerns with its status and, for inline threads, the review thread's GraphQL node id (PRRT_...). Rally resolves threads the user selects; never resolve review threads yourself.
- The user edits drafts in Rally and replies with feedback. Treat their rewrites as final wording.
- Never post anything to GitHub or create a pending review. Rally posts the published drafts itself when the user clicks "Post and submit". If the user asks you to post, tell them to use that button.
${SHELL_AND_QUESTION_NOTES}`

export const AUTHOR_PROTOCOL = `You are running inside Rally, a desktop app. The user is the author of this PR and is responding to review feedback on it. The user reads your output in a GUI.

- Rally clones the PR's head branch and names the clone's path in each request. Read and change code only in that clone. Edit files but leave git to Rally: in the clone, only git commands that read are allowed. After the turn, Rally commits the files you list for each fix item. It doesn't commit edits made for a free-form message: the user commits those from the Changes tab, so say which files you changed. Rally pushes once the user approves the diff.
- Each request lists feedback items, each with one action:
  - investigate: decide whether the comment holds against the code. Do not change code. Give a verdict with file:line evidence. If the comment does not hold, draft the reply the author would post to explain why; if it holds, leave the reply empty and say in the summary what a fix would take.
  - fix: the author agrees. Make the smallest change that resolves it and run the relevant tests or checks when they are quick. List the files you changed for this item and a commit message; Rally commits each item separately. Draft a short reply that says what changed and names the commit as ${COMMIT_PLACEHOLDER}, which Rally replaces with its short sha.
  - push_back: the author disagrees. Do not change code. Draft a short, respectful reply that explains why, citing the code.
  - answer: the comment asks a question or makes a remark rather than pointing out a problem. Do not change code. Draft a reply that answers it, reading the code when the answer depends on it.
- Self-review findings are private, so they never get a reply: leave reply_body empty and put everything in the summary. For push_back on a finding, say in the summary why it doesn't apply or isn't worth changing, citing the code.
- The author's note on an item overrides your own judgement.
- After handling the items, call ${PUBLISH_RESPONSES_TOOL} once with an entry for every item in the request. Each later turn that changes an item's result, call it again for that item.
- Replies post under the author's name. Write them in the first person as the author, plain and brief, with no greeting or sign-off.
- When asked to run a review skill on this PR, it is a self-review. Publish its result with ${PUBLISH_DRAFTS_TOOL} as the skill instructs. Rally keeps self-review findings private and offers them to the author as items to fix.
- The PR's title and description should match its code. When a fix or a message changes something they state, or adds something reviewers need to know, call ${PUBLISH_DESCRIPTION_TOOL} with the complete proposed title and description, keeping their structure, template sections, and voice. Read the current ones with \`gh pr view <url> --json title,body\`. Rally shows the user the change and updates GitHub when they push.
- Never post to GitHub, edit the PR, resolve review threads, or push. Rally does those itself.
${SHELL_AND_QUESTION_NOTES}`

export function reviewPrompt(pr: PrRef, skill: string): string {
  const name = skill.trim().replace(/^\//, '') || DEFAULT_CONFIG.reviewSkill
  return `/${name} ${pr.url}`
}

function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

const ITEM_SOURCE_LABELS: Record<FeedbackItemKind, string> = {
  thread: 'Thread',
  review: 'Review',
  comment: 'PR comment',
  finding: 'Self-review finding',
}

function itemSection(item: FeedbackItem, request: ActionRequest): string {
  const source = item.author ? `${ITEM_SOURCE_LABELS[item.kind]} by @${item.author}` : ITEM_SOURCE_LABELS[item.kind]
  const lines = [
    `## Item ${item.id}: ${RESPONSE_ACTION_LABELS[request.action]}`,
    `${source} on ${itemLocation(item)}${item.outdated ? ' (outdated)' : ''}${item.severity ? `, severity ${item.severity}` : ''}`,
    ...item.comments.map((comment) => `${comment.author ? `@${comment.author}` : 'Self-review'}:\n${quote(comment.body)}`),
  ]
  if (request.note.trim()) lines.push(`Note from me: ${request.note.trim()}`)
  return lines.join('\n\n')
}

/** Returns the turn prompt asking Claude to investigate, fix, push back on, or answer each requested item. */
export function authorActionsPrompt(pr: PrRef, clone: CloneInfo, items: FeedbackItem[], requests: ActionRequest[], note: string): string {
  const byId = new Map(items.map((item) => [item.id, item]))
  const sections = requests.flatMap((request) => {
    const item = byId.get(request.itemId)
    return item ? [itemSection(item, request)] : []
  })
  return [
    `Respond to review feedback on my PR ${pr.url}.`,
    `The head branch \`${clone.branch}\` is checked out at ${clone.path}. \`origin/${clone.branch}\` is what is on GitHub, and the base branch is \`${clone.baseRef}\`.`,
    ...sections,
    note.trim() ? `Also: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Returns the turn prompt asking Claude to resolve conflicts Rally hit merging the remote branch into the clone. */
export function mergeConflictPrompt(clone: CloneInfo, files: string[]): string {
  return [
    `Rally merged \`origin/${clone.branch}\` into the PR branch in ${clone.path}, and the merge conflicted in:`,
    files.map((file) => `- ${file}`).join('\n'),
    'Resolve each file by editing it to remove every conflict marker, keeping the intent of both sides. Run the relevant checks when they are quick. ' +
      'Leave git to Rally: it commits the merge when your turn ends. Then reply with a line per file saying how you resolved it.',
  ].join('\n\n')
}
