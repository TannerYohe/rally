import { tmpdir } from 'node:os'
import { parseShellWords, splitShellCommand, type Redirect } from './shellCommand'

export type ToolDecision = { allow: true } | { allow: false; reason: string }

export interface PolicyContext {
  submitting: boolean
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
  'LSP',
])

const READ_ONLY_MCP_VERBS = new Set([
  'get', 'list', 'search', 'read', 'fetch', 'query', 'lookup', 'describe', 'explain', 'analyze', 'analyse', 'aggregate',
  'find', 'inspect', 'view',
])

const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'socat', 'telnet', 'ftp', 'ssh', 'scp', 'sftp', 'rsync', 'dig', 'nslookup',
  'host', 'ping', 'traceroute', 'open',
])

const CODE_RUNNERS = new Set([
  'python', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'lua', 'osascript', 'bash', 'sh', 'zsh', 'fish',
  'dash', 'ksh', 'npm', 'npx', 'yarn', 'pnpm', 'bundle', 'bundler', 'rake', 'rails', 'rspec', 'pytest', 'tox', 'pip',
  'pip3', 'pipx', 'uv', 'poetry', 'make', 'go', 'cargo', 'gradle', 'mvn', 'docker', 'sudo', 'env', 'nohup', 'timeout',
  'nice', 'time', 'command', 'builtin', 'exec', 'eval', 'source', '.', 'xargs', 'parallel', 'watch', 'trap', 'alias',
  'function', 'case', 'script', 'expect', 'screen', 'tmux', 'vi', 'vim', 'nvim', 'nano', 'emacs', 'less', 'more', 'man',
])

const INFRASTRUCTURE_COMMANDS = new Set([
  'kubectl', 'helm', 'aws', 'gcloud', 'az', 'terraform', 'security', 'launchctl', 'crontab',
])

const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', '('])

const DECLARATION_COMMANDS = new Set(['export', 'declare', 'typeset', 'readonly', 'local'])

const PATH_OPERAND_COMMANDS = new Set(['rm', 'mv', 'tee', 'touch', 'truncate'])

const DESTINATION_OPERAND_COMMANDS = new Set(['cp', 'ln', 'install'])

const MODE_OPERAND_COMMANDS = new Set(['chmod', 'chown', 'chgrp'])

const COMMAND_RUNNING_FLAGS = new Map([
  ['find', ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprintf', '-fls']],
  ['rg', ['--pre']],
  ['sort', ['--compress-program']],
  ['split', ['--filter']],
  ['tar', ['--to-command', '--use-compress-program', '--checkpoint-action', '--info-script', '--new-volume-script', '-I', '-F']],
  ['zip', ['-TT', '--unzip-command']],
  ['sed', ['-i', '-I', '--in-place']],
])

const AWK_COMMANDS = new Set(['awk', 'gawk', 'mawk', 'nawk'])

const EXECUTING_ENV_VAR = /^(PATH|BASH_ENV|ENV|IFS|PROMPT_COMMAND|SHELLOPTS|PAGER|EDITOR|VISUAL|BROWSER|NODE_OPTIONS|LESSOPEN|LESSCLOSE|(LD|DYLD|GIT)_\w*|\w*_(PAGER|EDITOR))$/

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/

const PLAIN_PROGRAM = /^(?:[A-Za-z0-9_][A-Za-z0-9_.+-]*|\.|\[\[?)$/

const WRITABLE_DEVICES = ['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/fd/']

const READ_ONLY_GH_VERBS = new Set(['view', 'diff', 'list', 'status', 'checks', 'checkout', 'clone'])

const READ_ONLY_GIT_CONFIG_FLAGS = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l'])

const GIT_COMMAND_RUNNING_FLAGS = ['--upload-pack', '--receive-pack', '--exec', '--extcmd', '--open-files-in-pager']

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
  'resolveReviewThread',
]

const TEMP_ROOTS = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']

const deny = (reason: string): ToolDecision => ({ allow: false, reason })
const ALLOW: ToolDecision = { allow: true }

export function decideToolUse(toolName: string, input: Record<string, unknown>, context: PolicyContext): ToolDecision {
  if (ALWAYS_ALLOWED_TOOLS.has(toolName) || toolName.startsWith('mcp__rally__') || isReadOnlyMcpTool(toolName)) {
    return ALLOW
  }
  if (toolName === 'AskUserQuestion') {
    return deny('AskUserQuestion is unavailable in Rally. Ask the question in plain text and end your turn.')
  }
  if (toolName === 'Write') return decideWrite(String(input.file_path ?? ''))
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

function decideWrite(path: string): ToolDecision {
  if (TEMP_ROOTS.some((root) => path.startsWith(root))) return ALLOW
  return deny('Rally only allows writing files under the temp directory.')
}

function decideBash(command: string, context: PolicyContext): ToolDecision {
  for (const segment of splitShellCommand(command)) {
    const decision = decideSegment(segment, context)
    if (!decision.allow) return decision
  }
  return ALLOW
}

function decideSegment(segment: string, context: PolicyContext): ToolDecision {
  const { words, redirects } = parseShellWords(segment)
  const unsafeRedirect = redirects.find((r) => r.operator.startsWith('>') && !isWritableTarget(r))
  if (unsafeRedirect) return deny(`Rally only allows redirecting output to temp paths, not \`${unsafeRedirect.target}\`.`)
  if (words.some((w) => w.endsWith('()'))) return deny('Shell function definitions are not permitted in Rally.')

  let start = 0
  while (start < words.length && SHELL_KEYWORDS.has(words[start])) start++
  for (; start < words.length && ASSIGNMENT.test(words[start]); start++) {
    const decision = decideAssignment(words[start])
    if (!decision.allow) return decision
  }
  if (start === words.length) return ALLOW

  const [program, ...args] = words.slice(start)
  if (!PLAIN_PROGRAM.test(program)) {
    return deny(`Rally only runs commands by plain name, not \`${program}\`.`)
  }
  if (NETWORK_COMMANDS.has(program)) return deny(`\`${program}\` can send data off this machine, so Rally blocks it.`)
  if (CODE_RUNNERS.has(program)) return deny(`\`${program}\` can run arbitrary code, so Rally blocks it.`)
  if (INFRASTRUCTURE_COMMANDS.has(program)) return deny(`\`${program}\` acts on live systems, so Rally blocks it.`)

  const operands = args.filter((a) => !a.startsWith('-'))
  if (PATH_OPERAND_COMMANDS.has(program) && !operands.every(isTempPath)) {
    return deny(`Rally only allows \`${program}\` on temp paths.`)
  }
  if (DESTINATION_OPERAND_COMMANDS.has(program) && !isTempPath(operands.at(-1) ?? '')) {
    return deny(`Rally only allows \`${program}\` into temp paths.`)
  }
  if (MODE_OPERAND_COMMANDS.has(program) && !operands.slice(1).every(isTempPath)) {
    return deny(`Rally only allows \`${program}\` on temp paths.`)
  }
  const runningFlag = args.find((a) => (COMMAND_RUNNING_FLAGS.get(program) ?? []).some((flag) => matchesFlag(a, flag)))
  if (runningFlag) return deny(`\`${program} ${runningFlag}\` is not permitted in Rally.`)

  switch (program) {
    case 'gh':
      return decideGh(args, segment, context)
    case 'git':
      return decideGit(args)
    case 'dd':
      return args.filter((a) => a.startsWith('of=')).every((a) => isTempPath(a.slice(3)))
        ? ALLOW
        : deny('Rally only allows `dd` into temp paths.')
    default:
      if (AWK_COMMANDS.has(program)) return decideAwk(args)
      if (DECLARATION_COMMANDS.has(program)) return decideDeclaration(args)
      return ALLOW
  }
}

function decideAssignment(word: string): ToolDecision {
  const name = (word.match(ASSIGNMENT) as RegExpMatchArray)[1]
  return EXECUTING_ENV_VAR.test(name) ? deny(`Setting \`${name}\` is not permitted in Rally.`) : ALLOW
}

function decideDeclaration(args: string[]): ToolDecision {
  for (const arg of args.filter((a) => ASSIGNMENT.test(a))) {
    const decision = decideAssignment(arg)
    if (!decision.allow) return decision
  }
  return ALLOW
}

function decideAwk(args: string[]): ToolDecision {
  if (args.includes('-f')) return deny('Rally does not run awk programs from files.')
  const runsCommands = args.some((a) => /\bsystem\s*\(|\bgetline\b|(?<!\|)\|(?!\|)\s*\S/.test(a))
  return runsCommands ? deny('awk programs that run commands are not permitted in Rally.') : ALLOW
}

function matchesFlag(arg: string, flag: string): boolean {
  return arg === flag || arg.startsWith(`${flag}=`) || (!flag.startsWith('--') && arg.startsWith(flag))
}

function isWritableTarget(redirect: Redirect): boolean {
  if (redirect.operator.endsWith('&') && /^(?:\d+|-)$/.test(redirect.target)) return true
  return isTempPath(redirect.target) || WRITABLE_DEVICES.some((device) => redirect.target.startsWith(device))
}

function isTempPath(path: string): boolean {
  return path.startsWith('$WORK') || path.startsWith('${WORK}') || TEMP_ROOTS.some((root) => path.startsWith(root))
}

function isForeignRemote(arg: string): boolean {
  if (/^\w+::/.test(arg)) return true
  const host = arg.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)/i)?.[1] ?? arg.match(/^[\w.-]+@([\w.-]+):/)?.[1]
  return host !== undefined && host.toLowerCase() !== 'github.com'
}

function decideGit(args: string[]): ToolDecision {
  let index = 0
  while (index < args.length && args[index].startsWith('-')) {
    if (args[index].startsWith('-c') || args[index].startsWith('--config-env')) {
      return deny('`git -c` is not permitted in Rally.')
    }
    index += args[index] === '-C' ? 2 : 1
  }
  const [subcommand, ...rest] = args.slice(index)
  const runningFlag = rest.find((a) => GIT_COMMAND_RUNNING_FLAGS.some((flag) => matchesFlag(a, flag)))
  if (runningFlag) return deny(`\`git ${subcommand} ${runningFlag}\` is not permitted in Rally.`)
  if (rest.some(isForeignRemote)) return deny('Rally only allows git remotes on github.com.')

  switch (subcommand) {
    case 'push':
      return deny('git push is not permitted in Rally.')
    case 'config':
      return rest.some((a) => READ_ONLY_GIT_CONFIG_FLAGS.has(a)) ? ALLOW : deny('Rally only allows reading git config.')
    case 'difftool':
    case 'mergetool':
    case 'filter-branch':
      return deny(`\`git ${subcommand}\` is not permitted in Rally.`)
    case 'bisect':
      return rest[0] === 'run' ? deny('`git bisect run` is not permitted in Rally.') : ALLOW
    case 'submodule':
      return rest.includes('foreach') ? deny('`git submodule foreach` is not permitted in Rally.') : ALLOW
    case 'rebase':
      return rest.includes('-x') ? deny('`git rebase -x` is not permitted in Rally.') : ALLOW
    case 'grep':
      return rest.some((a) => a.startsWith('-O')) ? deny('`git grep -O` is not permitted in Rally.') : ALLOW
    case 'clone':
      return rest.includes('-u') ? deny('`git clone -u` is not permitted in Rally.') : ALLOW
    default:
      return ALLOW
  }
}

function decideGh(args: string[], segment: string, context: PolicyContext): ToolDecision {
  if (args[0] === 'api') return decideGhApi(args.slice(1), segment, context)
  if (args[0] === 'search' || READ_ONLY_GH_VERBS.has(args[1])) return ALLOW
  return deny(`\`gh ${args.slice(0, 2).join(' ')}\` is not permitted in Rally. Use \`gh api\` for review posting.`)
}

function ghApiMethod(args: string[]): string {
  const methodIndex = args.findIndex((a) => a === '--method' || a === '-X')
  if (methodIndex >= 0) return (args[methodIndex + 1] ?? '').toUpperCase()
  const inline = args.find((a) => a.startsWith('--method=') || a.startsWith('-X'))
  if (inline) return inline.replace(/^--method=|^-X/, '').toUpperCase()
  const sendsBody = args.some((a) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(a))
  return sendsBody ? 'POST' : 'GET'
}

function decideGhApi(args: string[], segment: string, context: PolicyContext): ToolDecision {
  const endpoint = args.find((a) => !a.startsWith('-')) ?? ''
  if (endpoint === 'graphql') {
    const mutation = /\bmutation\b/.test(segment)
    if (!mutation) return ALLOW
    if (context.submitting && SUBMIT_GRAPHQL_MUTATIONS.some((m) => segment.includes(m))) return ALLOW
    return deny('GitHub mutations are blocked until the user submits the review from Rally.')
  }

  const method = ghApiMethod(args)
  if (method === 'GET') return ALLOW
  if (context.submitting && method === 'POST' && SUBMIT_REST_PATHS.some((p) => p.test(endpoint))) return ALLOW
  return deny(
    context.submitting
      ? `Rally only permits posting reviews, review events, and thread replies; \`${method} ${endpoint}\` is blocked.`
      : 'GitHub writes are blocked until the user submits the review from Rally.',
  )
}
