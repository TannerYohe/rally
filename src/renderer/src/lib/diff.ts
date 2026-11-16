export type DiffLineKind = 'hunk' | 'add' | 'remove' | 'context'

export interface DiffFile {
  path: string
  lines: string[]
}

const FILE_HEADER = /^diff --git a\/.+? b\/(.+)$/

/** Splits a unified diff into files, dropping each file's metadata lines before its first hunk. */
export function splitDiffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let inHunk = false
  for (const line of diff.split('\n')) {
    const header = line.match(FILE_HEADER)
    if (header) {
      files.push({ path: header[1], lines: [] })
      inHunk = false
      continue
    }
    if (files.length === 0) continue
    if (line.startsWith('@@')) inHunk = true
    if (inHunk) files.at(-1)!.lines.push(line)
  }
  return files
}

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  return 'context'
}
