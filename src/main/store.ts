import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_CONFIG, type Config, type Pr, type ReviewSession } from '@shared/types'
import { JsonFile } from './jsonFile'

interface PrCache {
  viewer: string | null
  refreshedAt: string | null
  prs: Pr[]
}

const dir = app.getPath('userData')

export const configFile = new JsonFile<Config>(join(dir, 'config.json'), DEFAULT_CONFIG)
export const prCacheFile = new JsonFile<PrCache>(join(dir, 'prs.json'), { viewer: null, refreshedAt: null, prs: [] })
export const summariesFile = new JsonFile<Record<string, string>>(join(dir, 'summaries.json'), {})
export const sessionsFile = new JsonFile<Record<string, ReviewSession>>(join(dir, 'sessions.json'), {})
