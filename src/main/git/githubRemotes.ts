import { git } from './gitCommand'

/** Prefixes of the GitHub URL forms a remote can push to, whatever its owner and repo. */
export const GITHUB_URL_PREFIXES = ['https://github.com/', 'http://github.com/', 'https://www.github.com/', 'git@github.com:', 'ssh://git@github.com/', 'ssh://github.com/']

/** Returns owner/name, lowercased, for a GitHub remote URL, or null for any other URL. */
export function githubRepoOf(url: string): string | null {
  const match = url.trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null
}

export interface GithubRemotes {
  /** The `remote.*.url` values that point at GitHub. */
  urls: string[]
  /** The `remote.*.pushurl` values that point at GitHub. */
  pushUrls: string[]
}

export const NO_GITHUB_REMOTES: GithubRemotes = { urls: [], pushUrls: [] }

/** Reads the GitHub URLs and push URLs of every remote the repo at path configures. */
export async function githubRemotes(path: string): Promise<GithubRemotes> {
  const out = await git(path, ['config', '--get-regexp', '^remote\\..*\\.(url|pushurl)$']).catch(() => '')
  const remotes: GithubRemotes = { urls: [], pushUrls: [] }
  for (const line of out.split('\n')) {
    const [key, value] = [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1).trim()]
    if (!value || !githubRepoOf(value)) continue
    if (key.toLowerCase().endsWith('.pushurl')) remotes.pushUrls.push(value)
    else remotes.urls.push(value)
  }
  return remotes
}
