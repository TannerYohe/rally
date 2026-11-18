import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const GH_CREDENTIAL_HELPER = '!gh auth git-credential'
const GH_CREDENTIALS = ['-c', 'credential.helper=', '-c', `credential.helper=${GH_CREDENTIAL_HELPER}`]
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

export const LOCAL_TIMEOUT_MS = 60_000
export const NETWORK_TIMEOUT_MS = 3 * 60_000
export const CLONE_TIMEOUT_MS = 10 * 60_000

export interface GitFailure {
  code?: number | string
  killed?: boolean
  stderr?: string
}

/** Returns the git subcommand in args, skipping `-c key=value` pairs before it. */
const subcommand = (args: string[]) => args.find((arg, index) => arg !== '-c' && args[index - 1] !== '-c') ?? ''

/** Runs git in cwd with gh's credentials and no terminal prompts, returning stdout and naming the subcommand in any failure. */
export async function git(cwd: string, args: string[], timeoutMs = LOCAL_TIMEOUT_MS, env: Record<string, string> = {}): Promise<string> {
  try {
    const { stdout } = await run('git', [...GH_CREDENTIALS, ...args], {
      cwd,
      maxBuffer: MAX_OUTPUT_BYTES,
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    })
    return stdout
  } catch (error) {
    const failure = error as GitFailure
    const reason = failure.killed ? `timed out after ${Math.round(timeoutMs / 1000)}s` : failure.stderr?.trim() || (error as Error).message
    throw Object.assign(new Error(`git ${subcommand(args)} failed: ${reason}`), { code: failure.code })
  }
}

export const trackingRefspec = (remote: string, branch: string) => `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`
