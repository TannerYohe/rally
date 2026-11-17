import { isViewer } from './acknowledgment'

/** Selects each reviewer's latest approval or change request on a PR, with an optional directive such as `@include(if: $authored)`. */
export const decisionsField = (directive = '') =>
  `latestOpinionatedReviews(first: 100, writersOnly: true) ${directive} { nodes { state author { login } } }`

export interface RawDecision {
  state: string
  author: { login: string } | null
}

export type DecisionState = 'APPROVED' | 'CHANGES_REQUESTED'

/** Returns the reviewers other than me whose latest decision has the given state. */
export function reviewersWithDecision(decisions: RawDecision[], state: DecisionState, viewer: string): string[] {
  return decisions.flatMap((d) => (d.state === state && d.author && !isViewer(d.author, viewer) ? [d.author.login] : []))
}
