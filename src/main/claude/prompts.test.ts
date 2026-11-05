import { describe, expect, it } from 'vitest'
import { reviewPrompt, submitPrompt } from './prompts'
import { bashStepLabel } from './timeline'
import { decideToolUse } from './toolPolicy'

const pr = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }

function submitCommands(): string[] {
  return submitPrompt(pr, 'COMMENT', '')
    .split('\n')
    .flatMap((line) => line.match(/gh api .*$/) ?? [])
    .map((command) => command.replace(/<[^>]+>/g, '1'))
}

function graphqlFlagNames(command: string): string[] {
  return [...command.matchAll(/-[fF] (\w+)=/g)].map((m) => m[1]).filter((name) => name !== 'query')
}

function declaredVariables(command: string): string[] {
  const signature = command.match(/query='(?:query|mutation)\(([^)]*)\)/)?.[1] ?? ''
  return [...signature.matchAll(/\$(\w+):/g)].map((m) => m[1])
}

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

  it('only gives commands that the submit-turn tool policy allows, each with its timeline label', () => {
    const decide = (command: string) => decideToolUse('Bash', { command }, { submitting: true, cwd: '/tmp/rally/session' })
    expect(submitCommands().map((command) => [bashStepLabel(command, undefined), decide(command)])).toEqual([
      ['Posting pending review', { allow: true }],
      ['Querying review threads', { allow: true }],
      ['Posting thread reply', { allow: true }],
      ['Submitting review', { allow: true }],
      ['Deleting pending review', { allow: true }],
    ])
  })

  it('passes exactly the variables each graphql command declares', () => {
    const graphqlCommands = submitCommands().filter((command) => command.startsWith('gh api graphql'))
    expect(graphqlCommands).toHaveLength(2)
    for (const command of graphqlCommands) {
      expect(graphqlFlagNames(command).sort()).toEqual(declaredVariables(command).sort())
    }
  })

  it('includes final edits from the user', () => {
    expect(submitPrompt(pr, 'COMMENT', ' drop 2 ')).toContain('Apply these final edits from the user before posting:\ndrop 2\n')
  })
})
