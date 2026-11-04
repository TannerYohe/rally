import { describe, expect, it } from 'vitest'
import { classifyGithubFailure } from './failure'

function withFields(message: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error(message), fields)
}

describe('classifyGithubFailure', () => {
  it('reports a missing gh CLI', () => {
    expect(classifyGithubFailure(withFields('spawn gh ENOENT', { code: 'ENOENT' }))).toBe('gh_missing')
  })

  it('reports signed out when gh auth token exits non-zero', () => {
    const error = withFields('Command failed: gh auth token', { cmd: 'gh auth token', code: 1 })
    expect(classifyGithubFailure(error)).toBe('signed_out')
  })

  it('reports signed out when GitHub rejects the token', () => {
    expect(classifyGithubFailure(withFields('Bad credentials', { status: 401 }))).toBe('signed_out')
  })

  it('reports unreachable for network errors and server errors', () => {
    expect(classifyGithubFailure(withFields('fetch failed', { status: 500 }))).toBe('unreachable')
    expect(classifyGithubFailure(withFields('Service Unavailable', { status: 503 }))).toBe('unreachable')
    expect(classifyGithubFailure(new Error('getaddrinfo ENOTFOUND api.github.com'))).toBe('unreachable')
    expect(classifyGithubFailure('boom')).toBe('unreachable')
  })
})
