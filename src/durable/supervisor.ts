/**
 * `runSupervisedTurn` — relocates the durability boundary off the ephemeral
 * worker isolate.
 *
 * `runDurableTurn` replays a *completed* turn; an interrupted turn re-runs.
 * `runSupervisedTurn` closes that gap for sandbox-backed runs: the sandbox
 * container is orchestrator-managed and outlives the worker, so instead of
 * re-prompting, a fresh supervisor re-attaches to the in-flight substrate run
 * and resumes draining its event stream.
 *
 * Durability is owned by the substrate, not hoped-for from the sandbox. The
 * supervisor drains every event into the store's stream log as it flows
 * (`appendStreamEvent`), persists the reconnect pointer the instant the
 * substrate yields it (`setRunHandle`), and heartbeats the lease. A fresh
 * supervisor reads the log for its cursor and calls `adapter.attach` to
 * resume strictly after it — the append's idempotency on `eventId` dedups
 * the reconnect seam, so no event is lost and none is delivered twice.
 *
 * The platform-agnostic core is here; `SessionSupervisorDO` hosts it on a
 * Cloudflare Durable Object. The reconnect glue is one typed contract —
 * `SandboxReconnectAdapter` — implemented once per substrate, never per
 * product.
 */

import { canonicalHash } from './identity'
import type { DurableRunManifest, DurableRunStore, RunHandle, RunRecord } from './types'

/** One event drained from a supervised run. */
export interface SupervisedEvent<TEvent> {
  /** Stable substrate id — the dedup key and the reconnect cursor. */
  eventId: string
  payload: TEvent
  /**
   * The substrate run handle, carried on the first frame(s) once the run id
   * is known. The supervisor persists it so a fresh supervisor can re-attach.
   * Omit on later frames; the last non-undefined handle wins.
   */
  handle?: RunHandle
}

/**
 * Product-supplied glue to a reconnectable substrate run. The dangerous
 * reconnect logic — re-attaching to a live distributed run — lives behind
 * this one typed contract: implement it once per substrate (the sandbox SDK,
 * etc.), never per product.
 *
 * Conformance (asserted by `supervisor.test.ts`):
 *  - `start()` yields the run's events; at least one early event carries a
 *    `handle` with `status: 'running'` and a defined `runId`.
 *  - `attach(handle, afterEventId)` yields only events strictly after
 *    `afterEventId`, and terminates cleanly when the run has no more.
 *  - `eventId`s are unique within a run.
 */
export interface SandboxReconnectAdapter<TEvent> {
  /** Begin a fresh substrate run. */
  start(): AsyncIterable<SupervisedEvent<TEvent>>
  /**
   * Re-attach to an in-flight run, resuming strictly after `afterEventId`
   * (`undefined` → from the first event).
   */
  attach(
    handle: RunHandle,
    afterEventId: string | undefined,
  ): AsyncIterable<SupervisedEvent<TEvent>>
}

/** How the supervised turn resolved. */
export type SupervisedRunMode = 'fresh' | 'resumed' | 'replayed'

export interface RunSupervisorOptions<TEvent> {
  store: DurableRunStore
  /** Stable per-turn run id — the same id on a retry is what enables both
   *  replay (completed turn) and resume (in-flight turn). */
  runId: string
  manifest: DurableRunManifest
  /** Stable per-isolate worker id. */
  workerId: string
  adapter: SandboxReconnectAdapter<TEvent>
  /** Lease window in ms. Default 60_000 — deliberately short: the heartbeat
   *  keeps an actively-draining supervisor's lease alive, so an abandoned
   *  supervisor's lease lapses fast and a fresh supervisor can take over. */
  leaseMs?: number
  /** Renew the lease at most this often while draining. Default 30_000 —
   *  must be below `leaseMs` or an active drain loses its own lease. */
  heartbeatMs?: number
  /** Human-readable step label. Default `turn`. */
  intent?: string
  /** Time source override — tests pin this for deterministic heartbeats. */
  now?: () => number
}

export interface SupervisedRunHandle<TEvent> {
  /** Drop-in stream. Fresh forwards live events; resumed re-yields the logged
   *  prefix then forwards live events; replayed re-yields the full log. */
  stream: AsyncGenerator<TEvent, void, unknown>
  /** Which path ran. Valid after `stream` drains. */
  mode(): SupervisedRunMode
  /** The durable RunRecord for the turn. Valid after `stream` drains. */
  record(): RunRecord | undefined
}

const TURN_STEP = 0

export function runSupervisedTurn<TEvent>(
  options: RunSupervisorOptions<TEvent>,
): SupervisedRunHandle<TEvent> {
  const { store, runId, manifest, workerId, adapter } = options
  const leaseMs = options.leaseMs ?? 60_000
  const heartbeatMs = options.heartbeatMs ?? 30_000
  const intent = options.intent ?? 'turn'
  const now = options.now ?? (() => Date.now())
  const inputHash = canonicalHash(manifest.input)

  let mode: SupervisedRunMode = 'fresh'
  let finalRecord: RunRecord | undefined
  let currentHandle: RunHandle | undefined
  // Set when the heartbeat finds the lease taken by another supervisor. The
  // catch block then skips failStep/endRun — this worker no longer owns the
  // run, and must not write its terminal state.
  let leaseLost = false

  async function* drain(
    source: AsyncIterable<SupervisedEvent<TEvent>>,
  ): AsyncGenerator<TEvent, void, unknown> {
    let lastRenew = now()
    for await (const event of source) {
      // Persist the reconnect pointer the instant the substrate yields it,
      // before the event itself — a crash between the two must leave a
      // resumable handle, never an event a fresh supervisor cannot place.
      if (event.handle) {
        currentHandle = event.handle
        await store.setRunHandle({ runId, handle: event.handle })
      }
      // Drain into the durable log. Idempotent on eventId: a boundary event
      // re-yielded across the reconnect seam returns accepted=false and is
      // not re-forwarded — no duplicate reaches the caller.
      const { accepted } = await store.appendStreamEvent({
        runId,
        eventId: event.eventId,
        payload: event.payload,
      })
      if (now() - lastRenew >= heartbeatMs) {
        const renewed = await store.renewLease({ runId, workerId, leaseMs })
        if (!renewed.ok) {
          leaseLost = true
          throw new Error(`durable-runs: lease lost on ${runId} — another supervisor took over`)
        }
        lastRenew = now()
      }
      if (accepted) yield event.payload
    }
  }

  async function* stream(): AsyncGenerator<TEvent, void, unknown> {
    const { run, completedSteps } = await store.startOrResume({
      runId,
      manifest,
      workerId,
      leaseMs,
    })

    // ── Replayed — the turn already completed ───────────────────────────
    if (completedSteps.some((s) => s.stepIndex === TURN_STEP && s.status === 'completed')) {
      mode = 'replayed'
      for (const e of await store.readStreamEvents(runId)) yield e.payload as TEvent
      finalRecord = await store.endRun({ runId, workerId, status: 'completed' })
      return
    }

    // ── Decide fresh vs resume ──────────────────────────────────────────
    const logged = await store.readStreamEvents(runId)
    const priorHandle = run.handle
    const resumable =
      priorHandle !== undefined &&
      priorHandle.status === 'running' &&
      typeof priorHandle.runId === 'string'

    let source: AsyncIterable<SupervisedEvent<TEvent>>
    if (resumable && priorHandle) {
      mode = 'resumed'
      currentHandle = priorHandle
      // Re-yield the logged prefix so the caller sees the whole stream, then
      // attach strictly after the last logged event.
      for (const e of logged) yield e.payload as TEvent
      const cursor = logged.length > 0 ? logged[logged.length - 1]!.eventId : priorHandle.cursor
      source = adapter.attach(priorHandle, cursor)
    } else {
      mode = 'fresh'
      source = adapter.start()
    }

    await store.beginStep({ runId, stepIndex: TURN_STEP, intent, kind: 'llm', inputHash })
    try {
      yield* drain(source)
      const eventCount = (await store.readStreamEvents(runId)).length
      // completeStep first — it is the "turn finished" signal the replay path
      // keys on. A crash after it leaves a cleanly replayable run; flipping
      // the handle first and crashing before completeStep would instead make
      // a finished run look fresh (handle not `running`, step not completed).
      await store.completeStep({ runId, stepIndex: TURN_STEP, result: { eventCount } })
      if (currentHandle && currentHandle.status === 'running') {
        await store.setRunHandle({ runId, handle: { ...currentHandle, status: 'completed' } })
      }
      finalRecord = await store.endRun({
        runId,
        workerId,
        status: 'completed',
        outcome: { notes: intent, metadata: { events: eventCount, mode } },
      })
    } catch (err) {
      if (!leaseLost) {
        // The handle stays `running` — exactly what a resuming retry needs.
        await store.failStep({
          runId,
          stepIndex: TURN_STEP,
          error: { message: err instanceof Error ? err.message : String(err) },
        })
        finalRecord = await store.endRun({ runId, workerId, status: 'failed' })
      }
      throw err
    }
  }

  return {
    stream: stream(),
    mode: () => mode,
    record: () => finalRecord,
  }
}
