const TOKEN = /[\s,﻿]+|#[^\n\r]*|"""(?:\\"""|[\s\S])*?"""|"(?:\\.|[^"\\\n\r])*"|\.\.\.|[_A-Za-z][_0-9A-Za-z]*|[^\s]/g
const NAME = /^[_A-Za-z]/
const IGNORED = /^[\s,﻿#]/

function tokens(query: string): string[] | null {
  const significant = (query.match(TOKEN) ?? []).filter((token) => !IGNORED.test(token))
  return significant.includes('"') ? null : significant
}

export function topLevelMutationFields(query: string): string[] | null {
  const list = tokens(query)
  if (!list) return null
  const fields: string[] = []
  let braces = 0
  let parens = 0
  let pendingMutation = false
  let inMutation = false
  for (let i = 0; i < list.length; i++) {
    const token = list[i]
    if (token === '(') parens++
    else if (token === ')') parens--
    else if (parens > 0) continue
    else if (token === '{') {
      braces++
      if (braces === 1 && pendingMutation) inMutation = true
      pendingMutation = false
    } else if (token === '}') {
      braces--
      if (braces === 0) inMutation = false
    } else if (braces === 0 && token === 'mutation') pendingMutation = true
    else if (inMutation && braces === 1) {
      if (token === '...') return null
      if (token === '@') i++
      else if (NAME.test(token)) {
        const aliased = list[i + 1] === ':'
        const field = aliased ? list[i + 2] : token
        if (!field || !NAME.test(field)) return null
        fields.push(field)
        if (aliased) i += 2
      }
    }
    if (braces < 0 || parens < 0) return null
  }
  return braces === 0 && parens === 0 ? fields : null
}
