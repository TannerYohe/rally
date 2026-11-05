import { EventEmitter } from 'node:events'
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { app, net } from 'electron'
import type { AppInfo, ReleaseAsset, ReleaseInfo, UpdateState } from '@shared/types'
import { handOffMacInstall, handOffWindowsInstall, installBlocker, type InstallTarget } from './install'
import { isNewerVersion, RELEASE_REPO, toReleaseInfo, type GithubRelease } from './release'

const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`

const PLATFORM_LABELS: Partial<Record<NodeJS.Platform, string>> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
  const response = await net.fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } })
  if (response.status === 403 || response.status === 429) throw new Error('GitHub rate limited the update check. Try again later.')
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for the latest release.`)
  return toReleaseInfo((await response.json()) as GithubRelease, process.platform, process.arch)
}

async function download(asset: ReleaseAsset, path: string, onProgress: (received: number, total: number) => void): Promise<void> {
  const response = await net.fetch(asset.url)
  if (!response.ok || !response.body) throw new Error(`Downloading ${asset.name} failed with HTTP ${response.status}.`)
  const total = Number(response.headers.get('content-length')) || asset.size
  let received = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      onProgress(received, total)
      callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body as ReadableStream), counter, createWriteStream(path))
  if (received !== asset.size) throw new Error(`Downloaded ${received} bytes of ${asset.name}, expected ${asset.size}.`)
}

class Updater extends EventEmitter {
  private state: UpdateState = { status: 'idle' }

  get(): UpdateState {
    return this.state
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
      this.set({ status: 'error', error: errorMessage(error), release: null })
    }
  }

  async install(): Promise<void> {
    const release = this.pendingRelease()
    if (!release || this.busy()) return
    const blocker = installBlocker(release, installTarget())
    if (blocker || !release.asset) {
      this.set({ status: 'error', error: blocker ?? 'This release has no build for this machine.', release })
      return
    }
    const asset = release.asset
    const workDir = mkdtempSync(join(tmpdir(), 'rally-update-'))
    try {
      const path = join(workDir, asset.name)
      let lastPercent = -1
      this.set({ status: 'downloading', release, received: 0, total: asset.size })
      await download(asset, path, (received, total) => {
        const percent = Math.floor((received / total) * 100)
        if (percent === lastPercent) return
        lastPercent = percent
        this.set({ status: 'downloading', release, received, total })
      })
      this.set({ status: 'installing', release })
      await this.handOff(path, workDir)
    } catch (error) {
      console.error('Installing the update failed', { version: release.version, error })
      rmSync(workDir, { recursive: true, force: true })
      this.set({ status: 'error', error: errorMessage(error), release })
      return
    }
    app.quit()
  }

  private async handOff(downloadPath: string, workDir: string): Promise<void> {
    switch (process.platform) {
      case 'darwin':
        return handOffMacInstall(downloadPath, workDir, app.getPath('exe'))
      case 'win32':
        return handOffWindowsInstall(downloadPath)
      default:
        throw new Error(`Rally can't install updates on ${process.platform}.`)
    }
  }

  private pendingRelease(): ReleaseInfo | null {
    switch (this.state.status) {
      case 'available':
        return this.state.release
      case 'error':
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
