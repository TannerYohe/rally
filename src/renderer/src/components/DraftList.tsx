import type { DraftComment, Drafts, Severity } from '@shared/types'
import type { DraftEdits } from '../lib/feedback'

const SEVERITY_STYLES: Record<Severity, string> = {
  blocker: 'bg-rose-500/15 text-rose-300',
  high: 'bg-orange-500/15 text-orange-300',
  medium: 'bg-yellow-500/15 text-yellow-200',
  nit: 'bg-zinc-500/15 text-zinc-300',
}

const SEVERITY_ACCENTS: Record<Severity, string> = {
  blocker: 'border-l-rose-500',
  high: 'border-l-orange-400',
  medium: 'border-l-yellow-300',
  nit: 'border-l-zinc-500',
}

function location(comment: DraftComment): string {
  if (comment.kind === 'reply') return `Reply to comment ${comment.replyToCommentId ?? '?'}`
  if (!comment.path) return 'Review body'
  const lines = comment.startLine ? `${comment.startLine}-${comment.line}` : `${comment.line ?? ''}`
  return `${comment.path}${lines ? `:${lines}` : ''}`
}

interface Props {
  drafts: Drafts
  edits: DraftEdits
  disabled: boolean
  onEdit(id: string, edit: DraftEdits[string] | undefined): void
}

export function DraftList({ drafts, edits, disabled, onEdit }: Props) {
  if (drafts.comments.length === 0) return <p className="text-sm text-zinc-400">No draft comments.</p>
  return (
    <ol className="space-y-3">
      {drafts.comments.map((comment) => {
        const edit = edits[comment.id]
        const dropped = edit?.dropped ?? false
        const body = edit?.body ?? comment.body
        const edited = edit?.body !== undefined && edit.body !== comment.body
        return (
          <li
            key={comment.id}
            className={`rounded-xl border border-l-4 border-white/5 bg-zinc-900/60 p-3 ${SEVERITY_ACCENTS[comment.severity]} ${dropped ? 'opacity-40' : ''}`}
          >
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="font-semibold text-zinc-200">#{comment.id}</span>
              <span className={`rounded px-1.5 py-0.5 ${SEVERITY_STYLES[comment.severity]}`}>{comment.severity}</span>
              <span className="truncate font-mono text-zinc-400">{location(comment)}</span>
              {edited && <span className="text-amber-300">edited</span>}
              <div className="ml-auto flex gap-2">
                {(edited || dropped) && (
                  <button className="text-zinc-400 hover:text-zinc-100" disabled={disabled} onClick={() => onEdit(comment.id, undefined)}>
                    Revert
                  </button>
                )}
                <button
                  className="text-zinc-400 hover:text-rose-300"
                  disabled={disabled}
                  onClick={() => onEdit(comment.id, { ...edit, dropped: !dropped })}
                >
                  {dropped ? 'Keep' : 'Drop'}
                </button>
              </div>
            </div>
            <textarea
              className="w-full resize-y rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-sm text-zinc-100 disabled:opacity-60"
              rows={Math.min(8, Math.max(2, Math.ceil(body.length / 90)))}
              value={body}
              disabled={disabled || dropped}
              onChange={(e) => onEdit(comment.id, { ...edit, body: e.target.value })}
            />
          </li>
        )
      })}
    </ol>
  )
}
