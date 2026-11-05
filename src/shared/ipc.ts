import type { DraftChanges } from './feedback'
import type {
  AppInfo,
  Config,
  Health,
  HideMode,
  InstallAttempt,
  PrListState,
  PrRef,
  ReviewEvent,
  ReviewSession,
  ReviewThread,
  ThreadResolution,
  UpdateState,
} from './types'

export interface RallyApi {
  getConfig(): Promise<Config>
  saveConfig(config: Config): Promise<void>
  getHealth(): Promise<Health>
  getPrs(): Promise<PrListState>
  refreshPrs(): Promise<void>
  onPrsChanged(listener: (state: PrListState) => void): () => void
  hidePr(id: string, mode: HideMode): Promise<void>
  unhidePr(id: string): Promise<void>
  getSession(prKey: string): Promise<ReviewSession | null>
  startReview(pr: PrRef): Promise<ReviewSession>
  sendFeedback(sessionId: string, message: string): Promise<void>
  submitReview(sessionId: string, event: ReviewEvent, changes: DraftChanges, resolveThreadIds: string[]): Promise<void>
  getReviewThreads(sessionId: string): Promise<ReviewThread[]>
  resolveThreads(sessionId: string, threadIds: string[]): Promise<ThreadResolution>
  cancelReview(sessionId: string): Promise<void>
  discardSession(sessionId: string): Promise<void>
  onSessionChanged(listener: (session: ReviewSession) => void): () => void
  getAppInfo(): Promise<AppInfo>
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  getFailedInstall(): Promise<InstallAttempt | null>
  dismissFailedInstall(): Promise<void>
  onUpdateChanged(listener: (state: UpdateState) => void): () => void
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
  getAppInfo: 'app:info',
  getUpdateState: 'update:get',
  checkForUpdates: 'update:check',
  installUpdate: 'update:install',
  getFailedInstall: 'update:failed-install',
  dismissFailedInstall: 'update:dismiss-failed-install',
  updateChanged: 'update:changed',
} as const
