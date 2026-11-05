import type { Drafts, ReviewEvent } from './types'

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

export function keptCommentCount(drafts: Drafts | null, edits: DraftEdits): number {
  return drafts?.comments.filter((c) => !edits[c.id]?.dropped).length ?? 0
}

export function isEmptyCommentReview(event: ReviewEvent, drafts: Drafts, changes: DraftChanges): boolean {
  const summaryBody = changes.summaryBodyEdit ?? drafts.summaryBody
  return event === 'COMMENT' && !summaryBody.trim() && keptCommentCount(drafts, changes.edits) === 0 && !changes.instructions.trim()
}
