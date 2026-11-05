import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAC_SWAP_SCRIPT, macPreviousAppPath, macSwapArgs, windowsInstallArgs } from './install'

describe.skipIf(process.platform === 'win32')('MAC_SWAP_SCRIPT', () => {
  let root: string
  let paths: { currentApp: string; previousApp: string; newApp: string; workDir: string; dataDir: string; log: string; calls: string; stubs: string }

  const app = (path: string, version: string) => {
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'version'), version)
  }
  const versionOf = (path: string) => readFileSync(join(path, 'version'), 'utf8')
  const stub = (name: string, body: string) => {
    writeFileSync(join(paths.stubs, name), `#!/bin/sh\n${body}\n`)
    chmodSync(join(paths.stubs, name), 0o755)
  }
  const exitedPid = () => Number(String(spawnSync('/bin/sh', ['-c', 'echo $$']).stdout).trim())
  const orphanSleepPid = (seconds: number) =>
    Number(String(spawnSync('/bin/sh', ['-c', `sleep ${seconds} >/dev/null 2>&1 & echo $!`]).stdout).trim())

  function runScript({ pid = exitedPid(), failMoves = [] as string[] } = {}) {
    const args = macSwapArgs({ pid, newApp: paths.newApp, currentApp: paths.currentApp, workDir: paths.workDir, dataDir: paths.dataDir, logPath: paths.log })
    const result = spawnSync('/bin/sh', ['-c', MAC_SWAP_SCRIPT, 'rally-update', ...args], {
      env: { ...process.env, PATH: `${paths.stubs}:${process.env.PATH}`, CALLS: paths.calls, FAIL_MOVES: failMoves.join('\n') },
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
      previousApp: macPreviousAppPath(currentApp),
      newApp: join(workDir, 'extracted', 'Rally.app'),
      workDir,
      dataDir: join(root, 'rally data'),
      log: join(root, 'rally data', 'update.log'),
      calls: join(root, 'calls'),
      stubs: join(root, 'stubs'),
    }
    mkdirSync(paths.stubs)
    mkdirSync(paths.dataDir)
    app(paths.currentApp, 'old')
    app(paths.newApp, 'new')
    stub('open', 'echo "open $*" >> "$CALLS"')
    stub('xattr', 'echo "xattr $*" >> "$CALLS"')
    stub('mv', 'printf "%s\\n" "$FAIL_MOVES" | grep -qxF -- "$1" && exit 1\nexec /bin/mv "$@"')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('swaps in the new app, keeps the previous one, and reopens with the data directory', () => {
    const { log, calls } = runScript()
    expect(versionOf(paths.currentApp)).toBe('new')
    expect(versionOf(paths.previousApp)).toBe('old')
    expect(existsSync(paths.workDir)).toBe(false)
    expect(log).toContain('installed')
    expect(calls).toBe(`xattr -dr com.apple.quarantine ${paths.currentApp}\nopen --env RALLY_USER_DATA_DIR=${paths.dataDir} ${paths.currentApp}\n`)
  })

  it('waits for Rally to exit before swapping', () => {
    const started = Date.now()
    runScript({ pid: orphanSleepPid(1) })
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    expect(versionOf(paths.currentApp)).toBe('new')
  })

  it('replaces a stale previous app left by an earlier run', () => {
    app(paths.previousApp, 'stale')
    runScript()
    expect(versionOf(paths.previousApp)).toBe('old')
  })

  it('restores the previous app when the new one cannot move into place', () => {
    const { log, calls } = runScript({ failMoves: [paths.newApp] })
    expect(versionOf(paths.currentApp)).toBe('old')
    expect(existsSync(paths.previousApp)).toBe(false)
    expect(existsSync(paths.workDir)).toBe(false)
    expect(log).toContain('failed: restored the previous app')
    expect(calls).toBe(`open --env RALLY_USER_DATA_DIR=${paths.dataDir} ${paths.currentApp}\n`)
  })

  it('keeps both copies and reopens the previous .app when the restore fails', () => {
    const { log, calls } = runScript({ failMoves: [paths.newApp, paths.previousApp] })
    expect(existsSync(paths.currentApp)).toBe(false)
    expect(versionOf(paths.previousApp)).toBe('old')
    expect(versionOf(paths.newApp)).toBe('new')
    expect(log).toContain('could not restore the previous app')
    expect(calls).toBe(`open --env RALLY_USER_DATA_DIR=${paths.dataDir} ${paths.previousApp}\n`)
    expect(paths.previousApp.endsWith('.app')).toBe(true)
  })

  it('leaves the current app alone when it cannot be moved aside', () => {
    const { log } = runScript({ failMoves: [paths.currentApp] })
    expect(versionOf(paths.currentApp)).toBe('old')
    expect(log).toContain('could not move the current app aside')
  })
})

describe.runIf(process.platform === 'win32')('WINDOWS_INSTALL_SCRIPT', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rally-windows-install-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('runs the installer silently and logs its exit code, with quotes and spaces in the paths', () => {
    const dir = join(root, "o'brien files")
    mkdirSync(dir)
    const installer = join(dir, 'fake-installer.cmd')
    const log = join(dir, 'update.log')
    writeFileSync(installer, '@echo %* > "%~dp0args.txt"\r\n@exit /b 3\r\n')
    const result = spawnSync('powershell.exe', windowsInstallArgs(installer, log))
    expect(result.status).toBe(0)
    expect(readFileSync(join(dir, 'args.txt'), 'utf8').trim()).toBe('/S --force-run')
    expect(readFileSync(log, 'utf8')).toContain('installer exited with code 3')
  })
})
