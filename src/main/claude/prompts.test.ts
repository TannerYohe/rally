import { describe, expect, it } from 'vitest'
import { reviewPrompt, submitPrompt } from './prompts'
import { bashStepLabel } from './timeline'
import { decideToolUse } from './toolPolicy'

const pr = { owner: 'acme', repo: 'api', number: 12, url: 'https://github.com/acme/api/pull/12' }
const FIRST_ATTEMPT = { viewer: 'me', earlierAttemptAt: null }

function submitCommands(): string[] {
  return submitPrompt(pr, 'COMMENT', '', FIRST_ATTEMPT)
    .split('\n')
    .flatMap((line) => line.match(/gh api .*$/) ?? [])
    .map((command) => command.replace(/<[^>]+>/g, '1'))
}

function graphqlFlagNames(command: string): string[] {
  return [...command.matchAll(/-[fF] (\w+)=/g)].map((m) => m[1]).filter((name) => name !== 'query')
}

function declaredVariables(command: string): string[] {
  const signature = command.match(/query='(?:query|mutation)\(([^)]*)\)/)?.[1] ?? ''
  const names = [...signature.matchAll(/\$(\w+):/g)].map((m) => m[1])
  return command.includes('--paginate') ? names.filter((name) => name !== 'endCursor') : names
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
    const prompt = submitPrompt(pr, 'APPROVE', '', FIRST_ATTEMPT)
    expect(prompt).toContain('gh api repos/acme/api/pulls/12/reviews --method POST --input')
    expect(prompt).toContain('gh api graphql --paginate -f owner=acme -f repo=api -F number=12 -f query=')
    expect(prompt).toContain('addPullRequestReviewThreadReply(input: { pullRequestReviewId: $review')
    expect(prompt).toContain('gh api repos/acme/api/pulls/12/reviews/<id>/events --method POST -f event=APPROVE')
    expect(prompt).not.toMatch(/step \d|F5/)
  })

  it('routes thread replies through the pending review instead of the standalone replies endpoint', () => {
    const prompt = submitPrompt(pr, 'COMMENT', '', FIRST_ATTEMPT)
    expect(prompt).not.toMatch(/gh api \S*\/replies/)
  })

  it('only gives commands that the submit-turn tool policy allows, each with its timeline label', () => {
    const decide = (command: string) => decideToolUse('Bash', { command }, { submitting: true, cwd: '/tmp/rally/session', pr })
    expect(submitCommands().map((command) => [bashStepLabel(command, undefined), decide(command)])).toEqual([
      ['Reading PR conversation', { allow: true }],
      ['Deleting pending review', { allow: true }],
      ['Posting pending review', { allow: true }],
      ['Querying review threads', { allow: true }],
      ['Posting thread reply', { allow: true }],
      ['Submitting review', { allow: true }],
      ['Deleting pending review', { allow: true }],
    ])
  })

  it('pages through every review thread', () => {
    const [threads] = submitCommands().filter((command) => command.includes('reviewThreads'))
    expect(threads).toContain('gh api graphql --paginate ')
    expect(threads).toContain('reviewThreads(first: 100, after: $endCursor) { pageInfo { hasNextPage endCursor }')
  })

  it('passes exactly the variables each graphql command declares', () => {
    const graphqlCommands = submitCommands().filter((command) => command.startsWith('gh api graphql'))
    expect(graphqlCommands).toHaveLength(2)
    for (const command of graphqlCommands) {
      expect(graphqlFlagNames(command).sort()).toEqual(declaredVariables(command).sort())
    }
  })

  it('deletes my pending reviews before creating a new one', () => {
    const [list, remove, create] = submitCommands()
    expect(list).toBe(`gh api repos/acme/api/pulls/12/reviews --paginate --jq '.[] | {id, user: .user.login, state, submitted_at, html_url}'`)
    expect(remove).toBe('gh api repos/acme/api/pulls/12/reviews/1 --method DELETE')
    expect(create).toContain('/reviews --method POST --input')
  })

  it('checks whether an unconfirmed earlier attempt already went through before posting again', () => {
    const retry = submitPrompt(pr, 'COMMENT', '', { viewer: 'me', earlierAttemptAt: '2026-11-05T15:24:23.272Z' })
    expect(retry).toContain('started at 2026-11-05T15:24:23.272Z')
    expect(retry).toContain('If one of the reviews by me was submitted at or after that time, that attempt went through')
    expect(submitPrompt(pr, 'COMMENT', '', FIRST_ATTEMPT)).not.toContain('earlier submit attempt')
  })

  it('tells Claude how to find its login when Rally does not know it', () => {
    const retry = submitPrompt(pr, 'COMMENT', '', { viewer: null, earlierAttemptAt: '2026-11-05T15:24:23.272Z' })
    expect(retry).toContain('reviews by you (gh api user --jq .login)')
  })

  it('includes final edits from the user', () => {
    expect(submitPrompt(pr, 'COMMENT', ' drop 2 ', FIRST_ATTEMPT)).toContain('Apply these final edits from the user before posting:\ndrop 2\n')
  })
})
