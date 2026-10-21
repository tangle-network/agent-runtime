/**
 * The one router chat client: direct OpenAI-compatible completions through the
 * Tangle router — the cheapest dial, no sandbox. `routerChatWithUsage` returns a
 * measured chat result; `routerChatWithTools` adds function calls, and their
 * streamed counterparts assemble SSE. `routerBrain` adapts completions to the
 * shared tool-loop contract for built-in executors and bench/lab harnesses.
 *
 * Reports REAL token usage so the backend-integrity guard sees a real backend.
 * Returns `undefined` usage when the provider omitted it — never a fabricated 0
 * (a phantom 0 reads as a free call downstream, which the gate would act on).
 */

import type { ReasoningEffort } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import {
  fetchRouterResponse,
  type RouterResponseReceipt,
  retryRouterOperation,
  routerRequestHeaders,
  routerResponseJson,
  throwRouterFailureWithAttempts,
} from './router-http-transport'
import {
  chatCompletionBody,
  type RouterConfig,
  type ToolSpec,
  toolCompletionBody,
} from './router-request-body'
import {
  bufferedCompletionFields,
  meterTurn,
  type PromptCacheUsage,
  parseChatResult,
  type RawUsage,
  reportedModel,
  toolCallProviderFields,
} from './router-response'
import { resolveRouterRetryPolicy } from './router-retry-policy'
import { streamChatCompletion } from './router-streamed-completion'
import { addResourceSpend } from './supervise/resources'
import type { Spend } from './supervise/types'
import type { ToolLoopChat, ToolLoopToolCall } from './tool-loop'

export interface RouterChatResult {
  /** The final answer, with any inline `<think>...</think>` block stripped into `reasoning`. */
  content: string
  /**
   * Thinking-model reasoning, when the provider surfaced it — either as a separate
   * `reasoning`/`reasoning_content` message field (OpenRouter style) or inlined into
   * `content` as a `<think>` block (Groq style). Undefined for non-thinking models.
   * Downstream parsers that match single-token answers must read `content`, which is
   * clean either way; before this split, Groq-style inlining made the same model look
   * broken on one provider and fine on another.
   */
  reasoning?: string
  /** REAL usage, or undefined when the provider reported none. */
  usage?: { input: number; output: number; reasoning?: number }
  /** Explicit per-turn resource measurements supplied by the transport. */
  resources?: Spend['resources']
  /** Local catalog estimate derived from usage; never a provider billing receipt. */
  costUsd?: number
  /** Present with `costUsd` so consumers cannot mistake a catalog estimate for billed spend. */
  costProvenance?: 'catalog-estimate'
  /** Provider-reported billed cost. Absent means dollar spend is unknown. */
  billedCostUsd?: number
  /** Provider-reported prompt-cache fields; missing fields remain missing. */
  cache?: PromptCacheUsage
  /** Provider terminal reason (`stop`, `length`, ...), when reported. */
  finishReason?: string
  /** Exact HTTP/injected-transport calls consumed by this completion. */
  transportAttempts: number
  /** Model identity reported by the provider response. Absent when the provider omitted it. */
  model?: string
}

export interface RouterChatToolsResult {
  /** Complete buffered response, including routing decisions and physical call receipts. */
  response?: unknown
  content: string | null
  toolCalls: ToolLoopToolCall[]
  usage?: { input: number; output: number; reasoning?: number }
  /** Explicit per-turn resource measurements supplied by the transport. */
  resources?: Spend['resources']
  costUsd?: number
  /** Present with `costUsd` so consumers cannot mistake a catalog estimate for billed spend. */
  costProvenance?: 'catalog-estimate'
  /** Provider-reported billed cost. Absent means dollar spend is unknown. */
  billedCostUsd?: number
  /** Provider-reported prompt-cache fields; missing fields remain missing. */
  cache?: PromptCacheUsage
  /**
   * Thinking-model reasoning, normalized the way `RouterChatResult.reasoning` is (a separate
   * `reasoning_content`/`reasoning` field, or an inline `<think>` block split out of `content`).
   * Populated by the STREAMED path only — `routerChatWithTools` discards reasoning today and its
   * behavior is preserved unchanged, so a buffered turn still leaves this undefined.
   */
  reasoning?: string
  /**
   * The provider's `finish_reason` for the turn (`'stop'`, `'tool_calls'`, `'length'`, …).
   * Populated by the STREAMED path only. `'length'` is the truncation signal the buffered path
   * cannot surface: it says the turn hit `max_tokens`, not that the model chose to stop.
   */
  finishReason?: string
  /**
   * The turn happened and its token usage is UNKNOWN — not zero, not free. Set by the STREAMED
   * transport when the stream ran to completion without a single usage-bearing chunk, which means
   * the `stream_options.include_usage` contract was not honored upstream.
   *
   * It exists so a bare `usage: undefined` cannot read as a free turn: a metering caller branches
   * on this marker and records an UNKNOWN turn (see the coordination driver's `meteredBrain`),
   * rather than skipping the turn and letting a conserved budget pool believe it cost nothing.
   */
  usageUnknown?: true
  /** Exact HTTP/injected-transport calls consumed by this completion. */
  transportAttempts: number
  /** Model identity reported by the provider response. Absent when the provider omitted it. */
  model?: string
}

/** Per-call options shared by the buffered and streamed plain-chat transports. */
export type ChatCompletionOptions = NonNullable<Parameters<typeof routerChatWithUsage>[2]>

/** One OpenAI-compatible chat completion through the Tangle router, returning text + REAL token usage (`undefined` when the provider omits it — never a fabricated 0). */
export async function routerChatWithUsage(
  cfg: RouterConfig,
  messages: ReadonlyArray<{ role: string; content: unknown }>,
  opts?: {
    temperature?: number
    signal?: AbortSignal
    maxTokens?: number
    /** Ceiling on total billed completion tokens, sent as `max_completion_tokens`. */
    maxCompletionTokens?: number
    /** OpenAI-compatible deterministic seed. Omit when the provider does not support it. */
    seed?: number
    /**
     * Provider-specific request fields such as Z.AI's `thinking` object.
     * Canonical fields are written after these extras and cannot be overridden here.
     */
    extraBody?: Readonly<Record<string, unknown>>
    /**
     * Reasoning control for thinking models, forwarded as `reasoning_effort`.
     * 'none' is the load-bearing value: binary/single-token decisions (routing,
     * gating) on a thinking model otherwise burn the whole token budget inside
     * the think block — on slow backends (CPU-local) that turns into a client
     * timeout, not just waste. Providers that ignore the field are handled by
     * the reasoning/content split in `parseChatResult`.
     */
    reasoningEffort?: ReasoningEffort
    /** Stable logical-call id reused across transport retries. */
    callId?: string
    /** Caller trace correlation forwarded independently of idempotency. */
    correlationId?: string
    /** Headers inherited from an enclosing conversation or task. */
    propagatedHeaders?: Readonly<Record<string, string>>
  },
): Promise<RouterChatResult> {
  const url = `${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = routerRequestHeaders(cfg, opts)
  const body = (): Record<string, unknown> => chatCompletionBody(cfg, messages, opts)
  const retry = resolveRouterRetryPolicy(cfg.retry, 'RouterConfig.retry')
  // Injected transport short-circuits the network: the offline benchmark seam. It owns its own
  // determinism while sharing the HTTP path's retry, timeout, and cancellation behavior.
  const complete = cfg.complete
  if (complete) {
    const { value, attempts } = await retryRouterOperation(retry, opts?.signal, (signal) =>
      complete(body(), {
        headers,
        signal,
      }),
    )
    return parseChatResult(value, cfg.model, attempts)
  }
  // Retry transient upstream failures (429/5xx) with backoff so a single capacity
  // hiccup does not kill a whole multi-model benchmark run. Provider requests to
  // change temperature fail: generation behavior belongs to the exact profile.
  const { response, attempts } = await fetchRouterResponse(
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body()),
    },
    opts?.signal,
    retry,
  )
  return parseChatResult(await routerResponseJson(response, attempts), cfg.model, attempts)
}

/**
 * A router completion WITH tool-calling — the operator driver's LLM seam. Passes OpenAI-shape
 * `messages` (system/user/assistant-with-tool_calls/tool roles) + function `tools`, and returns the
 * assistant text plus the tool calls the model wants run. Same fail-loud + real-usage discipline as
 * `routerChatWithUsage`. `tool_choice: 'auto'` lets the model decide; the driver loops on the result.
 */
export async function routerChatWithTools(
  cfg: RouterConfig,
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters: unknown
      outputSchema?: Record<string, unknown> | boolean
    }
  }>,
  opts?: {
    /** Observe each actual HTTP attempt before decoding or rejecting its response. */
    onResponse?: (receipt: RouterResponseReceipt) => void | Promise<void>
    temperature?: number
    signal?: AbortSignal
    toolChoice?: 'auto' | 'required' | 'none'
    maxTokens?: number
    /** Ceiling on total billed completion tokens, sent as `max_completion_tokens`. */
    maxCompletionTokens?: number
    /** OpenAI-compatible deterministic seed. Omit when the provider does not support it. */
    seed?: number
    /** Provider-specific request fields; canonical fields cannot be overridden here. */
    extraBody?: Readonly<Record<string, unknown>>
    reasoningEffort?: ReasoningEffort
    callId?: string
    correlationId?: string
    /** Headers inherited from an enclosing conversation or task. */
    propagatedHeaders?: Readonly<Record<string, string>>
  },
): Promise<RouterChatToolsResult> {
  const body = toolCompletionBody(cfg, messages, tools, opts)
  const retry = resolveRouterRetryPolicy(cfg.retry, 'RouterConfig.retry')
  // Injected transport short-circuits the network — the offline benchmark seam (see RouterConfig.complete).
  let transportAttempts = 1
  const headers = routerRequestHeaders(cfg, opts)
  const complete = cfg.complete
  const raw = complete
    ? await (async () => {
        const result = await retryRouterOperation(retry, opts?.signal, (signal) =>
          complete(structuredClone(body), { headers, signal }),
        )
        transportAttempts = result.attempts
        return result.value
      })()
    : await (async () => {
        const result = await fetchRouterResponse(
          `${cfg.routerBaseUrl.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          },
          opts?.signal,
          retry,
          opts?.onResponse,
        )
        transportAttempts = result.attempts
        return routerResponseJson(result.response, result.attempts)
      })()
  const data = raw as {
    model?: unknown
    choices?: Array<{
      message?: {
        content?: string | null
        tool_calls?: Array<
          Record<string, unknown> & {
            id?: string
            function?: { name?: string; arguments?: string }
          }
        >
      }
      finish_reason?: string
    }>
    usage?: RawUsage
  }
  const msg = data.choices?.[0]?.message
  if (!msg) throw new ValidationError('router completion: no choices[0].message')
  const toolCalls: ToolLoopToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => {
    const providerFields = toolCallProviderFields(tc)
    return {
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? '{}',
      ...(providerFields ? { providerFields } : {}),
    }
  })
  const measured = meterTurn(data.usage, cfg.model, transportAttempts)
  return {
    response: raw,
    content: msg?.content ?? null,
    toolCalls,
    transportAttempts,
    ...(reportedModel(data.model) ? { model: reportedModel(data.model) } : {}),
    ...bufferedCompletionFields(data, measured),
  }
}

/**
 * The SAME completion as `routerChatWithTools`, taken over SSE (`stream: true`) and reassembled
 * into the identical `RouterChatToolsResult`. Opt in with `RouterConfig.stream` — the buffered
 * function is untouched and stays the default for every existing caller.
 *
 * What it buys: a buffered POST holds one connection idle for the whole completion, and that idle
 * window is what an intermediary gateway kills (524/503). Streaming puts bytes on the wire from the
 * first generated token, so the connection is only idle through prefill.
 *
 * Usage accounting is preserved exactly: `stream_options.include_usage` asks the provider for a
 * terminal usage chunk, and those tokens run through the same `meterTurn` the buffered path uses.
 *
 * When NO chunk reported usage, `usage`/`costUsd` stay undefined (never a fabricated 0) AND
 * `usageUnknown: true` is set. A stream that finishes with no usage chunk means the
 * `include_usage` request was not honored upstream, and returning a quiet `undefined` for it is
 * indistinguishable from a free turn — the marker is what lets a metering caller record an UNKNOWN
 * turn instead. Streaming raises the odds of this (one dropped terminal frame is enough), which is
 * why the streamed transport says so explicitly and the buffered one has no equivalent claim to make.
 */
export async function streamRouterChatWithTools(
  cfg: RouterConfig,
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<ToolSpec>,
  opts?: {
    temperature?: number
    signal?: AbortSignal
    toolChoice?: 'auto' | 'required' | 'none'
    maxTokens?: number
    /** Ceiling on total billed completion tokens, sent as `max_completion_tokens`. */
    maxCompletionTokens?: number
    seed?: number
    /** Provider-specific request fields; canonical streaming fields cannot be overridden here. */
    extraBody?: Readonly<Record<string, unknown>>
    reasoningEffort?: ReasoningEffort
    callId?: string
    correlationId?: string
    /** Headers inherited from an enclosing conversation or task. */
    propagatedHeaders?: Readonly<Record<string, string>>
  },
): Promise<RouterChatToolsResult> {
  const streamed = await streamChatCompletion(
    'streamRouterChatWithTools',
    cfg,
    toolCompletionBody(cfg, messages, tools, opts),
    opts,
  )
  const toolCalls: ToolLoopToolCall[] = [...streamed.calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, call]) => ({
      id: call.id ?? `call_${index}`,
      name: call.name ?? '',
      arguments: call.arguments || '{}',
      ...(call.providerFields ? { providerFields: call.providerFields } : {}),
    }))
  const { usage, resources, costUsd, costProvenance, billedCostUsd, cache } = meterTurn(
    streamed.rawUsage,
    cfg.model,
    streamed.transportAttempts,
  )
  return {
    // `null` only when NO content field was ever sent — the buffered path's `msg?.content ?? null`.
    content: streamed.sawContent ? streamed.content : null,
    toolCalls,
    transportAttempts: streamed.transportAttempts,
    ...(streamed.model !== undefined ? { model: streamed.model } : {}),
    ...(streamed.reasoning ? { reasoning: streamed.reasoning } : {}),
    ...(streamed.finishReason !== undefined ? { finishReason: streamed.finishReason } : {}),
    ...(usage ? { usage } : {}),
    ...(resources ? { resources } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(costProvenance ? { costProvenance } : {}),
    ...(billedCostUsd !== undefined ? { billedCostUsd } : {}),
    ...(cache ? { cache } : {}),
    // The turn ran; its tokens are unknown. Marked rather than left as a bare `undefined`, which a
    // metering caller cannot tell apart from a turn that genuinely cost nothing.
    ...(usage ? {} : { usageUnknown: true as const }),
  }
}

/**
 * The SAME completion as `routerChatWithUsage`, taken over SSE (`stream: true`) and reassembled
 * into the identical `RouterChatResult`: content with any inline `<think>` split out, reasoning,
 * finish reason, reported model, usage, catalog estimate, billed cost, and prompt cache.
 *
 * What it buys: the Tangle Router bounds a request by a deadline that ends when response headers
 * are committed. A buffered completion commits headers only after the whole generation, so a long
 * thinking-model answer outlives that deadline and fails with `request_deadline_exceeded`. A
 * streamed response commits headers at the first byte, so generation length is no longer bounded
 * by the Router's request deadline.
 *
 * Usage that never arrives stays `undefined` (never a fabricated 0), which the executor records as
 * unknown tokens. A stream that ends without a single choice is refused, matching the buffered
 * path's refusal of a completion with no `choices[0].message`.
 */
export async function streamRouterChatWithUsage(
  cfg: RouterConfig,
  messages: ReadonlyArray<{ role: string; content: unknown }>,
  opts?: ChatCompletionOptions,
): Promise<RouterChatResult> {
  const streamed = await streamChatCompletion(
    'streamRouterChatWithUsage',
    cfg,
    chatCompletionBody(cfg, messages, opts),
    opts,
  )
  if (!streamed.sawChoice) {
    throwRouterFailureWithAttempts(
      new ValidationError('router stream: completion carried no choices'),
      streamed.transportAttempts,
    )
  }
  const { usage, resources, costUsd, costProvenance, billedCostUsd, cache } = meterTurn(
    streamed.rawUsage,
    cfg.model,
    streamed.transportAttempts,
  )
  return {
    content: streamed.content,
    transportAttempts: streamed.transportAttempts,
    ...(streamed.model !== undefined ? { model: streamed.model } : {}),
    ...(streamed.reasoning ? { reasoning: streamed.reasoning } : {}),
    ...(usage ? { usage } : {}),
    ...(resources ? { resources } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(costProvenance ? { costProvenance } : {}),
    ...(billedCostUsd !== undefined ? { billedCostUsd } : {}),
    ...(cache ? { cache } : {}),
    ...(streamed.finishReason !== undefined ? { finishReason: streamed.finishReason } : {}),
  }
}

/** Pick the tool-calling transport the config asked for. `routerChatWithTools` itself never
 *  streams; `routerBrain` uses this switch to honor `RouterConfig.stream`. Profiled executors
 *  choose the buffered or streamed completion directly from their model execution settings. */
function chatWithTools(
  cfg: RouterConfig,
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<ToolSpec>,
  opts?: {
    temperature?: number
    signal?: AbortSignal
    toolChoice?: 'auto' | 'required' | 'none'
    maxTokens?: number
    /** Ceiling on total billed completion tokens, sent as `max_completion_tokens`. */
    maxCompletionTokens?: number
    seed?: number
    extraBody?: Readonly<Record<string, unknown>>
    reasoningEffort?: ReasoningEffort
  },
): Promise<RouterChatToolsResult> {
  return cfg.stream === true
    ? streamRouterChatWithTools(cfg, messages, tools, opts)
    : routerChatWithTools(cfg, messages, tools, opts)
}

/**
 * The router as a supervisor BRAIN: the canonical `ToolLoopChat` seam backed by the router's
 * tool-calling. The driver's spawn/observe/steer/await/stop turns become real router tool-calls.
 * The turnkey production brain — tests script a mock `ToolLoopChat`; production passes
 * `routerBrain(cfg)`. No message translation: the loop already speaks the router's OpenAI shape.
 *
 * Transport follows `cfg.stream`: buffered by default, SSE when the caller opts in. A supervisor
 * turn is the longest completion in the system, so it is the call site streaming exists for.
 */
export function routerBrain(
  cfg: RouterConfig,
  opts: {
    temperature?: number
    reasoningEffort?: ReasoningEffort
    seed?: number
    toolChoice?: 'auto' | 'required' | 'none'
    extraBody?: Readonly<Record<string, unknown>>
  } = {},
): ToolLoopChat {
  const temperature = opts.temperature ?? 0.4
  return async (messages, tools, context) => {
    const result = await chatWithTools(cfg, messages, tools, {
      temperature,
      toolChoice: opts.toolChoice ?? 'auto',
      // The config's ceiling reaches the completion, so a caller driving a reasoning model can
      // raise it. Without this a router-brained supervisor is stuck on the 8192 default.
      ...(cfg.maxTokens !== undefined ? { maxTokens: cfg.maxTokens } : {}),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      ...(opts.extraBody !== undefined ? { extraBody: opts.extraBody } : {}),
      ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
      ...(context?.signal ? { signal: context.signal } : {}),
      ...(context?.callId ? { callId: context.callId } : {}),
      ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
    })
    const hasBilledCost = result.billedCostUsd !== undefined
    return {
      content: result.content,
      toolCalls: result.toolCalls,
      ...(result.usage !== undefined ? { usage: result.usage } : {}),
      ...addResourceSpend(result.resources),
      ...(result.usageUnknown === true ? { usageUnknown: true as const } : {}),
      ...(result.model !== undefined ? { model: result.model } : {}),
      ...(result.cache !== undefined ? { promptCache: Object.freeze({ ...result.cache }) } : {}),
      transportAttempts: result.transportAttempts,
      ...(hasBilledCost
        ? { costUsd: result.billedCostUsd, costProvenance: 'billing-receipt' as const }
        : result.costUsd !== undefined
          ? { costUsd: result.costUsd, costProvenance: result.costProvenance }
          : {}),
    }
  }
}
