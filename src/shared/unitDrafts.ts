import type { DraftChanges } from './feedback'
import { keyOf } from './prUnit'
import type { Drafts, PrRef, ReviewSession } from './types'

/** Returns every PR a review session covers, its own PR first. */
export function sessionMembers(session: Pick<ReviewSession, 'pr' | 'members'>): PrRef[] {
  return session.members ?? [session.pr]
}

export function isUnitSession(session: Pick<ReviewSession, 'pr' | 'members'>): boolean {
  return sessionMembers(session).length > 1
}

export function sessionCovers(session: Pick<ReviewSession, 'pr' | 'members'>, prKey: string): boolean {
  return sessionMembers(session).some((member) => keyOf(member) === prKey)
}

/** Returns one PR's share of a unit's drafts as single-PR drafts; drafts for one PR come back unchanged. */
export function draftsForPr(drafts: Drafts, prKey: string): Drafts {
  if (!drafts.prReviews) return drafts
  const review = drafts.prReviews.find((r) => r.prKey === prKey)
  return {
    mode: drafts.mode,
    verdict: review?.verdict ?? drafts.verdict,
    reportMarkdown: drafts.reportMarkdown,
    summaryBody: review?.summaryBody ?? '',
    comments: drafts.comments.filter((c) => c.prKey === prKey),
    priorConcerns: drafts.priorConcerns.filter((c) => c.prKey === prKey),
  }
}

/** Returns the changes that apply to one PR, taking its review body edit from the per-PR edits of a unit. */
export function changesForPr(changes: DraftChanges, prKey: string): DraftChanges {
  if (!changes.summaryBodyEdits) return changes
  return { ...changes, summaryBodyEdit: changes.summaryBodyEdits[prKey] }
}

/** Returns what keeps a unit's drafts from mapping onto its PRs: comments or concerns without a member PR, repeated ids, or a PR with no verdict. */
export function unitDraftProblems(drafts: Drafts, memberKeys: string[]): string[] {
  const problems: string[] = []
  const members = memberKeys.join(', ')
  const checkPr = (subject: string, key: string | undefined) => {
    if (key === undefined) problems.push(`${subject} names no PR; name one of ${members}.`)
    else if (!memberKeys.includes(key)) problems.push(`${subject} names ${key}, which isn't one of ${members}.`)
  }
  for (const comment of drafts.comments) checkPr(`Draft #${comment.id}`, comment.prKey)
  for (const concern of drafts.priorConcerns) checkPr(`Earlier comment ${concern.id}`, concern.prKey)
  const ids = drafts.comments.map((c) => c.id)
  const repeated = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  if (repeated.length > 0) problems.push(`Draft ids must be unique across the PRs; ${repeated.map((id) => `#${id}`).join(', ')} repeat.`)
  const reviewed = drafts.prReviews?.map((r) => r.prKey) ?? []
  const missing = memberKeys.filter((key) => !reviewed.includes(key))
  if (missing.length > 0) problems.push(`Give a verdict and review body for ${missing.join(', ')} in pr_reviews.`)
  const unknown = reviewed.filter((key) => !memberKeys.includes(key))
  if (unknown.length > 0) problems.push(`pr_reviews names ${unknown.join(', ')}, which isn't in this review.`)
  return problems
}
