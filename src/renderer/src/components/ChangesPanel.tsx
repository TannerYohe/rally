import { useEffect, useState, type ReactNode } from 'react'
import { shortSha } from '@shared/authorSession'
import type { AuthorSession } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { age, fullTime } from '../lib/format'
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

function useCloneDiff(session: AuthorSession): { diff: string; error: string | null } {
  const [state, setState] = useState<{ diff: string; error: string | null }>({ diff: '', error: null })
  const commitKey = session.commits.map((c) => c.oid).join(',')
  useEffect(() => {
    if (!commitKey) {
      setState({ diff: '', error: null })
      return
    }
    let current = true
    window.rally.getAuthorDiff(session.id).then(
      (diff) => current && setState({ diff, error: null }),
      (error) => current && setState({ diff: '', error: errorMessage(error) }),
    )
    return () => {
      current = false
    }
  }, [session.id, commitKey])
  return state
}

/** Describes what the clone holds that GitHub doesn't: uncommitted files, unpushed commits, or both. */
function changesSummary({ commits, uncommitted, clone }: AuthorSession): ReactNode {
  const parts = [
    uncommitted.length > 0 && `${uncommitted.length} uncommitted file(s)`,
    commits.length > 0 && `${commits.length} unpushed commit(s)`,
  ].filter(Boolean)
  return (
    <>
      {parts.join(' and ')} on <span className="font-mono">{clone?.branch}</span>
    </>
  )
}

export function ChangesPanel({ session, disabled, onPush, onResolveConflicts, onAbortMerge, onDiscardUncommitted, onCommitUncommitted }: Props) {
  const { diff, error } = useCloneDiff(session)
  const { commits, uncommitted, lastPush, mergeConflicts, clone } = session
  const [commitMessage, setCommitMessage] = useState('')
  const commit = async () => {
    if (await onCommitUncommitted(commitMessage)) setCommitMessage('')
  }

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
      {commits.length > 0 || uncommitted.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold">{changesSummary(session)}</h3>
            {mergeConflicts.length > 0 ? null : uncommitted.length > 0 ? (
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
                  Commit {uncommitted.length} file{uncommitted.length === 1 ? '' : 's'}
                </button>
              </form>
            ) : (
              <button className={`${PRIMARY_BUTTON_CLASS} ml-auto px-3 py-1.5 text-sm`} disabled={disabled} onClick={onPush}>
                Push to GitHub
              </button>
            )}
          </div>
          {uncommitted.length > 0 && mergeConflicts.length === 0 && (
            <div className="space-y-1">
              <p className="text-xs text-ink-400">Not committed yet, so not pushed. Commit them to push, or discard them.</p>
              <ul className="space-y-0.5 font-mono text-xs text-amber-200">
                {uncommitted.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
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
              {error ? <p className="text-sm text-rose-300">Couldn't read the diff: {error}</p> : <DiffView diff={diff} />}
            </>
          )}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-ink-500">No unpushed commits. Pick Fix on a comment to have Claude change the code.</p>
      )}

      {lastPush && (
        <p className="text-xs text-ink-500" title={fullTime(lastPush.at)}>
          Last pushed {lastPush.commits.length} commit(s) {age(lastPush.at)} ago, head <span className="font-mono">{shortSha(lastPush.oid)}</span>.
        </p>
      )}
    </div>
  )
}
