export type Phase = 'in_progress' | 'unreviewed' | 'awaiting_rereview' | 'pending_changes' | 'approved'

export const PHASE_ORDER: Phase[] = ['in_progress', 'awaiting_rereview', 'unreviewed', 'pending_changes', 'approved']

export const PHASE_LABELS: Record<Phase, string> = {
  in_progress: 'In progress',
  unreviewed: 'Unreviewed',
  awaiting_rereview: 'Awaiting re-review',
  pending_changes: 'Pending changes',
  approved: 'Approved',
}

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'

export interface MyReview {
  state: ReviewState
  submittedAt: string | null
  commitOid: string | null
}

export interface Pr {
  id: string
  number: number
  owner: string
  repo: string
  url: string
  title: string
  body: string
  author: string
  authorAvatarUrl: string | null
  createdAt: string
  updatedAt: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  headRefOid: string
  baseRefName: string
  headRefName: string
  files: string[]
  reviewRequestedFromMe: boolean
  myReviews: MyReview[]
  phase: Phase
  reviewStatus: SessionStatus | null
  summary: string | null
}

export interface Config {
  authors: string[]
  repos: string[]
  includeReviewRequests: boolean
  pollIntervalMinutes: number
}

export const DEFAULT_CONFIG: Config = {
  authors: [],
  repos: [],
  includeReviewRequests: true,
  pollIntervalMinutes: 5,
}

export interface PrListState {
  prs: Pr[]
  viewer: string | null
  refreshedAt: string | null
  refreshing: boolean
  error: string | null
}

export interface Health {
  githubLogin: string | null
  githubError: string | null
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'

export const REVIEW_EVENT_LABELS: Record<ReviewEvent, string> = {
  COMMENT: 'Comment',
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
}

export type Severity = 'blocker' | 'high' | 'medium' | 'nit'

export interface DraftComment {
  id: string
  kind: 'inline' | 'reply'
  path: string | null
  line: number | null
  startLine: number | null
  side: 'LEFT' | 'RIGHT'
  severity: Severity
  body: string
  replyToCommentId: number | null
}

export interface PriorConcern {
  id: string
  location: string
  gist: string
  verdict: string
}

export interface Drafts {
  mode: 'full' | 'followup'
  verdict: string
  reportMarkdown: string
  summaryBody: string
  comments: DraftComment[]
  priorConcerns: PriorConcern[]
}

export type SessionStatus = 'running' | 'awaiting_feedback' | 'submitting' | 'submitted' | 'error' | 'cancelled'

export type TimelineEntry =
  | { kind: 'user'; id: string; text: string; at: string }
  | { kind: 'text'; id: string; text: string; at: string }
  | { kind: 'step'; id: string; label: string; detail: string; done: boolean; at: string }
  | { kind: 'agent'; id: string; label: string; done: boolean; activity: number; background: boolean; at: string }
  | { kind: 'denied'; id: string; label: string; at: string }
  | { kind: 'result'; id: string; ok: boolean; text: string; costUsd: number; durationMs: number; at: string }

export interface SubmittedReview {
  reviewId: number
  url: string
  event: ReviewEvent
}

export interface PrRef {
  owner: string
  repo: string
  number: number
  url: string
}

export interface ReviewSession {
  id: string
  pr: PrRef
  prKey: string
  sdkSessionId: string | null
  status: SessionStatus
  error: string | null
  timeline: TimelineEntry[]
  drafts: Drafts | null
  submitted: SubmittedReview | null
  createdAt: string
  updatedAt: string
}

export function prKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`
}
