import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Resolves symlinks in the longest part of the path that exists, keeping the rest as written. */
export function realPath(path: string): string {
  if (existsSync(path)) return realpathSync.native(path)
  const parent = dirname(path)
  return parent === path ? path : join(realPath(parent), basename(path))
}
