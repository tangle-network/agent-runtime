/**
 * `runDurableTurn` — a streaming, backend-agnostic, checkpoint+replay durable
 * turn. The single reusable primitive every product's chat handler routes
 * through, so per-product durability code drops to zero.
 *
 * A **turn** is one request→response unit: a producer yields a stream of
 * events and, once drained, exposes the turn's final text. `runDurableTurn`
 * wraps that with a `DurableRunStore`:
 *
 *   - **Fresh run** — no completed step for this `(runId)`. The producer
 *     runs; its events forward live to the caller (streaming preserved)
 *     while final text accumulates; on drain the text is checkpointed.
 *
 *   - **Replay** — a completed step already exists (the worker died after
 *     the turn finished but before the response reached the client, and the
 *     client retried the same turn). The cached text is emitted as a single
 *     synthetic event; the producer is never constructed — no LLM call, no
 *     double-billing.
 *
 *   - **Mid-stream crash** — a turn that died *while streaming* leaves step 0
 *     in `running`/`failed`. There is no partial-stream checkpoint (the
 *     substrate checkpoints JSON values at step granularity), so the turn
 *     re-runs from the top. This is the honest durability ceiling: a
 *     *completed* turn is free to replay; an *interrupted* turn re-runs.
 *
 * Generic over the event type `TEvent` so a product can stream its own NDJSON
 * shape or the runtime's `RuntimeStreamEvent` — `runDurableTurn` never
 * inspects events, it only forwards them and reads `finalText()` after drain.
 *
 * Lease: a turn is a single step, fast enough that the heartbeat in
 * `runDurable` is unnecessary — `runDurableTurn` claims the lease once via
 * `startOrResume` and releases it on `endRun`. Concurrent workers on the same
 * `runId` are rejected with `DurableRunLeaseHeldError` (the client retried
 * before the first attempt finished); callers surface that as "turn already
 * in flight."
 */

import { canonicalHash } from './identity'
import type { DurableRunManifest, DurableRunStore, RunRecord } from './types'

/** The live side of a turn — what a fresh run produces. */
export interface DurableTurnProducer<TEvent> {
  /** The turn's event stream. Forwarded verbatim to the caller. */
  stream: AsyncGenerator<TEvent, void, unknown>
  /** The turn's final assistant text. Read once, after `stream` drains. */
  finalText(): string
}

export interface RunDurableTurnOptions<TEvent> {
  store: DurableRunStore
  /** Stable per-turn run id. Convention: `chat:<threadId>:<turnIndex>`. The
   *  same id on a retry is what enables replay. */
  runId: string
  manifest: DurableRunManifest
  /** Stable per-isolate worker id. Defaults to a fresh `deriveWorkerId()`
   *  per call when omitted — fine for single-attempt turns. */
  workerId: string
  /** Lease window in ms. Default 60_000 — a turn rarely runs longer. */
  leaseMs?: number
  /** Human-readable step label. Default `turn`. */
  intent?: string
  /** Builds the live producer. Called exactly once, on a fresh run; never
   *  called on the replay path. */
  produce: () => DurableTurnProducer<TEvent>
  /** Synthesizes the single event emitted on the replay path from the
   *  cached final text (e.g. a product's `{ type: 'result', data: {...} }`). */
  replayEvent: (finalText: string) => TEvent
  /** Optional live accumulator. When the producer's `finalText()` is only
   *  valid after drain, this lets `runDurableTurn` also observe each event
   *  to build the text — return the running text or `undefined` to ignore
   *  an event. When omitted, `producer.finalText()` is the sole source. */
  accumulate?: (event: TEvent, current: string) => string | undefined
}

export interface DurableTurnHandle<TEvent> {
  /** Drop-in stream. Fresh runs forward producer events live; replays emit
   *  exactly one `replayEvent(cachedText)`. */
  stream: AsyncGenerator<TEvent, void, unknown>
  /** The turn's final text. Valid after `stream` drains. */
  finalText(): string
  /** True iff this turn replayed a cached result (no producer ran). Valid
   *  after `stream` drains. */
  replayed(): boolean
  /** The durable `RunRecord` for this turn. Valid after `stream` drains. */
  record(): RunRecord | undefined
}

const STEP_INDEX = 0

export function runDurableTurn<TEvent>(
  options: RunDurableTurnOptions<TEvent>,
): DurableTurnHandle<TEvent> {
  const { store, runId, manifest, workerId } = options
  const leaseMs = options.leaseMs ?? 60_000
  const intent = options.intent ?? 'turn'
  const inputHash = canonicalHash(manifest.input)

  let accumulated = ''
  let didReplay = false
  let finalRecord: RunRecord | undefined

  async function* stream(): AsyncGenerator<TEvent, void, unknown> {
    const { completedSteps } = await store.startOrResume({
      runId,
      manifest,
      workerId,
      leaseMs,
    })
    const prior = completedSteps.find((s) => s.stepIndex === STEP_INDEX)

    if (prior && prior.status === 'completed') {
      // ── Replay path — producer never constructed ──────────────────
      didReplay = true
      const cached = prior.result as { finalText?: string } | undefined
      accumulated = cached?.finalText ?? ''
      yield options.replayEvent(accumulated)
      finalRecord = await store.endRun({ runId, workerId, status: 'completed' })
      return
    }

    // ── Fresh run — produce live, forward, checkpoint ────────────────
    await store.beginStep({
      runId,
      stepIndex: STEP_INDEX,
      intent,
      kind: 'llm',
      inputHash,
    })
    try {
      const producer = options.produce()
      for await (const event of producer.stream) {
        if (options.accumulate) {
          const next = options.accumulate(event, accumulated)
          if (typeof next === 'string') accumulated = next
        }
        yield event
      }
      // Producer's own finalText wins when it is populated; otherwise the
      // live accumulator's value stands.
      const producerText = producer.finalText()
      if (producerText) accumulated = producerText
      await store.completeStep({
        runId,
        stepIndex: STEP_INDEX,
        result: { finalText: accumulated },
      })
      finalRecord = await store.endRun({
        runId,
        workerId,
        status: 'completed',
        outcome: { notes: intent, metadata: { chars: accumulated.length } },
      })
    } catch (err) {
      await store.failStep({
        runId,
        stepIndex: STEP_INDEX,
        error: { message: err instanceof Error ? err.message : String(err) },
      })
      finalRecord = await store.endRun({ runId, workerId, status: 'failed' })
      throw err
    }
  }

  return {
    stream: stream(),
    finalText: () => accumulated,
    replayed: () => didReplay,
    record: () => finalRecord,
  }
}
