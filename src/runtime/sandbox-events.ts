/**
 * Sandbox-event → runtime-event mapping.
 *
 * The sandbox SDK emits a polymorphic `SandboxEvent = { type, data, id? }`
 * whose `type` vocabulary is backend-determined (opencode, etc.) rather than
 * enumerated by the SDK. Two consumers project it:
 *   - the loop kernel's cost ledger (`extractLlmCallEvent`) — sums usage off
 *     every cost-bearing event, regardless of stream shape;
 *   - the `AgentRuntime.act` streaming contract (`mapSandboxEvent`) — projects
 *     incremental events to the `RuntimeStreamEvent` chat-UX vocabulary.
 *
 * Both live here so the empirically-observed `type` vocabulary has one home.
 */

import type { StreamEvent } from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import type { RuntimeStreamEvent } from '../types'
import { parseCanonicalTransportEvent } from './sandbox-transport-events'

const CANONICAL_STREAM_EVENT_TYPES: ReadonlySet<string> = new Set([
  'message.part.updated',
  'tool-heartbeat',
  'tool-slow',
  'model-processing',
  'status',
  'warning',
  'raw',
  'session.updated',
  'interaction',
  'interaction.cancel',
  'plan.submitted',
])

/** Decode one known Agent Interface event from a Sandbox event. */
export function canonicalStreamEventFromSandboxEvent(event: SandboxEvent): StreamEvent | undefined {
  if (!event || typeof event !== 'object') return undefined
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  const normalized = data.normalized
  if (normalized === undefined && !CANONICAL_STREAM_EVENT_TYPES.has(type)) return undefined
  return parseCanonicalTransportEvent(type, data, normalized, 'sandbox')
}

/**
 * Forward a sandbox event to an optional observer without letting observer
 * behavior affect the run. The observer receives a defensive copy, synchronous
 * throws are swallowed, and returned promises are deliberately not awaited.
 */
export function notifySandboxEventObserver<Meta>(
  event: SandboxEvent,
  observer: ((event: SandboxEvent, meta: Meta) => void | PromiseLike<void>) | undefined,
  meta: Meta,
): void {
  if (!observer) return
  try {
    const result = observer(cloneEventForObserver(event), meta)
    if (result && typeof result.then === 'function') {
      void result.then(undefined, () => {})
    }
  } catch {
    // Live observation is optional and must never interrupt the event stream.
  }
}

function cloneEventForObserver(event: SandboxEvent): SandboxEvent {
  try {
    return structuredClone(event)
  } catch {
    return copyPlainSpine(event, new WeakMap()) as SandboxEvent
  }
}

function copyPlainSpine(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value
  const existing = seen.get(value)
  if (existing !== undefined) return existing
  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(copyPlainSpine(item, seen))
    return copy
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return {}
  const copy: Record<string, unknown> = {}
  seen.set(value, copy)
  for (const [key, child] of Object.entries(value)) {
    copy[key] = copyPlainSpine(child, seen)
  }
  return copy
}

/**
 * Return the terminal failure carried by one Sandbox event.
 *
 * Sandbox transports report execution failure in-band: commonly an `error`
 * event followed by a synthetic `done`. Treating the iterable as successfully
 * drained therefore turns a provider/configuration failure into a completed
 * empty artifact. This decoder is deliberately conservative: tool-part errors
 * remain tool results, while top-level error events, explicit `success:false`,
 * and failed terminal states make the execution fail.
 */
export function sandboxEventFailure(event: SandboxEvent): string | undefined {
  if (!event || typeof event !== 'object') return undefined
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  const outcome = plainRecord(data.outcome)
  const status = firstString(
    data.status,
    outcome?.type,
    outcome?.status,
    plainRecord(data.result)?.status,
  )
  const terminalFailure =
    status !== undefined &&
    /^(error|errored|failed|failure|cancelled|canceled|timeout|timed_out)$/i.test(status)
  if (type !== 'error' && data.success !== false && !terminalFailure) return undefined

  return (
    describeSandboxError(data.error) ??
    describeSandboxError(outcome?.error) ??
    describeSandboxError(plainRecord(data.result)?.error) ??
    (typeof data.message === 'string' && data.message.length > 0 ? data.message : undefined) ??
    (status !== undefined
      ? `sandbox execution ended with status ${status}`
      : 'sandbox execution failed')
  )
}

/** Fail the live execution instead of allowing an in-band failure to become an empty success. */
export function assertSandboxEventSucceeded(event: SandboxEvent): void {
  const failure = sandboxEventFailure(event)
  if (failure !== undefined) throw new Error(`sandbox execution failed: ${failure}`)
}

function describeSandboxError(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const error = value as Record<string, unknown>
  return firstString(error.message, error.error, error.reason, error.code)
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0)
}

/**
 * Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when
 * the event carries usage/cost data. Returns `undefined` for non-cost events
 * so the kernel can iterate the full stream without branching. A top-level
 * Sandbox failure throws before extraction so every caller shares one terminal
 * truth boundary instead of inventing empty-output heuristics.
 *
 * Canonical cost-carrying types observed in the wild:
 *   - `llm_call` — `data: { model, tokensIn, tokensOut, costUsd, ... }`
 *   - `message.completed` / `result` — `data: { usage: { inputTokens,
 *      outputTokens, totalCostUsd? } }`
 *   - `cost.usage` / `usage` — same shape under a dedicated type
 *
 * Numeric coercion is strict: `Number.isFinite` gates every accumulator write
 * so a sentinel `NaN` from a misbehaving backend cannot poison the ledger.
 */
export function extractLlmCallEvent(
  event: SandboxEvent,
  agentRunName: string,
): (RuntimeStreamEvent & { type: 'llm_call' }) | undefined {
  if (!event || typeof event !== 'object') return undefined
  assertSandboxEventSucceeded(event)
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  if (type === 'llm_call' || type === 'cost.usage' || type === 'usage') {
    return buildLlmCall(data, agentRunName)
  }
  if (type === 'message.completed' || type === 'result' || type === 'final') {
    const usage = data.usage as Record<string, unknown> | undefined
    if (!usage || typeof usage !== 'object') return undefined
    return buildLlmCall({ ...usage, model: data.model ?? usage.model }, agentRunName)
  }
  // sandbox 0.4.0 terminal event: `data = { tokenUsage: { inputTokens, outputTokens,
  // reasoningTokens, cacheReadInputTokens }, totalCostUsd }`. Usage lives under
  // `tokenUsage` (not `usage`) and the cost is top-level — neither matched the
  // branches above, so an in-process loopDispatch run reported {0,0} and the
  // backend-integrity guard misread a real run as a stub. Reasoning tokens are
  // billed output (reasoning models), so they fold into the output count. The prompt-cache
  // counters are read off the SAME `tokenUsage` record rather than re-derived, because only
  // that record states what the provider billed.
  if (type === 'done') {
    const usage = data.tokenUsage as Record<string, unknown> | undefined
    if (!usage || typeof usage !== 'object') return undefined
    const out = pickFiniteNumber(usage, ['outputTokens', 'completion_tokens', 'tokensOut'])
    const reasoning = pickFiniteNumber(usage, ['reasoningTokens'])
    const mergedOut =
      out !== undefined || reasoning !== undefined ? (out ?? 0) + (reasoning ?? 0) : undefined
    const cache = readPromptCacheUsage(usage)
    return buildLlmCall(
      {
        inputTokens: usage.inputTokens,
        outputTokens: mergedOut,
        totalCostUsd: data.totalCostUsd,
        model: data.model ?? usage.model,
        ...(cache !== undefined ? { promptCache: cache } : {}),
      },
      agentRunName,
    )
  }
  return undefined
}

/**
 * Sum the token usage + USD cost of a sandbox turn's events — the one honest way to meter an
 * `openSandboxRun` cell. Folds `extractLlmCallEvent` over the stream (which reads usage off EVERY backend
 * event shape), so a `runProfileMatrix` dispatch can report it to `ctx.cost`:
 *
 *     receipt: (turn) => {
 *       const u = sumSandboxUsage(turn.events)
 *       return { model, inputTokens: u.input, outputTokens: u.output,
 *         ...(u.tokensKnown === false ? { usageUnknown: true } : {}),
 *         ...(u.usdKnown !== false && u.costUsd > 0 ? { actualCostUsd: u.costUsd } : {}),
 *         ...(u.usdKnown === false ? { costUnknown: true } : {}),
 *         ...(u.estimatedCostUsd !== undefined ? { estimatedCostUsd: u.estimatedCostUsd } : {}) }
 *     }
 *
 * Without this a cell reads `{tokens:0, cost:0}` and the backend-integrity guard correctly aborts the
 * matrix as a stub. `agentRunName` is the fallback model label for cost-only events (default `'agent'`).
 */
export function sumSandboxUsage(
  events: readonly SandboxEvent[],
  agentRunName = 'agent',
): {
  input: number
  output: number
  costUsd: number
  tokensKnown?: false
  usdKnown?: false
  estimatedCostUsd?: number
} {
  let input = 0
  let output = 0
  let costUsd = 0
  let estimatedCostUsd = 0
  let sawEstimate = false
  let sawCall = false
  let tokensKnown = true
  let usdKnown = true
  for (const ev of events) {
    const call = extractLlmCallEvent(ev, agentRunName)
    if (!call) continue
    sawCall = true
    input += call.tokensIn ?? 0
    output += call.tokensOut ?? 0
    costUsd += call.costUsd ?? 0
    if (call.tokensKnown === false) tokensKnown = false
    if (call.usdKnown === false) usdKnown = false
    if (call.estimatedCostUsd !== undefined) {
      estimatedCostUsd += call.estimatedCostUsd
      sawEstimate = true
    }
  }
  return {
    input,
    output,
    costUsd,
    ...(sawCall && tokensKnown ? {} : { tokensKnown: false as const }),
    ...(sawCall && usdKnown ? {} : { usdKnown: false as const }),
    ...(sawEstimate ? { estimatedCostUsd } : {}),
  }
}

function buildLlmCall(
  data: Record<string, unknown>,
  agentRunName: string,
): (RuntimeStreamEvent & { type: 'llm_call' }) | undefined {
  const tokensIn = pickFiniteNumber(data, ['tokensIn', 'inputTokens', 'prompt_tokens'])
  const outputTokens = pickFiniteNumber(data, ['tokensOut', 'outputTokens', 'completion_tokens'])
  const reasoningTokens = pickFiniteNumber(data, ['reasoningTokens'])
  const tokensOut =
    outputTokens !== undefined || reasoningTokens !== undefined
      ? (outputTokens ?? 0) + (reasoningTokens ?? 0)
      : undefined
  const reportedCostUsd = pickFiniteNumber(data, ['costUsd', 'totalCostUsd', 'cost_usd', 'cost'])
  const explicitTokensKnown = data.tokensKnown ?? data.tokens_known
  const explicitCostKnown = data.costKnown ?? data.cost_known ?? data.usdKnown ?? data.usd_known
  const costProvenance = data.costProvenance ?? data.cost_provenance
  const explicitEstimate = pickFiniteNumber(data, ['estimatedCostUsd', 'estimated_cost_usd'])
  const catalogEstimate =
    costProvenance === 'catalog-estimate' ? (explicitEstimate ?? reportedCostUsd) : explicitEstimate
  const costUsd = costProvenance === 'catalog-estimate' ? undefined : reportedCostUsd
  const promptCache = readPromptCacheUsage(data)
  const tokensKnown =
    explicitTokensKnown !== false && tokensIn !== undefined && tokensOut !== undefined
  // Sandbox's canonical terminal `totalCostUsd` is already the provider-reported receipt. The
  // current SDK carries no provenance tag, so absence means the canonical receipt rather than
  // "unknown". Explicit estimates and explicit false-known markers remain unknown.
  const usdKnown =
    explicitCostKnown !== false &&
    costUsd !== undefined &&
    (costProvenance === undefined ||
      costProvenance === 'provider-receipt' ||
      costProvenance === 'billing-receipt')
  if (
    tokensIn === undefined &&
    tokensOut === undefined &&
    costUsd === undefined &&
    catalogEstimate === undefined &&
    promptCache === undefined &&
    explicitTokensKnown !== false &&
    explicitCostKnown !== false
  ) {
    return undefined
  }
  const model = typeof data.model === 'string' && data.model.length > 0 ? data.model : agentRunName
  const event: RuntimeStreamEvent & { type: 'llm_call' } = {
    type: 'llm_call',
    model,
  }
  if (tokensIn !== undefined) event.tokensIn = tokensIn
  if (tokensOut !== undefined) event.tokensOut = tokensOut
  if (!tokensKnown) event.tokensKnown = false
  if (costUsd !== undefined) event.costUsd = costUsd
  if (!usdKnown) event.usdKnown = false
  if (catalogEstimate !== undefined) event.estimatedCostUsd = catalogEstimate
  if (promptCache !== undefined) event.promptCache = promptCache
  return event
}

/**
 * Every wire spelling of a prompt-cache READ counter, in precedence order: the canonical name
 * first, then the spellings observed on the paths that reach this extractor — the sandbox terminal
 * `tokenUsage` record, the cli-bridge OpenAI-compatible usage object (which normalizes every
 * backend to Anthropic's `cache_read_input_tokens`), Anthropic verbatim, OpenAI's
 * `prompt_tokens_details.cached_tokens`, and DeepSeek's `prompt_cache_hit_tokens`.
 */
const PROMPT_CACHE_READ_KEYS = [
  'readTokens',
  'read_tokens',
  'cacheReadInputTokens',
  'cache_read_input_tokens',
  'cacheRead',
  'cache_read',
  'cachedInputTokens',
  'cachedTokens',
  'cached_tokens',
  'prompt_cache_hit_tokens',
]

/**
 * Every wire spelling of a prompt-cache WRITE counter. OpenAI reports no write counter at all, so
 * an OpenAI-shaped usage record matches nothing here and the write stays absent — which is the
 * point: absent is not zero.
 */
const PROMPT_CACHE_WRITE_KEYS = [
  'writeTokens',
  'write_tokens',
  'cacheWriteInputTokens',
  'cache_write_input_tokens',
  'cacheCreationInputTokens',
  'cache_creation_input_tokens',
  'cacheWrite',
  'cache_write',
]

const PROMPT_CACHE_MISS_KEYS = ['missTokens', 'miss_tokens', 'prompt_cache_miss_tokens']

const PROMPT_CACHE_SAVINGS_KEYS = ['readSavingsUsd', 'read_savings_usd']

/**
 * Read the provider's own prompt-cache accounting off one usage-bearing event payload, in the
 * `PromptCacheUsage` vocabulary the router, driver, and chat-client paths already speak.
 *
 * Two sources, one record. A payload that already carries a `promptCache` / `prompt_cache` object
 * is forwarded VERBATIM — those fields are the provider's own report, and an unrecognized one must
 * stay visible rather than be bucketed away. On top of that, flat provider counters are translated
 * to the canonical names, filling only the names the verbatim object did not already define.
 *
 * A counter the payload does not carry is left out. Defaulting it to zero would assert the provider
 * measured no cache, which is a different fact from a provider that reported nothing — and it is
 * the fact the budget reads to decide whether its charge is a measurement or a bound.
 */
function readPromptCacheUsage(
  data: Record<string, unknown>,
): Record<string, number | string> | undefined {
  const declared = finiteMetadata(data.promptCache ?? data.prompt_cache)
  const nested = plainRecord(data.promptCache) ?? plainRecord(data.prompt_cache)
  const details = plainRecord(data.prompt_tokens_details)
  const sources = [nested, data, details].filter(
    (s): s is Record<string, unknown> => s !== undefined,
  )

  const canonical: Record<string, number | string> = {}
  const readTokens = pickTokenCount(sources, PROMPT_CACHE_READ_KEYS)
  const writeTokens = pickTokenCount(sources, PROMPT_CACHE_WRITE_KEYS)
  const missTokens = pickTokenCount(sources, PROMPT_CACHE_MISS_KEYS)
  const readSavingsUsd = pickNonNegativeNumber(sources, PROMPT_CACHE_SAVINGS_KEYS)
  const status =
    nested !== undefined && typeof nested.status === 'string' ? nested.status : undefined
  if (readTokens !== undefined) canonical.readTokens = readTokens
  if (writeTokens !== undefined) canonical.writeTokens = writeTokens
  if (missTokens !== undefined) canonical.missTokens = missTokens
  if (readSavingsUsd !== undefined) canonical.readSavingsUsd = readSavingsUsd
  if (status !== undefined) canonical.status = status

  const merged = { ...canonical, ...declared }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function pickTokenCount(
  sources: readonly Record<string, unknown>[],
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    for (const source of sources) {
      const value = source[key]
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
    }
  }
  return undefined
}

function pickNonNegativeNumber(
  sources: readonly Record<string, unknown>[],
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    for (const source of sources) {
      const value = source[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
    }
  }
  return undefined
}

function finiteMetadata(value: unknown): Record<string, number | string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: Record<string, number | string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if ((typeof entry === 'number' && Number.isFinite(entry)) || typeof entry === 'string') {
      result[key] = entry
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function pickFiniteNumber(data: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * Cross-event state for {@link mapSandboxToolEvent}. Sandbox backends emit a
 * tool invocation as MANY `message.part.updated` frames on the same call id
 * (pending → running → completed), so faithful projection needs per-call
 * status memory: one `tool_call` on first sighting, at most one `tool_result`
 * on the terminal transition, nothing on intermediate re-frames. Create one
 * state per turn via {@link createSandboxToolPartState}.
 *
 * @experimental
 */
export interface SandboxToolPartState {
  /** Last seen status per tool call id. A terminal status is sticky — later
   *  frames on a settled call project to nothing. */
  statusByCall: Map<string, string>
  /** Sequence for synthesized call ids when an event carries none. */
  seq: number
}

/**
 * Fresh per-turn {@link SandboxToolPartState} for {@link mapSandboxToolEvent} — an
 * empty call-status map so each turn projects tool frames independently.
 *
 * @experimental
 */
export function createSandboxToolPartState(): SandboxToolPartState {
  return { statusByCall: new Map(), seq: 0 }
}

/** Terminal tool statuses that are failures (everything here settles the call). */
const TERMINAL_TOOL_FAILURE =
  /^(error|errored|failed|failure|cancelled|canceled|timeout|timed_out)$/i

/**
 * Project one `SandboxEvent` onto the `tool_call` / `tool_result` variants of
 * `RuntimeStreamEvent` — the tool-part projection `mapSandboxEvent`
 * deliberately does NOT perform. Opt-in and additive: `mapSandboxEvent`'s
 * default vocabulary (text/reasoning deltas + `llm_call`) is unchanged;
 * consumers that need the tool surface (chat UIs rendering tool activity)
 * compose this projector alongside it — `streamAgentTurn` does exactly that
 * under its `preserveToolParts` option.
 *
 * Handled shapes (observed on the opencode / claude-code sandbox backends):
 *   - `message.part.updated` with `part.type === 'tool'` — stateful: a
 *     `tool_call` on the call id's first frame (args from `state.input` or
 *     `state.metadata.input`), a `tool_result` when the status transitions to
 *     `completed` (result from `state.output` / `metadata.output`) or to a
 *     terminal failure (result is `{ error, status, output? }` — the error
 *     surfaced in-band, never dropped).
 *   - bare `tool*` event types (`tool.call`, `tool_result`, …) — stateless:
 *     `*result*` types project to `tool_result`, the rest to `tool_call`.
 *
 * Returns `[]` for every non-tool event.
 *
 * @experimental
 */
export function mapSandboxToolEvent(
  event: SandboxEvent,
  state: SandboxToolPartState,
): (RuntimeStreamEvent & { type: 'tool_call' | 'tool_result' })[] {
  if (!event || typeof event !== 'object') return []
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  if (type === 'message.part.updated') {
    const part =
      data.part && typeof data.part === 'object' ? (data.part as Record<string, unknown>) : {}
    if (String(part.type ?? '') !== 'tool') return []
    return projectToolPart(part, state, typeof event.id === 'string' ? event.id : undefined)
  }

  if (type.includes('tool')) {
    const callId =
      pickString(data, ['toolCallId', 'tool_use_id', 'id']) ??
      (typeof event.id === 'string' ? event.id : undefined) ??
      `sandbox-tool-${++state.seq}`
    const toolName = pickString(data, ['name', 'toolName', 'tool']) ?? 'sandbox_tool'
    if (type.includes('result')) {
      return [
        {
          type: 'tool_result',
          toolName,
          toolCallId: callId,
          result: data.output ?? data.result ?? data.content ?? data,
        },
      ]
    }
    return [
      { type: 'tool_call', toolName, toolCallId: callId, args: data.input ?? data.args ?? {} },
    ]
  }

  return []
}

function projectToolPart(
  part: Record<string, unknown>,
  state: SandboxToolPartState,
  eventId: string | undefined,
): (RuntimeStreamEvent & { type: 'tool_call' | 'tool_result' })[] {
  const callId =
    pickString(part, ['callID', 'callId', 'toolCallId', 'id']) ??
    eventId ??
    `sandbox-tool-${++state.seq}`
  const toolName = pickString(part, ['tool', 'toolName', 'name']) ?? 'sandbox_tool'
  const toolState =
    part.state && typeof part.state === 'object' ? (part.state as Record<string, unknown>) : {}
  const metadata =
    toolState.metadata && typeof toolState.metadata === 'object'
      ? (toolState.metadata as Record<string, unknown>)
      : {}
  const status = pickString(toolState, ['status']) ?? 'updated'

  const previous = state.statusByCall.get(callId)
  const settled =
    previous === 'completed' || (previous !== undefined && TERMINAL_TOOL_FAILURE.test(previous))
  if (settled) return []

  const out: (RuntimeStreamEvent & { type: 'tool_call' | 'tool_result' })[] = []
  if (previous === undefined) {
    out.push({
      type: 'tool_call',
      toolName,
      toolCallId: callId,
      args: toolState.input ?? metadata.input ?? {},
    })
  }
  state.statusByCall.set(callId, status)

  if (status === 'completed') {
    out.push({
      type: 'tool_result',
      toolName,
      toolCallId: callId,
      result: toolState.output ?? metadata.output ?? '',
    })
  } else if (TERMINAL_TOOL_FAILURE.test(status)) {
    const message =
      pickString(toolState, ['error', 'message']) ??
      pickString(metadata, ['error', 'message']) ??
      `sandbox tool ended with status ${status}`
    const output = toolState.output ?? metadata.output
    out.push({
      type: 'tool_result',
      toolName,
      toolCallId: callId,
      result: { error: message, status, ...(output !== undefined ? { output } : {}) },
    })
  }
  return out
}

function pickString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * Project one `SandboxEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary,
 * for runtimes that bridge a sandbox `streamPrompt` into the
 * `AgentRuntime.act` streaming contract. Returns `undefined` for events that
 * have no faithful projection — the raw stream is preserved separately for the
 * `OutputAdapter`, so an unmapped event never loses data.
 *
 * Mapped (the task-optional incremental variants — no synthesized task
 * lifecycle, no guessed tool-part shapes):
 *   - `message.part.updated` text part → `text_delta`
 *   - `message.part.updated` reasoning/thinking part → `reasoning_delta`
 *   - cost-bearing events → `llm_call` (shared with the ledger extractor)
 *
 * Tool parts are deliberately NOT mapped here (unchanged default) — compose
 * {@link mapSandboxToolEvent} alongside when a consumer needs them.
 *
 * The opencode backend emits incremental text as
 * `{ type: 'message.part.updated', data: { part: { type, text }, delta } }`;
 * `delta` is the increment, `part.text` the running accumulation.
 */
export function mapSandboxEvent(
  event: SandboxEvent,
  opts: { agentRunName?: string } = {},
): RuntimeStreamEvent | undefined {
  if (!event || typeof event !== 'object') return undefined
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  if (type === 'message.part.updated') {
    const part =
      data.part && typeof data.part === 'object' ? (data.part as Record<string, unknown>) : {}
    const partType = String(part.type ?? '')
    const delta = typeof data.delta === 'string' ? data.delta : undefined
    const text = delta ?? (typeof part.text === 'string' ? part.text : undefined)
    if (text === undefined) return undefined
    if (partType === 'text') return { type: 'text_delta', text }
    if (partType === 'reasoning' || partType === 'thinking')
      return { type: 'reasoning_delta', text }
    return undefined
  }

  return extractLlmCallEvent(event, opts.agentRunName ?? 'agent')
}

export {
  extractTransportEventIdentity,
  parseCanonicalTransportEvent,
  type TransportEventIdentity,
} from './sandbox-transport-events'
