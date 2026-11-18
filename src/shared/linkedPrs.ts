import { isSamePr, isSameRepo, type PrCoords } from './types'

export const MAX_LINK_TARGETS = 5

const PR_URL = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)[^\s)>\]]*/gi
const PR_SHORT_REF = /(?<![\w./-])([A-Za-z\d][\w.-]*)\/([\w.-]+)#(\d+)\b/g
const HEADING_OPENER = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/
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

/** Returns a Markdown heading's text without its opening and closing # runs, or null when the line isn't a heading. */
function headingText(line: string): string | null {
  const opener = HEADING_OPENER.exec(line)
  if (!opener) return null
  const text = line.slice(opener[0].length).trimEnd()
  let closer = text.length
  while (closer > 0 && text[closer - 1] === '#') closer--
  if (closer === text.length) return text
  if (closer === 0) return ''
  const before = text[closer - 1]
  return before === ' ' || before === '\t' ? text.slice(0, closer).trimEnd() : text
}

type MarkerLine = { kind: 'heading' | 'label'; hasText: boolean }

/** Returns whether a line is a heading or Label: line naming a marker, and whether the line itself carries text after its label. */
function markerLine(line: string, markers: string[]): MarkerLine | null {
  const heading = headingText(line)
  if (heading !== null) return matchesMarker(heading, markers) ? { kind: 'heading', hasText: prRefsIn(line).length > 0 } : null
  const label = LABEL.exec(line)
  if (label && matchesMarker(label[1], markers)) return { kind: 'label', hasText: Boolean(label[2].trim()) || prRefsIn(line).length > 0 }
  return null
}

/** Returns the index of the first non-blank line at or after index, or lines.length when there is none. */
function nextNonBlank(lines: string[], index: number): number {
  while (index < lines.length && !lines[index].trim()) index++
  return index
}

/** Returns a marker's line and the block below it up to the next heading or blank line, where a heading's block runs past a blank line until it has a PR reference and the next line doesn't continue a list. */
function markedText(lines: string[], start: number, marker: MarkerLine): string {
  const covered = [lines[start]]
  let hasRef = marker.hasText
  let index = marker.hasText ? start + 1 : nextNonBlank(lines, start + 1)
  while (index < lines.length) {
    const line = lines[index]
    if (headingText(line) !== null) break
    if (!line.trim()) {
      if (marker.kind === 'label') break
      const next = nextNonBlank(lines, index)
      if (next === lines.length || (hasRef && !LIST_ITEM.test(lines[next]))) break
      index = next
      continue
    }
    covered.push(line)
    hasRef ||= prRefsIn(line).length > 0
    index++
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
    for (const ref of prRefsIn(markedText(lines, index, marker))) {
      if (isSameRepo(ref, self) || targets.some((t) => isSamePr(t, ref))) continue
      targets.push(ref)
    }
  })
  return targets.slice(0, MAX_LINK_TARGETS)
}
