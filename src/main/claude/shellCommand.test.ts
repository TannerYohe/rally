import { describe, expect, it } from 'vitest'
import { splitShellCommand } from './shellCommand'

describe('splitShellCommand', () => {
  it('splits on operators but not inside quotes', () => {
    expect(splitShellCommand(`gh api graphql -f query='\n  query { a; b | c }'`)).toHaveLength(1)
  })

  it('extracts command substitutions as their own segments', () => {
    expect(splitShellCommand('WORK=$(mktemp -d "/tmp/x-XXXX")')).toEqual(['WORK=""', 'mktemp -d "/tmp/x-XXXX"'])
  })

  it('keeps 2>&1 redirects in one segment', () => {
    expect(splitShellCommand('git fetch origin abc 2>&1 && echo ok')).toEqual(['git fetch origin abc 2>&1', 'echo ok'])
  })

  it('strips subshell grouping', () => {
    expect(splitShellCommand('(cd "$WORK/repo" && gh pr checkout 12 --force)')).toEqual([
      'cd "$WORK/repo"',
      'gh pr checkout 12 --force',
    ])
  })
})
