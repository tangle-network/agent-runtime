/**
 * @experimental
 *
 * Internal loop-kernel utilities shared across the kernel, drivers, and the
 * sandbox-acquire layer. Not part of the public barrel surface.
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

/** Add `delta` into `acc` in place. Missing fields count as zero. */
export function addTokenUsage(acc: LoopTokenUsage, delta: Partial<LoopTokenUsage>): void {
  acc.input += delta.input ?? 0
  acc.output += delta.output ?? 0
}
