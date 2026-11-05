import type { Drafts } from './types'

export interface DraftEdit {
  body?: string
  dropped?: boolean
}

export type DraftEdits = Record<string, DraftEdit>

export function bodyEdited(original: string, edit: string | undefined): boolean {
  return edit !== undefined && edit.trim() !== original.trim()
}

function rewriteLine(subject: string, body: string): string {
  return `- I rewrote ${subject}; use this as final wording:\n  """${body}"""`
}

export function describeEdits(drafts: Drafts | null, edits: DraftEdits, summaryBodyEdit: string | undefined): string {
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

export function feedbackMessage(drafts: Drafts | null, edits: DraftEdits, summaryBodyEdit: string | undefined, text: string): string {
  return [describeEdits(drafts, edits, summaryBodyEdit), text.trim()].filter(Boolean).join('\n\n')
}
