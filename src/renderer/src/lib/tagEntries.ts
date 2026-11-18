/** Whether entries are single words, split on spaces and commas, or phrases, split on commas and new lines. */
export type EntryKind = 'word' | 'phrase'

const SEPARATORS: Record<EntryKind, RegExp> = { word: /[\s,]+/, phrase: /\s*[,\n]+\s*/ }

export function splitEntries(text: string, kind: EntryKind = 'word'): string[] {
  return text
    .split(SEPARATORS[kind])
    .map((v) => v.trim())
    .filter(Boolean)
}

export function entriesFromPaste(draft: string, pasted: string, kind: EntryKind = 'word'): string[] | null {
  const entries = splitEntries(pasted, kind)
  if (entries.length < 2) return null
  return [...splitEntries(draft, kind), ...entries]
}

export function addEntries(values: string[], entries: string[]): string[] {
  const next = [...values]
  const seen = new Set(values.map((v) => v.toLowerCase()))
  for (const entry of entries) {
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    next.push(entry)
  }
  return next
}
