import { tmpdir } from 'node:os'

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
  'mcp__claude_ai_Atlassian__getJiraIssue',
  'mcp__claude_ai_Slack__slack_search_public_and_private',
  'mcp__claude_ai_Slack__slack_read_thread',
  'mcp__slack__slack_search_public_and_private',
  'mcp__slack__slack_read_thread',
])

const READ_ONLY_COMMANDS = new Set([
  'cd', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'sort', 'uniq', 'jq', 'echo', 'printf',
  'test', '[', 'diff', 'awk', 'cut', 'tr', 'comm', 'basename', 'dirname', 'true', 'pwd', 'mktemp', 'mkdir',
  'realpath', 'stat', 'file', 'date',
])

const READ_ONLY_GH_SUBCOMMANDS = new Set([
  'pr view', 'pr diff', 'pr checkout', 'pr list', 'pr status', 'pr checks', 'repo clone', 'repo view', 'auth status',
])

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
  if (ALWAYS_ALLOWED_TOOLS.has(toolName) || toolName.startsWith('mcp__rally__')) return ALLOW
  if (toolName === 'AskUserQuestion') {
    return deny('AskUserQuestion is unavailable in Rally. Ask the question in plain text and end your turn.')
  }
  if (toolName === 'Write') return decideWrite(String(input.file_path ?? ''))
  if (toolName === 'Bash') return decideBash(String(input.command ?? ''), context)
  return deny(`${toolName} is not permitted in Rally review sessions.`)
}

function decideWrite(path: string): ToolDecision {
  if (TEMP_ROOTS.some((root) => path.startsWith(root))) return ALLOW
  return deny('Rally only allows writing files under the temp directory.')
}

function closingParen(command: string, openIndex: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = openIndex; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"') {
      quote = ch
    } else if (ch === '(') {
      depth++
    } else if (ch === ')' && --depth === 0) {
      return i
    }
  }
  return command.length
}

function isSeparator(command: string, i: number): boolean {
  const ch = command[i]
  if (ch === '&') return command[i - 1] !== '>' && command[i + 1] !== '>'
  return ch === ';' || ch === '\n' || ch === '|'
}

export function splitShellCommand(command: string): string[] {
  const segments: string[] = []
  const substitutions: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (ch === '$' && command[i + 1] === '(' && quote !== "'") {
      const end = closingParen(command, i + 1)
      substitutions.push(command.slice(i + 2, end))
      current += '""'
      i = end
    } else if (quote) {
      current += ch
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
    } else if (ch === '\\' && command[i + 1] === '\n') {
      current += ' '
      i++
    } else if (isSeparator(command, i)) {
      segments.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  segments.push(current)
  return [...segments.map(stripGrouping), ...substitutions.flatMap(splitShellCommand)].filter(Boolean)
}

function stripGrouping(segment: string): string {
  return segment.trim().replace(/^[({]\s*/, '').replace(/\s*[)}]$/, '').trim()
}

function tokenize(segment: string): string[] {
  const tokens = segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []
  const withoutAssignments = tokens.slice(tokens.findIndex((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)))
  return tokens.every((t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) ? [] : withoutAssignments
}

function unquote(token: string): string {
  return token.replace(/^['"]|['"]$/g, '')
}

function decideBash(command: string, context: PolicyContext): ToolDecision {
  for (const segment of splitShellCommand(command)) {
    const decision = decideSegment(tokenize(segment), segment, context)
    if (!decision.allow) return decision
  }
  return ALLOW
}

function decideSegment(tokens: string[], segment: string, context: PolicyContext): ToolDecision {
  if (tokens.length === 0) return ALLOW
  const [program, ...args] = tokens
  switch (program) {
    case 'gh':
      return decideGh(args, segment, context)
    case 'git':
      return args[0] === 'push' ? deny('git push is not permitted in Rally.') : ALLOW
    case 'sed':
      return args.some((a) => a.startsWith('-i')) ? deny('In-place sed is not permitted in Rally.') : ALLOW
    case 'rm':
      return args.filter((a) => !a.startsWith('-')).every(isTempPath)
        ? ALLOW
        : deny('Rally only allows rm on temp directories.')
    default:
      return READ_ONLY_COMMANDS.has(program) ? ALLOW : deny(`\`${program}\` is not permitted in Rally review sessions.`)
  }
}

function isTempPath(token: string): boolean {
  const path = unquote(token)
  return path.startsWith('$WORK') || path.startsWith('${WORK}') || TEMP_ROOTS.some((root) => path.startsWith(root))
}

function decideGh(args: string[], segment: string, context: PolicyContext): ToolDecision {
  if (args[0] === 'api') return decideGhApi(args.slice(1), segment, context)
  if (READ_ONLY_GH_SUBCOMMANDS.has(`${args[0]} ${args[1]}`)) return ALLOW
  return deny(`\`gh ${args.slice(0, 2).join(' ')}\` is not permitted in Rally. Use \`gh api\` for review posting.`)
}

function ghApiMethod(args: string[]): string {
  const methodIndex = args.findIndex((a) => a === '--method' || a === '-X')
  if (methodIndex >= 0) return unquote(args[methodIndex + 1] ?? '').toUpperCase()
  const inline = args.find((a) => a.startsWith('--method=') || a.startsWith('-X'))
  if (inline) return unquote(inline.replace(/^--method=|^-X/, '')).toUpperCase()
  const sendsBody = args.some((a) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(a))
  return sendsBody ? 'POST' : 'GET'
}

function decideGhApi(args: string[], segment: string, context: PolicyContext): ToolDecision {
  const endpoint = unquote(args.find((a) => !a.startsWith('-')) ?? '')
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
