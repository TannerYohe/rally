import type { ReleaseAsset, ReleaseInfo } from '@shared/types'

interface Version {
  core: number[]
  prerelease: string | null
}

function parseVersion(text: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(text.trim())
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? null }
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  if (!next) return false
  const now = parseVersion(current)
  if (!now) return true
  for (let i = 0; i < 3; i++) {
    if (next.core[i] !== now.core[i]) return next.core[i] > now.core[i]
  }
  return now.prerelease !== null && next.prerelease === null
}

const MAC_RELEASE_ARCH = 'arm64'

export function installerAssetSuffix(platform: NodeJS.Platform, arch: string): string | null {
  switch (platform) {
    case 'darwin':
      return arch === MAC_RELEASE_ARCH ? `-${arch}.zip` : null
    case 'win32':
      return `-${arch}.exe`
    default:
      return null
  }
}

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface GithubRelease {
  tag_name: string
  html_url: string
  body: string | null
  published_at: string | null
  assets: GithubReleaseAsset[]
}

export function toReleaseInfo(release: GithubRelease, platform: NodeJS.Platform, arch: string): ReleaseInfo {
  const suffix = installerAssetSuffix(platform, arch)
  const asset = suffix ? release.assets.find((a) => a.name.endsWith(suffix)) : undefined
  return {
    version: release.tag_name.replace(/^v/, ''),
    url: release.html_url,
    notes: release.body ?? '',
    publishedAt: release.published_at,
    asset: asset ? toAsset(asset) : null,
  }
}

function toAsset(asset: GithubReleaseAsset): ReleaseAsset {
  return { name: asset.name, url: asset.browser_download_url, size: asset.size }
}
