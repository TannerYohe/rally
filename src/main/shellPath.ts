import { execFileSync } from 'node:child_process'

export function loadLoginShellPath(): void {
  if (process.platform === 'win32') return
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const path = execFileSync(shell, ['-ilc', 'printf "%s" "$PATH"'], { encoding: 'utf8', timeout: 5000 })
    if (path) process.env.PATH = path
  } catch {
    process.env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(':')
  }
}
