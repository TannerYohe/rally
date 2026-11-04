import { describe, expect, it } from 'vitest'
import { topLevelMutationFields } from './graphqlMutations'

describe('topLevelMutationFields', () => {
  it('returns no fields for queries', () => {
    expect(topLevelMutationFields('query($o: String!) { repository(owner: $o, name: "x") { id } }')).toEqual([])
    expect(topLevelMutationFields('{ viewer { login } }')).toEqual([])
  })

  it('returns every top-level mutation field, resolving aliases', () => {
    const query = 'mutation($id: ID!) { a: submitPullRequestReview(input: {id: $id}) { pullRequestReview { id } } resolveReviewThread(input: {threadId: "t"}) { thread { id } } }'
    expect(topLevelMutationFields(query)).toEqual(['submitPullRequestReview', 'resolveReviewThread'])
  })

  it('ignores names inside arguments, strings, and nested selections', () => {
    const query = 'mutation { mergePullRequest(input: {pullRequestId: "submitPullRequestReview"}) { pullRequest { submitPullRequestReview } } }'
    expect(topLevelMutationFields(query)).toEqual(['mergePullRequest'])
  })

  it('skips comments up to either line terminator', () => {
    expect(topLevelMutationFields('mutation { # note\n submitPullRequestReview { id } }')).toEqual(['submitPullRequestReview'])
    expect(topLevelMutationFields('mutation { submitPullRequestReview { id } # note\r mergePullRequest { id } }')).toEqual([
      'submitPullRequestReview',
      'mergePullRequest',
    ])
  })

  it('does not end a block string at an escaped triple quote', () => {
    const query = 'mutation { submitPullRequestReview(input: {body: """a \\""" mergePullRequest { id } b"""}) { id } }'
    expect(topLevelMutationFields(query)).toEqual(['submitPullRequestReview'])
    const after = 'mutation { submitPullRequestReview(input: {body: """a \\""" b"""}) { id } mergePullRequest { id } }'
    expect(topLevelMutationFields(after)).toEqual(['submitPullRequestReview', 'mergePullRequest'])
  })

  it('handles escaped quotes in regular strings', () => {
    const query = 'mutation { submitPullRequestReview(input: {body: "say \\"hi\\" mergePullRequest"}) { id } }'
    expect(topLevelMutationFields(query)).toEqual(['submitPullRequestReview'])
  })

  it('skips directives on top-level fields', () => {
    expect(topLevelMutationFields('mutation { submitPullRequestReview @include(if: true) { id } }')).toEqual(['submitPullRequestReview'])
  })

  it('returns null for fragment spreads, unterminated strings, and unbalanced queries', () => {
    expect(topLevelMutationFields('mutation { ...F } fragment F on Mutation { mergePullRequest { id } }')).toBeNull()
    expect(topLevelMutationFields('mutation { submitPullRequestReview(input: {body: "open}) { id } }')).toBeNull()
    expect(topLevelMutationFields('mutation { submitPullRequestReview { id }')).toBeNull()
    expect(topLevelMutationFields('mutation { submitPullRequestReview { id } } }')).toBeNull()
    expect(topLevelMutationFields('mutation { a: } ')).toBeNull()
  })
})
