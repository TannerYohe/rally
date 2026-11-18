import type { DraftComment, Drafts, ReplyTarget, ReviewEvent } from './types'

export interface DraftEdit {
  body?: string
  dropped?: boolean
}

export type DraftEdits = Record<string, DraftEdit>

export interface DraftChanges {
  edits: DraftEdits
  summaryBodyEdit: string | undefined
  /** Review body rewrites per PR key, in a review of several linked PRs. */
  summaryBodyEdits?: Record<string, string>
  instructions: string
}

export const EMPTY_COMMENT_REVIEW_ERROR =
  'There is nothing to post: a Comment review needs a body, an inline comment, or a thread reply. Use Resolve selected to resolve threads without a review.'

export const SUBMIT_WITH_INSTRUCTIONS_ERROR = 'Send your feedback to Claude before submitting, or clear it.'

export function bodyEdited(original: string, edit: string | undefined): boolean {
  return edit !== undefined && edit.trim() !== original.trim()
}

function rewriteLine(subject: string, body: string): string {
  return `- I rewrote ${subject}; use this as final wording:\n  """${body}"""`
}

function bodyEditLine(original: string, edit: string | undefined, subject: string): string | null {
  if (edit === undefined || !bodyEdited(original, edit)) return null
  return edit.trim() ? rewriteLine(subject, edit) : `- Remove ${subject}.`
}

function describeEdits(drafts: Drafts | null, changes: Pick<DraftChanges, 'edits' | 'summaryBodyEdit' | 'summaryBodyEdits'>): string {
  if (!drafts) return ''
  const lines: string[] = []
  if (drafts.prReviews) {
    for (const review of drafts.prReviews) {
      const line = bodyEditLine(review.summaryBody, changes.summaryBodyEdits?.[review.prKey], `the review body for ${review.prKey}`)
      if (line) lines.push(line)
    }
  } else {
    const line = bodyEditLine(drafts.summaryBody, changes.summaryBodyEdit, 'the review body')
    if (line) lines.push(line)
  }
  for (const comment of drafts.comments) {
    const edit = changes.edits[comment.id]
    if (!edit) continue
    const subject = comment.prKey ? `#${comment.id} on ${comment.prKey}` : `#${comment.id}`
    if (edit.dropped) lines.push(`- Drop ${subject}.`)
    else if (edit.body !== undefined && bodyEdited(comment.body, edit.body)) {
      lines.push(rewriteLine(subject, edit.body))
    }
  }
  return lines.length ? `Edits I made in Rally:\n${lines.join('\n')}` : ''
}

export function feedbackMessage(drafts: Drafts | null, changes: DraftChanges): string {
  return [describeEdits(drafts, changes), changes.instructions.trim()].filter(Boolean).join('\n\n')
}

/** Returns the instruction that asks Claude to pull in everything that changed on the PR, or on each of several PRs, since the given ISO time. */
export function pullChangesInstruction(since: string, prCount = 1): string {
  if (prCount > 1) {
    return (
      `Pull in everything that changed on each of the ${prCount} PRs since ${since}, when your last successful turn started: ` +
      'new commits, comments, replies, reviews, and edits to the title or description. ' +
      "If a head moved, check out the new head in that PR's clone and refresh any diff you saved before reading code. " +
      'Start your reply with a short list of what changed on each PR, or say that nothing did, then update the review to match.'
    )
  }
  return (
    `Pull in everything that changed on the PR since ${since}, when your last successful turn started: ` +
    'new commits, comments, replies, reviews, and edits to the title or description. ' +
    'If the head moved, check out the new head in your clone and refresh any diff you saved before reading code. ' +
    'Start your reply with a short list of what changed, or say that nothing did, then update the review to match.'
  )
}

/** Returns a feedback message that asks Claude to pull in the PRs' changes since the given ISO time, keeping any pending edits and typed feedback. */
export function pullChangesMessage(drafts: Drafts | null, changes: DraftChanges, since: string, prCount = 1): string {
  const instructions = [pullChangesInstruction(since, prCount), changes.instructions.trim()].filter(Boolean).join('\n\n')
  return feedbackMessage(drafts, { ...changes, instructions })
}

function keptComments(drafts: Drafts, edits: DraftEdits): DraftComment[] {
  return drafts.comments.flatMap((comment) => {
    const edit = edits[comment.id]
    const body = (edit?.body ?? comment.body).trim()
    return edit?.dropped || !body ? [] : [{ ...comment, body }]
  })
}

export function keptCommentCount(drafts: Drafts | null, edits: DraftEdits): number {
  return drafts ? keptComments(drafts, edits).length : 0
}

export function isEmptyCommentReview(event: ReviewEvent, drafts: Drafts, changes: DraftChanges): boolean {
  const summaryBody = changes.summaryBodyEdit ?? drafts.summaryBody
  return event === 'COMMENT' && !summaryBody.trim() && keptCommentCount(drafts, changes.edits) === 0
}

export function submitBlockedReason(instructions: string): string | null {
  return instructions.trim() ? SUBMIT_WITH_INSTRUCTIONS_ERROR : null
}

function fileLocation(path: string, line: number | null, startLine: number | null = null): string {
  if (line === null) return path
  return startLine === null ? `${path}:${line}` : `${path}:${startLine}-${line}`
}

/** Returns a reply's looked-up target, treating a stored value without a boolean `found` as not looked up. */
export function lookedUpReplyTarget(comment: DraftComment): ReplyTarget | undefined {
  const target = comment.replyTarget
  return typeof target?.found === 'boolean' ? target : undefined
}

function replyLocation(comment: DraftComment): string {
  const target = lookedUpReplyTarget(comment)
  if (!target?.found) return `Reply to comment ${comment.replyToCommentId ?? '?'}`
  const { author, path, line } = target.comment
  const location = fileLocation(path, line)
  return author ? `Reply to @${author} on ${location}` : `Reply on ${location}`
}

export function commentLocation(comment: DraftComment): string {
  if (comment.kind === 'reply') return replyLocation(comment)
  if (!comment.path) return 'General comment'
  return fileLocation(comment.path, comment.line, comment.startLine)
}

export type ReplyContext = { kind: 'quote'; excerpt: string; url: string } | { kind: 'warning'; message: string }

export function replyContext(comment: DraftComment): ReplyContext | null {
  if (comment.kind !== 'reply') return null
  if (comment.replyToCommentId === null) return { kind: 'warning', message: 'This reply has no comment id, so it will post in the review body.' }
  const target = lookedUpReplyTarget(comment)
  if (target === undefined) return null
  if (!target.found) {
    return { kind: 'warning', message: `Comment ${comment.replyToCommentId} isn't in a review thread on this PR, so this reply will post in the review body.` }
  }
  const { excerpt, url } = target.comment
  return { kind: 'quote', excerpt: excerpt || 'Empty comment', url }
}

export interface FinalReview {
  body: string
  inline: DraftComment[]
  replies: DraftComment[]
  folded: DraftComment[]
}

const canPostInline = (comment: DraftComment) => comment.kind === 'inline' && Boolean(comment.path) && comment.line !== null

export type PostableReply = DraftComment & { kind: 'reply'; replyToCommentId: number }

export const canPostReply = (comment: DraftComment): comment is PostableReply => comment.kind === 'reply' && comment.replyToCommentId !== null

export function finalReview(drafts: Drafts, changes: Pick<DraftChanges, 'edits' | 'summaryBodyEdit'>): FinalReview {
  const kept = keptComments(drafts, changes.edits)
  return {
    body: (changes.summaryBodyEdit ?? drafts.summaryBody).trim(),
    inline: kept.filter(canPostInline),
    replies: kept.filter(canPostReply),
    folded: kept.filter((c) => !canPostInline(c) && !canPostReply(c)),
  }
}

function foldedHeading(comment: DraftComment, prUrl: string): string | null {
  if (comment.kind === 'reply') {
    return comment.replyToCommentId === null ? null : `**Reply to [this comment](${prUrl}#discussion_r${comment.replyToCommentId})**`
  }
  return comment.path ? `**\`${commentLocation(comment)}\`**` : null
}

function foldedComment(comment: DraftComment, prUrl: string): string {
  const heading = foldedHeading(comment, prUrl)
  return heading ? `${heading}\n\n${comment.body}` : comment.body
}

export function foldIntoBody(body: string, comments: DraftComment[], prUrl: string): string {
  return [body, ...comments.map((comment) => foldedComment(comment, prUrl))].filter((part) => part.trim()).join('\n\n')
}
