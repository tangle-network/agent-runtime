/**
 *
 * Internal loop-kernel utilities shared across the kernel, drivers, and the
 * sandbox-acquire layer. Not part of the public barrel surface.
 *
 * @experimental
 */

import type { SandboxInstance } from '@tangle-network/sandbox'
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

/** Construct an AbortError. Downstream code pattern-matches on `err.name`. */
export function abortError(): Error {
  const err = new Error('aborted')
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
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    let onAbort: (() => void) | undefined
    const timer = setTimeout(() => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal) {
      onAbort = () => {
        clearTimeout(timer)
        resolve()
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/**
 * Race a promise against a timeout. Resolves with the value if it settles in
 * time, otherwise resolves with `undefined`. Always clears the timer.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
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
export function usdEstimatedOf(...spends: ReadonlyArray<{ usdEstimated?: number }>): {
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

/**
 * The token charge for one observation: every token counted ONCE, at the moment it first enters
 * the context — `input − cacheRead + output`.
 *
 * `input` is a rolled-up prompt total that re-counts a cached prefix on every turn that reads it,
 * so charging `input` makes a 100K prefix read 40 times cost 4.1M for content authored once. A
 * cache read is content that was already charged when it was written, so it is the one class the
 * charge subtracts. Under a complete split the result is exactly `freshInput + cacheWrite`. No
 * price weight is involved: this counts work, and money is a separate channel.
 *
 * The subtraction form is what makes the charge ADDITIVE. `input` and `cacheRead` both accumulate
 * through `addTokenUsage`, so the charge on an aggregate equals the sum of the charges on the
 * records that built it — including an aggregate that mixes classified and unclassified turns,
 * where the unclassified remainder is charged in full and only the reported cache reads are
 * credited. A form that read `freshInput + cacheWrite` directly loses that: one unclassified turn
 * would drop the whole aggregate to `input + output` and over-charge every classified turn with it.
 *
 * The one arithmetic guarantee: a set of classes that does not FIT inside the prompt total it
 * partitions credits nothing, so the charge is never below `output` and a class that overflows its
 * own total buys no tokens. It is not a guarantee against a provider that reports a cache read it
 * never served — that provider can under-report `input` just as easily, and the token channel is an
 * accounting unit, not a trust boundary. Prompt tokens the provider left unclassified are charged
 * in full, so a spend with no readable split charges an upper bound on newly-presented work rather
 * than a measurement, and every caller that enforces a ceiling must report the difference
 * (`BudgetPool` does it through `readout().cacheBreakdownKnown`).
 */
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

/** The prompt-cache token classes of one observation, as `LoopTokenUsage` members. */
export type PromptCacheTokenClasses = Pick<
  LoopTokenUsage,
  'freshInput' | 'cacheRead' | 'cacheWrite' | 'cacheBreakdownKnown'
>

/**
 * Translate one provider prompt-cache report into the prompt token classes `addTokenUsage` folds
 * and `chargedTokens` credits.
 *
 * The input is the open `promptCache` record an `llm_call` carries, keyed by the `PromptCacheUsage`
 * vocabulary (`readTokens`, `writeTokens`). Providers report that vocabulary unevenly, and the
 * three outcomes are different facts that must not collapse into one another:
 *
 *  - **Nothing reported** — no classes and no marker. The caller's own unknown handling decides,
 *    because a provider that says nothing about caching has not said the split is unknowable.
 *  - **Read and write both reported, and fitting inside `input`** — a complete partition, so
 *    `freshInput` is the remainder and the split is known.
 *  - **One counter reported, or classes that overflow `input`** — the counters that ARE measured
 *    pass through and `cacheBreakdownKnown` is false. A read with no write counter (OpenAI reports
 *    no write) still credits the read it measured, while declaring the rest unclassified so the
 *    charge stays a declared upper bound. An overflowing claim buys nothing: it cannot be a
 *    partition of a total it exceeds.
 *
 * A counter the provider did not report stays absent. A zero would claim the provider measured no
 * cache, which is a different fact from a provider that did not report.
 */
export function promptCacheTokenClasses(
  input: number | undefined,
  promptCache: Readonly<Record<string, number | string>> | undefined,
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

/**
 * Add the observed subtotal into `acc`; token and cache incompleteness are sticky.
 *
 * A delta whose classes do not FIT inside its own `input` contributes its prompt total and NO
 * classes. Folding them in would hide the overflow: the accumulator's larger `input` can absorb a
 * class total that overflowed the one delta that reported it, and `chargedTokens` would then credit
 * at the aggregate a cache read it refuses at the record. That is the one way the charge could come
 * out below the sum of the charges on the records that built it.
 */
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

/**
 * Map `items` through `fn` with at most `limit` calls in flight at once,
 * preserving input order in the result. On the first `fn` rejection no NEW
 * items are picked up; already-in-flight calls are awaited, then the first
 * error is rethrown. `limit` is clamped to ≥ 1.
 *
 * Used where a burst of provisioning (e.g. forking N child boxes) must respect
 * the loop's concurrency bound instead of firing all N at once.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const bound = Math.max(1, Math.floor(limit))
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = next
      next += 1
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i] as T, i)
      } catch (err) {
        failed = true
        throw err
      }
    }
  }
  const workerCount = Math.min(bound, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
