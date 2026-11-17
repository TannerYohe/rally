import type { DiffResult } from './types'

/** How many characters of a diff Rally shows before cutting it off. */
export const MAX_DIFF_CHARS = 400_000

export const EMPTY_DIFF: DiffResult = { diff: '', truncated: false }
