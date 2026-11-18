import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TEST_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
}

/** Runs git with the test identity, no hooks, and no signing, returning stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, env: TEST_GIT_ENV, stdio: 'pipe' }).toString()
}

/** Gives git commands the code under test runs the same identity as the test's own. */
export function useTestGitIdentity(): void {
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const) process.env[key] = TEST_GIT_ENV[key]
}

export function commitFile(cwd: string, name: string, content: string): void {
  writeFileSync(join(cwd, name), content)
  git(cwd, 'add', name)
  git(cwd, 'commit', '-m', `change ${name}`)
}

/** Creates a bare remote and a seed repo whose main branch, holding a.txt, is pushed to it. */
export function seedRemote(root: string, remote: string, seed: string): void {
  git(root, 'init', '--bare', '--initial-branch=main', remote)
  git(root, 'init', '--initial-branch=main', seed)
  commitFile(seed, 'a.txt', 'one\n')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', 'origin', 'main')
}
