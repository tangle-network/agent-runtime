/** Canonical provider request lowering for buffered and streamed completions. */

import { isRecord } from '@tangle-network/agent-core'
import type { ReasoningEffort } from '@tangle-network/agent-interface'
import type { ChatCompletionOptions } from './router-client'
import type { RouterTransportConfig } from './router-http-transport'
import type { RouterRetryPolicy } from './router-retry-policy'

/**
 * Router provider routing, lowered into every request a transport sends as
 * `providerOptions.gateway.{only, allowFallbacks}` and `require_model`. Braid's Z.ai-only release
 * proof (all-costs #10337) went out without it and was served by fireworks/glm-5p3.
 */
export interface RouterRouting {
  /** Providers the Router may serve the request from, such as `['zai']`. */
  readonly only?: ReadonlyArray<string>
  /** Whether the Router may fall back to a provider outside `only`. */
  readonly allowFallbacks?: boolean
  /** Refuse the request rather than serve a model other than the one it names. */
  readonly requireModel?: boolean
}

/**
 * Private request configuration used by Runtime's Router adapter.
 *
 * Do not export this through a package entry point. Public callers execute a concrete
 * `AgentProfile` through `createExecutor` + `streamAgentTurn`; only Runtime may lower that profile
 * into these provider request fields.
 */
export interface RouterConfig extends RouterTransportConfig {
  model: string
  /** Exact retry controls lowered from `AgentProfile.model.metadata.retry`. */
  retry?: RouterRetryPolicy
  /**
   * Optional ceiling for one completion, forwarded as `max_tokens`.
   *
   * A REASONING model spends this budget on hidden thinking BEFORE it emits a visible token, so
   * the default can truncate one mid-thought and return no content at all — observed live with a
   * model that spent 8,188 of the 8,192 on reasoning and answered with nothing. Raise it for a
   * thinking model; the ceiling belongs to the router and model a caller chose, which is why it
   * lives here rather than on one call site.
   */
  maxTokens?: number
  /**
   * Optional ceiling on TOTAL completion tokens — visible answer plus hidden reasoning —
   * forwarded as `max_completion_tokens`. Distinct from `maxTokens`: a reasoning model can spend
   * an entire `max_tokens` budget on hidden thinking, so only this field bounds what the provider
   * bills for one completion.
   */
  maxCompletionTokens?: number
  /**
   * Take the tool-calling completion over SSE instead of one buffered POST. Off by default —
   * `routerChatWithTools` never streams, and every existing caller keeps the buffered transport
   * byte for byte.
   *
   * Why it exists: a buffered POST holds one connection idle for the WHOLE completion, and a
   * supervisor turn is the longest completion in the system. An intermediary gateway with an
   * idle-read timeout kills that connection mid-completion (the 524/503 family). A streamed
   * response puts bytes on the wire from the first generated token on, so the connection is only
   * idle through prefill. It does NOT shorten prefill, so a gateway whose deadline is
   * time-to-FIRST-byte is unaffected; only an idle-timeout gateway is.
   *
   * Mutually exclusive with `complete`: the injected transport returns one parsed JSON body and has
   * no stream to read, so setting both throws rather than silently taking the buffered path.
   *
   * WHICH PATHS CAN OPT IN. `routerBrain` reads this flag through its private `chatWithTools`
   * transport switch. Profiled scalar and tool-loop executors choose the buffered or streamed
   * completion directly from `AgentProfile.model.metadata.stream`; their request configuration
   * still carries the profile's other execution settings. `supervisorAgent` lowers the same
   * exact profile into its brain configuration through `supervisor-router-config.ts`.
   * A direct `routerChatWithTools` call remains buffered; callers choose its streamed counterpart
   * explicitly. The local sandbox client's `routerBrain` configuration is built from its own
   * options without this flag, so that path remains buffered.
   */
  stream?: boolean
}

export interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: unknown
    outputSchema?: Record<string, unknown> | boolean
  }
}

/** The OpenAI-shape request body both plain-chat transports send. One builder so the streamed
 *  completion cannot drift from the buffered one on model, ceilings, seed, or reasoning effort. */
export function chatCompletionBody(
  cfg: RouterConfig,
  messages: ReadonlyArray<{ role: string; content: unknown }>,
  opts: ChatCompletionOptions | undefined,
): Record<string, unknown> {
  const temperature = opts?.temperature
  const maxTokens = opts?.maxTokens ?? cfg.maxTokens
  const maxCompletionTokens = opts?.maxCompletionTokens ?? cfg.maxCompletionTokens
  return {
    ...withRouting(
      providerRequestExtras(opts?.extraBody, [
        'model',
        'messages',
        'temperature',
        'max_tokens',
        'max_completion_tokens',
        'seed',
        'reasoning_effort',
        'stream',
        'stream_options',
      ]),
      cfg.routing,
    ),
    model: cfg.model,
    messages,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
    ...(maxCompletionTokens !== undefined ? { max_completion_tokens: maxCompletionTokens } : {}),
    ...(opts?.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
  }
}

/** The OpenAI-shape request body both tool-calling transports send. One builder so the streamed
 *  turn cannot drift from the buffered one on model, temperature, tool_choice, or the ceiling. */
export function toolCompletionBody(
  cfg: RouterConfig,
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<ToolSpec>,
  opts?: {
    temperature?: number
    toolChoice?: 'auto' | 'required' | 'none'
    maxTokens?: number
    maxCompletionTokens?: number
    seed?: number
    extraBody?: Readonly<Record<string, unknown>>
    reasoningEffort?: ReasoningEffort
  },
): Record<string, unknown> {
  const maxCompletionTokens = opts?.maxCompletionTokens ?? cfg.maxCompletionTokens
  return {
    ...withRouting(
      providerRequestExtras(opts?.extraBody, [
        'model',
        'messages',
        'tools',
        'tool_choice',
        'temperature',
        'max_tokens',
        'max_completion_tokens',
        'seed',
        'reasoning_effort',
        'stream',
        'stream_options',
      ]),
      cfg.routing,
    ),
    model: cfg.model,
    messages,
    ...(tools.length > 0
      ? {
          tools: tools.map(({ function: { outputSchema: _outputSchema, ...fn }, ...tool }) => ({
            ...tool,
            function: fn,
          })),
          tool_choice: opts?.toolChoice ?? 'auto',
        }
      : {}),
    ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(maxCompletionTokens !== undefined ? { max_completion_tokens: maxCompletionTokens } : {}),
    ...(opts?.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts?.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
  }
}

/** The request extras with the transport's provider routing merged into `providerOptions`. */
function withRouting(
  extras: Record<string, unknown>,
  routing: RouterRouting | undefined,
): Record<string, unknown> {
  if (routing === undefined) return extras
  const gateway = {
    ...(routing.only !== undefined ? { only: [...routing.only] } : {}),
    ...(routing.allowFallbacks !== undefined ? { allowFallbacks: routing.allowFallbacks } : {}),
  }
  const providerOptions = isRecord(extras.providerOptions) ? extras.providerOptions : {}
  return {
    ...extras,
    ...(Object.keys(gateway).length === 0
      ? {}
      : {
          providerOptions: {
            ...providerOptions,
            gateway: {
              ...(isRecord(providerOptions.gateway) ? providerOptions.gateway : {}),
              ...gateway,
            },
          },
        }),
    ...(routing.requireModel !== undefined ? { require_model: routing.requireModel } : {}),
  }
}

function providerRequestExtras(
  extraBody: Readonly<Record<string, unknown>> | undefined,
  reservedFields: ReadonlyArray<string>,
): Record<string, unknown> {
  if (!extraBody) return {}
  const extras = { ...extraBody }
  for (const field of reservedFields) delete extras[field]
  return extras
}
