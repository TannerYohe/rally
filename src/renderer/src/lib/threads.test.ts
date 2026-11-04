import { describe, expect, it } from 'vitest'
import type { ConcernStatus, PriorConcern, ReviewThread } from '@shared/types'
import { concernRows, selectedThreadIds } from './threads'

const concern = (id: string, status: ConcernStatus | undefined, threadId: string | null): PriorConcern => ({
  id,
  location: 'a.rb:1',
  gist: id,
  verdict: '',
  status,
  threadId,
})
const thread = (id: string, isResolved = false): ReviewThread => ({ id, url: `https://example.test/${id}`, isResolved, isOutdated: false })

describe('concernRows', () => {
  it('pairs each concern with its own thread, or null when Rally did not find one', () => {
    const rows = concernRows([concern('C1', 'addressed', 'T1'), concern('C2', 'addressed', 'T9'), concern('C3', 'moot', null)], [thread('T1')])
    expect(rows.map((row) => row.thread?.id ?? null)).toEqual(['T1', null, null])
  })
})

describe('selectedThreadIds', () => {
  const threads = [thread('T1'), thread('T2'), thread('T3'), thread('T4'), thread('T5'), thread('T6'), thread('T7', true)]
  const rows = concernRows(
    [
      concern('C1', 'addressed', 'T1'),
      concern('C2', 'moot', 'T2'),
      concern('C3', 'pushed_back_accept', 'T3'),
      concern('C4', 'partly', 'T4'),
      concern('C5', 'not_addressed', 'T5'),
      concern('C6', 'pushed_back_hold', 'T6'),
      concern('C7', 'addressed', 'T7'),
      concern('C8', 'addressed', 'T8'),
    ],
    threads,
  )

  it('pre-selects open threads that were addressed, moot, or accepted pushback', () => {
    expect(selectedThreadIds(rows, {})).toEqual(['T1', 'T2', 'T3'])
  })

  it('applies the user overrides', () => {
    expect(selectedThreadIds(rows, { T1: false, T4: true })).toEqual(['T2', 'T3', 'T4'])
  })

  it('never selects resolved threads or threads Rally did not confirm as the viewer’s', () => {
    expect(selectedThreadIds(rows, { T7: true, T8: true })).toEqual(['T1', 'T2', 'T3'])
  })

  it('does not pre-select concerns saved without a status', () => {
    expect(selectedThreadIds(concernRows([concern('C1', undefined, 'T1')], threads), {})).toEqual([])
  })
})
