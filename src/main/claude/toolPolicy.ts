import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { realPath } from '../realPath'
import { RALLY_TOOL_PREFIX } from './rallyTools'
import { topLevelMutationFields } from './graphqlMutations'
import { parseShellWords, splitShellCommand, type Redirect } from './shellCommand'
import { GITHUB_URL_PREFIXES, githubRepoOf, NO_GITHUB_REMOTES, type GithubRemotes } from '../git/githubRemotes'

export type ToolDecision = { allow: true } | { allow: false; reason: string }

/** sandboxed limits writes to the temp directory and blocks infrastructure, remote, and system commands; open allows everything except pushes and GitHub writes. */
export type ToolAccess = 'sandboxed' | 'open'

export interface PolicyContext {
  cwd: string
  /** Absent means sandboxed. */
  access?: ToolAccess
}

interface ShellState {
  cwd: string | null
  workTrusted: boolean
}

const ALWAYS_ALLOWED_TOOLS = new Set([
  'Agent',
  'Task',
  'SubagentHandback',
  'SendMessage',
  'ListAgents',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'TaskStop',
  'TaskOutput',
  'WaitForMcpServers',
  'Read',
  'Grep',
  'Glob',
  'Skill',
  'ToolSearch',
  'TodoWrite',
  'WebSearch',
  'WebFetch',
  'LSP',
])

const FILE_EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

const READ_ONLY_MCP_VERBS = new Set([
  'get', 'list', 'search', 'read', 'fetch', 'query', 'lookup', 'describe', 'explain', 'analyze', 'analyse', 'aggregate',
  'find', 'inspect', 'view',
])

const REMOTE_SHELL_COMMANDS = new Set(['ssh', 'scp', 'sftp'])

const INFRASTRUCTURE_COMMANDS = new Set(['kubectl', 'helm', 'aws', 'gcloud', 'az', 'terraform'])

const SYSTEM_COMMANDS = new Set(['sudo', 'security', 'launchctl', 'crontab'])

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'])

const WRAPPER_COMMANDS = new Set(['env', 'timeout', 'nice', 'nohup', 'time', 'command', 'exec', 'watch', 'winpty'])

const INPUT_ARGUMENT_COMMANDS = new Set(['xargs', 'parallel'])

const XARGS_VALUE_FLAGS = new Set([
  '-I', '-J', '-L', '-n', '-P', '-s', '-E', '-d', '-a', '-R', '-S', '--replace', '--max-args', '--max-procs',
  '--max-lines', '--max-chars', '--delimiter', '--arg-file', '--eof', '-j', '--jobs',
])

const XARGS_INPUT = '$xargs_input'

const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', '('])

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/

const PLAIN_WORD = /^[\w./-]+$/

const REMOTE_PATH = /^[\w.@-]+:/

const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/

const GIT_BASH_DRIVE = /^\/([a-zA-Z])(?:\/|$)/

const GIT_BASH_TEMP = /^\/tmp(?=\/|$)/

const IS_WINDOWS = process.platform === 'win32'

const WRITABLE_DEVICES = ['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/fd/']

const READ_ONLY_GH_VERBS = new Set(['view', 'diff', 'list', 'status', 'checks', 'checkout', 'clone'])

const READ_ONLY_GIT_CONFIG_FLAGS = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l'])

const GIT_REPO_FLAGS = new Set(['-C', '--git-dir', '--work-tree'])

const GIT_VALUE_FLAGS = new Set(['-c', '--config-env', '--namespace', '--super-prefix'])

const GIT_CONFIG_FLAGS = new Set(['-c', '--config-env'])

const GITHUB_HOST = /(?:^|[/@.])github\.com(?:[/:]|$)/i

const GIT_WORKTREE_COMMANDS = new Set([
  'add', 'am', 'apply', 'checkout', 'cherry-pick', 'clean', 'commit', 'merge', 'mv', 'pull', 'rebase', 'reset', 'restore',
  'revert', 'rm', 'stash', 'switch',
])

const GH_API_VALUE_FLAGS = new Set([
  '-X', '--method', '-H', '--header', '-f', '-F', '--field', '--raw-field', '--input', '-q', '--jq', '-t', '--template',
  '-p', '--preview', '--hostname', '--cache',
])
const GH_API_FIELD_FLAGS = ['--raw-field', '--field', '-f', '-F']
const GH_API_METHOD_FLAGS = ['--method', '-X']
const GH_API_BODY_FLAGS = ['-f', '-F', '--field', '--raw-field', '--input']
const CURL_METHOD_FLAGS = ['--request', '-X']
const CURL_BODY_FLAGS = [
  '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--json', '-F', '--form', '--form-string', '-T',
  '--upload-file',
]
const WGET_METHOD_FLAGS = ['--method']
const WGET_BODY_FLAGS = ['--post-data', '--post-file', '--body-data', '--body-file']
const READ_METHODS = new Set(['GET', 'HEAD'])

const GITHUB_WRITE_REASON = 'Rally blocks GitHub writes. It posts reviews and replies itself when the user asks.'

const GIT_PUSH_REASON = 'git push is not permitted in Rally. Rally pushes once the user approves the diff.'

const GIT_CONFIG_REASON = 'Rally blocks setting git aliases, URL rewrite rules, and remote URLs, and remotes pointed at GitHub URLs its push rewrite misses.'

const GIT_CONFIG_ENV_REASON = "Rally blocks changing the GIT_CONFIG_* environment, which carries its push URL rewrite."

const GIT_CONFIG_WRITE_FLAGS = new Set([
  '--add', '--replace-all', '--unset', '--unset-all', '--rename-section', '--remove-section', '--edit', '-e',
])

const GIT_CONFIG_WRITE_SUBCOMMANDS = new Set(['set', 'unset', 'rename-section', 'remove-section', 'edit'])

const GIT_CONFIG_READ_SUBCOMMANDS = new Set(['get', 'list'])

const ENV_VALUE_FLAGS = new Set(['u', 'C', 'P'])

const ENV_VALUE_OPTIONS = ['--chdir', '--block-signal', '--default-signal', '--ignore-signal']

const GIT_CONFIG_ENV = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)(?:\+?=|$)/

const GIT_PUSH_PROGRAMS = new Set(['git-push', 'git-send-pack', 'git-receive-pack'])

const TEMP_ROOTS = [...new Set([tmpdir(), '/tmp'].map((root) => realPath(toNativePath(root))))]

const WORK_STAND_IN = join(realPath(tmpdir()), 'rally-work')

const BLOCKED_PUSH_URL = 'rally-blocked-push://'

/**
 * Returns git config entries for the environment of a turn with open access, added after any the environment already sets, that rewrite
 * every common GitHub URL form, and each GitHub URL the checkout's remotes use, to one git can't push to, whatever command runs git.
 * pushInsteadOf covers remote URLs; insteadOf covers explicit push URLs, which pushInsteadOf skips, unless the push URL prefixes a fetch URL.
 */
export function pushBlockingGitEnv(env: NodeJS.ProcessEnv, remotes: GithubRemotes = NO_GITHUB_REMOTES): Record<string, string> {
  const rules = [
    ...[...GITHUB_URL_PREFIXES, ...remotes.urls].map((url) => ['pushInsteadOf', url]),
    ...remotes.pushUrls.filter((url) => !remotes.urls.some((fetchUrl) => fetchUrl.startsWith(url))).map((url) => ['insteadOf', url]),
  ]
  const start = Number(env.GIT_CONFIG_COUNT) || 0
  const entries: Record<string, string> = { GIT_CONFIG_COUNT: String(start + rules.length) }
  rules.forEach(([rule, url], i) => {
    entries[`GIT_CONFIG_KEY_${start + i}`] = `url.${BLOCKED_PUSH_URL}.${rule}`
    entries[`GIT_CONFIG_VALUE_${start + i}`] = url
  })
  return entries
}

const deny = (reason: string): ToolDecision => ({ allow: false, reason })
const ALLOW: ToolDecision = { allow: true }

const isOpen = (context: PolicyContext) => context.access === 'open'

export function decideToolUse(toolName: string, input: Record<string, unknown>, context: PolicyContext): ToolDecision {
  if (ALWAYS_ALLOWED_TOOLS.has(toolName) || toolName.startsWith(RALLY_TOOL_PREFIX) || isReadOnlyMcpTool(toolName)) {
    return ALLOW
  }
  if (toolName === 'AskUserQuestion') {
    return deny('AskUserQuestion is unavailable in Rally. Ask the question in plain text and end your turn.')
  }
  if (toolName === 'Bash') return decideBash(String(input.command ?? ''), context)
  if (isOpen(context)) return isGithubMcpWrite(toolName) ? deny(GITHUB_WRITE_REASON) : ALLOW
  if (FILE_EDIT_TOOLS.has(toolName)) return decideFileEdit(String(input.file_path ?? input.notebook_path ?? ''), context)
  return deny(`${toolName} is not permitted in Rally review sessions.`)
}

function mcpToolWords(toolName: string): { server: string; words: string[] } | null {
  const match = toolName.match(/^mcp__(.+?)__(.+)$/)
  if (!match) return null
  const [, server, action] = match
  return { server: server.toLowerCase(), words: action.split(/[-_]|(?=[A-Z])/).map((w) => w.toLowerCase()) }
}

function isReadOnlyMcpTool(toolName: string): boolean {
  const tool = mcpToolWords(toolName)
  if (!tool) return false
  const verb = tool.server.endsWith(tool.words[0]) ? tool.words[1] : tool.words[0]
  return READ_ONLY_MCP_VERBS.has(verb)
}

/** Treats a GitHub MCP tool as a write unless any word of its name is a read verb, as in pull_request_read. */
function isGithubMcpWrite(toolName: string): boolean {
  const tool = mcpToolWords(toolName)
  return tool !== null && tool.server.includes('github') && !tool.words.some((word) => READ_ONLY_MCP_VERBS.has(word))
}

function decideFileEdit(path: string, context: PolicyContext): ToolDecision {
  if (isTempPath(path, { cwd: context.cwd, workTrusted: false })) return ALLOW
  return deny(`Rally only edits files under the temp directory, not \`${path}\`.`)
}

function decideBash(command: string, context: PolicyContext): ToolDecision {
  return decideScript(command, { cwd: context.cwd, workTrusted: !isOpen(context) && workIsTemp(command, context) }, context)
}

function decideScript(script: string, state: ShellState, context: PolicyContext): ToolDecision {
  for (const segment of splitShellCommand(script)) {
    const decision = decideSegment(segment, state, context)
    if (!decision.allow) return decision
  }
  return ALLOW
}

function workIsTemp(command: string, context: PolicyContext): boolean {
  const assignments = [...command.matchAll(/(?:^|[\s;&|(])WORK=(\S*)/g)]
  return assignments.length > 0 && assignments.every(([, raw]) => {
    const value = raw.replace(/^["']/, '')
    if (value.startsWith('$(mktemp') || value.startsWith('`mktemp')) return true
    return isTempPath(value.replace(/["';)]+$/, ''), { cwd: context.cwd, workTrusted: false })
  })
}

function decideSegment(segment: string, state: ShellState, context: PolicyContext): ToolDecision {
  const { words, redirects } = parseShellWords(segment)
  const unsafeRedirect = !isOpen(context) && redirects.find((r) => r.operator.startsWith('>') && !isWritableTarget(r, state))
  if (unsafeRedirect) {
    return deny(`Rally only redirects output into the temp directory, not \`${unsafeRedirect.target}\`.`)
  }

  let start = 0
  while (
    start < words.length &&
    (SHELL_KEYWORDS.has(words[start]) || words[start].endsWith('()') || ASSIGNMENT.test(words[start]))
  ) {
    if (isOpen(context) && GIT_CONFIG_ENV.test(words[start])) return deny(GIT_CONFIG_ENV_REASON)
    start++
  }
  if (start === words.length) return ALLOW
  return decideCommand(words.slice(start), segment, state, context)
}

function decideCommand(words: string[], segment: string, state: ShellState, context: PolicyContext): ToolDecision {
  const [word, ...args] = words
  const programPath = /[$`]/.test(word) ? expandPath(word, state) : word
  if (!programPath) return deny(`Rally needs to see which program \`${word}\` runs. Call it by name or path.`)
  const program = programName(programPath)
  if (isOpen(context)) return decideOpenCommand(program, args, segment, state, context)

  if (REMOTE_SHELL_COMMANDS.has(program)) return deny(`\`${program}\` reaches other machines, so Rally blocks it.`)
  if (INFRASTRUCTURE_COMMANDS.has(program)) return deny(`\`${program}\` acts on live infrastructure, so Rally blocks it.`)
  if (SYSTEM_COMMANDS.has(program)) return deny(`\`${program}\` changes this machine's system settings, so Rally blocks it.`)
  if (SHELLS.has(program)) return decideShell(args, state, context)
  if (WRAPPER_COMMANDS.has(program)) return decideWrapped(args, segment, state, context)
  if (INPUT_ARGUMENT_COMMANDS.has(program)) return decideXargs(args, segment, state, context)

  const operands = args.filter((a) => !a.startsWith('-'))
  switch (program) {
    case 'gh':
      return decideGh(args, state)
    case 'git':
      return decideGit(args, state)
    case 'curl':
      return decideRequest(program, args, CURL_METHOD_FLAGS, CURL_BODY_FLAGS)
    case 'wget':
      return decideRequest(program, args, WGET_METHOD_FLAGS, WGET_BODY_FLAGS)
    case 'eval':
      return decideScript(args.join(' '), { ...state }, context)
    case 'cd':
    case 'pushd':
      state.cwd = operands.length ? expandPath(operands[0], state) : homedir()
      return ALLOW
    case 'rm':
    case 'rmdir':
    case 'mv':
    case 'tee':
    case 'touch':
    case 'truncate':
    case 'unlink':
      return requireTemp(program, operands, state)
    case 'cp':
    case 'ln':
    case 'install':
    case 'rsync':
      return requireTemp(program, operands.slice(-1), state)
    case 'chmod':
    case 'chown':
    case 'chgrp':
      return requireTemp(program, operands.slice(1), state)
    case 'dd':
      return requireTemp(program, args.filter((a) => a.startsWith('of=')).map((a) => a.slice(3)), state)
    case 'sed':
      return decideSed(args, state)
    case 'find':
      return decideFind(args, segment, state, context)
    default:
      return ALLOW
  }
}

/** Under open access, checks only commands that could push or write to GitHub, following them into nested shells and wrappers. */
function decideOpenCommand(program: string, args: string[], segment: string, state: ShellState, context: PolicyContext): ToolDecision {
  if (GIT_PUSH_PROGRAMS.has(program)) return deny(GIT_PUSH_REASON)
  if (touchesGitConfigEnv(program, args)) return deny(GIT_CONFIG_ENV_REASON)
  if (SHELLS.has(program)) return decideShell(args, state, context)
  if (WRAPPER_COMMANDS.has(program)) return decideWrapped(args, segment, state, context)
  if (INPUT_ARGUMENT_COMMANDS.has(program)) return decideXargs(args, segment, state, context)
  switch (program) {
    case 'gh':
      return decideGhWrite(args)
    case 'git':
      return decideOpenGit(args, state)
    case 'curl':
      return decideOpenRequest(args, CURL_METHOD_FLAGS, CURL_BODY_FLAGS)
    case 'wget':
      return decideOpenRequest(args, WGET_METHOD_FLAGS, WGET_BODY_FLAGS)
    case 'eval':
      return decideScript(args.join(' '), { ...state }, context)
    case 'find':
      return decideFind(args, segment, state, context)
    default:
      return ALLOW
  }
}

function requireTemp(program: string, paths: string[], state: ShellState): ToolDecision {
  const outside = paths.find((p) => !isTempPath(p, state))
  return outside === undefined ? ALLOW : deny(`Rally only lets \`${program}\` write under the temp directory, not \`${outside}\`.`)
}

function decideShell(args: string[], state: ShellState, context: PolicyContext): ToolDecision {
  const flagIndex = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a))
  return flagIndex < 0 ? ALLOW : decideScript(args[flagIndex + 1] ?? '', { ...state }, context)
}

function decideWrapped(args: string[], segment: string, state: ShellState, context: PolicyContext): ToolDecision {
  for (let i = 0; i < args.length; i++) {
    if (!PLAIN_WORD.test(args[i])) continue
    const decision = decideCommand(args.slice(i), segment, { ...state }, context)
    if (!decision.allow) return decision
  }
  return ALLOW
}

function decideXargs(args: string[], segment: string, state: ShellState, context: PolicyContext): ToolDecision {
  let index = 0
  let placeholder: string | null = null
  while (index < args.length && args[index].startsWith('-')) {
    const flag = args[index]
    if (flag === '-I' || flag === '--replace') placeholder = args[index + 1] ?? null
    else if (/^-I./.test(flag)) placeholder = flag.slice(2)
    index += XARGS_VALUE_FLAGS.has(flag) ? 2 : 1
  }
  const command = args.slice(index)
  if (command.length === 0) return ALLOW
  const withInput = placeholder ? command.map((w) => w.replaceAll(placeholder, XARGS_INPUT)) : [...command, XARGS_INPUT]
  return decideCommand(withInput, segment, { ...state }, context)
}

function decideSed(args: string[], state: ShellState): ToolDecision {
  if (!args.some((a) => ['-i', '-I', '--in-place'].some((flag) => matchesFlag(a, flag)))) return ALLOW
  const operands: string[] = []
  let scriptGiven = false
  for (let i = 0; i < args.length; i++) {
    if (['-e', '-f', '--expression', '--file'].includes(args[i])) {
      scriptGiven = true
      i++
    } else if (/^(?:-[ef].|--expression=|--file=)/.test(args[i])) {
      scriptGiven = true
    } else if (args[i] && !args[i].startsWith('-')) {
      operands.push(args[i])
    }
  }
  return requireTemp('sed -i', scriptGiven ? operands : operands.slice(1), state)
}

function decideFind(args: string[], segment: string, state: ShellState, context: PolicyContext): ToolDecision {
  const firstExpression = args.findIndex((a) => a.startsWith('-') || a === '(' || a === '!')
  const roots = args.slice(0, firstExpression < 0 ? args.length : firstExpression)
  const searchRoots = roots.length ? roots : ['.']
  if (args.includes('-delete') && !isOpen(context)) {
    const decision = requireTemp('find -delete', searchRoots, state)
    if (!decision.allow) return decision
  }
  for (let i = 0; i < args.length; i++) {
    if (!['-exec', '-execdir', '-ok', '-okdir'].includes(args[i])) continue
    const end = args.findIndex((a, j) => j > i && (a === ';' || a === '+'))
    const command = args.slice(i + 1, end < 0 ? args.length : end)
    for (const root of searchRoots) {
      const decision = decideCommand(
        command.map((w) => w.replaceAll('{}', `${root}/match`)),
        segment,
        { ...state },
        context,
      )
      if (!decision.allow) return decision
    }
  }
  return ALLOW
}

function matchesFlag(arg: string, flag: string): boolean {
  return arg === flag || arg.startsWith(`${flag}=`) || (!flag.startsWith('--') && arg.startsWith(flag))
}

function requestMethod(args: string[], methodFlags: string[], bodyFlags: string[]): string {
  let method: string | null = null
  for (let i = 0; i < args.length; i++) {
    const flag = methodFlags.find((f) => matchesFlag(args[i], f))
    if (!flag) continue
    const inline = args[i].slice(flag.length).replace(/^=/, '')
    method = (inline || args[++i] || '').toUpperCase()
  }
  if (method !== null) return method
  return args.some((a) => bodyFlags.some((flag) => matchesFlag(a, flag))) ? 'POST' : 'GET'
}

function decideRequest(program: string, args: string[], methodFlags: string[], bodyFlags: string[]): ToolDecision {
  const method = requestMethod(args, methodFlags, bodyFlags)
  return READ_METHODS.has(method) ? ALLOW : deny(`Rally only allows \`${program}\` reads, not \`${method}\` requests.`)
}

function isWritableTarget(redirect: Redirect, state: ShellState): boolean {
  if (redirect.operator.endsWith('&') && /^(?:\d+|-)$/.test(redirect.target)) return true
  return WRITABLE_DEVICES.some((device) => redirect.target.startsWith(device)) || isTempPath(redirect.target, state)
}

function expandPath(word: string, state: ShellState): string | null {
  if (/^\$(?:\{WORK\}|WORK\b)/.test(word) && !state.workTrusted) return null
  if (/^~(?!\/|$)/.test(word)) return null
  const expanded = toNativePath(
    word
      .replace(/^\$(?:\{WORK\}|WORK\b)/, WORK_STAND_IN)
      .replace(/^\$(?:\{TMPDIR(?::?-[^}]*)?\}|TMPDIR\b)/, tmpdir())
      .replace(/^(?:~|\$\{HOME\}|\$HOME\b)(?=\/|$)/, homedir()),
  )
  if (!expanded || /[$`]/.test(expanded) || isRemotePath(expanded)) return null
  if (isAbsolute(expanded)) return resolve(expanded)
  return state.cwd ? resolve(state.cwd, expanded) : null
}

// Returns the lowercased program name without a .exe, .cmd, .bat, or .com extension.
function programName(programPath: string): string {
  return basename(programPath).toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/, '')
}

// Maps Git Bash paths such as /tmp and /c/Users to Windows paths; other platforms keep the path unchanged.
function toNativePath(path: string): string {
  if (!IS_WINDOWS) return path
  return path.replace(GIT_BASH_TEMP, tmpdir()).replace(GIT_BASH_DRIVE, (_, drive: string) => `${drive}:/`)
}

function isRemotePath(path: string): boolean {
  return REMOTE_PATH.test(path) && !(IS_WINDOWS && WINDOWS_DRIVE_PATH.test(path))
}


function isTempPath(word: string, state: ShellState): boolean {
  const path = expandPath(word, state)
  if (!path) return false
  const real = realPath(path)
  return TEMP_ROOTS.some((root) => real.startsWith(root + sep))
}

interface GitInvocation {
  repoDir: string | null
  /** The values of `-c` and `--config-env` flags before the subcommand. */
  configs: string[]
  subcommand: string
  rest: string[]
}

/** Splits git's arguments into the repo it runs in, the subcommand, and the subcommand's arguments. */
function parseGit(args: string[], state: ShellState): GitInvocation {
  let repoDir = state.cwd
  const configs: string[] = []
  let index = 0
  while (index < args.length && args[index].startsWith('-')) {
    const [flag, inline] = args[index].split(/=(.*)/s)
    const value = inline ?? args[index + 1] ?? ''
    if (GIT_REPO_FLAGS.has(flag)) repoDir = expandPath(value, { ...state, cwd: repoDir })
    if (GIT_CONFIG_FLAGS.has(flag)) configs.push(value)
    index += inline === undefined && (GIT_REPO_FLAGS.has(flag) || GIT_VALUE_FLAGS.has(flag)) ? 2 : 1
  }
  const [subcommand = '', ...rest] = args.slice(index)
  return { repoDir, configs, subcommand, rest }
}

function decideGit(args: string[], state: ShellState): ToolDecision {
  const { repoDir, subcommand, rest } = parseGit(args, state)
  if (subcommand === 'push') return deny(GIT_PUSH_REASON)
  if (subcommand === 'config' && rest.some((a) => a === '--global' || a === '--system')) {
    if (!rest.some((a) => READ_ONLY_GIT_CONFIG_FLAGS.has(a))) return deny('Rally does not change your global git config.')
  }
  if (GIT_WORKTREE_COMMANDS.has(subcommand) && !(repoDir && isTempPath(repoDir, state))) {
    return deny(`Rally only runs \`git ${subcommand}\` in repos under the temp directory.`)
  }
  return ALLOW
}

/**
 * Under open access, blocks git push and send-pack, and git config that could push under another name or around Rally's push URL rewrite:
 * setting aliases, URL rewrite rules, remote URLs, or push URLs, and pointing a remote at a GitHub URL the rewrite doesn't cover.
 */
function decideOpenGit(args: string[], state: ShellState): ToolDecision {
  const { configs, subcommand, rest } = parseGit(args, state)
  if (subcommand === 'push' || subcommand === 'send-pack') return deny(GIT_PUSH_REASON)
  const setsGuardedKey = subcommand === 'config' && rest.some(isGuardedGitKey) && isGitConfigWrite(rest)
  const operands = rest.filter((a) => !a.startsWith('-'))
  const remoteUrlChange = subcommand === 'remote' && ['add', 'set-url'].includes(operands[0])
  const pointsRemoteAtUncoveredUrl = remoteUrlChange && (rest.includes('--push') || operands.slice(1).some(isUncoveredGithubUrl))
  if (configs.some(isGuardedGitKey) || setsGuardedKey || pointsRemoteAtUncoveredUrl) return deny(GIT_CONFIG_REASON)
  return ALLOW
}

const isGuardedGitKey = (word: string) => /^(?:alias\.|url\.|remote\..+\.(?:push)?url(?:=|$))/i.test(word)

const isUncoveredGithubUrl = (url: string) => githubRepoOf(url) !== null && !GITHUB_URL_PREFIXES.some((prefix) => url.startsWith(prefix))

/** Returns whether `git config` arguments change a value rather than read one: a write flag or subcommand, or a key followed by a value. */
function isGitConfigWrite(args: string[]): boolean {
  if (args.some((a) => READ_ONLY_GIT_CONFIG_FLAGS.has(a))) return false
  if (args.some((a) => GIT_CONFIG_WRITE_FLAGS.has(a.split('=')[0]))) return true
  const operands = args.filter((a) => !a.startsWith('-'))
  if (GIT_CONFIG_WRITE_SUBCOMMANDS.has(operands[0])) return true
  if (GIT_CONFIG_READ_SUBCOMMANDS.has(operands[0])) return false
  return operands.length >= 2
}

/** Under open access, blocks commands that set, clear, or drop the git config environment carrying Rally's push URL rewrite. */
function touchesGitConfigEnv(program: string, args: string[]): boolean {
  switch (program) {
    case 'unset':
    case 'export':
    case 'declare':
    case 'typeset':
    case 'local':
    case 'readonly':
      return args.some((a) => GIT_CONFIG_ENV.test(a))
    case 'env':
      return envClearsGitConfig(args)
    case 'exec':
      return execClearsEnvironment(args)
    default:
      return false
  }
}

/** Reads env's own options and assignments, up to the program it runs, for any that clear the environment or a GIT_CONFIG_* variable. */
function envClearsGitConfig(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (ASSIGNMENT.test(arg)) {
      if (GIT_CONFIG_ENV.test(arg)) return true
      continue
    }
    if (arg === '-') return true
    if (!arg.startsWith('-')) return false
    if (arg.startsWith('--')) {
      const [name, inline] = arg.split(/=(.*)/s)
      const isLong = (option: string, shortest: number) => name.length >= shortest && option.startsWith(name)
      if (isLong('--ignore-environment', 3) || isLong('--split-string', 3)) return true
      if (isLong('--unset', 3)) {
        if (GIT_CONFIG_ENV.test(inline ?? args[++i] ?? '')) return true
      } else if (inline === undefined && ENV_VALUE_OPTIONS.some((option) => isLong(option, 4))) {
        i++
      }
      continue
    }
    for (let j = 1; j < arg.length; j++) {
      if (arg[j] === 'i' || arg[j] === 'S') return true
      if (!ENV_VALUE_FLAGS.has(arg[j])) continue
      const value = arg.slice(j + 1) || args[++i] || ''
      if (arg[j] === 'u' && GIT_CONFIG_ENV.test(value)) return true
      break
    }
  }
  return false
}

/** Reads exec's own options, up to the program it runs, for -c, which clears the environment. */
function execClearsEnvironment(args: string[]): boolean {
  for (let i = 0; i < args.length && args[i].startsWith('-'); i++) {
    if (args[i].includes('c')) return true
    if (args[i].endsWith('a')) i++
  }
  return false
}

/** Under open access, blocks curl and wget requests to GitHub other than reads. */
function decideOpenRequest(args: string[], methodFlags: string[], bodyFlags: string[]): ToolDecision {
  if (!args.some((a) => GITHUB_HOST.test(a))) return ALLOW
  return READ_METHODS.has(requestMethod(args, methodFlags, bodyFlags)) ? ALLOW : deny(GITHUB_WRITE_REASON)
}

function decideGh(args: string[], state: ShellState): ToolDecision {
  if (args[1] === 'checkout' && !(state.cwd && isTempPath(state.cwd, state))) {
    return deny('Rally only runs `gh pr checkout` in repos under the temp directory.')
  }
  return decideGhWrite(args)
}

/** Blocks gh commands that write to GitHub. */
function decideGhWrite(args: string[]): ToolDecision {
  if (args[0] === 'api') return decideGhApi(args.slice(1))
  if (args[0] === 'search' || READ_ONLY_GH_VERBS.has(args[1])) return ALLOW
  return deny(`\`gh ${args.slice(0, 2).join(' ')}\` is not permitted in Rally.`)
}

function ghApiEndpoint(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    if (GH_API_VALUE_FLAGS.has(args[i])) i++
    else if (!args[i].startsWith('-')) return args[i]
  }
  return ''
}

function graphqlQueries(args: string[]): string[] {
  const queries: string[] = []
  for (let i = 0; i < args.length; i++) {
    const flag = GH_API_FIELD_FLAGS.find((f) => matchesFlag(args[i], f))
    if (!flag) continue
    const field = args[i] === flag ? (args[++i] ?? '') : args[i].slice(flag.length).replace(/^=/, '')
    const [name, ...value] = field.split('=')
    if (name === 'query') queries.push(value.join('='))
  }
  return queries
}

function isInlineGraphql(query: string): boolean {
  return !query.startsWith('@') && query.includes('{')
}

function mutationFields(queries: string[]): string[] | null {
  const fields = queries.map(topLevelMutationFields)
  return fields.some((f) => f === null) ? null : (fields.flat() as string[])
}

function decideGhApi(args: string[]): ToolDecision {
  const endpoint = ghApiEndpoint(args)
  if (endpoint === 'graphql') {
    if (args.some((a) => matchesFlag(a, '--input')) || !graphqlQueries(args).every(isInlineGraphql)) {
      return deny("Rally only inspects inline graphql queries. Pass the query text with `-f query='...'`.")
    }
    const fields = mutationFields(graphqlQueries(args))
    if (fields === null) return deny('Rally could not parse this graphql query, so it is blocked.')
    return fields.length === 0 ? ALLOW : deny(GITHUB_WRITE_REASON)
  }

  const method = requestMethod(args, GH_API_METHOD_FLAGS, GH_API_BODY_FLAGS)
  return method === 'GET' ? ALLOW : deny(GITHUB_WRITE_REASON)
}
