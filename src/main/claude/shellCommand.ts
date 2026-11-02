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

export function tokenize(segment: string): string[] {
  const tokens = segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []
  const withoutAssignments = tokens.slice(tokens.findIndex((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)))
  return tokens.every((t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) ? [] : withoutAssignments
}

export function unquote(token: string): string {
  return token.replace(/^['"]|['"]$/g, '')
}
