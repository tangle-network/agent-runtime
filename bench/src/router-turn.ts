import {
  type AgentProfile,
  agentProfileSchema,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import {
  collectAgentTurn,
  createExecutor,
  streamAgentTurn,
  type CollectedAgentTurn,
  type ToolSpec,
} from '@tangle-network/agent-runtime/kernel'

/** Bench-local target shorthand; Runtime still executes only the exact profile below. */
export interface BenchRouterTarget {
  routerBaseUrl: string
  routerKey: string
  profile: AgentProfile
}

export interface BenchRouterTurnConfig extends BenchRouterTarget {
  tools?: ReadonlyArray<ToolSpec>
  timeoutMs?: number
  signal?: AbortSignal
}

export interface BenchProfileSettings {
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  retry?: {
    maxAttempts?: number
    initialBackoffMs?: number
    maxBackoffMs?: number
    jitter?: number
    retryStatuses?: ReadonlyArray<number>
    requestTimeoutMs?: number
  }
  maxTurns?: number
  seed?: number
  reasoningEffort?: ReasoningEffort
  extraBody?: Readonly<Record<string, unknown>>
  toolChoice?: 'auto' | 'required' | 'none'
}

/** Author an exact direct-Router profile for a benchmark. This is profile construction only;
 * execution still accepts no model or generation fields outside the returned AgentProfile. */
export function benchRouterProfile(
  name: string,
  model: string,
  settings: BenchProfileSettings = {},
): AgentProfile {
  return withBenchProfile(
    {
      name,
      harness: 'cli-base',
      model: { provider: 'tangle-router', default: model },
    },
    settings,
  )
}

/** Derive another exact profile while preserving all untouched canonical axes. */
export function withBenchProfile(
  base: AgentProfile,
  settings: BenchProfileSettings & { name?: string },
): AgentProfile {
  const metadata = {
    ...(base.model?.metadata ?? {}),
    ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    ...(settings.maxTokens !== undefined ? { maxTokens: settings.maxTokens } : {}),
    ...(settings.retry !== undefined ? { retry: settings.retry } : {}),
    ...(settings.maxTurns !== undefined ? { maxTurns: settings.maxTurns } : {}),
    ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
    ...(settings.extraBody !== undefined ? { extraBody: settings.extraBody } : {}),
    ...(settings.toolChoice !== undefined ? { toolChoice: settings.toolChoice } : {}),
  }
  return agentProfileSchema.parse({
    ...base,
    ...(settings.name ? { name: settings.name } : {}),
    model: {
      ...base.model,
      ...(settings.reasoningEffort !== undefined
        ? { reasoningEffort: settings.reasoningEffort }
        : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    },
    ...(settings.systemPrompt !== undefined
      ? { prompt: { ...base.prompt, systemPrompt: settings.systemPrompt } }
      : {}),
  })
}

export function benchProfileModel(profile: AgentProfile): string {
  const model = profile.model?.default
  if (typeof model !== 'string' || model.length === 0 || model === 'runtime-selected') {
    throw new Error('benchmark AgentProfile.model.default must be concrete')
  }
  return model
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
    ...(config.tools ? { tools: config.tools } : {}),
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
