import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { Config } from '@shared/types'

type ModelOptions = Pick<Options, 'model' | 'effort' | 'env'>

export function reviewModelOptions(config: Config, baseEnv: NodeJS.ProcessEnv): ModelOptions {
  const env: Record<string, string | undefined> = { ...baseEnv }
  if (config.subagentModel) env.CLAUDE_CODE_SUBAGENT_MODEL = config.subagentModel
  if (config.subagentEffort) env.CLAUDE_CODE_SUBAGENT_EFFORT = config.subagentEffort
  return {
    model: config.reviewModel ?? undefined,
    effort: config.reviewEffort ?? undefined,
    env,
  }
}
