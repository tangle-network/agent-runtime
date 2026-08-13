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
 * A reported class may never exceed the prompt total it partitions. An over-reported `cacheRead`
 * credits nothing, so bad cache telemetry can only over-charge, never buy free tokens. An
 * unreadable split therefore charges an UPPER BOUND on newly-presented work, not a measurement,
 * and every caller that enforces a ceiling must report the difference (`BudgetPool` does it through
 * `readout().cacheBreakdownKnown`).
 */
export function chargedTokens(usage: LoopTokenUsage): number {
  return usage.input - creditedCacheRead(usage) + usage.output
}

function creditedCacheRead(usage: LoopTokenUsage): number {
  const { cacheRead } = usage
  if (cacheRead === undefined) return 0
  const classified = (usage.freshInput ?? 0) + cacheRead + (usage.cacheWrite ?? 0)
  return classified > usage.input ? 0 : cacheRead
}

/** Add the observed subtotal into `acc`; token and cache incompleteness are sticky. */
export function addTokenUsage(acc: LoopTokenUsage, delta: Partial<LoopTokenUsage>): void {
  acc.input += delta.input ?? 0
  acc.output += delta.output ?? 0
  if (delta.tokensKnown === false) acc.tokensKnown = false

  if (delta.freshInput !== undefined) acc.freshInput = (acc.freshInput ?? 0) + delta.freshInput
  if (delta.cacheRead !== undefined) acc.cacheRead = (acc.cacheRead ?? 0) + delta.cacheRead
  if (delta.cacheWrite !== undefined) acc.cacheWrite = (acc.cacheWrite ?? 0) + delta.cacheWrite

  const input = delta.input ?? 0
  const classified =
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
