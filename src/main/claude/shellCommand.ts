export interface Redirect {
  operator: string
  target: string
}

export interface ShellWords {
  words: string[]
  redirects: Redirect[]
}

interface PendingHeredoc {
  delimiter: string
  stripTabs: boolean
  expands: boolean
}

const HEREDOC_OPERATOR = /^<<(-?)[ \t]*((?:'[^']*'|"[^"]*"|\\.|[^\s;&|<>()])+)/

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

function closingBacktick(command: string, openIndex: number): number {
  for (let i = openIndex + 1; i < command.length; i++) {
    if (command[i] === '\\') i++
    else if (command[i] === '`') return i
  }
  return command.length
}

function isSeparator(command: string, i: number): boolean {
  const ch = command[i]
  if (ch === '&') return command[i - 1] !== '>' && command[i + 1] !== '>'
  return ch === ';' || ch === '\n' || ch === '|'
}

function startsWord(command: string, i: number): boolean {
  return i === 0 || /[\s;&|()<>]/.test(command[i - 1])
}

function substitutionsIn(text: string): string[] {
  const found: string[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++
    } else if (text[i] === '`') {
      const end = closingBacktick(text, i)
      found.push(text.slice(i + 1, end))
      i = end
    } else if (text[i] === '$' && text[i + 1] === '(') {
      const end = closingParen(text, i + 1)
      found.push(text.slice(i + 2, end))
      i = end
    }
  }
  return found
}

function skipHeredocBodies(command: string, newlineIndex: number, heredocs: PendingHeredoc[], nested: string[]): number {
  let lineStart = newlineIndex + 1
  for (const heredoc of heredocs) {
    const bodyStart = lineStart
    while (lineStart < command.length) {
      const lineEnd = command.indexOf('\n', lineStart) < 0 ? command.length : command.indexOf('\n', lineStart)
      const line = command.slice(lineStart, lineEnd)
      lineStart = lineEnd + 1
      if ((heredoc.stripTabs ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) {
        if (heredoc.expands) nested.push(...substitutionsIn(command.slice(bodyStart, lineEnd - line.length)))
        break
      }
    }
  }
  return lineStart - 2
}

export function splitShellCommand(command: string): string[] {
  const segments: string[] = []
  const nested: string[] = []
  let heredocs: PendingHeredoc[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote === "'") {
      current += ch
      if (ch === "'") quote = null
    } else if (ch === '\\' && command[i + 1] === '\n') {
      current += ' '
      i++
    } else if (ch === '\\') {
      current += command.slice(i, i + 2)
      i++
    } else if (ch === '`') {
      const end = closingBacktick(command, i)
      nested.push(command.slice(i + 1, end))
      current += '""'
      i = end
    } else if (ch === '$' && command[i + 1] === '(' && command[i + 2] === '(') {
      const end = closingParen(command, i + 1)
      nested.push(...substitutionsIn(command.slice(i + 3, end - 1)))
      current += '0'
      i = end
    } else if ((ch === '$' || (!quote && (ch === '<' || ch === '>'))) && command[i + 1] === '(') {
      const end = closingParen(command, i + 1)
      nested.push(command.slice(i + 2, end))
      current += '""'
      i = end
    } else if (quote) {
      current += ch
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
    } else if (ch === '#' && startsWord(command, i)) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++
    } else if (ch === '<' && command[i + 1] === '<' && command[i + 2] !== '<' && HEREDOC_OPERATOR.test(command.slice(i))) {
      const [operator, dash, word] = command.slice(i).match(HEREDOC_OPERATOR) as RegExpMatchArray
      heredocs.push({ delimiter: word.replace(/['"\\]/g, ''), stripTabs: dash === '-', expands: !/['"\\]/.test(word) })
      current += operator
      i += operator.length - 1
    } else if (ch === '\n' && heredocs.length > 0) {
      segments.push(current)
      current = ''
      i = skipHeredocBodies(command, i, heredocs, nested)
      heredocs = []
    } else if (isSeparator(command, i)) {
      segments.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  segments.push(current)
  return [...segments.map(stripGrouping), ...nested.flatMap(splitShellCommand)].filter(Boolean)
}

function stripGrouping(segment: string): string {
  return segment.trim().replace(/^[({\s]+/, '').replace(/[\s)}]+$/, '')
}

function redirectOperator(segment: string, i: number): string {
  const rest = segment.slice(i)
  return (rest.match(/^(?:>>|>\||>&|>|<<<|<<|<&|<>|<)/) as RegExpMatchArray)[0]
}

export function parseShellWords(segment: string): ShellWords {
  const words: string[] = []
  const redirects: Redirect[] = []
  let operator: string | null = null
  let word = ''
  let inWord = false
  let quote: string | null = null
  const endWord = () => {
    if (!inWord) return
    if (operator) redirects.push({ operator, target: word })
    else words.push(word)
    operator = null
    word = ''
    inWord = false
  }
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]
    if (quote === "'") {
      if (ch === "'") quote = null
      else word += ch
    } else if (quote === '"') {
      if (ch === '"') quote = null
      else if (ch === '\\' && /[$`"\\]/.test(segment[i + 1] ?? '')) word += segment[++i]
      else word += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
      inWord = true
    } else if (ch === '\\') {
      word += segment[++i] ?? ''
      inWord = true
    } else if (/\s/.test(ch)) {
      endWord()
    } else if (ch === '<' || ch === '>') {
      if (inWord && !operator && /^(?:\d+|&)$/.test(word)) {
        word = ''
        inWord = false
      }
      endWord()
      operator = redirectOperator(segment, i)
      i += operator.length - 1
    } else {
      word += ch
      inWord = true
    }
  }
  endWord()
  return { words, redirects }
}
