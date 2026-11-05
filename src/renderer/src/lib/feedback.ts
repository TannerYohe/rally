import type { Drafts } from '@shared/types'

export interface DraftEdit {
  body?: string
  dropped?: boolean
}

export type DraftEdits = Record<string, DraftEdit>

export function summaryBodyEdited(original: string, edit: string | undefined): edit is string {
  return edit !== undefined && edit.trim() !== original.trim()
}

export function describeEdits(drafts: Drafts | null, edits: DraftEdits, summaryBody: string | undefined): string {
  if (!drafts) return ''
  const lines: string[] = []
  if (summaryBodyEdited(drafts.summaryBody, summaryBody)) {
    lines.push(summaryBody.trim() ? `- I rewrote the review body; use this as final wording:\n  """${summaryBody}"""` : '- Remove the review body.')
  }
  for (const comment of drafts.comments) {
    const edit = edits[comment.id]
    if (!edit) continue
    if (edit.dropped) lines.push(`- Drop #${comment.id}.`)
    else if (edit.body !== undefined && edit.body !== comment.body) {
      lines.push(`- I rewrote #${comment.id}; use this as final wording:\n  """${edit.body}"""`)
    }
  }
  return lines.length ? `Edits I made in Rally:\n${lines.join('\n')}` : ''
}

export function feedbackMessage(drafts: Drafts | null, edits: DraftEdits, summaryBody: string | undefined, text: string): string {
  return [describeEdits(drafts, edits, summaryBody), text.trim()].filter(Boolean).join('\n\n')
}
