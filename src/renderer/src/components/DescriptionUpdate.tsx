import { useMemo, useState } from 'react'
import { normalizedDescription } from '@shared/authorSession'
import type { DescriptionDraft, PrDescription } from '@shared/types'
import { age, fullTime } from '../lib/format'
import { lineDiff } from '../lib/lineDiff'
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/theme'
import { BodyTextarea } from './BodyTextarea'
import { DiffLines } from './DiffView'

const LINE_PREFIX = { add: '+', remove: '-', context: ' ' } as const

/** Shows how a description update changes the title and body, line by line. */
function DescriptionDiff({ base, next }: { base: PrDescription; next: PrDescription }) {
  const before = normalizedDescription(base)
  const after = normalizedDescription(next)
  const bodyLines = useMemo(
    () => lineDiff(before.body, after.body).map((line) => ({ kind: line.kind, text: `${LINE_PREFIX[line.kind]} ${line.text}` })),
    [before.body, after.body],
  )
  return (
    <div className="space-y-2">
      {before.title !== after.title && (
        <div className="space-y-0.5 rounded-lg border border-white/5 bg-ink-950 px-3 py-2 text-sm">
          <div className="text-rose-200 line-through decoration-rose-400/60">{before.title}</div>
          <div className="text-emerald-200">{after.title}</div>
        </div>
      )}
      {before.body === after.body ? (
        <p className="text-xs text-ink-500">The description body is unchanged.</p>
      ) : (
        <DiffLines lines={bodyLines} className="whitespace-pre-wrap rounded-lg border border-white/5 bg-ink-950 py-1" />
      )}
    </div>
  )
}

interface DescriptionUpdateProps {
  draft: DescriptionDraft
  edit: PrDescription | null
  disabled: boolean
  pushAllowed: boolean
  pushesWithCommits: boolean
  onEdit(edit: PrDescription | null): void
  onDiscard(): void
  onPush(): void
}

/** Shows the description update Claude proposed, lets the author edit it, and pushes it on its own when there are no commits to push. */
export function DescriptionUpdate({ draft, edit, disabled, pushAllowed, pushesWithCommits, onEdit, onDiscard, onPush }: DescriptionUpdateProps) {
  const [editing, setEditing] = useState(false)
  const next = edit ?? draft
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">
          PR description update
          <span className="ml-2 text-xs font-normal text-ink-500" title={fullTime(draft.at)}>
            {edit ? 'edited by you' : `proposed ${age(draft.at)} ago`}
          </span>
        </h3>
        <div className="ml-auto flex gap-2">
          <button className={SECONDARY_BUTTON_CLASS} disabled={disabled} onClick={() => setEditing(!editing)}>
            {editing ? 'Show changes' : 'Edit'}
          </button>
          {edit && (
            <button className={SECONDARY_BUTTON_CLASS} disabled={disabled} onClick={() => onEdit(null)}>
              Undo edits
            </button>
          )}
          <button className={SECONDARY_BUTTON_CLASS} disabled={disabled} onClick={onDiscard}>
            Discard
          </button>
          {!pushesWithCommits && (
            <button className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`} disabled={disabled || !pushAllowed || !next.title.trim()} onClick={onPush}>
              Update on GitHub
            </button>
          )}
        </div>
      </div>
      {pushesWithCommits && <p className="text-xs text-ink-400">Push to GitHub updates the description after it pushes the commits.</p>}
      {editing ? (
        <div className="space-y-2">
          <input
            className="w-full rounded-md border border-ink-800 bg-ink-950 px-2 py-1 text-sm text-ink-100"
            placeholder="PR title"
            value={next.title}
            disabled={disabled}
            onChange={(event) => onEdit({ title: event.target.value, body: next.body })}
          />
          <BodyTextarea value={next.body} disabled={disabled} placeholder="PR description" maxRows={30} onChange={(body) => onEdit({ title: next.title, body })} />
        </div>
      ) : (
        <DescriptionDiff base={draft.base} next={next} />
      )}
    </div>
  )
}
