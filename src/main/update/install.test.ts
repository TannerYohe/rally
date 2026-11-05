import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseInfo } from '@shared/types'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('node:child_process', () => ({ execFile: mocks.execFile, spawn: mocks.spawn }))

const {
  handOffInstall,
  handOffMacInstall,
  handOffWindowsInstall,
  installBlocker,
  MAC_SWAP_SCRIPT,
  macBundlePath,
  macPreviousAppPath,
  macSwapArgs,
  WINDOWS_INSTALL_SCRIPT,
  windowsInstallArgs,
} = await import('./install')

const release: ReleaseInfo = {
  version: '1.7.0',
  url: 'https://github.com/TannerYohe/rally/releases/tag/v1.7.0',
  notes: '',
  publishedAt: '2026-11-05T12:00:00Z',
  asset: { name: 'Rally-1.7.0-arm64.zip', url: 'https://example.test/arm64.zip', size: 2 },
  assetProblem: null,
}

const macTarget = { packaged: true, platform: 'darwin' as const, exePath: '/Applications/Rally.app/Contents/MacOS/Rally' }
const writable = () => true

describe('macBundlePath', () => {
  it('climbs from the executable to the app bundle', () => {
    expect(macBundlePath('/Applications/Rally.app/Contents/MacOS/Rally')).toBe('/Applications/Rally.app')
  })
})

describe('macPreviousAppPath', () => {
  it('keeps the .app extension so macOS can open it', () => {
    expect(macPreviousAppPath('/Applications/Rally.app')).toBe('/Applications/Rally.previous.app')
  })
})

describe('macSwapArgs', () => {
  it('orders the arguments the swap script names', () => {
    const args = macSwapArgs({ pid: 42, newApp: '/w/x/Rally.app', currentApp: '/A/Rally.app', workDir: '/w', dataDir: '/d', logPath: '/d/update.log' })
    expect(args).toEqual(['42', '/w/x/Rally.app', '/A/Rally.app', '/A/Rally.previous.app', '/w', '/d', '/d/update.log'])
    expect(MAC_SWAP_SCRIPT).toContain('pid=$1 new_app=$2 current_app=$3 previous_app=$4 work_dir=$5 data_dir=$6 log=$7')
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

  it('explains an asset that failed validation', () => {
    const problem = "The release asset Rally.zip doesn't download from https://github.com/TannerYohe/rally/releases/download/."
    expect(installBlocker({ ...release, asset: null, assetProblem: problem }, macTarget, writable)).toBe(`${problem} Rally won't install it.`)
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

type ExecResult = { stdout?: string; error?: Error & { stderr?: string } }

function stubExecFile(results: (command: string, args: string[]) => ExecResult) {
  mocks.execFile.mockImplementation((command: string, args: string[], _options: unknown, callback: (error: Error | null, out?: object) => void) => {
    const { stdout = '', error } = results(command, args)
    callback(error ?? null, error ? undefined : { stdout, stderr: '' })
  })
}

function stubSpawn(event: 'spawn' | 'error' = 'spawn') {
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => (event === 'spawn' ? child.emit('spawn') : child.emit('error', new Error('spawn EACCES'))))
    return child
  })
}

describe('handOffMacInstall', () => {
  let workDir: string
  const exePath = '/Applications/Rally.app/Contents/MacOS/Rally'
  const handOff = () => ({ downloadPath: join(workDir, 'Rally.zip'), workDir, exePath, dataDir: '/d', logPath: '/d/update.log' })
  const bundleIds = (newId: string) => (command: string, args: string[]): ExecResult =>
    command === 'plutil' ? { stdout: args.at(-1)?.startsWith(workDir) ? `${newId}\n` : 'com.tanneryohe.rally\n' } : {}

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'rally-handoff-test-'))
    mkdirSync(join(workDir, 'extracted', 'Rally.app'), { recursive: true })
    mocks.execFile.mockReset()
    mocks.spawn.mockReset()
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('verifies the app and starts the swap script with the shared arguments', async () => {
    stubExecFile(bundleIds('com.tanneryohe.rally'))
    stubSpawn()
    await handOffMacInstall(handOff())
    expect(mocks.execFile.mock.calls.map(([command]) => command)).toEqual(['ditto', 'codesign', 'plutil', 'plutil'])
    const newApp = join(workDir, 'extracted', 'Rally.app')
    const args = macSwapArgs({ pid: process.pid, newApp, currentApp: '/Applications/Rally.app', workDir, dataDir: '/d', logPath: '/d/update.log' })
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', MAC_SWAP_SCRIPT, 'rally-update', ...args],
      expect.objectContaining({ detached: true, env: expect.objectContaining({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }) }),
    )
  })

  it("reports codesign's stderr when the signature check fails", async () => {
    const error = Object.assign(new Error('Command failed: codesign'), { stderr: 'Rally.app: a sealed resource is missing or invalid\n' })
    stubExecFile((command) => (command === 'codesign' ? { error } : {}))
    await expect(handOffMacInstall(handOff())).rejects.toThrow(
      'The downloaded app failed its code signature check: Rally.app: a sealed resource is missing or invalid',
    )
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects an app with a different bundle id', async () => {
    stubExecFile(bundleIds('com.example.other'))
    await expect(handOffMacInstall(handOff())).rejects.toThrow("The downloaded app's bundle id is com.example.other, not com.tanneryohe.rally.")
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects a zip without Rally.app', async () => {
    rmSync(join(workDir, 'extracted'), { recursive: true })
    stubExecFile(() => ({}))
    await expect(handOffMacInstall(handOff())).rejects.toThrow('The downloaded zip has no Rally.app.')
  })

  it('fails when the swap script cannot start', async () => {
    stubExecFile(bundleIds('com.tanneryohe.rally'))
    stubSpawn('error')
    await expect(handOffMacInstall(handOff())).rejects.toThrow('spawn EACCES')
  })
})

describe('windowsInstallArgs', () => {
  const decode = (args: string[]) => Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le')

  it('runs the script as an encoded command, which execution policy does not apply to', () => {
    const args = windowsInstallArgs('C:\\Temp\\Rally.exe', 'C:\\data\\update.log')
    expect(args.slice(0, -1)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(decode(args)).toBe(`& {${WINDOWS_INSTALL_SCRIPT}} -Installer 'C:\\Temp\\Rally.exe' -Log 'C:\\data\\update.log'`)
  })

  it('doubles single quotes in paths', () => {
    expect(decode(windowsInstallArgs("C:\\Users\\o'brien\\Rally.exe", 'C:\\log'))).toContain("-Installer 'C:\\Users\\o''brien\\Rally.exe'")
  })
})

describe('handOffWindowsInstall', () => {
  beforeEach(() => {
    mocks.spawn.mockReset()
  })

  it('starts PowerShell with the encoded install command', async () => {
    stubSpawn()
    const handOff = { downloadPath: 'C:\\Temp\\Rally.exe', workDir: 'C:\\Temp', exePath: 'C:\\Rally\\Rally.exe', dataDir: 'C:\\data', logPath: 'C:\\data\\update.log' }
    await handOffWindowsInstall(handOff)
    expect(mocks.spawn).toHaveBeenCalledWith(
      'powershell.exe',
      windowsInstallArgs('C:\\Temp\\Rally.exe', 'C:\\data\\update.log'),
      expect.objectContaining({ detached: true, windowsHide: true }),
    )
  })

  it('fails when PowerShell cannot start', async () => {
    stubSpawn('error')
    const handOff = { downloadPath: 'x.exe', workDir: 'C:\\Temp', exePath: 'C:\\Rally\\Rally.exe', dataDir: 'C:\\data', logPath: 'C:\\data\\update.log' }
    await expect(handOffWindowsInstall(handOff)).rejects.toThrow('spawn EACCES')
  })
})

describe('handOffInstall', () => {
  let dataDir: string
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'rally-handoff-test-'))
    mocks.spawn.mockReset()
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', platform)
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('logs the hand-off before starting the installer, even if it never starts', async () => {
    stubSpawn('error')
    const logPath = join(dataDir, 'update.log')
    const handOff = { downloadPath: join(dataDir, 'Rally-1.7.0-x64.exe'), workDir: dataDir, exePath: 'C:\\Rally\\Rally.exe', dataDir, logPath }
    await expect(handOffInstall(handOff)).rejects.toThrow('spawn EACCES')
    expect(readFileSync(logPath, 'utf8')).toMatch(new RegExp(`^\\S+ handing off .*Rally-1\\.7\\.0-x64\\.exe\\n$`))
  })
})
