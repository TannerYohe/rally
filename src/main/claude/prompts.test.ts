import { describe, expect, it } from 'vitest'
import { reviewPrompt, submitPrompt } from './prompts'
import { decideToolUse } from './toolPolicy'

const pr = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }

describe('reviewPrompt', () => {
  it('invokes the configured skill with the PR URL', () => {
    expect(reviewPrompt(pr, 'code-review')).toBe('/code-review https://github.com/acme/api/pull/12')
  })

  it('accepts a skill name with a leading slash or surrounding spaces', () => {
    expect(reviewPrompt(pr, ' /code-review ')).toBe('/code-review https://github.com/acme/api/pull/12')
  })

  it('falls back to review-pr when the skill is blank', () => {
    expect(reviewPrompt(pr, '  ')).toBe('/review-pr https://github.com/acme/api/pull/12')
  })
})

describe('submitPrompt', () => {
  it('spells out every GitHub call without relying on the review skill', () => {
    const prompt = submitPrompt(pr, 'APPROVE', '')
    expect(prompt).toContain('gh api repos/acme/api/pulls/12/reviews --method POST --input')
    expect(prompt).toContain('gh api graphql -f owner=acme -f repo=api -F number=12 -f query=')
    expect(prompt).toContain('addPullRequestReviewThreadReply(input: { pullRequestReviewId: $review')
    expect(prompt).toContain('gh api repos/acme/api/pulls/12/reviews/<id>/events --method POST -f event=APPROVE')
    expect(prompt).not.toMatch(/step \d|F5/)
  })

  it('routes thread replies through the pending review instead of the standalone replies endpoint', () => {
    const prompt = submitPrompt(pr, 'COMMENT', '')
    expect(prompt).not.toMatch(/gh api \S*\/replies/)
  })

  it('only gives commands that the submit-turn tool policy allows', () => {
    const commands = submitPrompt(pr, 'COMMENT', '')
      .split('\n')
      .flatMap((line) => line.match(/gh api .*$/) ?? [])
      .map((command) => command.replace(/<[^>]+>/g, '1'))
    expect(commands).toHaveLength(4)
    for (const command of commands) {
      expect(decideToolUse('Bash', { command }, { submitting: true, cwd: '/tmp/rally/session' })).toEqual({ allow: true })
    }
  })

  it('includes final edits from the user', () => {
    expect(submitPrompt(pr, 'COMMENT', ' drop 2 ')).toContain('Apply these final edits from the user before posting:\ndrop 2\n')
  })
})
