import { canReplyTo, isReplyPending, itemLocation } from '@shared/authorSession'
import { RESPONSE_ACTION_LABELS, RESPONSE_ACTIONS, RESPONSE_VERDICT_LABELS, type FeedbackComment, type ResponseAction, type ResponseVerdict } from '@shared/types'
import type { FeedbackRow } from '../lib/authorView'
import { age, fullTime } from '../lib/format'
import { Avatar } from './Avatar'
import { BodyTextarea } from './BodyTextarea'
import { Markdown } from './Markdown'

export interface ActionPick {
  action: ResponseAction
  note: string
}

const VERDICT_STYLES: Record<ResponseVerdict, string> = {
  valid: 'bg-amber-500/15 text-amber-200',
  partly_valid: 'bg-yellow-500/15 text-yellow-200',
  not_valid: 'bg-emerald-500/15 text-emerald-200',
  unclear: 'bg-ink-500/20 text-ink-300',
}

const FINDING_ACTIONS: ResponseAction[] = ['investigate', 'fix']

const VISIBLE_COMMENTS = 3

const CHIP_CLASS = 'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide'

function Comment({ comment }: { comment: FeedbackComment }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-ink-400">
        {comment.author ? <Avatar login={comment.author} url={comment.avatarUrl} size="xs" ringClass="ring-transparent" /> : null}
        <span className="text-ink-200">{comment.author ?? 'Self-review'}</span>
        {comment.createdAt && <span title={fullTime(comment.createdAt)}>{age(comment.createdAt)} ago</span>}
      </div>
      <div className="pl-6 text-sm">
        <Markdown>{comment.body || '_Empty comment._'}</Markdown>
      </div>
    </div>
  )
}

function Thread({ comments }: { comments: FeedbackComment[] }) {
  if (comments.length <= VISIBLE_COMMENTS) {
    return (
      <div className="space-y-3">
        {comments.map((comment, index) => (
          <Comment key={index} comment={comment} />
        ))}
      </div>
    )
  }
  const [first, ...rest] = comments
  const hidden = rest.slice(0, rest.length - (VISIBLE_COMMENTS - 1))
  const shown = rest.slice(rest.length - (VISIBLE_COMMENTS - 1))
  return (
    <div className="space-y-3">
      <Comment comment={first} />
      <details className="pl-6 text-xs text-ink-500">
        <summary className="cursor-pointer hover:text-ink-300">{hidden.length} earlier replies</summary>
        <div className="mt-3 space-y-3">
          {hidden.map((comment, index) => (
            <Comment key={index} comment={comment} />
          ))}
        </div>
      </details>
      {shown.map((comment, index) => (
        <Comment key={index} comment={comment} />
      ))}
    </div>
  )
}

interface Props {
  row: FeedbackRow
  pick: ActionPick | undefined
  replyEdit: string | undefined
  resolve: boolean
  disabled: boolean
  onPick(pick: ActionPick | undefined): void
  onReplyEdit(body: string | undefined): void
  onResolve(resolve: boolean): void
  onDropReply(): void
  onDismiss(): void
  onAcknowledge(): void
}

export function FeedbackCard({ row, pick, replyEdit, resolve, disabled, onPick, onReplyEdit, onResolve, onDropReply, onDismiss, onAcknowledge }: Props) {
  const { item, response, posted, closedOnGithub } = row
  const isFinding = item.kind === 'finding'
  const actions = isFinding ? FINDING_ACTIONS : RESPONSE_ACTIONS
  const replyPending = response !== null && isReplyPending(response, posted)
  const reply = replyEdit ?? response?.reply ?? ''

  return (
    <li className={`space-y-3 rounded-xl border border-white/5 bg-ink-900/60 p-4 ${item.answered && !replyPending ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {isFinding ? (
          <span className={`${CHIP_CLASS} bg-secondary-500/15 text-secondary-200`}>Self-review{item.severity ? ` · ${item.severity}` : ''}</span>
        ) : (
          <span className="flex items-center gap-1.5 text-ink-300">
            <Avatar login={item.author ?? 'ghost'} url={item.avatarUrl} size="xs" ringClass="ring-transparent" />@{item.author ?? 'ghost'}
          </span>
        )}
        <span className="truncate font-mono text-ink-400">{itemLocation(item)}</span>
        {item.outdated && <span className={`${CHIP_CLASS} bg-ink-700/60 text-ink-300`}>Outdated</span>}
        {item.answered && <span className={`${CHIP_CLASS} bg-emerald-500/10 text-emerald-300`}>You replied last</span>}
        {closedOnGithub && <span className={`${CHIP_CLASS} bg-ink-700/60 text-ink-300`}>Closed on GitHub</span>}
        {item.url && (
          <a className="ml-auto text-primary-400 hover:text-primary-300" href={item.url} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        )}
      </div>

      <Thread comments={item.comments} />

      {!closedOnGithub && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-ink-950 p-0.5 ring-1 ring-ink-800">
            {actions.map((action) => (
              <button
                key={action}
                disabled={disabled}
                onClick={() => onPick(pick?.action === action ? undefined : { action, note: pick?.note ?? '' })}
                className={`rounded-md px-3 py-1 text-xs transition disabled:opacity-40 ${pick?.action === action ? 'bg-primary-500/25 text-primary-100' : 'text-ink-400 hover:text-ink-200'}`}
              >
                {RESPONSE_ACTION_LABELS[action]}
              </button>
            ))}
          </div>
          {isFinding && (
            <button className="text-xs text-ink-500 hover:text-rose-300 disabled:opacity-40" disabled={disabled} onClick={onDismiss}>
              Dismiss
            </button>
          )}
          {!isFinding && !item.answered && item.reactionSubjectId && (
            <button
              className="rounded-md px-2 py-1 text-xs text-ink-400 ring-1 ring-ink-800 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-40"
              disabled={disabled}
              title="React 👍 on GitHub. That counts as your response, so the comment stops needing one."
              onClick={onAcknowledge}
            >
              👍 Acknowledge
            </button>
          )}
          {pick && (
            <input
              className="min-w-64 flex-1 rounded-md border border-ink-800 bg-ink-950 px-2 py-1 text-xs"
              placeholder="Note for Claude (optional)"
              value={pick.note}
              disabled={disabled}
              onChange={(e) => onPick({ ...pick, note: e.target.value })}
            />
          )}
        </div>
      )}

      {response && (
        <div className="space-y-2 border-t border-white/5 pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-500">Claude · {RESPONSE_ACTION_LABELS[response.action]}</span>
            {response.verdict && <span className={`${CHIP_CLASS} ${VERDICT_STYLES[response.verdict]}`}>{RESPONSE_VERDICT_LABELS[response.verdict]}</span>}
            {response.commits.map((oid) => (
              <span key={oid} className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300">
                {oid.slice(0, 7)}
              </span>
            ))}
          </div>
          {response.summary && <Markdown>{response.summary}</Markdown>}
          {response.pendingCommit && <p className="text-xs text-ink-500">Rally commits {response.files.join(', ')} when this turn ends.</p>}
          {response.commitError && <p className="text-xs text-amber-300">{response.commitError}</p>}
          {canReplyTo(item) && replyPending && (
            <div className="space-y-2">
              <BodyTextarea value={reply} disabled={disabled} onChange={(value) => onReplyEdit(value === response.reply ? undefined : value)} />
              <div className="flex items-center gap-3 text-xs">
                {item.kind === 'thread' && !closedOnGithub && (
                  <label className="flex items-center gap-1.5 text-ink-400">
                    <input type="checkbox" checked={resolve} disabled={disabled} onChange={(e) => onResolve(e.target.checked)} />
                    Resolve thread after posting
                  </label>
                )}
                {posted?.error && <span className="text-rose-300">Posting failed: {posted.error}</span>}
                <button className="ml-auto text-ink-400 hover:text-rose-300 disabled:opacity-40" disabled={disabled} onClick={onDropReply}>
                  Drop reply
                </button>
              </div>
            </div>
          )}
          {posted && !replyPending && !posted.error && (
            <div className="text-xs text-emerald-300">
              Replied {age(posted.at)} ago
              {posted.url && (
                <a className="ml-2 underline" href={posted.url} target="_blank" rel="noreferrer">
                  View ↗
                </a>
              )}
              {posted.resolved && <span className="ml-2">· thread resolved</span>}
              {posted.resolveError && <span className="ml-2 text-rose-300">· resolving failed: {posted.resolveError}</span>}
            </div>
          )}
        </div>
      )}
    </li>
  )
}
