import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { canPush, cloneChangeCount, committableFiles, normalizedDescription, shortSha } from '@shared/authorSession'
import { EMPTY_DIFF, MAX_DIFF_CHARS } from '@shared/diff'
import type { AuthorSession, DescriptionDraft, DiffResult, PrDescription } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { NO_CHANGES_MESSAGE } from '../lib/authorView'
import { age, fullTime, plural } from '../lib/format'
import { lineDiff } from '../lib/lineDiff'
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/theme'
import { BodyTextarea } from './BodyTextarea'
import { DiffLines, DiffView } from './DiffView'

const TRUNCATED_NOTE = `This diff is cut off at ${MAX_DIFF_CHARS.toLocaleString('en-US')} characters, so it leaves out some changes.`

const MERGE_BUTTON_CLASS = 'rounded-md bg-amber-500/15 px-2 py-0.5 ring-1 ring-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40'

interface Props {
  session: AuthorSession
  disabled: boolean
  descriptionEdit: PrDescription | null
  onDescriptionEdit(edit: PrDescription | null): void
  onDiscardDescription(): void
  onPush(): void
  onResolveConflicts(): void
  onAbortMerge(): void
  onDiscardUncommitted(): void
  onCommitUncommitted(message: string): Promise<boolean>
}

interface LoadedDiff extends DiffResult {
  error: string | null
}

const NO_DIFF: LoadedDiff = { ...EMPTY_DIFF, error: null }

/** Loads the diff whenever reloadKey changes, and shows nothing while it is empty. */
function useDiff(sessionId: string, reloadKey: string, load: (sessionId: string) => Promise<DiffResult>): LoadedDiff {
  const [state, setState] = useState<LoadedDiff>(NO_DIFF)
  useEffect(() => {
    if (!reloadKey) {
      setState(NO_DIFF)
      return
    }
    let current = true
    load(sessionId).then(
      (result) => current && setState({ ...result, error: null }),
      (error) => current && setState({ ...NO_DIFF, error: errorMessage(error) }),
    )
    return () => {
      current = false
    }
  }, [sessionId, reloadKey, load])
  return state
}

/** Describes what a diff leaves out, cut off past its limit or shown only as binary, or returns null when it shows everything. */
function hiddenChangesWarning({ truncated, binaryFiles }: DiffResult): string | null {
  const notes = [
    truncated && TRUNCATED_NOTE,
    binaryFiles.length > 0 && `${plural(binaryFiles.length, 'file')} show only as binary: ${binaryFiles.join(', ')}.`,
  ].filter(Boolean)
  return notes.length > 0 ? notes.join(' ') : null
}

/** Shows a loaded diff, its loading error, or a warning about what it leaves out. */
function DiffSection({ loaded, what }: { loaded: LoadedDiff; what: string }) {
  if (loaded.error) return <p className="text-sm text-rose-300">Couldn't read the {what}: {loaded.error}</p>
  const warning = hiddenChangesWarning(loaded)
  return (
    <>
      <DiffView diff={loaded.diff} />
      {warning && <p className="text-xs text-amber-300">{warning}</p>}
    </>
  )
}

/** Describes what the clone holds that GitHub doesn't: committable files, unpushed commits, or both. */
function changesSummary(session: AuthorSession): ReactNode {
  const committable = committableFiles(session)
  const parts = [
    committable.length > 0 && plural(committable.length, 'uncommitted file'),
    session.commits.length > 0 && plural(session.commits.length, 'unpushed commit'),
  ].filter(Boolean)
  return (
    <>
      {parts.join(' and ')} on <span className="font-mono">{session.clone?.branch}</span>
    </>
  )
}

type ChangesActionProps = Pick<Props, 'session' | 'disabled' | 'onPush' | 'onDiscardUncommitted' | 'onCommitUncommitted'> & {
  committable: string[]
  uncommittedWarning: string | null
  commitsWarning: string | null
}

/** Shows the Changes tab's actions: the commit form while files are committable, and Push while the commits can go. */
function ChangesAction({ session, committable, uncommittedWarning, commitsWarning, disabled, onPush, onDiscardUncommitted, onCommitUncommitted }: ChangesActionProps) {
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const busy = disabled || committing
  const commit = async () => {
    if (uncommittedWarning && !window.confirm(`${uncommittedWarning} Commit anyway?`)) return
    setCommitting(true)
    try {
      if (await onCommitUncommitted(commitMessage)) setCommitMessage('')
    } finally {
      setCommitting(false)
    }
  }
  return (
    <div className="ml-auto flex min-w-96 flex-1 justify-end gap-2">
      {committable.length > 0 && (
        <form
          className="flex flex-1 justify-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void commit()
          }}
        >
          <input
            className="min-w-48 flex-1 rounded-md border border-ink-800 bg-ink-950 px-2 py-1 text-sm text-ink-100"
            placeholder="Commit message"
            value={commitMessage}
            disabled={busy}
            onChange={(event) => setCommitMessage(event.target.value)}
          />
          <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={busy} onClick={onDiscardUncommitted}>
            Discard
          </button>
          <button type="submit" className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`} disabled={busy || !commitMessage.trim()}>
            Commit {plural(committable.length, 'file')}
          </button>
        </form>
      )}
      {session.commits.length > 0 && canPush(session) && (
        <button
          className={committable.length > 0 ? SECONDARY_BUTTON_CLASS : `${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`}
          disabled={busy}
          onClick={() => (!commitsWarning || window.confirm(`${commitsWarning} Push anyway?`)) && onPush()}
        >
          Push to GitHub
        </button>
      )}
    </div>
  )
}

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
  canPush: boolean
  pushesWithCommits: boolean
  onEdit(edit: PrDescription | null): void
  onDiscard(): void
  onPush(): void
}

/** Shows the description update Claude proposed, lets the author edit it, and pushes it on its own when there are no commits to push. */
function DescriptionUpdate({ draft, edit, disabled, canPush, pushesWithCommits, onEdit, onDiscard, onPush }: DescriptionUpdateProps) {
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
            <button className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`} disabled={disabled || !canPush || !next.title.trim()} onClick={onPush}>
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

const loadCommitsDiff = (sessionId: string) => window.rally.getAuthorDiff(sessionId)
const loadUncommittedDiff = (sessionId: string) => window.rally.getUncommittedDiff(sessionId)

export function ChangesPanel({
  session,
  disabled,
  descriptionEdit,
  onDescriptionEdit,
  onDiscardDescription,
  onPush,
  onResolveConflicts,
  onAbortMerge,
  onDiscardUncommitted,
  onCommitUncommitted,
}: Props) {
  const { commits, lastPush, mergeConflicts, description, descriptionUpdatedAt } = session
  const committable = committableFiles(session)
  const commitsReloadKey = commits.map((c) => c.oid).join(',')
  const uncommittedReloadKey = committable.length > 0 ? `${session.status}:${committable.join('\n')}` : ''
  const committed = useDiff(session.id, commitsReloadKey, loadCommitsDiff)
  const pending = useDiff(session.id, uncommittedReloadKey, loadUncommittedDiff)

  return (
    <div className="space-y-4">
      {mergeConflicts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-950/70 px-4 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
          <span title={mergeConflicts.join('\n')}>
            Merging the branch's new commits from GitHub conflicted in {plural(mergeConflicts.length, 'file')}.{' '}
            {disabled ? 'Claude is resolving them.' : 'Rally commits the merge once Claude resolves them.'}
          </span>
          <div className="ml-auto flex gap-2">
            <button className={MERGE_BUTTON_CLASS} disabled={disabled} onClick={onResolveConflicts}>
              Resolve with Claude
            </button>
            <button className={MERGE_BUTTON_CLASS} disabled={disabled} onClick={onAbortMerge}>
              Abort merge
            </button>
          </div>
        </div>
      )}
      {cloneChangeCount(session) > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold">{changesSummary(session)}</h3>
            <ChangesAction
              session={session}
              committable={committable}
              uncommittedWarning={hiddenChangesWarning(pending)}
              commitsWarning={hiddenChangesWarning(committed)}
              disabled={disabled}
              onPush={onPush}
              onDiscardUncommitted={onDiscardUncommitted}
              onCommitUncommitted={onCommitUncommitted}
            />
          </div>
          {committable.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-ink-400">Not committed yet, so Push leaves them out, and can't merge new commits from GitHub until you commit or discard them.</p>
              <ul className="space-y-0.5 font-mono text-xs text-amber-200">
                {committable.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              <DiffSection loaded={pending} what="uncommitted changes" />
            </div>
          )}
          {commits.length > 0 && (
            <>
              <ul className="space-y-1 text-sm">
                {commits.map((commit) => (
                  <li key={commit.oid} className="flex gap-2">
                    <span className="font-mono text-ink-500">{shortSha(commit.oid)}</span>
                    <span className="text-ink-200">{commit.subject}</span>
                  </li>
                ))}
              </ul>
              <DiffSection loaded={committed} what="diff" />
            </>
          )}
        </div>
      ) : (
        !description && <p className="py-6 text-center text-sm text-ink-500">{NO_CHANGES_MESSAGE}</p>
      )}

      {description && (
        <DescriptionUpdate
          draft={description}
          edit={descriptionEdit}
          disabled={disabled}
          canPush={canPush(session)}
          pushesWithCommits={commits.length > 0}
          onEdit={onDescriptionEdit}
          onDiscard={onDiscardDescription}
          onPush={onPush}
        />
      )}

      {lastPush && (
        <p className="text-xs text-ink-500" title={fullTime(lastPush.at)}>
          Last pushed {plural(lastPush.commits.length, 'commit')} {age(lastPush.at)} ago, head <span className="font-mono">{shortSha(lastPush.oid)}</span>.
        </p>
      )}
      {descriptionUpdatedAt && (
        <p className="text-xs text-ink-500" title={fullTime(descriptionUpdatedAt)}>
          Last updated the PR description {age(descriptionUpdatedAt)} ago.
        </p>
      )}
    </div>
  )
}
