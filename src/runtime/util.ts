/**
 *
 * Internal loop-kernel utilities shared across the kernel, drivers, and the
 * sandbox-acquire layer. Not part of the public barrel surface.
 *
 * @experimental
 */

import type { SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import { armDeadlineTimer } from './supervise/deadline'
import { addResourceSpend } from './supervise/resources'
import type { Spend, TokenUsageProvenance } from './supervise/types'
import { runTaskQueue } from './task-queue'
import type { LoopTokenUsage } from './types'

/**
 * Best-effort sandbox delete. Skips instances without a `delete` (test fakes);
 * swallows errors (the platform reaps on expiry). Returns `false` when delete
 * threw, `true` otherwise, so callers can surface a leak if they choose.
 */
export async function deleteBoxSafe(box: SandboxInstance | undefined): Promise<boolean> {
  if (!box || typeof (box as { delete?: unknown }).delete !== 'function') return true
  try {
    await box.delete()
    return true
  } catch {
    return false
  }
}

/** Short base36 id for trace correlation. Not cryptographic, not collision-free. */
export function randomSuffix(len = 8): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len)
}

/** Collision-resistant id for sandbox naming (find-by-name recovery must be unique). */
export function randomUuid(): string {
  return crypto.randomUUID()
}

/** Construct an AbortError carrying the abort reason's message. Downstream code pattern-matches on `err.name`. */
export function abortError(reason?: unknown): Error {
  const err = new Error(
    reason instanceof Error ? reason.message : reason === undefined ? 'aborted' : String(reason),
  )
  err.name = 'AbortError'
  return err
}

/** Throw an AbortError. */
export function throwAbort(): never {
  throw abortError()
}

/** Throw if the signal is already aborted; otherwise no-op. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}

/** True for any error whose `name` is `AbortError` (the cross-kernel abort contract). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/**
 * Sleep that resolves early on abort and always clears its timer so it never
 * keeps the event loop alive. Resolves (does not reject) on abort — callers
 * re-check the signal explicitly after the sleep.
 */
export function sleep(ms: number, signal?: AbortSignal, keepAlive = true): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimer()
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const clearTimer = armDeadlineTimer(ms, done, keepAlive)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * Race a promise against a timeout. Resolves with the value if it settles in
 * time, otherwise resolves with `undefined`. Always clears the timer.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const clearTimer = armDeadlineTimer(ms, () => resolve(undefined), true)
    promise.then(
      (value) => {
        clearTimer()
        resolve(value)
      },
      () => {
        clearTimer()
        resolve(undefined)
      },
    )
  })
}

interface StringifyOptions {
  /** Pretty-print with 2-space indent. Default false (compact). */
  pretty?: boolean
  /** Truncate to this many chars, appending `…`. Default unbounded. */
  max?: number
}

/**
 * `JSON.stringify` with a `String()` fallback on throw (cyclic / non-JSON).
 * Strings pass through unstringified so a preview of a string output is the
 * string itself, not a quoted re-encoding.
 */
export function stringifySafe(value: unknown, opts: StringifyOptions = {}): string {
  let s: string
  try {
    if (typeof value === 'string') {
      s = value
    } else {
      const json = opts.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)
      s = json ?? String(value)
    }
  } catch {
    s = String(value)
  }
  if (opts.max !== undefined && s.length > opts.max) return `${s.slice(0, opts.max)}…`
  return s
}

/** A fresh zero token-usage accumulator. */
export function zeroTokenUsage(): LoopTokenUsage {
  return { input: 0, output: 0 }
}

/**
 * Sum the catalog-priced part of a dollar total across spends, as a field to spread.
 *
 * Returns nothing when no input carried one. A fold of pure provider receipts must not gain a
 * `usdEstimated: 0`, which would read as "this runtime checked and priced none" on a path that
 * never prices at all.
 */
function usdEstimatedOf(...spends: ReadonlyArray<{ usdEstimated?: number }>): {
  usdEstimated?: number
} {
  let total = 0
  let priced = false
  for (const spend of spends) {
    if (spend.usdEstimated === undefined) continue
    priced = true
    total += spend.usdEstimated
  }
  return priced ? { usdEstimated: total } : {}
}

/** A conserved spend with every channel at zero and no completeness claim on it. */
export function zeroSpend(): Spend {
  return { iterations: 0, tokens: zeroTokenUsage(), usd: 0, ms: 0 }
}

/** Work that happened and reported no receipt. Unlike {@link zeroSpend}, `tokensKnown: false` makes
 *  the zero a floor, so a token or dollar ceiling still fires. Never relabel that as a measurement. */
export function unmeteredSpend(ms: number): Spend {
  return {
    iterations: 0,
    tokens: zeroTokenUsage(),
    tokensKnown: false,
    usd: 0,
    usdKnown: false,
    ms,
  }
}

/** Copy a conserved spend without dropping a completeness marker or the catalog-priced part. */
export function cloneSpend(spend: Spend): Spend {
  return {
    ...addResourceSpend(spend.resources),
    iterations: spend.iterations,
    tokens: cloneTokenUsage(spend.tokens),
    ...(spend.tokensKnown === false ? { tokensKnown: false } : {}),
    usd: spend.usd,
    ...(spend.usdKnown === false ? { usdKnown: false } : {}),
    ...(spend.usdEstimated !== undefined ? { usdEstimated: spend.usdEstimated } : {}),
    ms: spend.ms,
    ...boxMinutesOf(spend),
    ...(spend.tokensProvenance === undefined ? {} : { tokensProvenance: spend.tokensProvenance }),
    ...streamBreakOf(spend),
  }
}

/**
 * Sum two conserved spends per channel. Tokens and dollars never fold into each other, an
 * incomplete input keeps the sum incomplete on that channel, and the catalog-priced part of the
 * dollar total is summed separately so `usd - usdEstimated` still names what a provider billed.
 */
export function addSpend(a: Spend, b: Spend): Spend {
  const tokens = cloneTokenUsage(a.tokens)
  addTokenUsage(tokens, b.tokens)
  return {
    ...addResourceSpend(a.resources, b.resources),
    iterations: a.iterations + b.iterations,
    tokens,
    ...(a.tokensKnown === false || b.tokensKnown === false ? { tokensKnown: false } : {}),
    usd: a.usd + b.usd,
    ...(a.usdKnown === false || b.usdKnown === false ? { usdKnown: false } : {}),
    ...usdEstimatedOf(a, b),
    ms: a.ms + b.ms,
    ...boxMinutesOf(a, b),
    ...tokensProvenanceOf(a, b),
    ...streamBreakOf(a, b),
  }
}

/** Absent provenance is the live stream. A stated source beside an absent one folds to `mixed`. */
function tokensProvenanceOf(...spends: ReadonlyArray<Spend>): {
  tokensProvenance?: TokenUsageProvenance
} {
  let folded: TokenUsageProvenance | undefined
  let sawStated = false
  for (const spend of spends) {
    const stated = spend.tokensProvenance ?? 'stream-receipt'
    if (spend.tokensProvenance !== undefined) sawStated = true
    folded = folded === undefined || folded === stated ? stated : 'mixed'
  }
  return !sawStated || folded === undefined || folded === 'stream-receipt'
    ? {}
    : { tokensProvenance: folded }
}

/** Fold a broken stream's split. A spend that never broke contributes nothing, not a zero. */
function streamBreakOf(
  ...spends: ReadonlyArray<Spend>
): Pick<Spend, 'streamedTokens' | 'unobservedTokens' | 'iterationsKnown'> {
  const streamedTokens = foldTokenSplit(spends.map((spend) => spend.streamedTokens))
  const unobservedTokens = foldTokenSplit(spends.map((spend) => spend.unobservedTokens))
  const iterationsKnown = spends.some((spend) => spend.iterationsKnown === false)
    ? (false as const)
    : undefined
  return {
    ...(streamedTokens === undefined ? {} : { streamedTokens }),
    ...(unobservedTokens === undefined ? {} : { unobservedTokens }),
    ...(iterationsKnown === undefined ? {} : { iterationsKnown }),
  }
}

function foldTokenSplit(
  parts: ReadonlyArray<LoopTokenUsage | undefined>,
): LoopTokenUsage | undefined {
  const present = parts.filter((part): part is LoopTokenUsage => part !== undefined)
  const first = present[0]
  if (first === undefined) return undefined
  const total = cloneTokenUsage(first)
  for (const part of present.slice(1)) addTokenUsage(total, part)
  return total
}

/** Sum present box minutes. Absence is not zero, so a path with no box stays unmarked.
 *  `boxMinutesKnown` is sticky-false. Provenance degrades from observed to estimated to uncaptured. */
function boxMinutesOf(...spends: ReadonlyArray<Spend>): {
  boxMinutes?: number
  boxMinutesKnown?: boolean
  boxMinutesProvenance?: 'observed' | 'estimated' | 'uncaptured'
} {
  const present = spends.filter((spend) => spend.boxMinutesProvenance !== undefined)
  if (present.length === 0) return {}
  let minutes = 0
  let sawNumber = false
  let known = true
  let observedOnly = true
  for (const spend of present) {
    if (typeof spend.boxMinutes === 'number' && Number.isFinite(spend.boxMinutes)) {
      minutes += spend.boxMinutes
      sawNumber = true
      if (spend.boxMinutesProvenance !== 'observed') observedOnly = false
    }
    if (spend.boxMinutesKnown !== true) known = false
  }
  return {
    ...(sawNumber ? { boxMinutes: roundBoxMinutes(minutes) } : {}),
    boxMinutesKnown: known,
    boxMinutesProvenance: sawNumber ? (observedOnly ? 'observed' : 'estimated') : 'uncaptured',
  }
}

/**
 * Box minutes at four decimals — a tenth of a second.
 *
 * Fine enough that a box alive for two seconds reports `0.0333` instead of a zero that would read
 * as a measured free box, and coarse enough that summing floats does not print
 * `1.5000000000000002`.
 */
export function roundBoxMinutes(minutes: number): number {
  return Number(minutes.toFixed(4))
}

/** Copy a token subtotal without dropping optional provider cache telemetry. */
export function cloneTokenUsage(usage: LoopTokenUsage): LoopTokenUsage {
  const cacheBreakdownUnknown =
    usage.cacheBreakdownKnown === false || (usage.input > 0 && !hasClassifiedCacheBreakdown(usage))
  return {
    input: usage.input,
    output: usage.output,
    ...(usage.tokensKnown === false ? { tokensKnown: false as const } : {}),
    ...(usage.freshInput !== undefined ? { freshInput: usage.freshInput } : {}),
    ...(usage.cacheRead !== undefined ? { cacheRead: usage.cacheRead } : {}),
    ...(usage.cacheWrite !== undefined ? { cacheWrite: usage.cacheWrite } : {}),
    ...(cacheBreakdownUnknown ? { cacheBreakdownKnown: false as const } : {}),
  }
}

/** True only when every positive prompt token has a consistent cache classification. */
export function hasCompleteCacheBreakdown(usage: LoopTokenUsage): boolean {
  if (usage.cacheBreakdownKnown === false) return false
  return hasClassifiedCacheBreakdown(usage)
}

function hasClassifiedCacheBreakdown(usage: LoopTokenUsage): boolean {
  if (usage.input === 0) return true
  if (
    usage.freshInput === undefined ||
    usage.cacheRead === undefined ||
    usage.cacheWrite === undefined
  ) {
    return false
  }
  return usage.freshInput + usage.cacheRead + usage.cacheWrite === usage.input
}

/** Charge `input - cacheRead + output`. A cache read was charged when written. Classes that do not
 *  fit `input` credit nothing. Unclassified prompt tokens charge in full. Do not charge
 *  `freshInput + cacheWrite`: one unclassified turn would then over-charge the classified ones. */
export function chargedTokens(usage: LoopTokenUsage): number {
  return usage.input - creditedCacheRead(usage) + usage.output
}

/** `cacheRead` if the reported classes fit inside `input`, else nothing. */
function creditedCacheRead(usage: LoopTokenUsage): number {
  const { cacheRead } = usage
  if (cacheRead === undefined) return 0
  return classifiedTotal(usage, cacheRead) > usage.input ? 0 : cacheRead
}

function classifiedTotal(usage: Partial<LoopTokenUsage>, cacheRead: number): number {
  return (usage.freshInput ?? 0) + cacheRead + (usage.cacheWrite ?? 0)
}

/**
 * The only two members this reads out of a provider prompt-cache report, named rather than taken as
 * an open record: both the typed `PromptCacheUsage` and the open `promptCache` an `llm_call` carries
 * satisfy it, and each value is validated before it is credited.
 */
interface PromptCacheCounters {
  readonly readTokens?: unknown
  readonly writeTokens?: unknown
}

/** The prompt-cache token classes of one observation, as `LoopTokenUsage` members. */
type PromptCacheTokenClasses = Pick<
  LoopTokenUsage,
  'freshInput' | 'cacheRead' | 'cacheWrite' | 'cacheBreakdownKnown'
>

/** Nothing reported stays unmarked. A read and a write that fit `input` are a complete split.
 *  One counter, or classes past `input`, pass through with `cacheBreakdownKnown: false`.
 *  An unreported counter stays absent, never zero. */
export function promptCacheTokenClasses(
  input: number | undefined,
  promptCache: PromptCacheCounters | undefined,
): PromptCacheTokenClasses {
  if (promptCache === undefined) return {}
  const read = tokenCount(promptCache.readTokens)
  const write = tokenCount(promptCache.writeTokens)
  if (read === undefined && write === undefined) return {}
  if (input === undefined || (read ?? 0) + (write ?? 0) > input) {
    return { cacheBreakdownKnown: false }
  }
  if (read !== undefined && write !== undefined) {
    return { freshInput: input - read - write, cacheRead: read, cacheWrite: write }
  }
  return {
    ...(read !== undefined ? { cacheRead: read } : {}),
    ...(write !== undefined ? { cacheWrite: write } : {}),
    cacheBreakdownKnown: false,
  }
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Add a subtotal. Classes that overflow their own `input` are dropped, so a later fold cannot
 *  credit a cache read this record refused. An unclassified positive input makes the sum unknown. */
export function addTokenUsage(acc: LoopTokenUsage, delta: Partial<LoopTokenUsage>): void {
  acc.input += delta.input ?? 0
  acc.output += delta.output ?? 0
  if (delta.tokensKnown === false) acc.tokensKnown = false

  const input = delta.input ?? 0
  const fits = classifiedTotal(delta, delta.cacheRead ?? 0) <= input
  if (fits) {
    if (delta.freshInput !== undefined) acc.freshInput = (acc.freshInput ?? 0) + delta.freshInput
    if (delta.cacheRead !== undefined) acc.cacheRead = (acc.cacheRead ?? 0) + delta.cacheRead
    if (delta.cacheWrite !== undefined) acc.cacheWrite = (acc.cacheWrite ?? 0) + delta.cacheWrite
  }

  const classified =
    fits &&
    delta.freshInput !== undefined &&
    delta.cacheRead !== undefined &&
    delta.cacheWrite !== undefined &&
    delta.freshInput + delta.cacheRead + delta.cacheWrite === input
  // A provider that reports prompt input without all three classes leaves the
  // split unknown. Do not let an earlier complete turn make the aggregate look
  // complete after a later unclassified positive-input turn.
  if (delta.cacheBreakdownKnown === false || (input > 0 && !classified)) {
    acc.cacheBreakdownKnown = false
  }
}

/** Run `fn` with at most `limit` calls in flight, preserving input order. The first rejection wins. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  for await (const settled of runTaskQueue({
    concurrency: Math.max(1, Math.min(Math.floor(limit), items.length)),
    take: () => {
      const index = next++
      return index < items.length ? { id: String(index), value: index } : undefined
    },
    execute: ({ value: index }) => fn(items[index] as T, index),
  })) {
    if (settled.status === 'rejected') throw settled.reason
    results[settled.task.value] = settled.value
  }
  return results
}

/** The message of a thrown value: an `Error`'s own message, anything else stringified. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** True for an object whose `Symbol.asyncIterator` is callable, so `for await` can consume it. */
export function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  )
}

/** 32-bit FNV-1a over a string's UTF-16 code units, as eight lowercase hex digits. */
export function fnv1a32Hex(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Parent journals may already contain an interrupted driver's inference prefix. */
export function unreportedSpend(total: Spend, prior: Spend): Spend {
  const tokens = { ...total.tokens }
  for (const key of ['input', 'output', 'freshInput', 'cacheRead', 'cacheWrite'] as const) {
    const value = total.tokens[key]
    if (value !== undefined) tokens[key] = Math.max(0, value - (prior.tokens[key] ?? 0))
  }
  return {
    ...total,
    ...addResourceSpend(
      total.resources === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(total.resources).map(([name, value]) => {
              const previous = prior.resources?.[name]
              if (previous && previous.unit !== value.unit)
                throw new ValidationError(`resource ${name}: unit mismatch`)
              return [
                name,
                {
                  ...value,
                  amount: Math.max(0, value.amount - (previous?.amount ?? 0)),
                  known: value.known && (previous?.known ?? true),
                },
              ]
            }),
          ),
    ),
    iterations: Math.max(0, total.iterations - prior.iterations),
    tokens,
    usd: Math.max(0, total.usd - prior.usd),
    ms: Math.max(0, total.ms - prior.ms),
    ...(total.usdEstimated === undefined
      ? {}
      : { usdEstimated: Math.max(0, total.usdEstimated - (prior.usdEstimated ?? 0)) }),
    ...(total.boxMinutes === undefined
      ? {}
      : { boxMinutes: Math.max(0, total.boxMinutes - (prior.boxMinutes ?? 0)) }),
  }
}
