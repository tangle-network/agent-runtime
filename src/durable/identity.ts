/**
 * Identity + canonical-hash helpers for the durable-runs substrate.
 *
 * Two boundary disciplines:
 *
 *   1. **Manifest hash** — sha256 over a sorted-key JSON of (projectId,
 *      scenarioId, task.id, task.intent, task.domain, input). Same hash =
 *      same run identity. Used to detect "same runId, different inputs."
 *
 *   2. **Step input hash** — sha256 over a sorted-key JSON of the step's
 *      input fingerprint. Used to detect drift across replays.
 *
 * Sorted-key JSON makes hashes deterministic regardless of object insertion
 * order. NaN / Infinity / undefined / functions / symbols / class instances
 * are rejected — pure JSON only at the boundary, so the hash matches whatever
 * the store round-trips.
 */

import { createHash } from 'node:crypto'

import type { DurableRunManifest } from './types'

/** sha256-hex over a JSON-canonicalized value. */
export function canonicalHash(value: unknown): string {
  const json = canonicalJson(value)
  return createHash('sha256').update(json).digest('hex')
}

/** Canonical JSON: object keys sorted lexicographically; arrays preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null
  if (Array.isArray(value)) return value.map(canonicalize)
  const t = typeof value
  if (t === 'string' || t === 'boolean') return value
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new TypeError(`canonicalJson: non-finite number ${String(value)} not serializable`)
    }
    return value
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    throw new TypeError(`canonicalJson: ${t} is not JSON-serializable`)
  }
  if (t === 'bigint') {
    // BigInts have no JSON representation. Encode as string; tag for
    // disambiguation so consumers can choose to reject or decode.
    return { __bigint: String(value) }
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>
    // Reject class instances — Date / Error / Map / Set / TypedArray — to
    // force callers to project to plain JSON at the boundary. Errors round-
    // tripped silently are the #1 source of "looks the same but differs"
    // bugs.
    const proto = Object.getPrototypeOf(obj)
    if (proto !== null && proto !== Object.prototype) {
      const ctor = obj.constructor?.name ?? 'unknown'
      throw new TypeError(
        `canonicalJson: class instance (${ctor}) is not JSON-serializable. Project to plain { ... } at the boundary.`,
      )
    }
    const keys = Object.keys(obj).sort()
    const out: Record<string, unknown> = {}
    for (const k of keys) out[k] = canonicalize(obj[k])
    return out
  }
  throw new TypeError(`canonicalJson: unsupported type ${t}`)
}

/** Hash a DurableRunManifest into the run identity component. */
export function manifestHash(manifest: DurableRunManifest): string {
  return canonicalHash({
    projectId: manifest.projectId,
    scenarioId: manifest.scenarioId ?? null,
    taskId: manifest.task.id,
    taskIntent: manifest.task.intent,
    taskDomain: manifest.task.domain,
    input: manifest.input,
  })
}

/** Stable per-step identifier — hash of (runId, position, intent). */
export function stepId(runId: string, stepIndex: number, intent: string): string {
  return canonicalHash({ runId, stepIndex, intent })
}

let counter = 0
/**
 * Stable worker id for a single process. Format: `host:pid:rand`. Random
 * suffix prevents collisions when the host/pid pair is short-lived (e.g.,
 * Cloudflare isolates that recycle fast).
 */
export function deriveWorkerId(): string {
  const host = process.env.HOSTNAME ?? 'host'
  const pid = process.pid ?? 0
  const rand = Math.random().toString(36).slice(2, 10)
  counter += 1
  return `${host}:${pid}:${rand}:${counter}`
}
