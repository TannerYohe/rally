import type { AppInfo, Config, Health, PrListState, PrRef, ReviewEvent, ReviewSession, ReviewThread, ThreadResolution, UpdateState } from './types'

export interface RallyApi {
  getConfig(): Promise<Config>
  saveConfig(config: Config): Promise<void>
  getHealth(): Promise<Health>
  getPrs(): Promise<PrListState>
  refreshPrs(): Promise<void>
  onPrsChanged(listener: (state: PrListState) => void): () => void
  getSession(prKey: string): Promise<ReviewSession | null>
  startReview(pr: PrRef): Promise<ReviewSession>
  sendFeedback(sessionId: string, message: string): Promise<void>
  submitReview(sessionId: string, event: ReviewEvent, notes: string, resolveThreadIds: string[]): Promise<void>
  getReviewThreads(sessionId: string): Promise<ReviewThread[]>
  resolveThreads(sessionId: string, threadIds: string[]): Promise<ThreadResolution>
  cancelReview(sessionId: string): Promise<void>
  discardSession(sessionId: string): Promise<void>
  onSessionChanged(listener: (session: ReviewSession) => void): () => void
  getAppInfo(): Promise<AppInfo>
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateChanged(listener: (state: UpdateState) => void): () => void
}

export const IPC = {
  getConfig: 'config:get',
  saveConfig: 'config:save',
  getHealth: 'health:get',
  getPrs: 'prs:get',
  refreshPrs: 'prs:refresh',
  prsChanged: 'prs:changed',
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
  updateChanged: 'update:changed',
} as const
