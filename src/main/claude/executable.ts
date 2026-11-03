import { createRequire } from 'node:module'
import { sep } from 'node:path'
import { app } from 'electron'

const resolveModule = createRequire(import.meta.url).resolve

// Path to the bundled Claude Code binary in app.asar.unpacked when packaged; undefined in dev so the SDK resolves it.
export function claudeExecutable(): string | undefined {
  if (!app.isPackaged) return undefined
  const binary = resolveModule(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`)
  return binary.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}
