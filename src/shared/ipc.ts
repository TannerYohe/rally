import type { Config, Health, PrListState, ReviewEvent, ReviewSession } from './types'

export interface PrRef {
  owner: string
  repo: string
  number: number
  url: string
}

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
  submitReview(sessionId: string, event: ReviewEvent): Promise<void>
  cancelReview(sessionId: string): Promise<void>
  discardSession(sessionId: string): Promise<void>
  onSessionChanged(listener: (session: ReviewSession) => void): () => void
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
  cancelReview: 'session:cancel',
  discardSession: 'session:discard',
  sessionChanged: 'session:changed',
} as const
