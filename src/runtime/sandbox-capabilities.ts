/**
 *
 * Capability probe for the loop kernel's backend-blind lineage seams. The
 * kernel must NEVER ask "is this Docker or Firecracker?"; it asks "can this
 * platform fork a checkpoint?" via `client.criuStatus()` and degrades to fresh
 * boxes when the answer is no. CRIU availability is a per-platform fact, so the
 * probe is memoized per client — one network round-trip, reused across every
 * fanout in the run.
 *
 * Invariant: a client with no `criuStatus` method (the loop's test fakes, the
 * raw SDK before it grew the probe) reports `canFork = false`. The seam is
 * fail-CLOSED — never assume forking works, only enable it on a positive probe.
 *
 * @experimental
 */

import type { SandboxClient } from './types'

/**
 * What the loop kernel is allowed to know about a sandbox backend: a single
 * capability bit, never the backend's identity. `canFork` gates the
 * checkpoint+fork fanout path; everything else (session continuation) is a
 * universal SDK feature that needs no probe.
 *
 * @experimental
 */
export interface SandboxCapabilities {
  /**
   * True only when `client.criuStatus()` returned `{ available: true }`. When
   * false, a fork-enabled fanout degrades to independent fresh boxes — same
   * result, no shared context prefix.
   */
  canFork: boolean
}

const probeCache = new WeakMap<object, Promise<SandboxCapabilities>>()

/**
 * Probe (and memoize per client) what the loop may rely on. A client without a
 * `criuStatus` method, or whose probe rejects, yields `canFork = false` — a
 * failed probe must never claim a capability the platform may not have. The
 * promise is cached so concurrent fanout branches share one round-trip.
 *
 * @experimental
 */
export function probeSandboxCapabilities(client: SandboxClient): Promise<SandboxCapabilities> {
  const key = client as unknown as object
  const cached = probeCache.get(key)
  if (cached) return cached
  const probe = resolveCapabilities(client)
  probeCache.set(key, probe)
  return probe
}

async function resolveCapabilities(client: SandboxClient): Promise<SandboxCapabilities> {
  const criuStatus = (client as CriuCapableClient).criuStatus
  if (typeof criuStatus !== 'function') return { canFork: false }
  try {
    const status = await criuStatus.call(client)
    return { canFork: status?.available === true }
  } catch {
    // A probe that throws (transport error, unsupported endpoint) is treated as
    // "no fork" — fail closed so a flaky probe degrades to fresh boxes rather
    // than attempting a checkpoint the platform can't honor.
    return { canFork: false }
  }
}

/**
 * Narrowed view of the optional CRIU probe. The loop-side `SandboxClient`
 * does not require `criuStatus`; this widens it optionally so the probe can be
 * read without importing sandbox-backend specifics. @experimental
 */
export interface CriuCapableClient {
  criuStatus?: () => Promise<{ available: boolean; criuVersion?: string; reason?: string }>
}
