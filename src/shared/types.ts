export type ReviewPhase = 'in_progress' | 'unreviewed' | 'awaiting_rereview' | 'pending_changes' | 'approved'

export type AuthorPhase = 'in_progress' | 'needs_response' | 'awaiting_reviews' | 'approved'

export type Phase = ReviewPhase | AuthorPhase

export const REVIEW_PHASE_ORDER: ReviewPhase[] = ['in_progress', 'awaiting_rereview', 'unreviewed', 'pending_changes', 'approved']

export const AUTHOR_PHASE_ORDER: AuthorPhase[] = ['in_progress', 'needs_response', 'awaiting_reviews', 'approved']

export const PHASE_LABELS: Record<Phase, string> = {
  in_progress: 'In progress',
  unreviewed: 'Unreviewed',
  awaiting_rereview: 'Awaiting re-review',
  pending_changes: 'Pending changes',
  needs_response: 'Needs response',
  awaiting_reviews: 'Awaiting reviews',
  approved: 'Approved',
}

export type PrListKind = 'reviewing' | 'authored'

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'

/** Review activity on a PR the viewer authored. */
export interface PrFeedback {
  reviewDecision: ReviewDecision | null
  openThreads: number
  unacknowledged: number
  changesRequestedBy: string[]
  approvedBy: string[]
  /** True when the PR has more threads, comments, or reviews than the list query reads, so some feedback went unchecked. */
  truncated: boolean
}

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'

export interface MyReview {
  databaseId: number | null
  state: ReviewState
  submittedAt: string | null
  commitOid: string | null
  replyOnly: boolean
}

export type HideMode = 'snooze' | 'indefinite'

export const HIDE_MODE_LABELS: Record<HideMode, string> = {
  snooze: 'Snoozed until updated',
  indefinite: 'Hidden',
}

export interface PrHide {
  mode: HideMode
  at: string
}

export interface StoredHide extends PrHide {
  headRefOid: string
  reviewRequestedWhenLastListed: boolean
  lastListedAt: string
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
  feedback: PrFeedback | null
  phase: Phase
  reviewStatus: SessionStatus | null
  /** Self-review findings in Rally that wait on a terminal step; always 0 for PRs you review. */
  openFindings: number
  summary: string | null
  summaryError: string | null
  hidden: PrHide | null
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

export type SoundCue = 'reviewDone' | 'needsAttention' | 'approved'

export const SOUND_CUES: SoundCue[] = ['reviewDone', 'needsAttention', 'approved']

export const SOUND_CUE_LABELS: Record<SoundCue, string> = {
  reviewDone: 'Claude finishes a turn',
  needsAttention: 'A PR needs your attention',
  approved: 'A PR is approved',
}

export type ReviewDoneSound = 'each' | 'last' | 'off'

export const REVIEW_DONE_SOUND_LABELS: Record<ReviewDoneSound, string> = {
  each: 'Every turn',
  last: 'When no other turn is still running',
  off: 'Off',
}

export interface SoundPlayback {
  cue: SoundCue
  pack: SkinId
  volume: number
}

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
  soundsEnabled: boolean
  soundVolume: number
  /** The skin whose sounds play; null follows the selected skin. */
  soundPack: SkinId | null
  reviewDoneSound: ReviewDoneSound
  attentionSound: boolean
  approvedSound: boolean
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
  soundsEnabled: true,
  soundVolume: 60,
  soundPack: null,
  reviewDoneSound: 'each',
  attentionSound: true,
  approvedSound: true,
}

export function soundPlayback(cue: SoundCue, config: Pick<Config, 'skin' | 'soundPack' | 'soundVolume'>): SoundPlayback {
  return { cue, pack: config.soundPack ?? config.skin, volume: config.soundVolume }
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

export interface RepliedComment {
  author: string | null
  path: string
  line: number | null
  excerpt: string
  url: string
}

export type ReplyTarget = { found: true; comment: RepliedComment } | { found: false }

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
  /** Absent until Rally looks up the review comment this reply answers. */
  replyTarget?: ReplyTarget
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

export type TurnMode = 'review' | 'refine' | 'respond' | 'self_review' | 'resolve_merge' | 'describe'

export type TimelineEntry =
  | { kind: 'user'; id: string; text: string; at: string; turn?: TurnMode }
  | { kind: 'text'; id: string; text: string; at: string }
  | { kind: 'step'; id: string; label: string; detail: string; done: boolean; at: string }
  | { kind: 'agent'; id: string; label: string; done: boolean; activity: number; background: boolean; at: string }
  | { kind: 'denied'; id: string; label: string; at: string }
  | { kind: 'warning'; id: string; label: string; detail: string; at: string }
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
  foldedDraftIds?: string[]
}

export type FeedbackItemKind = 'thread' | 'review' | 'comment' | 'finding'

export interface FeedbackComment {
  author: string | null
  avatarUrl: string | null
  body: string
  createdAt: string
  url: string
}

/** One thing a reviewer, or a self-review, raised on the viewer's own PR. */
export interface FeedbackItem {
  id: string
  kind: FeedbackItemKind
  author: string | null
  authorIsBot: boolean
  avatarUrl: string | null
  path: string | null
  line: number | null
  url: string | null
  severity: Severity | null
  outdated: boolean
  answered: boolean
  comments: FeedbackComment[]
  replyToCommentId: number | null
  /** Node id of the comment an acknowledgment reaction goes on, or null when there is nothing to react to. */
  reactionSubjectId: string | null
}

export interface PrRef {
  owner: string
  repo: string
  number: number
  url: string
}

/** Fields every Claude session Rally runs for a PR has. */
export interface SessionCore {
  id: string
  pr: PrRef
  prKey: string
  sdkSessionId: string | null
  status: SessionStatus
  error: string | null
  timeline: TimelineEntry[]
  createdAt: string
  updatedAt: string
}

export interface ReviewSession extends SessionCore {
  drafts: Drafts | null
  submitted: SubmittedReview | null
  threadResolution?: ThreadResolution | null
  resolvingThreads?: boolean
  threadsToResolveOnSubmit?: string[]
  submitAttemptReviewId?: number
}

export const RESPONSE_ACTIONS = ['investigate', 'fix', 'push_back', 'answer'] as const

export type ResponseAction = (typeof RESPONSE_ACTIONS)[number]

export const RESPONSE_ACTION_LABELS: Record<ResponseAction, string> = {
  investigate: 'Investigate',
  fix: 'Fix',
  push_back: 'Push back',
  answer: 'Answer',
}

export const RESPONSE_VERDICTS = ['valid', 'partly_valid', 'not_valid', 'unclear'] as const

export type ResponseVerdict = (typeof RESPONSE_VERDICTS)[number]

export const RESPONSE_VERDICT_LABELS: Record<ResponseVerdict, string> = {
  valid: 'Valid',
  partly_valid: 'Partly valid',
  not_valid: 'Not valid',
  unclear: 'Unclear',
}

export interface ActionRequest {
  itemId: string
  action: ResponseAction
  note: string
}

export interface ItemResponse {
  itemId: string
  action: ResponseAction
  verdict: ResponseVerdict | null
  summary: string
  reply: string
  /** Files Claude changed for a fix, which Rally commits after the turn. */
  files: string[]
  commitMessage: string
  /** True until Rally commits the files Claude listed. */
  pendingCommit: boolean
  commits: string[]
  commitError: string | null
  at: string
}

export interface PostedReply {
  at: string
  body: string
  url: string | null
  resolved: boolean
  error: string | null
  resolveError: string | null
}

export interface ReplyPost {
  itemId: string
  body: string
  resolve: boolean
}

/** A unified diff for display, whether it was cut off before its end, and the files it shows only as binary. */
export interface DiffResult {
  diff: string
  truncated: boolean
  binaryFiles: string[]
}

export interface LocalCommit {
  oid: string
  subject: string
}

export interface CloneInfo {
  path: string
  branch: string
  baseRef: string
  /** The branch head on GitHub when Rally last synced, merged, or pushed; commits after it are Rally's own. */
  syncedHead?: string
}

export interface PushRecord {
  at: string
  oid: string
  commits: LocalCommit[]
}

export interface ReviewReRequest {
  at: string
  reviewers: string[]
  error: string | null
}

export interface PrDescription {
  title: string
  body: string
}

/** A title and description Claude proposed for the PR, and what GitHub had when it proposed them. */
export interface DescriptionDraft extends PrDescription {
  base: PrDescription
  at: string
}

export interface SelfReview {
  verdict: string
  reportMarkdown: string
  findings: FeedbackItem[]
}

export interface AuthorSession extends SessionCore {
  clone: CloneInfo | null
  items: FeedbackItem[]
  responses: Record<string, ItemResponse>
  posted: Record<string, PostedReply>
  selfReview: SelfReview | null
  commits: LocalCommit[]
  uncommitted: string[]
  lastPush: PushRecord | null
  /** Files left conflicted by merging the remote branch, until the merge is committed or aborted. */
  mergeConflicts: string[]
  /** Reviewers I replied to whose review Rally re-requests once none of their comments are left unanswered. */
  reviewersToReRequest: string[]
  lastReRequest: ReviewReRequest | null
  /** A description update waiting for the author to push it to GitHub. */
  description: DescriptionDraft | null
  descriptionUpdatedAt: string | null
}

export function isSamePr(a: Pick<PrRef, 'owner' | 'repo' | 'number'>, b: Pick<PrRef, 'owner' | 'repo' | 'number'>): boolean {
  return a.number === b.number && a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
}

export function prKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`
}

export function headKey(pr: { id: string; headRefOid: string }): string {
  return `${pr.id}:${pr.headRefOid}`
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  platformId: string
  userDataDir: string
}

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface ReleaseInfo {
  version: string
  url: string
  notes: string
  publishedAt: string | null
  asset: ReleaseAsset | null
  assetProblem: string | null
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'check_failed'; error: string }
  | { status: 'up_to_date'; checkedAt: string }
  | { status: 'available'; release: ReleaseInfo; installBlocker: string | null }
  | { status: 'downloading'; release: ReleaseInfo; received: number; total: number }
  | { status: 'installing'; release: ReleaseInfo }
  | { status: 'install_failed'; release: ReleaseInfo; error: string }

export interface InstallAttempt {
  version: string
  logPath: string
}
