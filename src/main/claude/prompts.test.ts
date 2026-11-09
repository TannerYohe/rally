import { describe, expect, it } from 'vitest'
import { reviewPrompt } from './prompts'

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
