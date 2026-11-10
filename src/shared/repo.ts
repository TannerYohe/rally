export const RALLY_REPO = 'TannerYohe/rally'

export const RALLY_REPO_URL = `https://github.com/${RALLY_REPO}`

export function releasePageUrl(version: string): string {
  return `${RALLY_REPO_URL}/releases/tag/v${version}`
}
