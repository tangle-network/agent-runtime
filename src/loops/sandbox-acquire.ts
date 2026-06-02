/**
 * @experimental
 *
 * `acquireSandbox` — cold-start-resilient sandbox acquisition. Eliminates the
 * "create timed out at the proxy" failure mode conceptually by DECOUPLING "the
 * create HTTP call returned" from "the sandbox is ready":
 *
 *   - Create is initiated with a known `name`.
 *   - Readiness is observed from the sandbox's own `status` (`refresh()` polls
 *     true state), NOT from whether the create call returned in time.
 *   - If the create call itself times out at a gateway (502/503/504/522/524 or
 *     a transport timeout), provisioning is still running server-side — so we
 *     find the named sandbox via `list()` and wait for it to reach `running`.
 *
 * Result: a scale-from-zero cold start (node boot + host-agent registration,
 * minutes) can no longer surface as a create failure behind a ~100s proxy
 * limit. The loop becomes indifferent to whether the host pool is warm or cold.
 *
 * Backward-compatible: an instance that reports no `status` (the minimal fakes
 * the loop tests use) is treated as ready — only an explicit `pending`/
 * `provisioning` status triggers waiting, and only a retryable THROW triggers
 * the find-by-name path. Real errors (auth, validation, budget) fail loud.
 */

import type { CreateSandboxOptions, SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import type { LoopSandboxClient } from './types'

/** Gateway/transport statuses where the create call returned but provisioning continues. */
const RETRYABLE_HTTP = new Set([502, 503, 504, 522, 524, 408, 425, 429])
const TERMINAL_STATUS = new Set(['failed', 'expired', 'stopped'])

/** @experimental */
export interface AcquireOptions {
  /**
   * Total budget for the sandbox to reach `running`, covering on-demand node
   * cold-start. Default 600_000ms — matches the orchestrator's pending-host
   * registration window so we never give up before the platform itself would.
   */
  readyTimeoutMs?: number
  /** Poll interval while waiting for `running` / for the named sandbox to appear. */
  pollIntervalMs?: number
  /** Cancellation (user abort). Distinct from create-call timeouts. */
  signal?: AbortSignal
  /** Stamp a name so a timed-out create is recoverable by lookup. Auto-generated if absent. */
  name?: string
  /** Clock override for deterministic tests. */
  now?: () => number
  /** Sleep override for deterministic tests. */
  sleep?: (ms: number) => Promise<void>
}

/** Minimal client surface acquire needs beyond `create` (the real SDK satisfies it). */
interface PollableClient extends LoopSandboxClient {
  list?: (options?: unknown) => Promise<SandboxInstance[]>
  get?: (id: string) => Promise<SandboxInstance | null>
}

/** @experimental */
export async function acquireSandbox(
  client: LoopSandboxClient,
  options: CreateSandboxOptions,
  acquire: AcquireOptions = {},
): Promise<SandboxInstance> {
  if (!client || typeof client.create !== 'function') {
    throw new ValidationError('acquireSandbox: client.create is required')
  }
  const now = acquire.now ?? Date.now
  const sleep = acquire.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const pollMs = acquire.pollIntervalMs ?? 3000
  const deadline = now() + (acquire.readyTimeoutMs ?? 600_000)
  const name = options.name ?? acquire.name ?? `loop-sbx-${randomSuffix()}`
  const createOpts: CreateSandboxOptions = { ...options, name }
  const c = client as PollableClient

  let lastErr: unknown
  let attempt = 0
  while (now() < deadline) {
    throwIfAborted(acquire.signal)
    try {
      const box = await client.create(createOpts)
      return await waitUntilReady(box, deadline, pollMs, acquire.signal, now, sleep)
    } catch (err) {
      throwIfAborted(acquire.signal)
      // Non-retryable (auth/validation/budget) fails loud immediately.
      if (!isRetryable(err)) throw err
      lastErr = err
      // Two recoveries for a gateway-timed-out create, in order:
      //  (a) some orchestrators leave a pending sandbox behind — attach to it;
      //  (b) others roll the create back — so retry create with backoff (a
      //      retry lands once a warm host exists / the autoscaler caught up).
      if (typeof c.list === 'function') {
        const found = (await c.list().catch(() => []))?.find((b) => b.name === name)
        if (found) return await waitUntilReady(found, deadline, pollMs, acquire.signal, now, sleep)
      }
      attempt += 1
      await sleep(Math.min(pollMs * attempt, 15_000))
    }
  }
  throw new ValidationError(
    `acquireSandbox: could not acquire a running sandbox "${name}" within budget`,
    { cause: lastErr instanceof Error ? lastErr : undefined },
  )
}

/** Wait for `running`. No status (minimal fakes) = ready. Terminal status throws. */
async function waitUntilReady(
  box: SandboxInstance,
  deadline: number,
  pollMs: number,
  signal: AbortSignal | undefined,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<SandboxInstance> {
  for (;;) {
    throwIfAborted(signal)
    const status = readStatus(box)
    if (status === undefined || status === 'running') return box
    if (TERMINAL_STATUS.has(status)) {
      throw new ValidationError(
        `acquireSandbox: sandbox ${box.id ?? '(unknown)'} is ${status}${box.error ? `: ${box.error}` : ''}`,
      )
    }
    if (now() >= deadline) {
      throw new ValidationError(
        `acquireSandbox: sandbox ${box.id ?? '(unknown)'} not running within budget (last status: ${status})`,
      )
    }
    await sleep(pollMs)
    if (typeof box.refresh === 'function') await box.refresh()
  }
}

function readStatus(box: SandboxInstance): string | undefined {
  const s = (box as { status?: unknown }).status
  return typeof s === 'string' ? s : undefined
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: number; statusCode?: number; name?: string; message?: string }
  const status = e.status ?? e.statusCode
  if (typeof status === 'number' && RETRYABLE_HTTP.has(status)) return true
  const name = e.name ?? ''
  if (name === 'TimeoutError' || name === 'ServerError' || name === 'NetworkError') return true
  return /\b(timed out|timeout|gateway|temporarily unavailable|ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b/i.test(
    e.message ?? '',
  )
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error('aborted')
    err.name = 'AbortError'
    throw err
  }
}

function randomSuffix(len = 10): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len)
}
