import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Resolves symlinks in the longest part of the path that exists, keeping the rest as written. */
export function realPath(path: string): string {
  if (existsSync(path)) return realpathSync.native(path)
  const parent = dirname(path)
  return parent === path ? path : join(realPath(parent), basename(path))
}

/** Returns whether two paths name the same file once symlinks, short names, and separators are resolved. */
export const samePath = (a: string, b: string) => realPath(a) === realPath(b)
