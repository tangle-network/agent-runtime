/**
 * Sandbox-event → runtime-event mapping.
 *
 * The sandbox SDK emits a polymorphic `SandboxEvent = { type, data, id? }`
 * whose `type` vocabulary is backend-determined (opencode, etc.) rather than
 * enumerated by the SDK. Two consumers project it:
 *   - the loop kernel's cost ledger (`extractLlmCallEvent`, and
 *     `createSandboxUsageLedger` for a turn's full accounting) — sums usage off
 *     every cost-bearing event, regardless of stream shape;
 *   - the `AgentRuntime.act` streaming contract (`mapSandboxEvent`) — projects
 *     incremental events to the `RuntimeStreamEvent` chat-UX vocabulary.
 *
 * Both live here so the empirically-observed `type` vocabulary has one home.
 * A harness that reports usage only inside its OWN event is decoded by the
 * per-harness registry in `harness-usage.ts`; this module holds the canonical
 * fold and the once-per-turn precedence rule between the two sources.
 */

import type { HarnessType, StreamEvent } from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import type { RuntimeStreamEvent } from '../types'
import { decodeHarnessUsage, type HarnessUsage } from './harness-usage'
import { parseCanonicalTransportEvent } from './sandbox-transport-events'
import type { ExecutorProgressEvent } from './supervise/types'

/** The canonical usage receipt every accounting path in the kernel reads. */
type LlmCallEvent = RuntimeStreamEvent & { type: 'llm_call' }

const CANONICAL_STREAM_EVENT_TYPES: ReadonlySet<string> = new Set([
  'child-task',
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

/** The provider/model the platform reports it actually bound to a turn, when it reports one.
 *  `source` is the platform's own account of where that choice came from — `environment` means
 *  the platform chose, not the request. */
export interface SandboxServedBackend {
  readonly provider?: string
  readonly model?: string
  readonly source?: string
}

/**
 * Read the served execution identity off one Sandbox event.
 *
 * The platform reports `effectiveBackend` on `execution.started` and again on the terminal
 * event (`@tangle-network/sandbox`, `EffectiveBackend`). Absence returns `undefined`
 * and must stay unknown — a request is not a receipt, so nothing here may be inferred from
 * what was asked for.
 */
export function sandboxEventServedBackend(event: SandboxEvent): SandboxServedBackend | undefined {
  if (!event || typeof event !== 'object') return undefined
  const data = plainRecord(event.data)
  const served = plainRecord(data?.effectiveBackend)
  if (!served) return undefined
  const provider = firstString(served.provider)
  const model = firstString(served.model)
  const source = firstString(served.source)
  if (provider === undefined && model === undefined) return undefined
  return {
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(source !== undefined ? { source } : {}),
  }
}

/**
 * Fail the execution when the platform reports serving a model other than the exact one asked for.
 *
 * Measured motive (agent-runtime#892, live infrastructure 2026-08-17): 6 of 6 boxes whose profile
 * declared `zai-coding-plan/glm-5.2` reported
 * `{"provider":"openai-compat","model":"deepseek/deepseek-v4-flash","source":"environment"}`,
 * while the materialization receipt recorded the declared model as `status: "known"`. Sending
 * `backend.model` makes that substitution unlikely; only reading the report back makes it
 * detectable. A run that cannot say which model produced its evidence must not settle as one
 * that can.
 *
 * Silent when the platform reports no served model: unobserved stays unobserved.
 */
export function assertSandboxServedModel(
  event: SandboxEvent,
  expected: { readonly provider?: string; readonly model?: string } | undefined,
): void {
  const wanted = expected?.model?.trim()
  if (!wanted) return
  const served = sandboxEventServedBackend(event)
  if (served?.model === undefined) return
  if (sameModelId(served.model, wanted, [served.provider, expected?.provider])) return
  const attribution = [
    served.provider !== undefined ? `provider ${JSON.stringify(served.provider)}` : undefined,
    served.source !== undefined ? `source ${JSON.stringify(served.source)}` : undefined,
  ].filter((part): part is string => part !== undefined)
  const detail = attribution.length > 0 ? ` (${attribution.join(', ')})` : ''
  throw new Error(
    `sandbox served model ${JSON.stringify(served.model)}${detail} instead of the exact profile model ${JSON.stringify(wanted)}`,
  )
}

/**
 * Do two model ids name the same model, allowing for routing prefixes?
 *
 * Either side may spell the model bare (`glm-5.2`), provider-qualified
 * (`zai-coding-plan/glm-5.2`), or route-qualified, and the platform reports the provider in its
 * own field rather than always in the id. So the comparison drops any known provider prefix and
 * then accepts a `/`-boundary suffix match: a longer route to the SAME leaf model is a routing
 * difference, not a substitution.
 *
 * What it deliberately does NOT absorb is a different leaf: `glm-5.2` against `glm-5.3` stays a
 * mismatch, which is the substitution measured directly against the provider API (a request for
 * `glm-5.2` was served `glm-5.3`). A version suffix is the whole difference between two
 * instruments, so nothing here may treat it as noise.
 */
function sameModelId(
  served: string,
  wanted: string,
  providers: readonly (string | undefined)[],
): boolean {
  const a = stripProviderPrefix(served, providers)
  const b = stripProviderPrefix(wanted, providers)
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

function stripProviderPrefix(id: string, providers: readonly (string | undefined)[]): string {
  let out = id.trim().toLowerCase()
  for (const provider of providers) {
    const prefix = provider?.trim().toLowerCase()
    if (prefix && out.startsWith(`${prefix}/`)) out = out.slice(prefix.length + 1)
  }
  return out
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0)
}

/**
 * The sandbox event types that END a turn.
 *
 * One list, because two consumers ask this question about the same wire event and must agree: the
 * usage credit below, and the terminal-text lift in `stream-agent-turn.ts`. Written separately they
 * drifted by exactly one member — `message.completed` credited tokens and dollars while its final
 * text was never lifted, so a backend whose terminal frame carries that type produced a run that
 * was billed and recorded no answer.
 */
export const sandboxTerminalEventTypes = ['message.completed', 'result', 'final', 'done'] as const

export type SandboxTerminalEventType = (typeof sandboxTerminalEventTypes)[number]

const terminalTypes: ReadonlySet<string> = new Set<string>(sandboxTerminalEventTypes)

/** True for an event type that ends a sandbox turn. */
export function isSandboxTerminalEvent(type: string): type is SandboxTerminalEventType {
  return terminalTypes.has(type)
}

/**
 * Which member of a terminal event's `data` carries its usage receipt.
 *
 * The one place the terminal types legitimately differ, stated rather than implied by two lists:
 * sandbox 0.4.0's `done` reports under `tokenUsage` with the cost at the top level, every other
 * terminal type reports under `usage`.
 */
export function sandboxTerminalUsageField(type: SandboxTerminalEventType): 'usage' | 'tokenUsage' {
  return type === 'done' ? 'tokenUsage' : 'usage'
}

/**
 * Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when
 * the event carries usage/cost data. Returns `undefined` for non-cost events
 * so the kernel can iterate the full stream without branching.
 *
 * Pure by contract: it never throws on a failed run. The terminal truth
 * boundary is the public Sandbox outcome tracker, applied after the complete
 * stream. Post-hoc readers — {@link sumSandboxUsage}, the
 * analyst trace store, the chat projection — must stay able to read a failed
 * turn's events, which is when reading them matters most.
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
  const type = String(event.type ?? '')
  const data =
    event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  if (type === 'llm_call' || type === 'cost.usage' || type === 'usage') {
    return buildLlmCall(data, agentRunName)
  }
  if (isSandboxTerminalEvent(type) && sandboxTerminalUsageField(type) === 'usage') {
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
 * Per-turn usage accounting over BOTH the canonical events and the harness-native ones.
 *
 * Some harnesses report a turn's tokens only inside their own event (`harness-usage.ts`), and a
 * stream may carry that report AND a canonical usage event for the same turn. Crediting both
 * counts one turn twice, so this ledger holds the precedence rule: a canonical usage event WINS,
 * and a harness-native report is credited only for a turn in which no canonical usage arrived.
 *
 * The harness-native report is held until the turn ends, because it can arrive before the
 * canonical answer is known — codex emits `turn.completed` ahead of the terminal transport
 * events. Call {@link SandboxUsageLedger.observe} for every event of a turn, then
 * {@link SandboxUsageLedger.settleTurn} once at the turn boundary; settling also resets the
 * ledger for the next turn, so one ledger serves a whole multi-turn session.
 */
export interface SandboxUsageLedger {
  /** Account one event. Returns the canonical usage receipt to credit now, if the event is one. */
  observe(
    event: SandboxEvent,
    agentRunName: string,
  ): (RuntimeStreamEvent & { type: 'llm_call' }) | undefined
  /** End the turn. Returns the held harness-native receipt when no canonical usage arrived. */
  settleTurn(agentRunName: string): (RuntimeStreamEvent & { type: 'llm_call' }) | undefined
}

/** A {@link SandboxUsageLedger} for one worker. Pass the worker's harness to decode with that
 *  harness's adapter; omit it to try every registered adapter. */
export function createSandboxUsageLedger(harness?: HarnessType): SandboxUsageLedger {
  let held: HarnessUsage[] = []
  let sawCanonical = false
  return {
    observe(event, agentRunName) {
      const call = extractLlmCallEvent(event, agentRunName)
      if (call) {
        sawCanonical = true
        return call
      }
      const usage = decodeHarnessUsage(event, harness)
      // Every report of the turn is kept: a stream carrying more than one is more than one
      // charge, and keeping only the last would drop tokens the provider billed.
      if (usage) held.push(usage)
      return undefined
    },
    settleTurn(agentRunName) {
      const reports = held
      const canonical = sawCanonical
      held = []
      sawCanonical = false
      if (canonical || reports.length === 0) return undefined
      return harnessUsageLlmCall(reports, agentRunName)
    },
  }
}

/**
 * Fold harness-native usage reports into the canonical `llm_call` the accounting paths read.
 *
 * Every counter a `HarnessUsage` carries beside `input` and `output` CLASSIFIES one of those two
 * totals, so none of them is added to the total it describes:
 *
 *   - the prompt-cache counters classify `input` and ride `promptCache`, the convention the
 *     terminal `tokenUsage` branch above already follows and `promptCacheTokenClasses` folds,
 *     where `freshInput = input - cacheRead - cacheWrite`;
 *   - `reasoningOutput` classifies `output`. Codex counts its reasoning tokens INSIDE
 *     `output_tokens` — a turn reporting `output_tokens 1523` with `reasoning_output_tokens 1516`
 *     answered with about seven tokens of text — and `parseCodexUsageRecord` holds that as an
 *     invariant. The canonical `llm_call` carries no reasoning class, so the count is not
 *     forwarded to {@link buildLlmCall}, whose `reasoningTokens` input is for the sandbox
 *     `tokenUsage` record that reports reasoning BESIDE its output count.
 *
 * A counter no report carried stays absent, because a zero would claim the provider measured none.
 */
function harnessUsageLlmCall(
  reports: readonly HarnessUsage[],
  agentRunName: string,
): LlmCallEvent | undefined {
  let inputTokens = 0
  let outputTokens = 0
  let readTokens: number | undefined
  let writeTokens: number | undefined
  for (const report of reports) {
    inputTokens += report.input
    outputTokens += report.output
    if (report.cachedInput !== undefined) readTokens = (readTokens ?? 0) + report.cachedInput
    if (report.cacheWriteInput !== undefined)
      writeTokens = (writeTokens ?? 0) + report.cacheWriteInput
  }
  const promptCache: Record<string, number> = {}
  if (readTokens !== undefined) promptCache.readTokens = readTokens
  if (writeTokens !== undefined) promptCache.writeTokens = writeTokens
  return buildLlmCall(
    {
      inputTokens,
      outputTokens,
      ...(Object.keys(promptCache).length > 0 ? { promptCache } : {}),
    },
    agentRunName,
  )
}

/**
 * Sum the token usage + USD cost of a sandbox turn's events — the one honest way to meter an
 * `openSandboxRun` cell. Folds a {@link SandboxUsageLedger} over the stream, so it reads usage off
 * EVERY backend event shape — the canonical events plus a harness that reports usage only in its
 * own event — and a `runProfileMatrix` dispatch can report it to `ctx.cost`:
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
 *
 * Pure by contract, like the extractors it folds: it never throws. A harness receipt it cannot read
 * is skipped, the result reports `tokensKnown: false`, and `tokensUnknownReason` carries the decode
 * message — an unreadable receipt is a different fact from a turn that reported no usage, and a
 * post-hoc reader that threw would lose the whole failed turn it exists to report.
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
  tokensUnknownReason?: string
} {
  let input = 0
  let output = 0
  let costUsd = 0
  let estimatedCostUsd = 0
  let sawEstimate = false
  let sawCall = false
  let tokensKnown = true
  let usdKnown = true
  let unreadable: string | undefined
  const ledger = createSandboxUsageLedger()
  const credit = (call: LlmCallEvent): void => {
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
  // The FIRST decode message is kept: it names the receipt the reader could not read, and a later
  // one from the same turn does not make the answer any more unknown.
  const readable = <T>(read: () => T): T | undefined => {
    try {
      return read()
    } catch (err) {
      tokensKnown = false
      unreadable ??= err instanceof Error ? err.message : String(err)
      return undefined
    }
  }
  for (const ev of events) {
    const call = readable(() => ledger.observe(ev, agentRunName))
    if (call) credit(call)
  }
  const harnessCall = readable(() => ledger.settleTurn(agentRunName))
  if (harnessCall) credit(harnessCall)
  return {
    input,
    output,
    costUsd,
    ...(sawCall && tokensKnown ? {} : { tokensKnown: false as const }),
    ...(sawCall && usdKnown ? {} : { usdKnown: false as const }),
    ...(sawEstimate ? { estimatedCostUsd } : {}),
    ...(unreadable === undefined ? {} : { tokensUnknownReason: unreadable }),
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

/** Statuses that settle one tool call as a failure. A failed tool call stays a tool result:
 *  the run's terminal state comes from the public Sandbox outcome tracker, never from here. */
const TERMINAL_FAILURE = /^(error|errored|failed|failure|cancelled|canceled|timeout|timed_out)$/i

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
    previous === 'completed' || (previous !== undefined && TERMINAL_FAILURE.test(previous))
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
  } else if (TERMINAL_FAILURE.test(status)) {
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

/**
 * Project one `SandboxEvent` onto Runtime's executor progress vocabulary: incremental text and
 * reasoning, tool calls and results, and an interaction request. It composes the existing
 * projections ({@link mapSandboxEvent}, {@link mapSandboxToolEvent}, and the canonical Agent
 * Interface decode) so every sandbox-shaped executor publishes live output through one reader.
 * Usage-bearing events project to nothing here — accounting stays on the `tokens`/`cost`
 * channels.
 *
 * Pass one {@link SandboxToolPartState} per turn so a multi-frame tool call yields one call and
 * at most one result.
 *
 * @experimental
 */
export function sandboxProgressEvents(
  event: SandboxEvent,
  state: SandboxToolPartState,
): ExecutorProgressEvent[] {
  const canonical = canonicalStreamEventFromSandboxEvent(event)
  if (canonical?.type === 'interaction') {
    return [{ kind: 'interaction', request: canonical.request }]
  }
  if (canonical?.type === 'child-task') {
    return [{ kind: 'child_task', event: canonical }]
  }
  const tools = mapSandboxToolEvent(event, state).map((projected) =>
    projected.type === 'tool_call'
      ? ({
          kind: 'tool_call',
          toolName: projected.toolName,
          ...(projected.toolCallId === undefined ? {} : { toolCallId: projected.toolCallId }),
          ...(projected.args === undefined ? {} : { args: projected.args }),
        } as const)
      : ({
          kind: 'tool_result',
          toolName: projected.toolName,
          ...(projected.toolCallId === undefined ? {} : { toolCallId: projected.toolCallId }),
          ...(projected.result === undefined ? {} : { result: projected.result }),
        } as const),
  )
  if (tools.length > 0) return tools
  const mapped = mapSandboxEvent(event)
  if (mapped?.type === 'text_delta') return [{ kind: 'text_delta', text: mapped.text }]
  if (mapped?.type === 'reasoning_delta') return [{ kind: 'reasoning_delta', text: mapped.text }]
  return []
}

export {
  extractTransportEventIdentity,
  parseCanonicalTransportEvent,
  type TransportEventIdentity,
} from './sandbox-transport-events'
