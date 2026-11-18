import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { githubRemotes } from './githubRemotes'
import { git } from './testRepo.fixture'

const repo = mkdtempSync(join(tmpdir(), 'rally-github-remotes-'))

afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe('githubRemotes', () => {
  it('lists the GitHub URLs and push URLs of every remote, skipping other hosts', async () => {
    git(repo, 'init', '--initial-branch=main')
    git(repo, 'remote', 'add', 'origin', 'https://me@github.com/acme/api.git')
    git(repo, 'remote', 'add', 'gitlab', 'https://gitlab.com/acme/api.git')
    git(repo, 'remote', 'add', 'mirror', 'git@github.com:acme/mirror.git')
    git(repo, 'remote', 'set-url', '--push', 'mirror', 'ssh://git@github.com/acme/mirror-push.git')

    expect(await githubRemotes(repo)).toEqual({
      urls: ['https://me@github.com/acme/api.git', 'git@github.com:acme/mirror.git'],
      pushUrls: ['ssh://git@github.com/acme/mirror-push.git'],
    })
  })

  it('returns no remotes outside a repo', async () => {
    expect(await githubRemotes(tmpdir())).toEqual({ urls: [], pushUrls: [] })
  })
})
