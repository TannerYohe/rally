import { describe, expect, it } from 'vitest'
import { submitPrompt } from './prompts'

const pr = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }

describe('submitPrompt', () => {
  it('spells out every GitHub call without relying on the review skill', () => {
    const prompt = submitPrompt(pr, 'APPROVE', '')
    expect(prompt).toContain('gh api repos/acme/api/pulls/12/reviews --method POST --input')
    expect(prompt).toContain('gh api repos/acme/api/pulls/12/comments/<comment_id>/replies --method POST')
    expect(prompt).toContain('gh api repos/acme/api/pulls/12/reviews/<review_id>/events --method POST -f event=APPROVE')
    expect(prompt).not.toMatch(/step \d|F5/)
  })

  it('includes final edits from the user', () => {
    expect(submitPrompt(pr, 'COMMENT', ' drop 2 ')).toContain('Apply these final edits from the user before posting:\ndrop 2\n')
  })
})
