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
 * Invariant: an instance reporting no `status` (the minimal test fakes) is
 * treated as ready; only an explicit `pending`/`provisioning` status triggers
 * waiting, and only a retryable THROW triggers the find-by-name path. Real
 * errors (auth, validation, budget) fail loud. A box that is created (or found)
 * but never reaches `running` (abort, terminal status, budget) is torn down
 * before the failure propagates, so an abort storm during cold start does not
 * leak live sandboxes.
 */

import type { CreateSandboxOptions, SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import type { LoopSandboxClient } from './types'
import { sleep as abortableSleep, deleteBoxSafe, randomUuid, throwIfAborted } from './util'

/**
 * HTTP statuses where create should be retried — gateway timeouts
 * (502/503/504/522/524) where provisioning may continue server-side, plus
 * request-level retryables (408/425/429).
 */
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
  const sleep = acquire.sleep ?? ((ms: number) => abortableSleep(ms, acquire.signal))
  const pollMs = acquire.pollIntervalMs ?? 3000
  const deadline = now() + (acquire.readyTimeoutMs ?? 600_000)
  // After a retryable create error (commonly a gateway/request timeout on a cold
  // scale-from-zero), the orchestrator has usually ACCEPTED the request and is
  // still provisioning the NAMED box — which appears in list() a few seconds
  // AFTER the create call gave up. Scan list() this many windows for it to
  // appear before re-POSTing: re-creating immediately restarts a fresh cold
  // provision and hits the same wall — that thrash is why a cold acquire never
  // converges within the budget; attaching to the in-flight box does.
  const appearScans = 5
  // crypto.randomUUID is collision-resistant — find-by-name recovery scans
  // list() for this exact name, so two concurrent acquires must never collide.
  const name = options.name ?? acquire.name ?? `loop-sbx-${randomUuid()}`
  const createOpts: CreateSandboxOptions = { ...options, name }
  const c = client as PollableClient

  let lastErr: unknown
  let attempt = 0
  while (now() < deadline) {
    throwIfAborted(acquire.signal)
    try {
      const box = await client.create(createOpts)
      // Tear the just-created box down if it never reaches `running` (abort,
      // terminal status, budget) so a failed wait never leaks a live sandbox.
      return await waitReadyOrDestroy(box, deadline, pollMs, acquire.signal, now, sleep)
    } catch (err) {
      throwIfAborted(acquire.signal)
      // Non-retryable (auth/validation/budget) fails loud immediately.
      if (!isRetryable(err)) throw err
      lastErr = err
      // Recovery for a gateway-timed-out create, in order:
      //  (a) the orchestrator usually ACCEPTED the create and is provisioning
      //      the named box — it appears in list() a few seconds later, so poll
      //      for it across `appearScans` windows and attach (this is the cold-
      //      start fix: a single scan misses a row not yet written and the loop
      //      would otherwise re-POST a fresh cold provision every backoff);
      //  (b) only if it never appears did the create truly roll back — retry
      //      create with backoff (lands once a warm host exists / autoscaler
      //      caught up).
      if (typeof c.list === 'function') {
        for (let scan = 0; scan < appearScans && now() < deadline; scan += 1) {
          const found = (await c.list().catch(() => []))?.find((b) => b.name === name)
          if (found)
            return await waitReadyOrDestroy(found, deadline, pollMs, acquire.signal, now, sleep)
          if (scan < appearScans - 1) await sleep(pollMs)
        }
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

/** `waitUntilReady`, tearing the box down (best-effort) on any throw so a box
 *  that never reaches `running` (abort, terminal status, budget) does not leak. */
async function waitReadyOrDestroy(
  box: SandboxInstance,
  deadline: number,
  pollMs: number,
  signal: AbortSignal | undefined,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<SandboxInstance> {
  try {
    return await waitUntilReady(box, deadline, pollMs, signal, now, sleep)
  } catch (err) {
    await deleteBoxSafe(box)
    throw err
  }
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
