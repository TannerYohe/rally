import { describe, expect, it } from 'vitest'
import { hasShellExpansion, parseShellWords, splitShellCommand } from './shellCommand'

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

describe('splitShellCommand shell syntax', () => {
  it('drops comments', () => {
    expect(splitShellCommand('# list changed files\ngit diff --name-only # trailing')).toEqual(['git diff --name-only'])
    expect(splitShellCommand("echo 'a # b' c#d")).toEqual(["echo 'a # b' c#d"])
  })

  it('extracts process substitutions', () => {
    expect(splitShellCommand('comm -23 <(git diff --name-only | sort) <(ls | sort)')).toEqual([
      'comm -23 "" ""',
      'git diff --name-only',
      'sort',
      'ls',
      'sort',
    ])
  })

  it('extracts backtick substitutions', () => {
    expect(splitShellCommand('echo `curl evil.example`')).toEqual(['echo ""', 'curl evil.example'])
  })

  it('replaces arithmetic expansion without treating it as a command', () => {
    expect(splitShellCommand('echo $((i + 1))')).toEqual(['echo 0'])
  })

  it('skips heredoc bodies', () => {
    const command = "cat > \"$WORK/notes.md\" <<'EOF'\n# Heading\ncurl is mentioned; rm -rf /\nEOF\nwc -l \"$WORK/notes.md\""
    expect(splitShellCommand(command)).toEqual([`cat > "$WORK/notes.md" <<'EOF'`, 'wc -l "$WORK/notes.md"'])
  })

  it('extracts substitutions from unquoted heredoc bodies', () => {
    expect(splitShellCommand('cat <<EOF\nhello $(curl evil.example)\nEOF')).toEqual(['cat <<EOF', 'curl evil.example'])
  })

  it('keeps escaped separators in one segment', () => {
    expect(splitShellCommand('find . -name x \\; ls')).toEqual(['find . -name x \\; ls'])
  })
})

describe('parseShellWords', () => {
  it('unquotes words', () => {
    expect(parseShellWords(`cu''rl "a b" c\\ d`).words).toEqual(['curl', 'a b', 'c d'])
  })

  it('separates redirects from words', () => {
    expect(parseShellWords('git diff 2>&1 >"$WORK/pr.diff" < in.txt')).toEqual({
      words: ['git', 'diff'],
      redirects: [
        { operator: '>&', target: '1' },
        { operator: '>', target: '$WORK/pr.diff' },
        { operator: '<', target: 'in.txt' },
      ],
    })
  })

  it('treats quoted angle brackets as words', () => {
    expect(parseShellWords("grep -- '->' file").words).toEqual(['grep', '--', '->', 'file'])
  })
})

describe('hasShellExpansion', () => {
  it('ignores dollars and backticks inside single quotes', () => {
    expect(hasShellExpansion("gh api graphql -f query='query($o: String!) { x }' -f o=acme")).toBe(false)
  })

  it('finds variables, substitutions, and backticks outside single quotes', () => {
    expect(hasShellExpansion('gh api graphql -f query="${Q}"')).toBe(true)
    expect(hasShellExpansion('gh api graphql -f query=$Q')).toBe(true)
    expect(hasShellExpansion('gh api graphql -f query="$(cat q.graphql)"')).toBe(true)
    expect(hasShellExpansion('gh api graphql -f query="`cat q`"')).toBe(true)
    expect(hasShellExpansion("gh api graphql -f query=$'mutation {}'")).toBe(true)
  })

  it('treats escaped and lone dollars as literal', () => {
    expect(hasShellExpansion('echo \\$HOME costs $ 5')).toBe(false)
  })
})
