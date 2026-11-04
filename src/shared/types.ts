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
  replyOnly: boolean
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
  headForcePushedAt: string | null
  headKnownSince: string | null
  baseRefName: string
  headRefName: string
  files: string[]
  reviewRequestedFromMe: boolean
  myReviews: MyReview[]
  phase: Phase
  reviewStatus: SessionStatus | null
  summary: string | null
  summaryError: string | null
}

export type ModelChoice = 'opus' | 'opus[1m]' | 'sonnet' | 'sonnet[1m]' | 'haiku'

export const MODEL_LABELS: Record<ModelChoice, string> = {
  opus: 'Opus',
  'opus[1m]': 'Opus (1M context)',
  sonnet: 'Sonnet',
  'sonnet[1m]': 'Sonnet (1M context)',
  haiku: 'Haiku',
}

export type EffortChoice = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const EFFORT_LABELS: Record<EffortChoice, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

export type SkinId = 'classic' | 'tennis' | 'motorsport' | 'pep'

export interface Config {
  authors: string[]
  repos: string[]
  includeReviewRequests: boolean
  pollIntervalMinutes: number
  reviewSkill: string
  reviewModel: ModelChoice | null
  reviewEffort: EffortChoice | null
  subagentModel: ModelChoice | null
  subagentEffort: EffortChoice | null
  skin: SkinId
}

export const DEFAULT_CONFIG: Config = {
  authors: [],
  repos: [],
  includeReviewRequests: true,
  pollIntervalMinutes: 5,
  reviewSkill: 'review-pr',
  reviewModel: null,
  reviewEffort: null,
  subagentModel: null,
  subagentEffort: null,
  skin: 'classic',
}

export interface PrListState {
  prs: Pr[]
  viewer: string | null
  refreshedAt: string | null
  refreshing: boolean
  error: string | null
}

export interface ClaudeDefaults {
  model: string | null
  effort: string | null
}

export type GithubFailure = 'gh_missing' | 'signed_out' | 'unreachable'

export interface Health {
  githubLogin: string | null
  githubFailure: GithubFailure | null
  githubError: string | null
  claudeDefaults: ClaudeDefaults
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

export const CONCERN_STATUSES = ['addressed', 'partly', 'not_addressed', 'pushed_back_accept', 'pushed_back_hold', 'moot'] as const

export type ConcernStatus = (typeof CONCERN_STATUSES)[number]

export const RESOLVABLE_CONCERN_STATUSES: ConcernStatus[] = ['addressed', 'moot', 'pushed_back_accept']

export const CONCERN_STATUS_LABELS: Record<ConcernStatus, string> = {
  addressed: 'Addressed',
  partly: 'Partly addressed',
  not_addressed: 'Not addressed',
  pushed_back_accept: 'Pushed back, accepted',
  pushed_back_hold: 'Pushed back, holding',
  moot: 'Moot',
}

export interface PriorConcern {
  id: string
  location: string
  gist: string
  verdict: string
  status?: ConcernStatus
  threadId?: string | null
}

export function priorConcernThreadIds(drafts: Pick<Drafts, 'priorConcerns'> | null): string[] {
  return drafts?.priorConcerns.flatMap((c) => (c.threadId ? [c.threadId] : [])) ?? []
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

export type TurnMode = 'review' | 'refine' | 'submit'

export type TimelineEntry =
  | { kind: 'user'; id: string; text: string; at: string; turn?: TurnMode }
  | { kind: 'text'; id: string; text: string; at: string }
  | { kind: 'step'; id: string; label: string; detail: string; done: boolean; at: string }
  | { kind: 'agent'; id: string; label: string; done: boolean; activity: number; background: boolean; at: string }
  | { kind: 'denied'; id: string; label: string; at: string }
  | { kind: 'result'; id: string; ok: boolean; text: string; costUsd: number; durationMs: number; at: string }

export interface ReviewThread {
  id: string
  url: string
  isResolved: boolean
  isOutdated: boolean
}

export interface ThreadResolution {
  at: string
  resolved: string[]
  failed: { threadId: string; error: string }[]
}

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
  threadResolution?: ThreadResolution | null
  resolvingThreads?: boolean
  threadsToResolveOnSubmit?: string[]
  createdAt: string
  updatedAt: string
}

export function prKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`
}

export function headKey(pr: { id: string; headRefOid: string }): string {
  return `${pr.id}:${pr.headRefOid}`
}
