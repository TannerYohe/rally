import { spawn, execFile } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { join, posix } from 'node:path'
import { promisify } from 'node:util'
import type { ReleaseInfo } from '@shared/types'

const run = promisify(execFile)

const MAC_APP_NAME = 'Rally.app'

const MAC_SWAP_SCRIPT = `
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
if mv "$3" "$4/previous.app"; then
  if mv "$2" "$3"; then
    xattr -dr com.apple.quarantine "$3" 2>/dev/null
  else
    mv "$4/previous.app" "$3"
  fi
fi
if [ -n "$5" ]; then open --env "RALLY_USER_DATA_DIR=$5" "$3"; else open "$3"; fi
rm -rf "$4"
`

export function macBundlePath(exePath: string): string {
  return posix.resolve(exePath, '../../..')
}

function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export interface InstallTarget {
  packaged: boolean
  platform: NodeJS.Platform
  exePath: string
}

export function installBlocker(release: ReleaseInfo, target: InstallTarget, canWrite: (path: string) => boolean = isWritable): string | null {
  if (!target.packaged) return 'Updates install only in the packaged app.'
  if (!release.asset) return 'This release has no build for this machine. Download it from the release page.'
  if (target.platform !== 'darwin') return null
  const bundle = macBundlePath(target.exePath)
  if (bundle.includes('/AppTranslocation/')) return 'Move Rally to the Applications folder, reopen it, and try again.'
  const folder = posix.dirname(bundle)
  if (!canWrite(folder)) return `Rally can't write to ${folder}. Install the update with scripts/install.sh instead.`
  return null
}

export async function handOffMacInstall(zipPath: string, workDir: string, exePath: string): Promise<void> {
  const extracted = join(workDir, 'extracted')
  await run('ditto', ['-x', '-k', zipPath, extracted])
  const newApp = join(extracted, MAC_APP_NAME)
  if (!existsSync(newApp)) throw new Error(`The downloaded zip has no ${MAC_APP_NAME}.`)
  const args = [String(process.pid), newApp, macBundlePath(exePath), workDir, process.env.RALLY_USER_DATA_DIR ?? '']
  spawn('/bin/sh', ['-c', MAC_SWAP_SCRIPT, 'rally-update', ...args], {
    detached: true,
    stdio: 'ignore',
  }).unref()
}

export function handOffWindowsInstall(installerPath: string): void {
  spawn(installerPath, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
}
