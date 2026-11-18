import { useState, type ReactNode } from 'react'
import { REVIEW_EVENT_LABELS, SUBMIT_EVENT_LABELS, type MemberVerdict, type ReviewEvent, type SubmitEvent, type SubmittedReview } from '@shared/types'
import { submitConfirmation, type SubmitCounts } from '../lib/submitConfirmation'

const EVENTS: ReviewEvent[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES']
const UNIT_EVENTS: SubmitEvent[] = [...EVENTS, 'SKIP']

export interface SubmitMember extends SubmitCounts {
  label: ReactNode
  posted: SubmittedReview | null
}

interface Props {
  /** One entry per PR the review covers; a PR that already posted shows its result instead of a choice. */
  members: SubmitMember[]
  disabled: boolean
  blockedReason: string | null
  onSubmit(verdicts: MemberVerdict[]): void
}

export function SubmitBar({ members, disabled, blockedReason, onSubmit }: Props) {
  const [events, setEvents] = useState<Record<string, SubmitEvent>>({})
  const unit = members.length > 1
  const options = unit ? UNIT_EVENTS : EVENTS
  const eventOf = (prKey: string) => events[prKey] ?? 'COMMENT'
  const submit = () => {
    const verdicts = members.filter((m) => !m.posted).map((m) => ({ prKey: m.prKey, event: eventOf(m.prKey) }))
    if (window.confirm(submitConfirmation(verdicts, members))) onSubmit(verdicts)
  }
  return (
    <div className="space-y-2 rounded-md border border-ink-800 bg-ink-900 p-3">
      {members.map((member) => (
        <div key={member.prKey} className="flex flex-wrap items-center gap-3">
          {unit ? <span className="min-w-0 flex-1 truncate text-sm">{member.label}</span> : <span className="text-sm text-ink-400">Submit as</span>}
          {member.posted ? (
            <span className="text-sm text-emerald-300">Posted as {REVIEW_EVENT_LABELS[member.posted.event].toLowerCase()}</span>
          ) : (
            options.map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name={`event-${member.prKey}`}
                  checked={eventOf(member.prKey) === option}
                  disabled={disabled}
                  onChange={() => setEvents((current) => ({ ...current, [member.prKey]: option }))}
                />
                {SUBMIT_EVENT_LABELS[option]}
              </label>
            ))
          )}
        </div>
      ))}
      <div className="flex items-center gap-3">
        {blockedReason && <span className="text-xs text-ink-500">{blockedReason}</span>}
        <button
          className="ml-auto rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          disabled={disabled || Boolean(blockedReason)}
          onClick={submit}
        >
          Post and submit
        </button>
      </div>
    </div>
  )
}
