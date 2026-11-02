import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeDefaults } from '@shared/types'

const USER_SETTINGS = join(homedir(), '.claude', 'settings.json')

export function readClaudeDefaults(): ClaudeDefaults {
  if (!existsSync(USER_SETTINGS)) return { model: null, effort: null }
  try {
    const settings = JSON.parse(readFileSync(USER_SETTINGS, 'utf8'))
    return { model: settings.model ?? null, effort: settings.effortLevel ?? null }
  } catch {
    return { model: null, effort: null }
  }
}
