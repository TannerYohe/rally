import type { Config } from '@shared/types'

const MAX_QUERY_LENGTH = 256
const BASE = 'is:pr is:open archived:false'

function chunkQualifiers(qualifiers: string[], budget: number): string[][] {
  if (qualifiers.length === 0) return [[]]
  const chunks: string[][] = [[]]
  let length = 0
  for (const qualifier of qualifiers) {
    const cost = qualifier.length + 1
    if (chunks.at(-1)!.length > 0 && length + cost > budget) {
      chunks.push([])
      length = 0
    }
    chunks.at(-1)!.push(qualifier)
    length += cost
  }
  return chunks
}

export function repoQualifier(entry: string): string {
  const scope = entry.trim().replace(/\/\*?$/, '')
  return scope.includes('/') ? `repo:${scope}` : `org:${scope}`
}

export function buildSearchQueries(config: Config): string[] {
  const queries: string[] = []
  const repos = config.repos.map(repoQualifier)
  const authors = config.authors.map((a) => `author:${a}`)

  if (repos.length > 0 || authors.length > 0) {
    const budget = (MAX_QUERY_LENGTH - BASE.length) / 2
    for (const repoChunk of chunkQualifiers(repos, budget)) {
      for (const authorChunk of chunkQualifiers(authors, budget)) {
        queries.push([BASE, ...repoChunk, ...authorChunk].join(' '))
      }
    }
  }

  if (config.includeReviewRequests) queries.push(`${BASE} user-review-requested:@me`)
  return queries
}
