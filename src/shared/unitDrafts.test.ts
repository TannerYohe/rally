import { describe, expect, it } from 'vitest'
import { finalReview } from './feedback'
import type { DraftComment, Drafts, PrRef } from './types'
import { changesForPr, distinctSessions, draftsForPr, isUnitSession, sessionCovers, sessionMembers, unitDraftProblems, withPrTags } from './unitDrafts'

const api: PrRef = { owner: 'acme', repo: 'api', number: 1, url: 'https://github.com/acme/api/pull/1' }
const web: PrRef = { owner: 'acme', repo: 'web', number: 2, url: 'https://github.com/acme/web/pull/2' }
const API = 'acme/api#1'
const WEB = 'acme/web#2'

function comment(id: string, prKey?: string): DraftComment {
  return { id, kind: 'inline', path: 'a.ts', line: 1, startLine: null, side: 'RIGHT', severity: 'medium', body: `body ${id}`, replyToCommentId: null, prKey }
}

const unitDrafts: Drafts = {
  mode: 'followup',
  verdict: 'Needs changes',
  reportMarkdown: '# Report',
  summaryBody: '',
  comments: [comment('1', API), comment('2', WEB), comment('3', API)],
  priorConcerns: [{ id: 'P1', location: 'a.ts:1', gist: 'g', verdict: 'v', prKey: WEB }],
  prReviews: [
    { prKey: API, verdict: 'Looks good', summaryBody: 'API body' },
    { prKey: WEB, verdict: 'Needs changes', summaryBody: 'Web body' },
  ],
}

describe('sessionMembers', () => {
  it('treats a session with one member as a single-PR review', () => {
    expect(sessionMembers({ members: [api] })).toEqual([api])
    expect(isUnitSession({ members: [api] })).toBe(false)
    expect(isUnitSession({ members: [api, web] })).toBe(true)
  })

  it('covers every member key', () => {
    expect(sessionCovers({ members: [api, web] }, WEB)).toBe(true)
    expect(sessionCovers({ members: [api] }, WEB)).toBe(false)
  })
})

describe('draftsForPr', () => {
  it('returns one PR share as single-PR drafts', () => {
    expect(draftsForPr(unitDrafts, WEB)).toEqual({
      mode: 'followup',
      verdict: 'Needs changes',
      reportMarkdown: '# Report',
      summaryBody: 'Web body',
      comments: [comment('2', WEB)],
      priorConcerns: [unitDrafts.priorConcerns[0]],
    })
  })

  it('tags untagged drafts for one PR with that PR and leaves tagged drafts alone', () => {
    const solo = withPrTags({ ...unitDrafts, comments: [comment('1')], priorConcerns: [], prReviews: undefined, verdict: 'Looks good', summaryBody: 'Body' }, API)
    expect(solo.comments.map((c) => c.prKey)).toEqual([API])
    expect(solo.prReviews).toEqual([{ prKey: API, verdict: 'Looks good', summaryBody: 'Body' }])
    expect(draftsForPr(solo, API)).toMatchObject({ verdict: 'Looks good', summaryBody: 'Body', comments: solo.comments })
    expect(withPrTags(unitDrafts, API)).toBe(unitDrafts)
  })

  it('feeds finalReview with the PR own body edit', () => {
    const changes = { edits: { '3': { dropped: true } }, summaryBodyEdit: undefined, summaryBodyEdits: { [API]: 'Edited API body' }, instructions: '' }
    const review = finalReview(draftsForPr(unitDrafts, API), changesForPr(changes, API))
    expect(review.body).toBe('Edited API body')
    expect(review.inline.map((c) => c.id)).toEqual(['1'])
    expect(finalReview(draftsForPr(unitDrafts, WEB), changesForPr(changes, WEB)).body).toBe('Web body')
  })
})

describe('unitDraftProblems', () => {
  it('accepts drafts that map onto every member', () => {
    expect(unitDraftProblems(unitDrafts, [API, WEB])).toEqual([])
  })

  it('names comments and concerns without a member PR, repeated ids, and missing verdicts', () => {
    const drafts: Drafts = {
      ...unitDrafts,
      comments: [comment('1'), comment('2', 'acme/other#9'), comment('2', WEB)],
      priorConcerns: [{ id: 'P1', location: '', gist: '', verdict: '' }],
      prReviews: [{ prKey: API, verdict: '', summaryBody: '' }],
    }
    expect(unitDraftProblems(drafts, [API, WEB])).toEqual([
      'Draft #1 names no PR; name one of acme/api#1, acme/web#2.',
      "Draft #2 names acme/other#9, which isn't one of acme/api#1, acme/web#2.",
      'Earlier comment P1 names no PR; name one of acme/api#1, acme/web#2.',
      'Draft ids must be unique across the PRs; #2 repeat.',
      'Give a verdict and review body for acme/web#2 in pr_reviews.',
    ])
  })

  it('names pr_reviews entries for a PR outside the review or given twice', () => {
    const review = (prKey: string) => ({ prKey, verdict: 'Looks good', summaryBody: '' })
    const drafts: Drafts = { ...unitDrafts, prReviews: [review(API), review(WEB), review(WEB), review('acme/other#9')] }
    expect(unitDraftProblems(drafts, [API, WEB])).toEqual([
      "pr_reviews names acme/other#9, which isn't in this review.",
      'Give acme/web#2 one entry in pr_reviews.',
    ])
  })
})

describe('distinctSessions', () => {
  it('keeps each session once in order and drops missing ones', () => {
    const a = { id: 'a' }
    const b = { id: 'b' }
    expect(distinctSessions([a, null, b, a])).toEqual([a, b])
  })
})
