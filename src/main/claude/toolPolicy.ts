import { existsSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { RALLY_TOOL_PREFIX } from './rallyTools'
import { topLevelMutationFields } from './graphqlMutations'
import { hasShellExpansion, parseShellWords, splitShellCommand, type Redirect } from './shellCommand'

export type ToolDecision = { allow: true } | { allow: false; reason: string }

export interface PolicyContext {
  submitting: boolean
  cwd: string
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

const SUBMIT_REST_PATHS = [
  /^\/?repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/,
  /^\/?repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews\/\d+\/events$/,
  /^\/?repos\/[^/]+\/[^/]+\/pulls\/\d+\/comments\/\d+\/replies$/,
]

const SUBMIT_GRAPHQL_MUTATIONS = [
  'addPullRequestReview',
  'addPullRequestReviewThread',
  'addPullRequestReviewThreadReply',
  'addPullRequestReviewComment',
  'submitPullRequestReview',
]

const TEMP_ROOTS = [...new Set([tmpdir(), '/tmp'].map((root) => realPath(toNativePath(root))))]

const WORK_STAND_IN = join(realPath(tmpdir()), 'rally-work')

const deny = (reason: string): ToolDecision => ({ allow: false, reason })
const ALLOW: ToolDecision = { allow: true }

export function decideToolUse(toolName: string, input: Record<string, unknown>, context: PolicyContext): ToolDecision {
  if (ALWAYS_ALLOWED_TOOLS.has(toolName) || toolName.startsWith(RALLY_TOOL_PREFIX) || isReadOnlyMcpTool(toolName)) {
    return ALLOW
  }
  if (toolName === 'AskUserQuestion') {
    return deny('AskUserQuestion is unavailable in Rally. Ask the question in plain text and end your turn.')
  }
  if (FILE_EDIT_TOOLS.has(toolName)) return decideFileEdit(String(input.file_path ?? input.notebook_path ?? ''), context)
  if (toolName === 'Bash') return decideBash(String(input.command ?? ''), context)
  return deny(`${toolName} is not permitted in Rally review sessions.`)
}

function isReadOnlyMcpTool(toolName: string): boolean {
  const match = toolName.match(/^mcp__(.+?)__(.+)$/)
  if (!match) return false
  const [, server, action] = match
  const words = action.split(/[-_]|(?=[A-Z])/).map((w) => w.toLowerCase())
  const verb = server.toLowerCase().endsWith(words[0]) ? words[1] : words[0]
  return READ_ONLY_MCP_VERBS.has(verb)
}

function decideFileEdit(path: string, context: PolicyContext): ToolDecision {
  if (isTempPath(path, { cwd: context.cwd, workTrusted: false })) return ALLOW
  return deny(`Rally only edits files under the temp directory, not \`${path}\`.`)
}

function decideBash(command: string, context: PolicyContext): ToolDecision {
  return decideScript(command, { cwd: context.cwd, workTrusted: workIsTemp(command, context) }, context)
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
  const unsafeRedirect = redirects.find((r) => r.operator.startsWith('>') && !isWritableTarget(r, state))
  if (unsafeRedirect) {
    return deny(`Rally only redirects output into the temp directory, not \`${unsafeRedirect.target}\`.`)
  }

  let start = 0
  while (
    start < words.length &&
    (SHELL_KEYWORDS.has(words[start]) || words[start].endsWith('()') || ASSIGNMENT.test(words[start]))
  ) {
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

  if (REMOTE_SHELL_COMMANDS.has(program)) return deny(`\`${program}\` reaches other machines, so Rally blocks it.`)
  if (INFRASTRUCTURE_COMMANDS.has(program)) return deny(`\`${program}\` acts on live infrastructure, so Rally blocks it.`)
  if (SYSTEM_COMMANDS.has(program)) return deny(`\`${program}\` changes this machine's system settings, so Rally blocks it.`)
  if (SHELLS.has(program)) return decideShell(args, state, context)
  if (WRAPPER_COMMANDS.has(program)) return decideWrapped(args, segment, state, context)
  if (INPUT_ARGUMENT_COMMANDS.has(program)) return decideXargs(args, segment, state, context)

  const operands = args.filter((a) => !a.startsWith('-'))
  switch (program) {
    case 'gh':
      return decideGh(args, segment, state, context)
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
  if (args.includes('-delete')) {
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

function realPath(path: string): string {
  if (existsSync(path)) return realpathSync.native(path)
  const parent = dirname(path)
  return parent === path ? path : join(realPath(parent), basename(path))
}

function isTempPath(word: string, state: ShellState): boolean {
  const path = expandPath(word, state)
  if (!path) return false
  const real = realPath(path)
  return TEMP_ROOTS.some((root) => real.startsWith(root + sep))
}

function decideGit(args: string[], state: ShellState): ToolDecision {
  let repoDir = state.cwd
  let index = 0
  while (index < args.length && args[index].startsWith('-')) {
    const [flag, inline] = args[index].split(/=(.*)/s)
    if (GIT_REPO_FLAGS.has(flag)) {
      repoDir = expandPath(inline ?? args[index + 1] ?? '', { ...state, cwd: repoDir })
    }
    index += inline === undefined && (GIT_REPO_FLAGS.has(flag) || GIT_VALUE_FLAGS.has(flag)) ? 2 : 1
  }
  const [subcommand, ...rest] = args.slice(index)
  if (subcommand === 'push') return deny('git push is not permitted in Rally.')
  if (subcommand === 'config' && rest.some((a) => a === '--global' || a === '--system')) {
    if (!rest.some((a) => READ_ONLY_GIT_CONFIG_FLAGS.has(a))) return deny('Rally does not change your global git config.')
  }
  if (GIT_WORKTREE_COMMANDS.has(subcommand) && !(repoDir && isTempPath(repoDir, state))) {
    return deny(`Rally only runs \`git ${subcommand}\` in repos under the temp directory.`)
  }
  return ALLOW
}

function decideGh(args: string[], segment: string, state: ShellState, context: PolicyContext): ToolDecision {
  if (args[0] === 'api') return decideGhApi(args.slice(1), segment, context)
  if (args[1] === 'checkout' && !(state.cwd && isTempPath(state.cwd, state))) {
    return deny('Rally only runs `gh pr checkout` in repos under the temp directory.')
  }
  if (args[0] === 'search' || READ_ONLY_GH_VERBS.has(args[1])) return ALLOW
  return deny(`\`gh ${args.slice(0, 2).join(' ')}\` is not permitted in Rally. Use \`gh api\` for review posting.`)
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

function decideGhApi(args: string[], segment: string, context: PolicyContext): ToolDecision {
  const endpoint = ghApiEndpoint(args)
  if (endpoint === 'graphql') {
    if (args.some((a) => matchesFlag(a, '--input')) || !graphqlQueries(args).every(isInlineGraphql)) {
      return deny("Rally only inspects inline graphql queries. Pass the query text with `-f query='...'`.")
    }
    if (hasShellExpansion(segment)) {
      return deny('Rally only inspects literal graphql commands. Inline every value instead of using shell variables or substitutions.')
    }
    const fields = mutationFields(graphqlQueries(args))
    if (fields === null) return deny('Rally could not parse this graphql query, so it is blocked.')
    if (fields.length === 0) return ALLOW
    if (!context.submitting) return deny('GitHub mutations are blocked until the user submits the review from Rally.')
    if (fields.every((field) => SUBMIT_GRAPHQL_MUTATIONS.includes(field))) return ALLOW
    return deny(
      `In the submit turn Rally only permits these graphql mutations: ${SUBMIT_GRAPHQL_MUTATIONS.join(', ')}. Rally resolves review threads itself.`,
    )
  }

  const method = requestMethod(args, GH_API_METHOD_FLAGS, GH_API_BODY_FLAGS)
  if (method === 'GET') return ALLOW
  if (context.submitting && method === 'POST' && SUBMIT_REST_PATHS.some((p) => p.test(endpoint))) return ALLOW
  return deny(
    context.submitting
      ? `Rally only permits posting reviews, review events, and thread replies; \`${method} ${endpoint}\` is blocked.`
      : 'GitHub writes are blocked until the user submits the review from Rally.',
  )
}
