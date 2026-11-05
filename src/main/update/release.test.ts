import { describe, expect, it } from 'vitest'
import { installerAssetSuffix, isNewerVersion, toReleaseInfo, type GithubRelease } from './release'

describe('isNewerVersion', () => {
  it('compares major, minor, and patch numerically', () => {
    expect(isNewerVersion('1.10.0', '1.9.3')).toBe(true)
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true)
    expect(isNewerVersion('1.6.1', '1.6.0')).toBe(true)
    expect(isNewerVersion('1.6.0', '1.6.0')).toBe(false)
    expect(isNewerVersion('1.5.9', '1.6.0')).toBe(false)
  })

  it('accepts a leading v on the tag', () => {
    expect(isNewerVersion('v1.7.0', '1.6.0')).toBe(true)
  })

  it('treats a release as newer than a prerelease of the same version', () => {
    expect(isNewerVersion('1.6.0', '1.6.0-beta.1')).toBe(true)
    expect(isNewerVersion('1.6.0-beta.1', '1.6.0')).toBe(false)
  })

  it('treats any release as newer than the development version', () => {
    expect(isNewerVersion('1.6.0', '0.0.0-development')).toBe(true)
  })

  it('ignores a tag that is not a version', () => {
    expect(isNewerVersion('nightly', '1.6.0')).toBe(false)
  })
})

describe('installerAssetSuffix', () => {
  it('uses the zip on macOS and the installer on Windows', () => {
    expect(installerAssetSuffix('darwin', 'arm64')).toBe('-arm64.zip')
    expect(installerAssetSuffix('win32', 'x64')).toBe('-x64.exe')
  })

  it('has no installer for Intel Macs, whose x64 zip name would match the Windows zip', () => {
    expect(installerAssetSuffix('darwin', 'x64')).toBeNull()
  })

  it('has no installer for other platforms', () => {
    expect(installerAssetSuffix('linux', 'x64')).toBeNull()
  })
})

describe('toReleaseInfo', () => {
  const release: GithubRelease = {
    tag_name: 'v1.7.0',
    html_url: 'https://github.com/TannerYohe/rally/releases/tag/v1.7.0',
    body: '### Features\n\n* about screen',
    published_at: '2026-11-05T12:00:00Z',
    assets: [
      { name: 'Rally-1.7.0-arm64.dmg', browser_download_url: 'https://example.test/arm64.dmg', size: 3 },
      { name: 'Rally-1.7.0-arm64.zip', browser_download_url: 'https://example.test/arm64.zip', size: 2 },
      { name: 'Rally-1.7.0-x64.exe', browser_download_url: 'https://example.test/x64.exe', size: 4 },
      { name: 'Rally-1.7.0-x64.zip', browser_download_url: 'https://example.test/x64.zip', size: 5 },
    ],
  }

  it('picks the macOS zip for this architecture', () => {
    expect(toReleaseInfo(release, 'darwin', 'arm64')).toEqual({
      version: '1.7.0',
      url: release.html_url,
      notes: release.body,
      publishedAt: release.published_at,
      asset: { name: 'Rally-1.7.0-arm64.zip', url: 'https://example.test/arm64.zip', size: 2 },
    })
  })

  it('picks the Windows installer rather than the Windows zip', () => {
    expect(toReleaseInfo(release, 'win32', 'x64').asset?.name).toBe('Rally-1.7.0-x64.exe')
  })

  it('has no asset when the release lacks a build for this machine', () => {
    expect(toReleaseInfo(release, 'darwin', 'x64').asset).toBeNull()
    expect(toReleaseInfo(release, 'linux', 'x64').asset).toBeNull()
  })

  it('tolerates a release without notes or a publish time', () => {
    const info = toReleaseInfo({ ...release, body: null, published_at: null }, 'darwin', 'arm64')
    expect(info.notes).toBe('')
    expect(info.publishedAt).toBeNull()
  })
})
