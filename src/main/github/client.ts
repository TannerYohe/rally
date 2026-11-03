import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { graphql } from '@octokit/graphql'
import { Octokit } from '@octokit/rest'

const run = promisify(execFile)

let cached: { token: string; graphql: typeof graphql; rest: Octokit; login: string } | null = null

export async function github() {
  if (cached) return cached
  const { stdout } = await run('gh', ['auth', 'token'])
  const token = stdout.trim()
  const rest = new Octokit({ auth: token })
  const { data } = await rest.users.getAuthenticated()
  cached = {
    token,
    graphql: graphql.defaults({ headers: { authorization: `token ${token}` } }),
    rest,
    login: data.login,
  }
  return cached
}

export function resetGithubClient(): void {
  cached = null
}
