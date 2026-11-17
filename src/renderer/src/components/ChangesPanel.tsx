import { useEffect, useState, type ReactNode } from 'react'
import { canPush, cloneChangeCount, shortSha } from '@shared/authorSession'
import type { AuthorSession } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { NO_CHANGES_MESSAGE } from '../lib/authorView'
import { age, fullTime, plural } from '../lib/format'
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../lib/theme'
import { DiffView } from './DiffView'

const MERGE_BUTTON_CLASS = 'rounded-md bg-amber-500/15 px-2 py-0.5 ring-1 ring-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40'

interface Props {
  session: AuthorSession
  disabled: boolean
  onPush(): void
  onResolveConflicts(): void
  onAbortMerge(): void
  onDiscardUncommitted(): void
  onCommitUncommitted(message: string): Promise<boolean>
}

function useDiff(sessionId: string, key: string, load: (sessionId: string) => Promise<string>): { diff: string; error: string | null } {
  const [state, setState] = useState<{ diff: string; error: string | null }>({ diff: '', error: null })
  useEffect(() => {
    if (!key) {
      setState({ diff: '', error: null })
      return
    }
    let current = true
    load(sessionId).then(
      (diff) => current && setState({ diff, error: null }),
      (error) => current && setState({ diff: '', error: errorMessage(error) }),
    )
    return () => {
      current = false
    }
  }, [sessionId, key, load])
  return state
}

/** Describes what the clone holds that GitHub doesn't: uncommitted files, unpushed commits, or both. */
function changesSummary({ commits, uncommitted, clone }: AuthorSession): ReactNode {
  const parts = [
    uncommitted.length > 0 && plural(uncommitted.length, 'uncommitted file'),
    commits.length > 0 && plural(commits.length, 'unpushed commit'),
  ].filter(Boolean)
  return (
    <>
      {parts.join(' and ')} on <span className="font-mono">{clone?.branch}</span>
    </>
  )
}

type ChangesActionProps = Pick<Props, 'session' | 'disabled' | 'onPush' | 'onDiscardUncommitted' | 'onCommitUncommitted'>

/** Shows the Changes tab's main action: Push when the commits can go, the commit form while files are uncommitted, otherwise nothing. */
function ChangesAction({ session, disabled, onPush, onDiscardUncommitted, onCommitUncommitted }: ChangesActionProps) {
  const [commitMessage, setCommitMessage] = useState('')
  if (canPush(session)) {
    return (
      <button className={`${PRIMARY_BUTTON_CLASS} ml-auto px-3 py-1.5 text-sm`} disabled={disabled} onClick={onPush}>
        Push to GitHub
      </button>
    )
  }
  if (session.mergeConflicts.length > 0 || session.uncommitted.length === 0) return null
  const commit = async () => {
    if (await onCommitUncommitted(commitMessage)) setCommitMessage('')
  }
  return (
    <form
      className="ml-auto flex min-w-96 flex-1 justify-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void commit()
      }}
    >
      <input
        className="min-w-48 flex-1 rounded-md border border-ink-800 bg-ink-950 px-2 py-1 text-sm text-ink-100"
        placeholder="Commit message"
        value={commitMessage}
        disabled={disabled}
        onChange={(event) => setCommitMessage(event.target.value)}
      />
      <button type="button" className={SECONDARY_BUTTON_CLASS} disabled={disabled} onClick={onDiscardUncommitted}>
        Discard
      </button>
      <button type="submit" className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`} disabled={disabled || !commitMessage.trim()}>
        Commit {plural(session.uncommitted.length, 'file')}
      </button>
    </form>
  )
}

const loadCommitsDiff = (sessionId: string) => window.rally.getAuthorDiff(sessionId)
const loadUncommittedDiff = (sessionId: string) => window.rally.getUncommittedDiff(sessionId)

export function ChangesPanel({ session, disabled, onPush, onResolveConflicts, onAbortMerge, onDiscardUncommitted, onCommitUncommitted }: Props) {
  const { commits, uncommitted, lastPush, mergeConflicts } = session
  const showUncommitted = uncommitted.length > 0 && mergeConflicts.length === 0
  const committed = useDiff(session.id, commits.map((c) => c.oid).join(','), loadCommitsDiff)
  const pending = useDiff(session.id, showUncommitted ? `${session.status}:${uncommitted.join('\n')}` : '', loadUncommittedDiff)

  return (
    <div className="space-y-4">
      {mergeConflicts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-950/70 px-4 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
          <span title={mergeConflicts.join('\n')}>
            Merging the branch's new commits from GitHub conflicted in {mergeConflicts.length} file(s).{' '}
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
              disabled={disabled}
              onPush={onPush}
              onDiscardUncommitted={onDiscardUncommitted}
              onCommitUncommitted={onCommitUncommitted}
            />
          </div>
          {showUncommitted && (
            <div className="space-y-1">
              <p className="text-xs text-ink-400">Not committed yet, so not pushed. Commit them to push, or discard them.</p>
              <ul className="space-y-0.5 font-mono text-xs text-amber-200">
                {uncommitted.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              {pending.error ? <p className="text-sm text-rose-300">Couldn't read the uncommitted changes: {pending.error}</p> : <DiffView diff={pending.diff} />}
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
              {committed.error ? <p className="text-sm text-rose-300">Couldn't read the diff: {committed.error}</p> : <DiffView diff={committed.diff} />}
            </>
          )}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-ink-500">{NO_CHANGES_MESSAGE}</p>
      )}

      {lastPush && (
        <p className="text-xs text-ink-500" title={fullTime(lastPush.at)}>
          Last pushed {lastPush.commits.length} commit(s) {age(lastPush.at)} ago, head <span className="font-mono">{shortSha(lastPush.oid)}</span>.
        </p>
      )}
    </div>
  )
}
