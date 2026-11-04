import type { GithubFailure } from '@shared/types'

interface ErrorFields {
  code?: unknown
  cmd?: unknown
  status?: unknown
}

export function classifyGithubFailure(error: unknown): GithubFailure {
  const { code, cmd, status } = (error ?? {}) as ErrorFields
  if (code === 'ENOENT') return 'gh_missing'
  if (typeof cmd === 'string' && typeof code === 'number') return 'signed_out'
  if (status === 401) return 'signed_out'
  return 'unreachable'
}
