import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@shared/types'
import { reviewModelOptions } from './modelOptions'

describe('reviewModelOptions', () => {
  it('leaves everything to the system defaults when unset', () => {
    expect(reviewModelOptions(DEFAULT_CONFIG, { PATH: '/bin' })).toEqual({ model: undefined, effort: undefined, env: { PATH: '/bin' } })
  })

  it('pins the review model and effort and passes subagent settings through the environment', () => {
    const config = { ...DEFAULT_CONFIG, reviewModel: 'opus' as const, reviewEffort: 'high' as const, subagentModel: 'sonnet' as const, subagentEffort: 'medium' as const }
    expect(reviewModelOptions(config, { PATH: '/bin' })).toEqual({
      model: 'opus',
      effort: 'high',
      env: { PATH: '/bin', CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet', CLAUDE_CODE_SUBAGENT_EFFORT: 'medium' },
    })
  })
})
