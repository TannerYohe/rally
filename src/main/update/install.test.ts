import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReleaseInfo } from '@shared/types'
import { installBlocker, MAC_SWAP_SCRIPT, macBundlePath } from './install'

const release: ReleaseInfo = {
  version: '1.7.0',
  url: 'https://github.com/TannerYohe/rally/releases/tag/v1.7.0',
  notes: '',
  publishedAt: '2026-11-05T12:00:00Z',
  asset: { name: 'Rally-1.7.0-arm64.zip', url: 'https://example.test/arm64.zip', size: 2 },
}

const macTarget = { packaged: true, platform: 'darwin' as const, exePath: '/Applications/Rally.app/Contents/MacOS/Rally' }
const writable = () => true

describe('macBundlePath', () => {
  it('climbs from the executable to the app bundle', () => {
    expect(macBundlePath('/Applications/Rally.app/Contents/MacOS/Rally')).toBe('/Applications/Rally.app')
  })
})

describe('installBlocker', () => {
  it('allows installing a packaged app in a writable folder', () => {
    expect(installBlocker(release, macTarget, writable)).toBeNull()
  })

  it('blocks the development build', () => {
    expect(installBlocker(release, { ...macTarget, packaged: false }, writable)).toMatch(/packaged app/)
  })

  it('blocks a release without a build for this machine', () => {
    expect(installBlocker({ ...release, asset: null }, macTarget, writable)).toMatch(/no build for this machine/)
  })

  it('blocks an app that macOS translocated', () => {
    const exePath = '/private/var/folders/xy/T/AppTranslocation/ABC/d/Rally.app/Contents/MacOS/Rally'
    expect(installBlocker(release, { ...macTarget, exePath }, writable)).toMatch(/Applications folder/)
  })

  it('blocks when the folder holding the app is read-only', () => {
    const checked: string[] = []
    const readOnly = (path: string) => {
      checked.push(path)
      return false
    }
    expect(installBlocker(release, macTarget, readOnly)).toMatch(/can't write to \/Applications/)
    expect(checked).toEqual(['/Applications'])
  })

  it('does not check folder permissions on Windows', () => {
    const exePath = 'C:\\Users\\me\\AppData\\Local\\Programs\\Rally\\Rally.exe'
    expect(installBlocker(release, { packaged: true, platform: 'win32', exePath }, () => false)).toBeNull()
  })
})

describe.skipIf(process.platform === 'win32')('MAC_SWAP_SCRIPT', () => {
  let root: string
  let paths: { currentApp: string; previousApp: string; newApp: string; workDir: string; log: string; calls: string; stubs: string }

  const app = (path: string, version: string) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'version'), version)
  }
  const versionOf = (path: string) => readFileSync(join(path, 'version'), 'utf8')
  const stub = (name: string, body: string) => {
    writeFileSync(join(paths.stubs, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(paths.stubs, name), 0o755)
  }
  const exitedPid = () => String(spawnSync('/bin/sh', ['-c', 'echo $$']).stdout).trim()

  function runScript({ dataDir = '', failMoves = [] as string[] } = {}) {
    const args = [exitedPid(), paths.newApp, paths.currentApp, paths.workDir, dataDir, paths.log]
    const result = spawnSync('/bin/sh', ['-c', MAC_SWAP_SCRIPT, 'rally-update', ...args], {
      env: { ...process.env, PATH: `${paths.stubs}:${process.env.PATH}`, CALLS: paths.calls, FAIL_MOVES: failMoves.join(' ') },
    })
    expect(result.status).toBe(0)
    return { log: readFileSync(paths.log, 'utf8'), calls: existsSync(paths.calls) ? readFileSync(paths.calls, 'utf8') : '' }
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rally-swap-test-'))
    const currentApp = join(root, 'Applications', 'Rally.app')
    const workDir = join(root, 'work')
    paths = {
      currentApp,
      previousApp: `${currentApp}.previous`,
      newApp: join(workDir, 'extracted', 'Rally.app'),
      workDir,
      log: join(root, 'update.log'),
      calls: join(root, 'calls'),
      stubs: join(root, 'stubs'),
    }
    mkdirSync(paths.stubs)
    app(paths.currentApp, 'old')
    app(paths.newApp, 'new')
    stub('open', 'echo "open $*" >> "$CALLS"')
    stub('xattr', 'echo "xattr $*" >> "$CALLS"')
    stub('mv', 'for path in $FAIL_MOVES; do [ "$1" = "$path" ] && exit 1; done\nexec /bin/mv "$@"')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('swaps in the new app, cleans up, and reopens it', () => {
    const { log, calls } = runScript()
    expect(versionOf(paths.currentApp)).toBe('new')
    expect(existsSync(paths.previousApp)).toBe(false)
    expect(existsSync(paths.workDir)).toBe(false)
    expect(log).toContain('installed')
    expect(calls).toBe(`xattr -dr com.apple.quarantine ${paths.currentApp}\nopen ${paths.currentApp}\n`)
  })

  it('reopens with the same data directory', () => {
    const { calls } = runScript({ dataDir: '/tmp/rally data' })
    expect(calls).toContain(`open --env RALLY_USER_DATA_DIR=/tmp/rally data ${paths.currentApp}`)
  })

  it('replaces a stale previous app left by an earlier run', () => {
    app(paths.previousApp, 'stale')
    runScript()
    expect(versionOf(paths.currentApp)).toBe('new')
    expect(existsSync(paths.previousApp)).toBe(false)
  })

  it('restores the previous app when the new one cannot move into place', () => {
    const { log, calls } = runScript({ failMoves: [paths.newApp] })
    expect(versionOf(paths.currentApp)).toBe('old')
    expect(existsSync(paths.previousApp)).toBe(false)
    expect(existsSync(paths.workDir)).toBe(false)
    expect(log).toContain('failed: restored the previous app')
    expect(calls).toBe(`open ${paths.currentApp}\n`)
  })

  it('keeps both copies and reopens the previous app when the restore fails', () => {
    const { log, calls } = runScript({ failMoves: [paths.newApp, paths.previousApp] })
    expect(existsSync(paths.currentApp)).toBe(false)
    expect(versionOf(paths.previousApp)).toBe('old')
    expect(versionOf(paths.newApp)).toBe('new')
    expect(log).toContain('could not restore the previous app')
    expect(calls).toBe(`open ${paths.previousApp}\n`)
  })

  it('leaves the current app alone when it cannot be moved aside', () => {
    const { log } = runScript({ failMoves: [paths.currentApp] })
    expect(versionOf(paths.currentApp)).toBe('old')
    expect(log).toContain('could not move the current app aside')
  })
})
