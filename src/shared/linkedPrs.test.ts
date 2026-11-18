import { describe, expect, it } from 'vitest'
import { normalizeMarker, parseLinkedPrs, parsePrRef } from './linkedPrs'
import { DEFAULT_LINK_MARKERS } from './types'

const self = { owner: 'acme', repo: 'api', number: 1 }
const parse = (body: string, markers = DEFAULT_LINK_MARKERS) => parseLinkedPrs(body, self, markers)

describe('parsePrRef', () => {
  it('parses a PR URL or an owner/repo#N reference', () => {
    expect(parsePrRef('https://github.com/acme/web/pull/12')).toEqual({ owner: 'acme', repo: 'web', number: 12 })
    expect(parsePrRef(' https://github.com/acme/web/pull/12/files ')).toEqual({ owner: 'acme', repo: 'web', number: 12 })
    expect(parsePrRef('acme/web.js#7')).toEqual({ owner: 'acme', repo: 'web.js', number: 7 })
  })

  it('rejects text that is not exactly one PR reference', () => {
    expect(parsePrRef('#12')).toBeNull()
    expect(parsePrRef('https://github.com/acme/web/issues/12')).toBeNull()
    expect(parsePrRef('acme/web#1 acme/web#2')).toBeNull()
    expect(parsePrRef('')).toBeNull()
  })
})

describe('normalizeMarker', () => {
  it('treats PRs and pull requests as PR', () => {
    expect(normalizeMarker('**Related Pull Requests**')).toBe('related pr')
    expect(normalizeMarker('Linked PR(s)')).toBe('linked pr')
    expect(normalizeMarker('Sibling PRs')).toBe('sibling pr')
  })
})

describe('parseLinkedPrs', () => {
  it('reads PR refs on a Label: line', () => {
    expect(parse('Depends on: https://github.com/acme/web/pull/3 and acme/worker#9')).toEqual([
      { owner: 'acme', repo: 'web', number: 3 },
      { owner: 'acme', repo: 'worker', number: 9 },
    ])
  })

  it('reads the block under a heading, skipping the blank line after it, up to the next blank line', () => {
    const body = ['## Related PRs', '', '- https://github.com/acme/web/pull/3', '- acme/worker#9', '', 'Unrelated: acme/other#4'].join('\n')
    expect(parse(body).map((r) => r.repo)).toEqual(['web', 'worker'])
  })

  it('reads past an intro paragraph and a loose list under a heading', () => {
    const intro = ['## Related PRs', '', 'This change spans two repos:', '', '- https://github.com/acme/web/pull/2'].join('\n')
    expect(parse(intro).map((r) => r.repo)).toEqual(['web'])
    const loose = ['## Related PRs', '', '- https://github.com/acme/web/pull/2', '', '- acme/cli#3', '', 'Other: acme/other#4'].join('\n')
    expect(parse(loose).map((r) => r.repo)).toEqual(['web', 'cli'])
  })

  it('ends a Label: block at a blank line', () => {
    expect(parse(['Related PRs:', '- acme/web#2', '', '- acme/cli#3'].join('\n')).map((r) => r.repo)).toEqual(['web'])
  })

  it('reads headings with closing hashes', () => {
    expect(parse('## Related PRs ##\nacme/web#3').map((r) => r.repo)).toEqual(['web'])
    expect(parse('##\nacme/web#3')).toEqual([])
  })

  it('parses a heading with a long run of spaces in linear time', () => {
    const started = Date.now()
    parse(`# a${' '.repeat(50_000)}x\n## Related PRs${' '.repeat(50_000)}#\nacme/web#3`)
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('reads past the blank line after an empty Label: marker inside another marker block', () => {
    expect(parse('Related PRs: acme/web#3\nDepends on:\n\nacme/worker#4').map((r) => r.repo)).toEqual(['web', 'worker'])
    expect(parse('## Related PRs\n- acme/web#3\nDepends on:\n\nacme/worker#4').map((r) => r.repo)).toEqual(['web', 'worker'])
    expect(parse('## Related PRs\n- acme/web#3\n\n- Depends on:\n\n  acme/worker#4').map((r) => r.repo)).toEqual(['web', 'worker'])
  })

  it('parses a long run of marker lines in linear time', () => {
    const started = Date.now()
    parse('related PR: acme/web#3\n'.repeat(3000) + 'Related PR:\n'.repeat(3000))
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('stops the block at the next heading', () => {
    const body = ['### Linked pull requests', 'acme/web#3', '### Testing', 'acme/other#4'].join('\n')
    expect(parse(body).map((r) => r.repo)).toEqual(['web'])
  })

  it('reads bold and list-item labels', () => {
    expect(parse('- **Companion PR:** acme/web#3').map((r) => r.repo)).toEqual(['web'])
    expect(parse('**Required by**: acme/web#3').map((r) => r.repo)).toEqual(['web'])
  })

  it('ignores PR refs outside a marker', () => {
    expect(parse('See acme/web#3 for context.\n\nFixes https://github.com/acme/web/pull/4')).toEqual([])
  })

  it('ignores template placeholders in HTML comments and code', () => {
    const body = [
      '## Related PRs',
      '<!-- e.g. https://github.com/acme/example/pull/1 -->',
      '`acme/inline#2`',
      '```',
      'acme/fenced#3',
      '```',
    ].join('\n')
    expect(parse(body)).toEqual([])
  })

  it('ignores same-repo and self refs', () => {
    expect(parse('Related PRs: acme/api#1, ACME/API#2, acme/web#3').map((r) => r.repo)).toEqual(['web'])
  })

  it('dedupes refs and keeps at most five', () => {
    const refs = ['acme/web#1', 'https://github.com/acme/web/pull/1', ...[2, 3, 4, 5, 6, 7].map((n) => `acme/r${n}#${n}`)]
    expect(parse(`Linked PRs: ${refs.join(' ')}`).map((r) => r.repo)).toEqual(['web', 'r2', 'r3', 'r4', 'r5'])
  })

  it('uses only the markers given', () => {
    expect(parse('Depends on: acme/web#3', ['goes with'])).toEqual([])
    expect(parse('Pairs with: acme/web#3', ['pairs with']).map((r) => r.repo)).toEqual(['web'])
  })

  it('does not take a URL line for a label', () => {
    expect(parse('- https://github.com/acme/web/pull/3')).toEqual([])
  })
})
