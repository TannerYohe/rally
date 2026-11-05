import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_CONFIG, type Config, type Pr, type ReviewSession, type StoredHide } from '@shared/types'
import { JsonDir, JsonFile } from './jsonFile'

interface PrCache {
  viewer: string | null
  refreshedAt: string | null
  prs: Pr[]
}

if (process.env.RALLY_USER_DATA_DIR) app.setPath('userData', process.env.RALLY_USER_DATA_DIR)

const dir = app.getPath('userData')

export const configFile = new JsonFile<Config>(join(dir, 'config.json'), DEFAULT_CONFIG)
export const prCacheFile = new JsonFile<PrCache>(join(dir, 'prs.json'), { viewer: null, refreshedAt: null, prs: [] })
export const summariesFile = new JsonFile<Record<string, string>>(join(dir, 'summaries.json'), {})
export const headsSeenFile = new JsonFile<Record<string, string>>(join(dir, 'heads-seen.json'), {})
export const hiddenPrsFile = new JsonFile<Record<string, StoredHide>>(join(dir, 'hidden-prs.json'), {})
export const sessionsDir = new JsonDir<ReviewSession>(join(dir, 'sessions'))
