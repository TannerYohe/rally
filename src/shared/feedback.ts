import type { DraftComment, Drafts, ReviewEvent } from './types'

export interface DraftEdit {
  body?: string
  dropped?: boolean
}

export type DraftEdits = Record<string, DraftEdit>

export interface DraftChanges {
  edits: DraftEdits
  summaryBodyEdit: string | undefined
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

function describeEdits(drafts: Drafts | null, edits: DraftEdits, summaryBodyEdit: string | undefined): string {
  if (!drafts) return ''
  const lines: string[] = []
  if (summaryBodyEdit !== undefined && bodyEdited(drafts.summaryBody, summaryBodyEdit)) {
    lines.push(summaryBodyEdit.trim() ? rewriteLine('the review body', summaryBodyEdit) : '- Remove the review body.')
  }
  for (const comment of drafts.comments) {
    const edit = edits[comment.id]
    if (!edit) continue
    if (edit.dropped) lines.push(`- Drop #${comment.id}.`)
    else if (edit.body !== undefined && bodyEdited(comment.body, edit.body)) {
      lines.push(rewriteLine(`#${comment.id}`, edit.body))
    }
  }
  return lines.length ? `Edits I made in Rally:\n${lines.join('\n')}` : ''
}

export function feedbackMessage(drafts: Drafts | null, changes: DraftChanges): string {
  return [describeEdits(drafts, changes.edits, changes.summaryBodyEdit), changes.instructions.trim()].filter(Boolean).join('\n\n')
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

function replyLocation(comment: DraftComment): string {
  const target = comment.replyTarget
  if (!target) return `Reply to comment ${comment.replyToCommentId ?? '?'}`
  const location = fileLocation(target.path, target.line)
  return target.author ? `Reply to @${target.author} on ${location}` : `Reply on ${location}`
}

export function commentLocation(comment: DraftComment): string {
  if (comment.kind === 'reply') return replyLocation(comment)
  if (!comment.path) return 'General comment'
  return fileLocation(comment.path, comment.line, comment.startLine)
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
