import { SUBMIT_EVENT_LABELS, type MemberVerdict } from '@shared/types'

export interface SubmitCounts {
  prKey: string
  /** Draft comments that submitting this PR would post. */
  commentCount: number
  /** Selected threads on this PR, resolved once the review posts. */
  threadCount: number
}

/** Returns the question confirming a submit, counting only comments and threads on PRs that aren't skipped. */
export function submitConfirmation(verdicts: MemberVerdict[], members: SubmitCounts[]): string {
  const skipped = new Set(verdicts.filter((v) => v.event === 'SKIP').map((v) => v.prKey))
  const posting = new Set(verdicts.filter((v) => v.event !== 'SKIP').map((v) => v.prKey))
  const commentCount = members.filter((m) => posting.has(m.prKey)).reduce((sum, m) => sum + m.commentCount, 0)
  const threadCount = members.filter((m) => !skipped.has(m.prKey)).reduce((sum, m) => sum + m.threadCount, 0)
  const resolve = threadCount > 0 ? `, then resolve ${threadCount} review thread(s)` : ''
  if (members.length === 1) return `Post ${commentCount} comment(s) and submit the review as "${SUBMIT_EVENT_LABELS[verdicts[0].event]}"${resolve}?`
  const parts = verdicts.map((v) => (v.event === 'SKIP' ? `skip ${v.prKey}` : `submit ${v.prKey} as "${SUBMIT_EVENT_LABELS[v.event]}"`))
  return `Post ${commentCount} comment(s), ${parts.join(', ')}${resolve}?`
}
