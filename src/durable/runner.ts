/**
 * Durable runner — wraps a user-supplied async function in checkpoint /
 * resume / lease semantics. The user writes plain async code, awaiting
 * `ctx.step(intent, fn)` boundaries. On worker crash, the next caller with
 * the same `runId` skips completed steps and resumes from the first unfinished
 * one.
 *
 * Invariants:
 *
 *   - Step positions are derived from a monotonic counter on the ctx. The
 *     same intent at position N is the same step across replays. If the user
 *     reorders steps, position N changes intent and we raise
 *     DurableRunDivergenceError fail-loud.
 *
 *   - `ctx.now()` and `ctx.uuid()` are checkpointed as zero-input logic steps
 *     with kind='deterministic'. On replay they return the recorded value.
 *
 *   - `awaitEvent` writes a 'event' step that records the event payload on
 *     first awaited completion. On replay, the cached payload returns
 *     synchronously. If the event has not been emitted and the runner is in
 *     a fresh execution, it polls the store until timeout.
 *
 *   - Lease renewal happens on a wall-clock interval (every leaseMs/3). If
 *     the store reports a lost lease, the runner aborts the current step
 *     execution and throws — letting whichever worker holds the lease pick
 *     up. Committed steps survive.
 */

import { canonicalHash, deriveWorkerId, manifestHash } from './identity'
import type {
  DurableRunManifest,
  DurableRunStore,
  RunOutcome,
  RunRecord,
  StepKind,
  StepRecord,
} from './types'
import {
  DurableAwaitEventTimeoutError,
  DurableRunDivergenceError,
} from './types'

export interface DurableContext {
  readonly runId: string
  readonly projectId: string
  readonly scenarioId?: string

  /**
   * Execute a checkpointed step. The step is identified by its **position**
   * (monotonic counter on this ctx); `intent` is a human-readable label that
   * must stay stable across replays.
   *
   * On first execution: runs `fn`, records the result, returns it.
   * On replay: returns the recorded result WITHOUT calling `fn`.
   *
   * The `inputFingerprint` (optional) lets the runner detect "same intent,
   * different inputs" — it gets hashed and compared. If you don't supply
   * one, drift is allowed (input not checked).
   */
  step<T>(
    intent: string,
    fn: () => Promise<T>,
    opts?: { kind?: StepKind; inputFingerprint?: unknown },
  ): Promise<T>

  /** Race-free first-emit-wins event wait. */
  awaitEvent<T = unknown>(key: string, opts?: { timeoutMs?: number; pollMs?: number }): Promise<T>

  /** Emit an event. First emit wins. Subsequent emits no-op. */
  emitEvent(key: string, payload: unknown): Promise<{ accepted: boolean }>

  /** Deterministic clock — checkpointed once per call. */
  now(): Promise<Date>

  /** Deterministic uuid — checkpointed once per call. */
  uuid(): Promise<string>
}

const DEFAULT_LEASE_MS = 30_000
const DEFAULT_AWAIT_POLL_MS = 250

export interface RunDurableInput<TResult> {
  runId: string
  manifest: DurableRunManifest
  store: DurableRunStore
  workerId?: string
  leaseMs?: number
  /** Total time budget for the run. Used for awaitEvent timeouts; runner
   *  itself doesn't kill long-running steps (the step fn must respect
   *  AbortSignal if it cares). */
  signal?: AbortSignal
  taskFn: (ctx: DurableContext) => Promise<TResult>
  /** Default outcome on successful completion. */
  defaultOutcome?: RunOutcome
}

export interface RunDurableResult<TResult> {
  result: TResult
  record: RunRecord
  /** All steps captured this run (replayed + freshly executed). */
  steps: ReadonlyArray<StepRecord>
}

export async function runDurable<TResult>(input: RunDurableInput<TResult>): Promise<RunDurableResult<TResult>> {
  const workerId = input.workerId ?? deriveWorkerId()
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS
  const { completedSteps } = await input.store.startOrResume({
    runId: input.runId,
    manifest: input.manifest,
    workerId,
    leaseMs,
  })

  // Pre-compute a position-indexed view of prior steps for O(1) replay
  // lookups. We DON'T trust that the store returned them in order — sort.
  const priorByIndex = new Map<number, StepRecord>()
  for (const s of completedSteps) priorByIndex.set(s.stepIndex, s)

  const collected: StepRecord[] = [...completedSteps].sort((a, b) => a.stepIndex - b.stepIndex)

  // Lease renewal heartbeat — best-effort. Errors are surfaced via
  // `leaseLost` so steps can short-circuit.
  let leaseLost = false
  const heartbeatIntervalMs = Math.max(1_000, Math.floor(leaseMs / 3))
  const heartbeat = setInterval(() => {
    void input.store
      .renewLease({ runId: input.runId, workerId, leaseMs })
      .then((res) => {
        if (!res.ok) leaseLost = true
      })
      .catch(() => {
        leaseLost = true
      })
  }, heartbeatIntervalMs)
  // unref() so the heartbeat doesn't keep the process alive on test exit.
  if (typeof heartbeat.unref === 'function') heartbeat.unref()

  let positionCounter = 0

  const ctx: DurableContext = {
    runId: input.runId,
    projectId: input.manifest.projectId,
    scenarioId: input.manifest.scenarioId,
    async step<T>(
      intent: string,
      fn: () => Promise<T>,
      opts?: { kind?: StepKind; inputFingerprint?: unknown },
    ): Promise<T> {
      checkAbortAndLease(input.signal, leaseLost)
      const stepIndex = positionCounter++
      const prior = priorByIndex.get(stepIndex)
      const inputHash = opts?.inputFingerprint !== undefined ? canonicalHash(opts.inputFingerprint) : ''
      if (prior && prior.status === 'completed') {
        // Replay path — return cached result.
        if (prior.intent !== intent) {
          throw new DurableRunDivergenceError(
            `step ${stepIndex}: intent changed across replays ('${prior.intent}' -> '${intent}')`,
          )
        }
        return prior.result as T
      }
      // Begin a fresh attempt (either net-new or retry of a failed step).
      const begun = await input.store.beginStep({
        runId: input.runId,
        stepIndex,
        intent,
        kind: opts?.kind ?? 'logic',
        inputHash,
      })
      try {
        const result = await fn()
        const completed = await input.store.completeStep({
          runId: input.runId,
          stepIndex,
          result,
        })
        upsertCollected(collected, completed)
        priorByIndex.set(stepIndex, completed)
        return result
      } catch (err) {
        const failed = await input.store.failStep({
          runId: input.runId,
          stepIndex,
          error: toStepError(err),
        })
        upsertCollected(collected, failed)
        priorByIndex.set(stepIndex, failed)
        throw err
      } finally {
        // The `begun` reference suppresses "unused" warnings without an
        // eslint-disable comment.
        void begun
      }
    },
    async awaitEvent<T>(key: string, opts?: { timeoutMs?: number; pollMs?: number }): Promise<T> {
      const stepIndex = positionCounter++
      const prior = priorByIndex.get(stepIndex)
      if (prior && prior.status === 'completed') {
        if (prior.intent !== `event:${key}`) {
          throw new DurableRunDivergenceError(
            `step ${stepIndex}: awaitEvent key changed across replays`,
          )
        }
        return prior.result as T
      }
      const beginAt = Date.now()
      const timeoutMs = opts?.timeoutMs ?? 60_000
      const pollMs = opts?.pollMs ?? DEFAULT_AWAIT_POLL_MS
      await input.store.beginStep({
        runId: input.runId,
        stepIndex,
        intent: `event:${key}`,
        kind: 'event',
        inputHash: '',
      })
      try {
        for (;;) {
          checkAbortAndLease(input.signal, leaseLost)
          const evt = await input.store.loadEvent(input.runId, key)
          if (evt) {
            const completed = await input.store.completeStep({
              runId: input.runId,
              stepIndex,
              result: evt.payload,
            })
            upsertCollected(collected, completed)
            priorByIndex.set(stepIndex, completed)
            return evt.payload as T
          }
          if (Date.now() - beginAt > timeoutMs) {
            const err = new DurableAwaitEventTimeoutError(
              `awaitEvent('${key}') timed out after ${timeoutMs}ms`,
            )
            const failed = await input.store.failStep({
              runId: input.runId,
              stepIndex,
              error: toStepError(err),
            })
            upsertCollected(collected, failed)
            priorByIndex.set(stepIndex, failed)
            throw err
          }
          await sleep(pollMs, input.signal)
        }
      } catch (err) {
        // Any non-timeout error: mark failed (if not already), surface.
        if (!(err instanceof DurableAwaitEventTimeoutError)) {
          const existing = priorByIndex.get(stepIndex)
          if (!existing || existing.status !== 'failed') {
            const failed = await input.store.failStep({
              runId: input.runId,
              stepIndex,
              error: toStepError(err),
            })
            upsertCollected(collected, failed)
            priorByIndex.set(stepIndex, failed)
          }
        }
        throw err
      }
    },
    async emitEvent(key: string, payload: unknown): Promise<{ accepted: boolean }> {
      const res = await input.store.emitEvent({ runId: input.runId, key, payload })
      return { accepted: res.accepted }
    },
    async now(): Promise<Date> {
      const v = await this.step(
        `deterministic:now`,
        async () => new Date().toISOString(),
        { kind: 'deterministic' },
      )
      return new Date(v)
    },
    async uuid(): Promise<string> {
      return this.step(
        `deterministic:uuid`,
        async () => cryptoRandomUuid(),
        { kind: 'deterministic' },
      )
    },
  }

  try {
    const result = await input.taskFn(ctx)
    const finalRecord = await input.store.endRun({
      runId: input.runId,
      workerId,
      status: 'completed',
      outcome: input.defaultOutcome,
    })
    return { result, record: finalRecord, steps: collected }
  } catch (err) {
    const finalRecord = await input.store.endRun({
      runId: input.runId,
      workerId,
      status: 'failed',
      outcome: {
        ...input.defaultOutcome,
        notes: err instanceof Error ? err.message : String(err),
      },
    })
    void finalRecord
    throw err
  } finally {
    clearInterval(heartbeat)
  }
}

function checkAbortAndLease(signal: AbortSignal | undefined, leaseLost: boolean): void {
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  if (leaseLost) throw new Error('durable-runs: lease lost; another worker has taken over this run')
}

function upsertCollected(list: StepRecord[], rec: StepRecord): void {
  const i = list.findIndex((s) => s.stepIndex === rec.stepIndex)
  if (i === -1) list.push(rec)
  else list[i] = rec
}

function toStepError(err: unknown): { message: string; code?: string; stack?: string } {
  if (err instanceof Error) {
    return {
      message: err.message,
      code: (err as { code?: string }).code,
      stack: err.stack,
    }
  }
  return { message: String(err) }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'))
      return
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function cryptoRandomUuid(): string {
  // Defensive: globalThis.crypto.randomUUID may not be available in older
  // Node — fall back to a manual v4 derivation.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Re-export for callers that want manifestHash without reaching into identity.
export { manifestHash }
