/** Provider completion fields and measured resource accounting. */

import { ValidationError } from '../errors'
import { priceTokens } from '../pricing/router-prices'
import type { RouterChatResult } from './router-client'
import { addResourceSpend } from './supervise/resources'
import type { Spend } from './supervise/types'

/** What the router reports about prefix caching for one completion. Absent when the provider
 *  said nothing — an unreported cache is not a miss, and a miss is not a zero saving. */
export interface PromptCacheUsage {
  /** Prompt tokens served from a cached prefix. */
  readonly readTokens?: number
  /** Prompt tokens written INTO the cache by this call. */
  readonly writeTokens?: number
  /** Prompt tokens that missed a provider cache. */
  readonly missTokens?: number
  /** Dollars the provider says the cache read saved on this call. */
  readonly readSavingsUsd?: number
  /** The provider's own word for what happened: `hit`, `miss`, `read`, … Kept verbatim rather
   *  than normalized, so a new status is visible instead of silently bucketed. */
  readonly status?: string
}

export function parseChatResult(
  json: unknown,
  model: string,
  transportAttempts: number,
): RouterChatResult {
  const data = json as {
    model?: unknown
    choices?: Array<{
      message?: { content?: string; reasoning?: string; reasoning_content?: string }
      finish_reason?: string
    }>
    usage?: RawUsage
  }
  const measured = meterTurn(data.usage, model, transportAttempts)
  const msg = data.choices?.[0]?.message
  if (!msg) throw new ValidationError('router completion: no choices[0].message')
  const { content, reasoning } = splitReasoning(
    msg?.content ?? '',
    msg?.reasoning ?? msg?.reasoning_content,
  )
  return {
    content,
    transportAttempts,
    ...(reportedModel(data.model) ? { model: reportedModel(data.model) } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...bufferedCompletionFields(data, measured),
  }
}

/**
 * Normalize the two ways providers surface thinking-model reasoning into one shape:
 * a separate field (OpenRouter: `reasoning`, DeepSeek/Kimi: `reasoning_content`) or a
 * `<think>...</think>` block inlined at the head of `content` (Groq, some local runtimes).
 * An UNCLOSED `<think>` (the model hit max_tokens mid-thought) yields empty content and
 * everything as reasoning — which is honest: no final answer was emitted.
 */
export function splitReasoning(
  rawContent: string,
  fieldReasoning: string | undefined,
): { content: string; reasoning?: string } {
  const open = rawContent.indexOf('<think>')
  if (open !== -1) {
    const close = rawContent.indexOf('</think>', open)
    const inline = close !== -1 ? rawContent.slice(open + 7, close) : rawContent.slice(open + 7)
    const rest =
      close !== -1
        ? rawContent.slice(0, open) + rawContent.slice(close + 8)
        : rawContent.slice(0, open)
    const reasoning = [fieldReasoning, inline.trim()].filter(Boolean).join('\n')
    return { content: rest.trim(), ...(reasoning ? { reasoning } : {}) }
  }
  return { content: rawContent, ...(fieldReasoning ? { reasoning: fieldReasoning } : {}) }
}

/** Keep provider extensions beside, never in place of, the canonical call identity and function.
 * Stream indices identify assembly slots and are not replay fields. */
export function toolCallProviderFields(
  call: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const fields = Object.fromEntries(
    Object.entries(call).filter(([key]) => !['id', 'type', 'function', 'index'].includes(key)),
  )
  return Object.keys(fields).length === 0 ? undefined : fields
}

export function reportedModel(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * REAL usage → the metered pair, or `undefined` when the provider reported none. Never a
 * fabricated 0: a phantom 0 reads as a free call to the conserved budget pool, which would then
 * over-spend. Shared by the buffered and streamed transports so both meter identically.
 */
export function meterTurn(
  raw: RawUsage | undefined,
  model: string,
  transportAttempts: number,
): {
  usage?: { input: number; output: number; reasoning?: number }
  /** Explicit per-turn resource measurements supplied by the transport. */
  resources?: Spend['resources']
  costUsd?: number
  costProvenance?: 'catalog-estimate'
  billedCostUsd?: number
  cache?: PromptCacheUsage
} {
  let resources = addResourceSpend(raw?.resources).resources
  if (transportAttempts > 1 && resources !== undefined) {
    // The final receipt cannot prove that failed transport attempts consumed no resources.
    resources = Object.fromEntries(
      Object.entries(resources).map(([name, value]) => [name, { ...value, known: false }]),
    )
  }
  const reasoning = providerReasoningTokens(raw)
  const usage =
    raw && typeof raw.prompt_tokens === 'number' && typeof raw.completion_tokens === 'number'
      ? {
          input: raw.prompt_tokens,
          output: raw.completion_tokens,
          ...(reasoning !== undefined ? { reasoning } : {}),
        }
      : undefined
  const cache = readPromptCache(raw)
  const billedCostUsd = providerBilledCost(raw)
  if (!usage) {
    return {
      ...(resources ? { resources } : {}),
      ...(billedCostUsd !== undefined ? { billedCostUsd } : {}),
      ...(cache ? { cache } : {}),
    }
  }
  const localEstimate = priceTokens({ model, inputTokens: usage.input, outputTokens: usage.output })
  // A cached prefix token is billed at a discount the local price table does not know about, so
  // subtract the provider's OWN reported saving rather than re-deriving a discount here. Without
  // this a long supervisor run — which re-sends a growing transcript every turn — is reported at
  // full price for tokens the provider served from cache.
  const costUsd =
    localEstimate !== undefined && cache?.readSavingsUsd !== undefined
      ? Math.max(0, localEstimate - cache.readSavingsUsd)
      : localEstimate
  return {
    usage,
    ...(resources ? { resources } : {}),
    ...(costUsd !== undefined ? { costUsd, costProvenance: 'catalog-estimate' as const } : {}),
    ...(billedCostUsd !== undefined ? { billedCostUsd } : {}),
    ...(cache ? { cache } : {}),
  }
}

function providerReasoningTokens(raw: RawUsage | undefined): number | undefined {
  if (!raw) return undefined
  for (const value of [raw.completion_tokens_details?.reasoning_tokens, raw.reasoning_tokens]) {
    if (Number.isSafeInteger(value) && (value as number) >= 0) return value as number
  }
  return undefined
}

function providerBilledCost(raw: RawUsage | undefined): number | undefined {
  if (!raw) return undefined
  for (const value of [raw.cost, raw.cost_usd]) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return undefined
}

export interface RawUsage {
  resources?: Spend['resources']
  prompt_tokens?: number
  completion_tokens?: number
  cost?: number
  cost_usd?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
  reasoning_tokens?: number
  prompt_cache?: unknown
}

function readPromptCache(raw: unknown): PromptCacheUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const nested =
    o.prompt_cache && typeof o.prompt_cache === 'object'
      ? (o.prompt_cache as Record<string, unknown>)
      : o
  const details =
    o.prompt_tokens_details && typeof o.prompt_tokens_details === 'object'
      ? (o.prompt_tokens_details as Record<string, unknown>)
      : undefined
  const readTokens =
    num(nested.read_tokens) ?? num(o.prompt_cache_hit_tokens) ?? num(details?.cached_tokens)
  const writeTokens = num(nested.write_tokens)
  const missTokens = num(o.prompt_cache_miss_tokens)
  const savings = num(nested.read_savings_usd)
  const status = typeof nested.status === 'string' ? nested.status : undefined
  if (
    readTokens === undefined &&
    writeTokens === undefined &&
    missTokens === undefined &&
    savings === undefined &&
    status === undefined
  ) {
    return undefined
  }
  return {
    ...(readTokens !== undefined ? { readTokens } : {}),
    ...(writeTokens !== undefined ? { writeTokens } : {}),
    ...(missTokens !== undefined ? { missTokens } : {}),
    ...(savings !== undefined ? { readSavingsUsd: savings } : {}),
    ...(status !== undefined ? { status } : {}),
  }
}

/** Buffered completions share the same ordered, absence-preserving measured fields. */
export function bufferedCompletionFields(
  data: { choices?: Array<{ finish_reason?: string }> },
  measured: ReturnType<typeof meterTurn>,
): Pick<
  RouterChatResult,
  'usage' | 'resources' | 'costUsd' | 'costProvenance' | 'billedCostUsd' | 'cache' | 'finishReason'
> {
  const { usage, resources, costUsd, costProvenance, billedCostUsd, cache } = measured
  return {
    ...(usage ? { usage } : {}),
    ...(resources ? { resources } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(costProvenance ? { costProvenance } : {}),
    ...(billedCostUsd !== undefined ? { billedCostUsd } : {}),
    ...(cache ? { cache } : {}),
    ...(typeof data.choices?.[0]?.finish_reason === 'string'
      ? { finishReason: data.choices[0].finish_reason }
      : {}),
  }
}
