import { bodyEdited } from '../lib/feedback'
import { BodyTextarea } from './BodyTextarea'

interface Props {
  original: string
  edit: string | undefined
  disabled: boolean
  onEdit(body: string | undefined): void
}

export function ReviewBodyEditor({ original, edit, disabled, onEdit }: Props) {
  const body = edit ?? original
  const edited = bodyEdited(original, edit)
  return (
    <div className="rounded-xl border border-white/5 bg-ink-900/60 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="font-semibold text-ink-200">Review body</span>
        {edited && <span className="text-amber-300">edited</span>}
        {edited && (
          <button className="ml-auto text-ink-400 hover:text-ink-100" disabled={disabled} onClick={() => onEdit(undefined)}>
            Revert
          </button>
        )}
      </div>
      <BodyTextarea value={body} disabled={disabled} placeholder="No review body. Type one to add it." onChange={onEdit} />
    </div>
  )
}
