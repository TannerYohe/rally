export type DiffLineKind = 'hunk' | 'add' | 'remove' | 'context'

export interface DiffFile {
  path: string
  lines: string[]
}

const HEADER_PREFIX = 'diff --git '
const FILE_HEADER = /^diff --git a\/.+? b\/(.+)$/
const KEPT_METADATA = /^(?:new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|Binary files) /

/** Splits a unified diff into files at each header, naming a file by its header verbatim when git quoted its path, and keeping the metadata lines that describe a file with no hunks. */
export function splitDiffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let inHunk = false
  for (const line of diff.split('\n')) {
    if (line.startsWith(HEADER_PREFIX)) {
      files.push({ path: line.match(FILE_HEADER)?.[1] ?? line.slice(HEADER_PREFIX.length), lines: [] })
      inHunk = false
      continue
    }
    if (files.length === 0) continue
    if (line.startsWith('@@')) inHunk = true
    if (inHunk || KEPT_METADATA.test(line)) files.at(-1)!.lines.push(line)
  }
  return files
}

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  return 'context'
}
