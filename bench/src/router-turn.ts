import type { AgentProfile, ReasoningEffort } from '@tangle-network/agent-interface'
import {
  collectAgentTurn,
  createExecutor,
  streamAgentTurn,
  type CollectedAgentTurn,
  type ToolSpec,
} from '@tangle-network/agent-runtime/kernel'

export interface BenchRouterTurnConfig {
  routerBaseUrl: string
  routerKey: string
  profile: AgentProfile
  temperature?: number
  maxTokens?: number
  seed?: number
  reasoningEffort?: ReasoningEffort
  extraBody?: Readonly<Record<string, unknown>>
  tools?: ReadonlyArray<ToolSpec>
  toolChoice?: 'auto' | 'required' | 'none'
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * The benchmark-side entry to Runtime's canonical one-turn path.
 * It is only an ergonomic composition: Runtime still parses the exact profile,
 * materializes the executor, records identity/usage/result events, and refuses
 * profile axes the direct Router backend cannot carry.
 */
export async function runBenchRouterTurn(
  config: BenchRouterTurnConfig,
  input: string | { readonly messages: ReadonlyArray<Readonly<Record<string, unknown>>> },
): Promise<CollectedAgentTurn> {
  if (!config.profile.model?.default) {
    throw new Error('runBenchRouterTurn: profile.model.default is required')
  }
  const factory = createExecutor({
    backend: 'router',
    routerBaseUrl: config.routerBaseUrl,
    routerKey: config.routerKey,
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    ...(config.seed !== undefined ? { seed: config.seed } : {}),
    ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
    ...(config.extraBody ? { extraBody: config.extraBody } : {}),
    ...(config.tools ? { tools: config.tools } : {}),
    ...(config.toolChoice ? { toolChoice: config.toolChoice } : {}),
  })
  const turn = await collectAgentTurn(
    streamAgentTurn(
      { kind: 'executor', factory, profile: config.profile },
      input,
      {
        ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        ...(config.signal ? { signal: config.signal } : {}),
      },
    ),
  )
  if (turn.status !== 'completed') {
    throw new Error(turn.error?.message ?? `Router turn ended with status ${turn.status}`)
  }
  return turn
}
