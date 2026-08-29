/**
 * Harness-native token-usage decoders — the ONE registry of per-harness usage wire shapes.
 *
 * A sandbox backend that reports usage under a canonical event (`llm_call`, `cost.usage`,
 * `usage`, or a terminal `usage` / `tokenUsage` record) is read by `extractLlmCallEvent`
 * (`sandbox-events.ts`). A harness that reports usage ONLY inside its own event needs an adapter,
 * and every such adapter lives here — the same rule the tool-part decoders follow
 * (`supervise/trace-source.ts`): one entry per harness family, each owning its real wire shape,
 * while the kernel's accounting stays harness-agnostic.
 *
 * A worker whose usage no reader decodes settles with `tokensKnown: false` and pays nothing into
 * the conserved budget pool, so equal-compute accounting cannot see it. That is why a decode
 * failure here is a typed error rather than a skip: a usage receipt the runtime cannot read must
 * not settle as a turn that spent nothing. The live-stream paths turn the typed error into a
 * settled failure that carries the message; the post-hoc readers degrade to `tokensKnown: false`.
 *
 * This module also owns `parseCodexUsageRecord`, the single reader of codex's `turn.completed`
 * usage record. `runLocalHarness` reads the same record off `codex exec --json` stdout and calls
 * the same function, so both surfaces hold the same field policy and the same two cross-field
 * invariants.
 */

import type { HarnessType } from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'

/**
 * Codex's `turn.completed` usage record, validated.
 *
 * Four counters are required, which is the set every observed codex build reports.
 * `cacheWriteInputTokens` is optional: the codex CLI reports it and a provider-normalized capture
 * omits it, and an absent counter must stay absent rather than become a zero that claims the
 * provider measured no cache write.
 */
export interface CodexUsageRecord {
  /** Total prompt tokens for the turn, the cached ones included. */
  readonly inputTokens: number
  /** The part of `inputTokens` the provider served from its prompt cache. */
  readonly cachedInputTokens: number
  /** Total completion tokens for the turn, the reasoning ones included. */
  readonly outputTokens: number
  /** The part of `outputTokens` the model spent on reasoning. */
  readonly reasoningOutputTokens: number
  /** The part of `inputTokens` the provider wrote into its prompt cache. */
  readonly cacheWriteInputTokens?: number
}

/**
 * Read and validate one codex `turn.completed` usage record.
 *
 * Every counter must be a non-negative safe integer. Two cross-field invariants hold, and they are
 * what states that the two named counters are SUBSETS of their totals rather than additions to
 * them: `cached_input_tokens <= input_tokens` and `reasoning_output_tokens <= output_tokens`.
 * Measured against the codex CLI: a turn reporting `output_tokens 1523` with
 * `reasoning_output_tokens 1516` answered with about seven tokens of text.
 *
 * `label` names the surface the record came from, so one message serves both readers.
 * Throws `ValidationError` on any violation.
 */
export function parseCodexUsageRecord(usage: unknown, label: string): CodexUsageRecord {
  const record = plainRecord(usage)
  if (record === undefined) {
    throw new ValidationError(`${label}: usage must be an object, received ${describe(usage)}`)
  }
  const inputTokens = naturalNumber(record.input_tokens, 'input_tokens', label)
  const cachedInputTokens = naturalNumber(record.cached_input_tokens, 'cached_input_tokens', label)
  const outputTokens = naturalNumber(record.output_tokens, 'output_tokens', label)
  const reasoningOutputTokens = naturalNumber(
    record.reasoning_output_tokens,
    'reasoning_output_tokens',
    label,
  )
  const cacheWriteInputTokens =
    record.cache_write_input_tokens === undefined
      ? undefined
      : naturalNumber(record.cache_write_input_tokens, 'cache_write_input_tokens', label)
  if (cachedInputTokens > inputTokens) {
    throw new ValidationError(`${label}: cached_input_tokens exceeds input_tokens`)
  }
  if (reasoningOutputTokens > outputTokens) {
    throw new ValidationError(`${label}: reasoning_output_tokens exceeds output_tokens`)
  }
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    ...(cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens }),
  }
}

/**
 * One harness's own token-usage report for one turn, in the runtime's field names.
 *
 * `input` is the provider's TOTAL prompt count and `output` is its TOTAL completion count.
 * The other three counters CLASSIFY a part of one of those totals; none of them adds to it.
 * `cachedInput` and `cacheWriteInput` classify `input`, which is the convention
 * `promptCacheTokenClasses` (`util.ts`) folds: `freshInput = input - cacheRead - cacheWrite`.
 * `reasoningOutput` classifies `output`.
 *
 * A counter the harness does not report stays absent, because a zero would claim the harness
 * measured none.
 */
export interface HarnessUsage {
  /** The harness family whose adapter produced this report. */
  readonly harness: HarnessType
  /** Total prompt tokens the provider charged for the turn, the cached ones included. */
  readonly input: number
  /** Total completion tokens the provider charged for the turn, the reasoning ones included. */
  readonly output: number
  /** The part of `input` the provider served from its prompt cache. */
  readonly cachedInput?: number
  /** The part of `input` the provider wrote into its prompt cache. */
  readonly cacheWriteInput?: number
  /** The part of `output` the model spent on reasoning. Never added to `output`. */
  readonly reasoningOutput?: number
}

/**
 * Decode one harness's own usage report off a sandbox event, or `undefined` when the event carries
 * no usage for that harness. ONE adapter per harness family — each owns its real wire shape. Add a
 * harness by adding a decoder and registering it; no other code changes.
 *
 * A decoder throws `ValidationError` when the event IS the harness's usage carrier and its
 * numbers cannot be read.
 */
export type HarnessUsageDecoder = (event: SandboxEvent) => HarnessUsage | undefined

/** Names the wire record every codex decode error is reported against. */
const codexUsageContext = 'codex turn.completed'

/**
 * codex reports the tokens of a turn inside its own `turn.completed` event, which rides the
 * transport as `{ type: 'raw', data: { type: 'turn.completed', usage: { … } } }`. It emits no
 * canonical usage event, so this adapter is a codex worker's only usage source.
 *
 * The record is read by `parseCodexUsageRecord`, the same reader `runLocalHarness` uses on the
 * codex CLI's own stdout, so both surfaces hold one field policy and both cross-field invariants.
 *
 * A `turn.completed` that carries a `usage` member the reader cannot read is a `ValidationError`
 * naming the field. A `turn.completed` with no `usage` member reports no usage at all, which
 * leaves the turn's tokens unknown rather than zero.
 */
const decodeCodexTurnUsage: HarnessUsageDecoder = (event) => {
  if (String(event.type ?? '') !== 'raw') return undefined
  const data = plainRecord(event.data)
  if (data === undefined || data.type !== 'turn.completed' || data.usage === undefined) {
    return undefined
  }
  const record = parseCodexUsageRecord(data.usage, codexUsageContext)
  return {
    harness: 'codex',
    input: record.inputTokens,
    output: record.outputTokens,
    cachedInput: record.cachedInputTokens,
    reasoningOutput: record.reasoningOutputTokens,
    ...(record.cacheWriteInputTokens === undefined
      ? {}
      : { cacheWriteInput: record.cacheWriteInputTokens }),
  }
}

/**
 * The harness → usage-decoder registry. Add a harness by adding one entry.
 *
 * Keyed by `HarnessType`, the vocabulary the `harness` argument is drawn from, so a key no caller
 * can produce does not compile. A harness absent from this registry reports usage through the
 * canonical events or not at all.
 */
const harnessUsageDecoders: Partial<Record<HarnessType, HarnessUsageDecoder>> = {
  codex: decodeCodexTurnUsage,
}

/**
 * Decode a sandbox event with one harness's adapter, or `undefined` when the event carries no
 * harness-native usage.
 *
 * A NAMED harness reads with that harness's adapter only, and a named harness with no adapter
 * reports nothing. It never falls through to another harness's adapter: a different harness's
 * `turn.completed` decoded as codex would either drop the counters codex does not name or fail on
 * a field codex requires, and both answers would be about the wrong harness. The composite over
 * every registered adapter runs only when the caller cannot name the harness.
 *
 * Throws `ValidationError` when an adapter recognizes the event as its harness's usage carrier and
 * cannot read the numbers.
 */
export function decodeHarnessUsage(
  event: SandboxEvent,
  harness?: HarnessType,
): HarnessUsage | undefined {
  if (!event || typeof event !== 'object') return undefined
  if (harness !== undefined) return harnessUsageDecoders[harness]?.(event)
  for (const decode of new Set(Object.values(harnessUsageDecoders))) {
    const usage = decode(event)
    if (usage !== undefined) return usage
  }
  return undefined
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function naturalNumber(value: unknown, field: string, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(
      `${label}: usage.${field} must be a non-negative safe integer, received ${describe(value)}`,
    )
  }
  return value
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return 'an array'
  return typeof value
}
