import { describe, expect, it, vi } from 'vitest'
import type { PrRef } from '@shared/types'
import { publishDraftsTool, toDrafts, type PublishDraftsArgs } from './rallyTools'

const api: PrRef = { owner: 'acme', repo: 'api', number: 1, url: 'https://github.com/acme/api/pull/1' }
const web: PrRef = { owner: 'Acme', repo: 'Web', number: 2, url: 'https://github.com/Acme/Web/pull/2' }

function comment(id: string, pr?: string): PublishDraftsArgs['comments'][number] {
  return { id, kind: 'inline', path: 'a.ts', line: 3, start_line: null, side: 'RIGHT', severity: 'high', body: 'Fix this', reply_to_comment_id: null, pr }
}

const unitArgs: PublishDraftsArgs = {
  mode: 'full',
  verdict: 'Needs changes',
  report_markdown: '# Report',
  summary_body: '',
  comments: [comment('1', 'acme/api#1'), comment('2', 'https://github.com/acme/web/pull/2')],
  prior_concerns: [{ id: 'P1', location: 'a.ts:1', gist: 'g', verdict: 'v', status: 'addressed', thread_id: 'PRRT_1', pr: 'acme/web#2' }],
  pr_reviews: [
    { pr: 'acme/api#1', verdict: 'Looks good', summary_body: 'API' },
    { pr: 'ACME/web#2', verdict: 'Needs changes', summary_body: 'Web' },
  ],
}

describe('toDrafts', () => {
  it('tags comments, concerns, and verdicts with the member key the reference names', () => {
    const drafts = toDrafts(unitArgs, [api, web])
    expect(drafts.comments.map((c) => c.prKey)).toEqual(['acme/api#1', 'Acme/Web#2'])
    expect(drafts.priorConcerns[0]).toMatchObject({ prKey: 'Acme/Web#2', threadId: 'PRRT_1', status: 'addressed' })
    expect(drafts.prReviews).toEqual([
      { prKey: 'acme/api#1', verdict: 'Looks good', summaryBody: 'API' },
      { prKey: 'Acme/Web#2', verdict: 'Needs changes', summaryBody: 'Web' },
    ])
  })

  it('keeps a reference that names no member so validation can report it', () => {
    const drafts = toDrafts({ ...unitArgs, comments: [comment('1', 'acme/other#3'), comment('2')] }, [api, web])
    expect(drafts.comments.map((c) => c.prKey)).toEqual(['acme/other#3', undefined])
  })

  it('leaves drafts for one PR untagged', () => {
    const drafts = toDrafts(unitArgs, [api])
    expect(drafts.comments.every((c) => !('prKey' in c))).toBe(true)
    expect(drafts.prReviews).toBeUndefined()
    expect(drafts.comments[0]).toEqual({
      id: '1', kind: 'inline', path: 'a.ts', line: 3, startLine: null, side: 'RIGHT', severity: 'high', body: 'Fix this', replyToCommentId: null,
    })
  })
})

describe('publishDraftsTool', () => {
  it('publishes drafts that map onto every member', async () => {
    const onDrafts = vi.fn()
    const result = await publishDraftsTool({ onDrafts }, { members: [api, web] }).handler(unitArgs, {})
    expect(result.isError).toBeUndefined()
    expect(onDrafts).toHaveBeenCalledWith(expect.objectContaining({ prReviews: expect.any(Array) }))
  })

  it('rejects unit drafts with a missing PR, a repeated id, or a missing verdict without publishing them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onDrafts = vi.fn()
    const args = { ...unitArgs, comments: [comment('1'), comment('1', 'acme/api#1')], pr_reviews: unitArgs.pr_reviews!.slice(0, 1) }
    const result = await publishDraftsTool({ onDrafts }, { members: [api, web] }).handler(args, {})
    expect(result.isError).toBe(true)
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Draft #1 names no PR')
    expect(text).toContain('#1 repeat')
    expect(text).toContain('Give a verdict and review body for Acme/Web#2')
    expect(onDrafts).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('Rally rejected unit drafts', expect.objectContaining({ members: ['acme/api#1', 'Acme/Web#2'] }))
  })

  it('accepts any drafts for one PR, as author self-review does', async () => {
    const onDrafts = vi.fn()
    const result = await publishDraftsTool({ onDrafts }).handler({ ...unitArgs, comments: [comment('1'), comment('1')], pr_reviews: undefined }, {})
    expect(result.isError).toBeUndefined()
    expect(onDrafts).toHaveBeenCalledTimes(1)
  })
})
