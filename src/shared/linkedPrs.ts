import { isSamePr, type PrRef } from './types'

export type PrCoords = Pick<PrRef, 'owner' | 'repo' | 'number'>

export const MAX_LINK_TARGETS = 5

const PR_URL = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)[^\s)>\]]*/gi
const PR_SHORT_REF = /(?<![\w./-])([A-Za-z\d][\w.-]*)\/([\w.-]+)#(\d+)\b/g
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const LABEL = /^\s*(?:[-*+]\s+|>\s*)*[*_]{0,2}([^:\n]{1,80}?)[*_]{0,2}\s*:(?!\/\/)[*_]{0,2}(.*)$/

function coords(owner: string, repo: string, number: string): PrCoords {
  return { owner, repo: repo.replace(/\.git$/i, ''), number: Number(number) }
}

/** Returns every PR reference in the text, as GitHub PR URLs or owner/repo#N, in order of appearance. */
function prRefsIn(text: string): PrCoords[] {
  const found: { index: number; ref: PrCoords }[] = []
  const withoutUrls = text.replace(PR_URL, (match, owner: string, repo: string, number: string, index: number) => {
    found.push({ index, ref: coords(owner, repo, number) })
    return ' '.repeat(match.length)
  })
  for (const match of withoutUrls.matchAll(PR_SHORT_REF)) found.push({ index: match.index, ref: coords(match[1], match[2], match[3]) })
  return found.sort((a, b) => a.index - b.index).map((f) => f.ref)
}

/** Parses one PR reference typed by the user, as a GitHub PR URL or owner/repo#N. */
export function parsePrRef(text: string): PrCoords | null {
  const trimmed = text.trim()
  const refs = prRefsIn(trimmed)
  return refs.length === 1 ? refs[0] : null
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/

function withoutCodeAndComments(body: string): string {
  let fence: string | null = null
  return body
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .split(/\r?\n/)
    .map((line) => {
      const opener = FENCE.exec(line)?.[1]
      if (fence) {
        if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null
        return ''
      }
      if (opener) {
        fence = opener
        return ''
      }
      return line.replace(/`[^`]*`/g, '')
    })
    .join('\n')
}

/** Lowercases a label and writes "pull request(s)" and "PRs" as "pr", so markers match either spelling. */
export function normalizeMarker(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/\bpull[\s-]*requests?\b/g, 'pr')
    .replace(/\bprs\b|\bpr\(s\)/g, 'pr')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesMarker(label: string, markers: string[]): boolean {
  const normalized = normalizeMarker(label)
  return markers.some((marker) => {
    const wanted = normalizeMarker(marker)
    return wanted !== '' && new RegExp(`(^|\\W)${escapeRegExp(wanted)}(\\W|$)`).test(normalized)
  })
}

/** Returns whether a line is a heading or Label: line naming a marker, and whether the line itself carries text after its label. */
function markerLine(line: string, markers: string[]): { hasText: boolean } | null {
  const heading = HEADING.exec(line)
  if (heading) return matchesMarker(heading[1], markers) ? { hasText: prRefsIn(line).length > 0 } : null
  const label = LABEL.exec(line)
  if (label && matchesMarker(label[1], markers)) return { hasText: Boolean(label[2].trim()) || prRefsIn(line).length > 0 }
  return null
}

/** Returns the text a marker covers: its own line, then the block below it up to the next heading or blank line. */
function markedText(lines: string[], start: number, hasText: boolean): string {
  const covered = [lines[start]]
  let index = start + 1
  if (!hasText) while (index < lines.length && !lines[index].trim()) index++
  for (; index < lines.length; index++) {
    const line = lines[index]
    if (!line.trim() || HEADING.test(line)) break
    covered.push(line)
  }
  return covered.join('\n')
}

/** Returns the PRs in other repos that a description lists under a link marker, at most MAX_LINK_TARGETS. */
export function parseLinkedPrs(body: string, self: PrCoords, markers: string[]): PrCoords[] {
  const lines = withoutCodeAndComments(body).split(/\r?\n/)
  const targets: PrCoords[] = []
  lines.forEach((line, index) => {
    const marker = markerLine(line, markers)
    if (!marker) return
    for (const ref of prRefsIn(markedText(lines, index, marker.hasText))) {
      const sameRepo = ref.owner.toLowerCase() === self.owner.toLowerCase() && ref.repo.toLowerCase() === self.repo.toLowerCase()
      if (sameRepo || targets.some((t) => isSamePr(t, ref))) continue
      targets.push(ref)
    }
  })
  return targets.slice(0, MAX_LINK_TARGETS)
}
