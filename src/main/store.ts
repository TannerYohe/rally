import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_CONFIG, type Config, type InstallAttempt, type Pr, type ReviewSession } from '@shared/types'
import { JsonDir, JsonFile } from './jsonFile'

interface PrCache {
  viewer: string | null
  refreshedAt: string | null
  prs: Pr[]
}

interface UpdateRecord {
  pending: InstallAttempt | null
  failed: InstallAttempt | null
}

if (process.env.RALLY_USER_DATA_DIR) app.setPath('userData', process.env.RALLY_USER_DATA_DIR)

const dir = app.getPath('userData')

export const configFile = new JsonFile<Config>(join(dir, 'config.json'), DEFAULT_CONFIG)
export const prCacheFile = new JsonFile<PrCache>(join(dir, 'prs.json'), { viewer: null, refreshedAt: null, prs: [] })
export const summariesFile = new JsonFile<Record<string, string>>(join(dir, 'summaries.json'), {})
export const headsSeenFile = new JsonFile<Record<string, string>>(join(dir, 'heads-seen.json'), {})
export const rallyReviewsFile = new JsonFile<Record<string, number[]>>(join(dir, 'rally-reviews.json'), {})
export const updateFile = new JsonFile<UpdateRecord>(join(dir, 'update.json'), { pending: null, failed: null })
export const sessionsDir = new JsonDir<ReviewSession>(join(dir, 'sessions'))
