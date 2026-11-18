import type { DIFF_LINE_PREFIX, DiffLine } from './diff'

export interface LineChange extends DiffLine {
  kind: keyof typeof DIFF_LINE_PREFIX
}

const splitLines = (text: string) => (text === '' ? [] : text.replaceAll('\r\n', '\n').split('\n'))

/** Returns a line-by-line diff from `before` to `after` that keeps their longest common run of lines as context. */
export function lineDiff(before: string, after: string): LineChange[] {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const context = (lines: string[]) => lines.map((text): LineChange => ({ kind: 'context', text }))
  return [...context(a.slice(0, start)), ...changedRun(a.slice(start, a.length - end), b.slice(start, b.length - end)), ...context(a.slice(a.length - end))]
}

/** Returns the diff of two runs of lines from a longest-common-subsequence table. */
function changedRun(a: string[], b: string[]): LineChange[] {
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1])
    }
  }
  const lines: LineChange[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', text: a[i] })
      i++
      j++
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      lines.push({ kind: 'remove', text: a[i++] })
    } else {
      lines.push({ kind: 'add', text: b[j++] })
    }
  }
  while (i < a.length) lines.push({ kind: 'remove', text: a[i++] })
  while (j < b.length) lines.push({ kind: 'add', text: b[j++] })
  return lines
}
