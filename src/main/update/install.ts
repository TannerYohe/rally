import { execFile, spawn } from 'node:child_process'
import { accessSync, appendFileSync, constants, existsSync, rmSync } from 'node:fs'
import { join, posix } from 'node:path'
import { promisify } from 'node:util'
import type { ReleaseInfo } from '@shared/types'

const run = promisify(execFile)

const MAC_APP_NAME = 'Rally.app'
const INSTALL_LOG = 'update.log'
const MAC_SYSTEM_ENV = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }

export const MAC_SWAP_SCRIPT = `
pid=$1 new_app=$2 current_app=$3 previous_app=$4 work_dir=$5 data_dir=$6 log=$7
exec >>"$log" 2>&1
echo "$(date) installing $new_app over $current_app"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
rm -rf "$previous_app"
if ! mv "$current_app" "$previous_app"; then
  echo "failed: could not move the current app aside"
  rm -rf "$work_dir"
elif mv "$new_app" "$current_app"; then
  xattr -dr com.apple.quarantine "$current_app"
  rm -rf "$work_dir"
  echo "installed; keeping $previous_app until the new version starts"
elif mv "$previous_app" "$current_app"; then
  echo "failed: restored the previous app"
  rm -rf "$work_dir"
else
  echo "failed: could not restore the previous app, which is at $previous_app"
fi
if [ -d "$current_app" ]; then relaunch=$current_app; else relaunch=$previous_app; fi
open --env "RALLY_USER_DATA_DIR=$data_dir" "$relaunch"
`

export const WINDOWS_INSTALLER_ARGS = ['--updated', '/S', '--force-run'] as const

export function macBundlePath(exePath: string): string {
  return posix.resolve(exePath, '../../..')
}

export function macPreviousAppPath(currentApp: string): string {
  return `${currentApp.replace(/\.app$/, '')}.previous.app`
}

export function installLogPath(dataDir: string): string {
  return join(dataDir, INSTALL_LOG)
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
  if (release.assetProblem) return `${release.assetProblem} Rally won't install it.`
  if (!release.asset) return 'This release has no build for this machine yet. Check again later, or download it from the release page.'
  if (target.platform !== 'darwin') return null
  const bundle = macBundlePath(target.exePath)
  if (bundle.includes('/AppTranslocation/')) return 'Move Rally to the Applications folder, reopen it, and try again.'
  const folder = posix.dirname(bundle)
  if (!canWrite(folder)) return `Rally can't write to ${folder}. Install the update with scripts/install.sh instead.`
  return null
}

export function spawnDetached(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, env })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

async function bundleId(appPath: string): Promise<string> {
  const plist = join(appPath, 'Contents', 'Info.plist')
  const { stdout } = await run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], { env: MAC_SYSTEM_ENV })
  return stdout.trim()
}

async function verifyMacApp(newApp: string, currentApp: string): Promise<void> {
  try {
    await run('codesign', ['--verify', '--deep', '--strict', newApp], { env: MAC_SYSTEM_ENV })
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim()
    throw new Error(`The downloaded app failed its code signature check${stderr ? `: ${stderr}` : '.'}`)
  }
  const [expected, actual] = await Promise.all([bundleId(currentApp), bundleId(newApp)])
  if (actual !== expected) throw new Error(`The downloaded app's bundle id is ${actual}, not ${expected}.`)
}

export interface MacSwap {
  pid: number
  newApp: string
  currentApp: string
  workDir: string
  dataDir: string
  logPath: string
}

export function macSwapArgs({ pid, newApp, currentApp, workDir, dataDir, logPath }: MacSwap): string[] {
  return [String(pid), newApp, currentApp, macPreviousAppPath(currentApp), workDir, dataDir, logPath]
}

export interface HandOff {
  downloadPath: string
  workDir: string
  exePath: string
  dataDir: string
  logPath: string
}

export async function handOffMacInstall({ downloadPath, workDir, exePath, dataDir, logPath }: HandOff): Promise<void> {
  const newApp = join(workDir, 'extracted', MAC_APP_NAME)
  await run('ditto', ['-x', '-k', downloadPath, join(workDir, 'extracted')], { env: MAC_SYSTEM_ENV })
  if (!existsSync(newApp)) throw new Error(`The downloaded zip has no ${MAC_APP_NAME}.`)
  const currentApp = macBundlePath(exePath)
  await verifyMacApp(newApp, currentApp)
  const args = macSwapArgs({ pid: process.pid, newApp, currentApp, workDir, dataDir, logPath })
  await spawnDetached('/bin/sh', ['-c', MAC_SWAP_SCRIPT, 'rally-update', ...args], MAC_SYSTEM_ENV)
}

export async function handOffWindowsInstall({ downloadPath }: HandOff): Promise<void> {
  await spawnDetached(downloadPath, WINDOWS_INSTALLER_ARGS)
}

export async function handOffInstall(handOff: HandOff): Promise<void> {
  appendFileSync(handOff.logPath, `${new Date().toISOString()} handing off ${handOff.downloadPath}\n`)
  switch (process.platform) {
    case 'darwin':
      return handOffMacInstall(handOff)
    case 'win32':
      return handOffWindowsInstall(handOff)
    default:
      throw new Error(`Rally can't install updates on ${process.platform}.`)
  }
}

export function removePreviousMacApp(exePath: string): void {
  rmSync(macPreviousAppPath(macBundlePath(exePath)), { recursive: true, force: true })
}
