import { describe, expect, it } from 'vitest'
import type { ReleaseInfo } from '@shared/types'
import { installBlocker, macBundlePath } from './install'

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
