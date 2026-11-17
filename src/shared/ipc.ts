import type { DraftChanges } from './feedback'
import type {
  ActionRequest,
  AppInfo,
  AuthorSession,
  FeedbackItem,
  Config,
  Health,
  HideMode,
  InstallAttempt,
  PrListKind,
  PrListState,
  PrRef,
  ReplyPost,
  ReviewEvent,
  ReviewSession,
  ReviewThread,
  SoundPlayback,
  ThreadResolution,
  UpdateState,
} from './types'

export interface PrListChange {
  list: PrListKind
  state: PrListState
}

export interface RallyApi {
  getConfig(): Promise<Config>
  saveConfig(config: Config): Promise<void>
  getHealth(): Promise<Health>
  getPrs(list: PrListKind): Promise<PrListState>
  refreshPrs(list: PrListKind): Promise<void>
  onPrsChanged(listener: (change: PrListChange) => void): () => void
  hidePr(list: PrListKind, id: string, mode: HideMode): Promise<void>
  unhidePr(list: PrListKind, id: string): Promise<void>
  getSession(prKey: string): Promise<ReviewSession | null>
  startReview(pr: PrRef): Promise<ReviewSession>
  sendFeedback(sessionId: string, message: string): Promise<void>
  submitReview(sessionId: string, event: ReviewEvent, changes: DraftChanges, resolveThreadIds: string[]): Promise<void>
  getReviewThreads(sessionId: string): Promise<ReviewThread[]>
  resolveThreads(sessionId: string, threadIds: string[]): Promise<ThreadResolution>
  cancelReview(sessionId: string): Promise<void>
  discardSession(sessionId: string): Promise<void>
  onSessionChanged(listener: (session: ReviewSession) => void): () => void
  getAuthorSession(prKey: string): Promise<AuthorSession | null>
  getFeedbackItems(pr: PrRef): Promise<FeedbackItem[]>
  acknowledgeFeedback(pr: PrRef, itemId: string): Promise<void>
  runAuthorActions(pr: PrRef, requests: ActionRequest[], note: string): Promise<AuthorSession>
  startSelfReview(pr: PrRef): Promise<AuthorSession>
  sendAuthorFeedback(sessionId: string, message: string): Promise<void>
  cancelAuthorTurn(sessionId: string): Promise<void>
  getAuthorDiff(sessionId: string): Promise<string>
  pushAuthorCommits(sessionId: string): Promise<void>
  resolveMergeConflicts(sessionId: string): Promise<void>
  abortMerge(sessionId: string): Promise<void>
  discardUncommitted(sessionId: string): Promise<void>
  commitUncommitted(sessionId: string, message: string): Promise<void>
  postAuthorReplies(sessionId: string, replies: ReplyPost[], reRequestReviews: boolean): Promise<void>
  discardAuthorReply(sessionId: string, itemId: string): Promise<void>
  dismissFinding(sessionId: string, itemId: string): Promise<void>
  discardAuthorSession(sessionId: string): Promise<void>
  onAuthorSessionChanged(listener: (session: AuthorSession) => void): () => void
  getAppInfo(): Promise<AppInfo>
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  getFailedInstall(): Promise<InstallAttempt | null>
  dismissFailedInstall(): Promise<void>
  onUpdateChanged(listener: (state: UpdateState) => void): () => void
  onSoundCue(listener: (playback: SoundPlayback) => void): () => void
}

export const IPC = {
  getConfig: 'config:get',
  saveConfig: 'config:save',
  getHealth: 'health:get',
  getPrs: 'prs:get',
  refreshPrs: 'prs:refresh',
  prsChanged: 'prs:changed',
  hidePr: 'prs:hide',
  unhidePr: 'prs:unhide',
  getSession: 'session:get',
  startReview: 'session:start',
  sendFeedback: 'session:feedback',
  submitReview: 'session:submit',
  getReviewThreads: 'session:threads',
  resolveThreads: 'session:resolve-threads',
  cancelReview: 'session:cancel',
  discardSession: 'session:discard',
  sessionChanged: 'session:changed',
  getAuthorSession: 'author:get',
  getFeedbackItems: 'author:feedback-items',
  acknowledgeFeedback: 'author:acknowledge',
  runAuthorActions: 'author:run',
  startSelfReview: 'author:self-review',
  sendAuthorFeedback: 'author:feedback',
  cancelAuthorTurn: 'author:cancel',
  getAuthorDiff: 'author:diff',
  pushAuthorCommits: 'author:push',
  resolveMergeConflicts: 'author:resolve-conflicts',
  abortMerge: 'author:abort-merge',
  discardUncommitted: 'author:discard-uncommitted',
  commitUncommitted: 'author:commit-uncommitted',
  postAuthorReplies: 'author:post-replies',
  discardAuthorReply: 'author:discard-reply',
  dismissFinding: 'author:dismiss-finding',
  discardAuthorSession: 'author:discard',
  authorSessionChanged: 'author:changed',
  getAppInfo: 'app:info',
  getUpdateState: 'update:get',
  checkForUpdates: 'update:check',
  installUpdate: 'update:install',
  getFailedInstall: 'update:failed-install',
  dismissFailedInstall: 'update:dismiss-failed-install',
  updateChanged: 'update:changed',
  soundCue: 'sound:cue',
} as const
