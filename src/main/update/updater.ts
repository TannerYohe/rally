import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createWriteStream, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { app, net } from 'electron'
import { errorMessage } from '@shared/errors'
import { RALLY_REPO } from '@shared/repo'
import type { AppInfo, InstallAttempt, ReleaseAsset, ReleaseInfo, UpdateState } from '@shared/types'
import { GITHUB_TIMEOUT_MS } from '../github/client'
import { updateFile } from '../store'
import { handOffInstall, installBlocker, installLogPath, removePreviousMacApp, type InstallTarget } from './install'
import { isNewerVersion, toReleaseInfo, type GithubRelease } from './release'

const LATEST_RELEASE_URL = `https://api.github.com/repos/${RALLY_REPO}/releases/latest`
const DOWNLOAD_STALL_MS = 30_000

const PLATFORM_LABELS: Partial<Record<NodeJS.Platform, string>> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export function appInfo(): AppInfo {
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${PLATFORM_LABELS[process.platform] ?? process.platform} ${process.arch}`,
    userDataDir: app.getPath('userData'),
  }
}

function installTarget(): InstallTarget {
  return { packaged: app.isPackaged, platform: process.platform, exePath: app.getPath('exe') }
}

async function fetchLatestRelease(): Promise<ReleaseInfo> {
  let response: Response
  try {
    response = await net.fetch(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error(`GitHub didn't answer within ${GITHUB_TIMEOUT_MS / 1000} seconds.`)
    throw error
  }
  if (response.status === 403 || response.status === 429) throw new Error('GitHub rate limited the update check. Try again later.')
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for the latest release.`)
  return toReleaseInfo((await response.json()) as GithubRelease, process.platform, process.arch)
}

async function download(asset: ReleaseAsset, path: string, onProgress: (received: number, total: number) => void): Promise<void> {
  const controller = new AbortController()
  let stallTimer: NodeJS.Timeout | undefined
  const resetStallTimer = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(
      () => controller.abort(new Error(`The download stalled for ${DOWNLOAD_STALL_MS / 1000} seconds.`)),
      DOWNLOAD_STALL_MS,
    )
  }
  let received = 0
  resetStallTimer()
  try {
    const response = await net.fetch(asset.url, { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`Downloading ${asset.name} failed with HTTP ${response.status}.`)
    const total = Number(response.headers.get('content-length')) || asset.size
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        resetStallTimer()
        onProgress(received, total)
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body as ReadableStream), counter, createWriteStream(path), { signal: controller.signal })
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error
  } finally {
    clearTimeout(stallTimer)
  }
  if (received !== asset.size) throw new Error(`Downloaded ${received} bytes of ${asset.name}, expected ${asset.size}.`)
}

function workDirPrefix(): string {
  const dataDirHash = createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 12)
  return `rally-update-${dataDirHash}-`
}

function sweepWorkDirs(): void {
  const root = tmpdir()
  const prefix = workDirPrefix()
  for (const name of readdirSync(root).filter((n) => n.startsWith(prefix))) {
    try {
      rmSync(join(root, name), { recursive: true, force: true })
    } catch (error) {
      console.error('Removing a leftover update directory failed', { name, error })
    }
  }
}

function setPendingInstall(pending: InstallAttempt | null): void {
  updateFile.set({ ...updateFile.get(), pending })
}

class Updater extends EventEmitter {
  private state: UpdateState = { status: 'idle' }

  start(): void {
    sweepWorkDirs()
    const { pending } = updateFile.get()
    if (!pending) return
    const reachedVersion = pending.version === app.getVersion()
    updateFile.set({ pending: null, failed: reachedVersion ? null : pending })
    if (reachedVersion && process.platform === 'darwin' && app.isPackaged) removePreviousMacApp(app.getPath('exe'))
  }

  get(): UpdateState {
    return this.state
  }

  failedInstall(): InstallAttempt | null {
    return updateFile.get().failed
  }

  dismissFailedInstall(): void {
    updateFile.set({ ...updateFile.get(), failed: null })
  }

  async check(): Promise<void> {
    if (this.busy()) return
    this.set({ status: 'checking' })
    try {
      const release = await fetchLatestRelease()
      if (isNewerVersion(release.version, app.getVersion())) {
        this.set({ status: 'available', release, installBlocker: installBlocker(release, installTarget()) })
      } else {
        this.set({ status: 'up_to_date', checkedAt: new Date().toISOString() })
      }
    } catch (error) {
      console.error('Checking for updates failed', { error })
      this.set({ status: 'check_failed', error: errorMessage(error) })
    }
  }

  async install(): Promise<void> {
    const release = this.pendingRelease()
    if (!release) return
    const { asset } = release
    const blocker = installBlocker(release, installTarget())
    if (blocker || !asset) {
      this.set({ status: 'available', release, installBlocker: blocker })
      return
    }
    const workDir = mkdtempSync(join(tmpdir(), workDirPrefix()))
    try {
      const downloadPath = join(workDir, asset.name)
      let lastPercent = -1
      this.set({ status: 'downloading', release, received: 0, total: asset.size })
      await download(asset, downloadPath, (received, total) => {
        const percent = Math.floor((received / total) * 100)
        if (percent === lastPercent) return
        lastPercent = percent
        this.set({ status: 'downloading', release, received, total })
      })
      this.set({ status: 'installing', release })
      const dataDir = app.getPath('userData')
      const logPath = installLogPath(dataDir)
      setPendingInstall({ version: release.version, logPath })
      await handOffInstall({ downloadPath, workDir, exePath: app.getPath('exe'), dataDir, logPath })
    } catch (error) {
      console.error('Installing the update failed', { version: release.version, error })
      setPendingInstall(null)
      rmSync(workDir, { recursive: true, force: true })
      this.set({ status: 'install_failed', release, error: errorMessage(error) })
      return
    }
    app.quit()
  }

  private pendingRelease(): ReleaseInfo | null {
    switch (this.state.status) {
      case 'available':
        return this.state.release
      case 'install_failed':
        return this.state.release
      default:
        return null
    }
  }

  private busy(): boolean {
    return this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'installing'
  }

  private set(state: UpdateState): void {
    this.state = state
    this.emit('changed', state)
  }
}

export const updater = new Updater()
