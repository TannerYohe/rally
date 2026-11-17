import type { KeyboardEvent, ReactNode } from 'react'
import type { SessionCore, SessionStatus } from '@shared/types'
import { age, clockTime, fullTime } from '../lib/format'
import { BUSY_STATUSES } from '../lib/sessionStatus'
import { PRIMARY_BUTTON_CLASS } from '../lib/theme'
import { BusyDot } from './BusyDot'
import { Markdown } from './Markdown'

interface SessionHeaderProps {
  title: string
  session: Pick<SessionCore, 'status' | 'createdAt'> | null
  statusLabels: Record<SessionStatus, string>
  notes?: ReactNode
  actions: ReactNode
}

/** Renders a session panel's title, status, start time, inline notes, and action buttons. */
export function SessionHeader({ title, session, statusLabels, notes, actions }: SessionHeaderProps) {
  const busy = session !== null && BUSY_STATUSES.includes(session.status)
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {session && (
        <>
          <span className={`text-sm ${session.status === 'error' ? 'text-rose-300' : 'text-ink-400'}`}>
            {busy && <BusyDot className="mr-2 h-2 w-2 bg-primary-400" />}
            {statusLabels[session.status]}
          </span>
          <span className="text-sm text-ink-500" title={fullTime(session.createdAt)}>
            started {clockTime(session.createdAt)} · {age(session.createdAt)} ago
          </span>
        </>
      )}
      {notes}
      <div className="ml-auto flex gap-2">{actions}</div>
    </div>
  )
}

export function ErrorBox({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return <div className="rounded-md bg-rose-950 px-3 py-2 text-sm text-rose-200">{message}</div>
}

export function ReportView({ verdict, markdown }: { verdict: string; markdown: string }) {
  return (
    <div className="space-y-3">
      <div className="text-sm">
        <span className="text-ink-500">Verdict · </span>
        <span className="text-ink-200">{verdict}</span>
      </div>
      <Markdown>{markdown}</Markdown>
    </div>
  )
}

interface ComposerProps {
  value: string
  placeholder: string
  disabled: boolean
  canSend: boolean
  sendLabel: string
  onChange(value: string): void
  onSend(): void
}

/** Renders the message box for Claude, where Enter sends and Shift+Enter adds a line. */
export function Composer({ value, placeholder, disabled, canSend, sendLabel, onChange, onSend }: ComposerProps) {
  const sendOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (canSend) onSend()
  }
  return (
    <>
      <textarea
        className="w-full rounded-md border border-ink-800 bg-ink-900 p-3 text-sm"
        rows={3}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={sendOnEnter}
      />
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-ink-500">Enter to send · Shift+Enter for a new line</span>
        <button className={`${PRIMARY_BUTTON_CLASS} px-3 py-1.5 text-sm`} disabled={!canSend} onClick={onSend}>
          {sendLabel}
        </button>
      </div>
    </>
  )
}
