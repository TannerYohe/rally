import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallAttempt, ReleaseInfo } from '@shared/types'

const ASSET_SIZE = 64

const mocks = vi.hoisted(() => {
  let record: { pending: InstallAttempt | null; failed: InstallAttempt | null } = { pending: null, failed: null }
  return {
    app: { getVersion: vi.fn(() => '1.6.0'), isPackaged: true, getPath: (name: string) => `/fake/${name}`, quit: vi.fn() },
    fetch: vi.fn(),
    updateFile: { get: () => record, set: (next: typeof record) => void (record = next) },
    handOffInstall: vi.fn(),
    installBlocker: vi.fn((): string | null => null),
    release: null as ReleaseInfo | null,
    removePreviousMacApp: vi.fn(),
    tmpRoot: '',
  }
})

vi.mock('node:os', async (importOriginal) => ({ ...(await importOriginal<object>()), tmpdir: () => mocks.tmpRoot }))

const { tmpdir: realTmpdir } = await vi.importActual<typeof import('node:os')>('node:os')

vi.mock('electron', () => ({ app: mocks.app, net: { fetch: mocks.fetch } }))
vi.mock('../store', () => ({ updateFile: mocks.updateFile }))
vi.mock('../github/client', () => ({ GITHUB_TIMEOUT_MS: 15_000 }))
vi.mock('./install', () => ({
  handOffInstall: mocks.handOffInstall,
  installBlocker: mocks.installBlocker,
  installLogPath: (dataDir: string) => `${dataDir}/update.log`,
  removePreviousMacApp: mocks.removePreviousMacApp,
}))
vi.mock('./release', async (importOriginal) => ({ ...(await importOriginal<object>()), toReleaseInfo: () => mocks.release }))

const RELEASE: ReleaseInfo = {
  version: '1.7.0',
  url: 'https://github.com/TannerYohe/rally/releases/tag/v1.7.0',
  notes: '',
  publishedAt: null,
  asset: { name: 'Rally-1.7.0-arm64.zip', url: 'https://example.test/Rally-1.7.0-arm64.zip', size: ASSET_SIZE },
  assetProblem: null,
}

const OWN_PREFIX = `rally-update-${createHash('sha256').update('/fake/userData').digest('hex').slice(0, 12)}-`

const releaseResponse = () => new Response(JSON.stringify({}), { status: 200 })
const assetResponse = (bytes = ASSET_SIZE) => new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes) } })

const workDirs = () => readdirSync(mocks.tmpRoot)

async function loadUpdater() {
  vi.resetModules()
  return (await import('./updater')).updater
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

async function updaterWithRelease() {
  const updater = await loadUpdater()
  mocks.fetch.mockResolvedValueOnce(releaseResponse())
  await updater.check()
  return updater
}

describe('updater', () => {
  beforeEach(() => {
    mocks.tmpRoot = mkdtempSync(join(realTmpdir(), 'rally-updater-test-'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.removePreviousMacApp.mockReset()
    mocks.release = RELEASE
    mocks.fetch.mockReset()
    mocks.handOffInstall.mockReset()
    mocks.installBlocker.mockReset().mockReturnValue(null)
    mocks.app.quit.mockReset()
    mocks.app.getVersion.mockReturnValue('1.6.0')
    mocks.updateFile.set({ pending: null, failed: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(mocks.tmpRoot, { recursive: true, force: true })
  })

  describe('check', () => {
    it('offers a newer release', async () => {
      const updater = await updaterWithRelease()
      expect(updater.get()).toEqual({ status: 'available', release: RELEASE, installBlocker: null })
    })

    it('reports up to date when the release is not newer', async () => {
      mocks.release = { ...RELEASE, version: '1.6.0' }
      const updater = await updaterWithRelease()
      expect(updater.get().status).toBe('up_to_date')
    })

    it('reports a failed check without a release', async () => {
      const updater = await loadUpdater()
      mocks.fetch.mockResolvedValueOnce(new Response('', { status: 500 }))
      await updater.check()
      expect(updater.get()).toEqual({ status: 'check_failed', error: 'GitHub returned HTTP 500 for the latest release.' })
    })

    it('times out the request and says GitHub did not answer', async () => {
      const updater = await loadUpdater()
      mocks.fetch.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
      await updater.check()
      expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining('/releases/latest'), expect.objectContaining({ signal: expect.any(AbortSignal) }))
      expect(updater.get()).toEqual({ status: 'check_failed', error: "GitHub didn't answer within 15 seconds." })
    })

    it.each([403, 429])('reports rate limiting on HTTP %i', async (status) => {
      const updater = await loadUpdater()
      mocks.fetch.mockResolvedValueOnce(new Response('', { status }))
      await updater.check()
      expect(updater.get()).toEqual({ status: 'check_failed', error: 'GitHub rate limited the update check. Try again later.' })
    })

    it('ignores a second check while one is running', async () => {
      const updater = await loadUpdater()
      mocks.fetch.mockResolvedValue(releaseResponse())
      await Promise.all([updater.check(), updater.check()])
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('install', () => {
    it('downloads the asset, records the pending install, hands off, and quits', async () => {
      const updater = await updaterWithRelease()
      mocks.fetch.mockResolvedValueOnce(assetResponse())
      await updater.install()
      expect(mocks.fetch).toHaveBeenLastCalledWith(RELEASE.asset?.url, expect.anything())
      const [handOff] = mocks.handOffInstall.mock.calls[0]
      expect(handOff.downloadPath).toBe(join(handOff.workDir, 'Rally-1.7.0-arm64.zip'))
      expect(existsSync(handOff.downloadPath)).toBe(true)
      expect(handOff).toMatchObject({ dataDir: '/fake/userData', logPath: '/fake/userData/update.log', exePath: '/fake/exe' })
      expect(handOff.workDir.startsWith(join(mocks.tmpRoot, OWN_PREFIX))).toBe(true)
      expect(mocks.updateFile.get().pending).toEqual({ version: '1.7.0', logPath: '/fake/userData/update.log' })
      expect(updater.get().status).toBe('installing')
      expect(mocks.app.quit).toHaveBeenCalled()
    })

    it('fails on a size mismatch and removes the download', async () => {
      const updater = await updaterWithRelease()
      const before = workDirs()
      mocks.fetch.mockResolvedValueOnce(assetResponse(ASSET_SIZE - 1))
      await updater.install()
      expect(updater.get()).toMatchObject({ status: 'install_failed', release: RELEASE, error: expect.stringMatching(/expected 64/) })
      expect(workDirs()).toEqual(before)
      expect(mocks.handOffInstall).not.toHaveBeenCalled()
      expect(mocks.app.quit).not.toHaveBeenCalled()
    })

    it('cleans up and clears the pending install when the hand-off throws', async () => {
      const updater = await updaterWithRelease()
      mocks.fetch.mockResolvedValueOnce(assetResponse())
      mocks.handOffInstall.mockRejectedValueOnce(new Error('The downloaded app failed its code signature check.'))
      await updater.install()
      const [handOff] = mocks.handOffInstall.mock.calls[0]
      expect(existsSync(handOff.workDir)).toBe(false)
      expect(mocks.updateFile.get().pending).toBeNull()
      expect(updater.get()).toEqual({ status: 'install_failed', release: RELEASE, error: 'The downloaded app failed its code signature check.' })
      expect(mocks.app.quit).not.toHaveBeenCalled()
    })

    it('retries from a failed install', async () => {
      const updater = await updaterWithRelease()
      mocks.fetch.mockResolvedValueOnce(new Response('', { status: 502 }))
      await updater.install()
      expect(updater.get().status).toBe('install_failed')
      mocks.fetch.mockResolvedValueOnce(assetResponse())
      await updater.install()
      expect(mocks.handOffInstall).toHaveBeenCalledTimes(1)
      expect(mocks.app.quit).toHaveBeenCalled()
    })

    it('returns to the blocked offer instead of downloading', async () => {
      const updater = await updaterWithRelease()
      mocks.installBlocker.mockReturnValue('Updates install only in the packaged app.')
      await updater.install()
      expect(updater.get()).toEqual({ status: 'available', release: RELEASE, installBlocker: 'Updates install only in the packaged app.' })
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    })

    it('ignores a second install and a check while downloading', async () => {
      const updater = await updaterWithRelease()
      const response = deferred<Response>()
      mocks.fetch.mockReturnValueOnce(response.promise)
      const installing = updater.install()
      expect(updater.get().status).toBe('downloading')
      await updater.install()
      await updater.check()
      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(updater.get().status).toBe('downloading')
      response.resolve(assetResponse())
      await installing
      expect(mocks.handOffInstall).toHaveBeenCalledTimes(1)
    })

    it('keeps a slow download alive while data keeps arriving', async () => {
      const updater = await updaterWithRelease()
      vi.useFakeTimers()
      let stream!: ReadableStreamDefaultController<Uint8Array>
      const body = new ReadableStream<Uint8Array>({ start: (controller) => void (stream = controller) })
      mocks.fetch.mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'content-length': String(ASSET_SIZE) } }))
      const installing = updater.install()
      for (let sent = 0; sent < ASSET_SIZE; sent += 16) {
        await vi.advanceTimersByTimeAsync(20_000)
        stream.enqueue(new Uint8Array(16))
      }
      stream.close()
      await installing
      expect(mocks.handOffInstall).toHaveBeenCalledTimes(1)
    })

    it('does nothing without an offered release', async () => {
      const updater = await loadUpdater()
      await updater.install()
      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(updater.get().status).toBe('idle')
    })

    it('fails a download that stalls', async () => {
      const updater = await updaterWithRelease()
      vi.useFakeTimers()
      mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start() {} }), { status: 200 }))
      const installing = updater.install()
      await vi.advanceTimersByTimeAsync(30_000)
      await installing
      expect(updater.get()).toMatchObject({ status: 'install_failed', error: 'The download stalled for 30 seconds.' })
    })
  })

  describe('start', () => {
    it('clears a pending install that reached the new version and removes the previous macOS app', async () => {
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      try {
        mocks.app.getVersion.mockReturnValue('1.7.0')
        mocks.updateFile.set({ pending: { version: '1.7.0', logPath: '/fake/userData/update.log' }, failed: null })
        const updater = await loadUpdater()
        updater.start()
        expect(mocks.updateFile.get()).toEqual({ pending: null, failed: null })
        expect(mocks.removePreviousMacApp).toHaveBeenCalledWith('/fake/exe')
      } finally {
        Object.defineProperty(process, 'platform', platform)
      }
    })

    it('records a pending install that did not reach the new version as failed', async () => {
      const attempt = { version: '1.7.0', logPath: '/fake/userData/update.log' }
      mocks.updateFile.set({ pending: attempt, failed: null })
      const updater = await loadUpdater()
      updater.start()
      expect(updater.failedInstall()).toEqual(attempt)
      expect(mocks.removePreviousMacApp).not.toHaveBeenCalled()
      updater.dismissFailedInstall()
      expect(updater.failedInstall()).toBeNull()
    })

    it("removes this data directory's leftover update dirs and leaves other instances' alone", async () => {
      const own = join(mocks.tmpRoot, `${OWN_PREFIX}leftover`)
      const other = join(mocks.tmpRoot, 'rally-update-0123456789ab-in-flight')
      mkdirSync(own)
      mkdirSync(other)
      const updater = await loadUpdater()
      updater.start()
      expect(existsSync(own)).toBe(false)
      expect(existsSync(other)).toBe(true)
    })
  })
})
