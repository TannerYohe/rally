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
      { path: 'b.ts', lines: ['new file mode 100644', '@@ -0,0 +1 @@', '+new'] },
    ])
  })

  it('keeps the metadata of files with no hunks', () => {
    const diff = [
      'diff --git a/run.sh b/run.sh',
      'old mode 100644',
      'new mode 100755',
      'diff --git a/logo.png b/logo.png',
      'index 1..2 100644',
      'Binary files a/logo.png and b/logo.png differ',
      'diff --git a/move-me.txt b/moved.txt',
      'similarity index 100%',
      'rename from move-me.txt',
      'rename to moved.txt',
    ].join('\n')
    expect(splitDiffFiles(diff)).toEqual([
      { path: 'run.sh', lines: ['old mode 100644', 'new mode 100755'] },
      { path: 'logo.png', lines: ['Binary files a/logo.png and b/logo.png differ'] },
      { path: 'moved.txt', lines: ['similarity index 100%', 'rename from move-me.txt', 'rename to moved.txt'] },
    ])
  })

  it('starts a file at a header with a quoted path instead of adding its lines to the previous file', () => {
    const diff = ['diff --git a/a.ts b/a.ts', '@@ -1 +1 @@', '+a', 'diff --git "a/\\"q.sh" "b/\\"q.sh"', '@@ -0,0 +1 @@', '+q'].join('\n')
    expect(splitDiffFiles(diff)).toEqual([
      { path: 'a.ts', lines: ['@@ -1 +1 @@', '+a'] },
      { path: '"a/\\"q.sh" "b/\\"q.sh"', lines: ['@@ -0,0 +1 @@', '+q'] },
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
