import { describe, expect, it } from 'vitest'
import { diffLineKind, splitDiffFiles } from './diff'

const DIFF = [
  'diff --git a/a.ts b/a.ts',
  'index 1..2 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '--- a removed line that looks like a header',
  '+added',
  'diff --git a/b.ts b/b.ts',
  'new file mode 100644',
  '@@ -0,0 +1 @@',
  '+new',
].join('\n')

describe('splitDiffFiles', () => {
  it('groups hunk lines by file and keeps content lines that look like headers', () => {
    expect(splitDiffFiles(DIFF)).toEqual([
      { path: 'a.ts', lines: ['@@ -1,2 +1,2 @@', ' keep', '--- a removed line that looks like a header', '+added'] },
      { path: 'b.ts', lines: ['@@ -0,0 +1 @@', '+new'] },
    ])
  })

  it('returns nothing for an empty diff', () => {
    expect(splitDiffFiles('')).toEqual([])
  })
})

describe('diffLineKind', () => {
  it('classifies lines by prefix', () => {
    expect(['@@ x', '+a', '-b', ' c'].map(diffLineKind)).toEqual(['hunk', 'add', 'remove', 'context'])
  })
})
