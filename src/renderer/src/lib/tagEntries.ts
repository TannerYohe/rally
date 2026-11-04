export function splitEntries(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean)
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
