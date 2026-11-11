import type { DraftComment, Drafts, Severity } from '@shared/types'
import { bodyEdited, commentLocation, type DraftEdits } from '@shared/feedback'
import { BodyTextarea } from './BodyTextarea'

const SEVERITY_STYLES: Record<Severity, string> = {
  blocker: 'bg-rose-500/15 text-rose-300',
  high: 'bg-orange-500/15 text-orange-300',
  medium: 'bg-yellow-500/15 text-yellow-200',
  nit: 'bg-ink-500/15 text-ink-300',
}

const SEVERITY_ACCENTS: Record<Severity, string> = {
  blocker: 'border-l-rose-500',
  high: 'border-l-orange-400',
  medium: 'border-l-yellow-300',
  nit: 'border-l-ink-500',
}

function ReplyContext({ comment }: { comment: DraftComment }) {
  if (comment.kind !== 'reply' || comment.replyTarget === undefined) return null
  if (comment.replyTarget === null) {
    return (
      <div className="mb-2 text-xs text-amber-300">
        Comment {comment.replyToCommentId} isn't in a review thread on this PR, so this reply will post in the review body.
      </div>
    )
  }
  const { excerpt, url } = comment.replyTarget
  return (
    <a
      className="mb-2 block border-l-2 border-ink-600 pl-2 text-xs text-ink-400 hover:border-primary-400 hover:text-ink-200"
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Open the comment on GitHub"
    >
      <span className="line-clamp-2">{excerpt || 'Empty comment'}</span>
    </a>
  )
}

interface Props {
  drafts: Drafts
  edits: DraftEdits
  disabled: boolean
  onEdit(id: string, edit: DraftEdits[string] | undefined): void
}

export function DraftList({ drafts, edits, disabled, onEdit }: Props) {
  return (
    <ol className="space-y-3">
      {drafts.comments.map((comment) => {
        const edit = edits[comment.id]
        const dropped = edit?.dropped ?? false
        const body = edit?.body ?? comment.body
        const edited = bodyEdited(comment.body, edit?.body)
        return (
          <li
            key={comment.id}
            className={`rounded-xl border border-l-4 border-white/5 bg-ink-900/60 p-3 ${SEVERITY_ACCENTS[comment.severity]} ${dropped ? 'opacity-40' : ''}`}
          >
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="font-semibold text-ink-200">#{comment.id}</span>
              <span className={`rounded px-1.5 py-0.5 ${SEVERITY_STYLES[comment.severity]}`}>{comment.severity}</span>
              <span className="truncate font-mono text-ink-400">{commentLocation(comment)}</span>
              {edited && <span className="text-amber-300">edited</span>}
              <div className="ml-auto flex gap-2">
                {(edited || dropped) && (
                  <button className="text-ink-400 hover:text-ink-100" disabled={disabled} onClick={() => onEdit(comment.id, undefined)}>
                    Revert
                  </button>
                )}
                <button
                  className="text-ink-400 hover:text-rose-300"
                  disabled={disabled}
                  onClick={() => onEdit(comment.id, { ...edit, dropped: !dropped })}
                >
                  {dropped ? 'Keep' : 'Drop'}
                </button>
              </div>
            </div>
            <ReplyContext comment={comment} />
            <BodyTextarea value={body} disabled={disabled || dropped} onChange={(value) => onEdit(comment.id, { ...edit, body: value })} />
          </li>
        )
      })}
    </ol>
  )
}
