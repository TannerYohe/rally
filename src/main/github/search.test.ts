import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/types'
import { buildSearchQueries, repoQualifier } from './search'

const config = (overrides: Partial<typeof DEFAULT_CONFIG>) => ({ ...DEFAULT_CONFIG, includeReviewRequests: false, ...overrides })

describe('buildSearchQueries', () => {
  it('returns nothing when no filters and no review requests', () => {
    expect(buildSearchQueries(config({}))).toEqual([])
  })

  it('combines repos and authors in one query', () => {
    expect(buildSearchQueries(config({ repos: ['acme/api', 'acme/web'], authors: ['alice'] }))).toEqual([
      'is:pr is:open archived:false repo:acme/api repo:acme/web author:alice',
    ])
  })

  it('treats owner/* and bare owners as org scopes alongside exact repos', () => {
    expect(buildSearchQueries(config({ repos: ['AvantFinCo/*', 'TannerYohe/rally'], authors: ['alice'] }))).toEqual([
      'is:pr is:open archived:false org:AvantFinCo repo:TannerYohe/rally author:alice',
    ])
  })

  it('adds review-requested and reviewed-by queries', () => {
    expect(buildSearchQueries(config({ includeReviewRequests: true }))).toEqual([
      'is:pr is:open archived:false user-review-requested:@me',
      'is:pr is:open archived:false reviewed-by:@me -author:@me',
    ])
  })

  it('splits long qualifier lists so each query stays under the search limit', () => {
    const authors = Array.from({ length: 30 }, (_, i) => `some-long-author-name-${i}`)
    const queries = buildSearchQueries(config({ repos: ['acme/api'], authors }))
    expect(queries.length).toBeGreaterThan(1)
    for (const q of queries) expect(q.length).toBeLessThanOrEqual(256)
    const seen = queries.flatMap((q) => q.split(' ').filter((t) => t.startsWith('author:')))
    expect(seen).toHaveLength(30)
    for (const q of queries) expect(q).toContain('repo:acme/api')
  })
})

describe('repoQualifier', () => {
  it('maps entries to repo or org qualifiers', () => {
    expect(repoQualifier('acme/api')).toBe('repo:acme/api')
    expect(repoQualifier('acme/*')).toBe('org:acme')
    expect(repoQualifier('acme/')).toBe('org:acme')
    expect(repoQualifier(' acme ')).toBe('org:acme')
  })
})
