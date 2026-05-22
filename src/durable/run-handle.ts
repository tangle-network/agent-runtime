/**
 * `runReconnectableTurn` — cross-worker sandbox-reconnect durability.
 *
 * `runDurableTurn` survives a worker crash *after* a turn completes: the
 * cached final text replays. It cannot survive a crash *during* a 15-minute
 * agentic turn — the producer's generator died with the isolate, so a fresh
 * worker re-runs the whole turn.
 *
 * The fix exploits a property of sandbox-backed turns: the work runs inside
 * an orchestrator-managed sandbox container that OUTLIVES the worker isolate.
 * The `@tangle-network/sandbox` SDK's `streamPrompt` already auto-reconnects
 * to the runtime event-replay endpoint when the SSE stream drops within a
 * live worker. The gap is cross-worker: when the isolate itself dies, the
 * generator is gone and a fresh worker has no pointer to the in-flight run.
 *
 * `runReconnectableTurn` closes that gap by checkpointing a **run handle** —
 * `{ sandboxId, sessionId, runId }` — the instant the turn starts, before any
 * events stream. On a retry that finds a `running` handle, a fresh worker
 * calls the product-supplied `reconnect(handle)` callback (which wires the
 * SDK's replay endpoint) instead of `produce`. The sandbox runtime IS the
 * durable engine; this primitive only remembers the pointer.
 *
 * Substrate split:
 *   - sandbox products supply `produce` + `reconnect`. `produce` registers a
 *     handle via `register(handle)` once `streamPrompt` yields the run id;
 *     `reconnect` re-attaches to that run from a fresh process.
 *   - tcloud products supply `produce` only and omit `reconnect`. With no
 *     reconnect path a `running` handle on retry is treated as a stale lease
 *     and the turn re-runs — identical to `runDurableTurn` semantics.
 *
 * Storage: the handle is checkpointed as a *completed* step at index 0 (the
 * handle step). The actual turn runs at step index 1. This reuses the
 * existing `completeStep` JSON-result path with zero schema change — a
 * completed step is the only step shape `startOrResume` returns to a retry,
 * and it must be readable while the turn step is still `running`. Adding a
 * `durable_steps` column would force a migration across all three stores and
 * a new store method; the handle-step approach needs neither.
 */

import { canonicalHash } from './identity'
import type { DurableTurnProducer } from './turn'
import type { DurableRunManifest, DurableRunStore, RunRecord, StepRecord } from './types'

/**
 * A pointer to a substrate run that outlives the worker isolate. Persisted at
 * turn start so a fresh worker can re-attach instead of re-running.
 */
export interface RunHandle {
  /** Which substrate owns the run. `sandbox` runs are reconnectable; `tcloud`
   *  runs are not (no cross-process replay endpoint). */
  kind: 'sandbox' | 'tcloud'
  /** Orchestrator-managed sandbox id. Stable across worker isolates. Present
   *  for `kind: 'sandbox'`. */
  sandboxId?: string
  /** Sandbox conversation/session id — the `sessionId` passed to
   *  `streamPrompt`. Lets the reconnect target the right thread. */
  sessionId?: string
  /** The in-flight run id — the sandbox SDK's `executionId`, captured from
   *  the first `execution.started` SSE frame. The replay endpoint keys on it:
   *  `GET {runtimeUrl}/agents/run/{runId}/events?lastEventId=<cursor>`. */
  runId?: string
  /** Lifecycle of the substrate run as last observed by this primitive. */
  status: 'running' | 'completed' | 'failed'
  /** Last SSE event id yielded — the replay cursor. A reconnect resumes from
   *  here so already-delivered events are not re-emitted. Undefined until the
   *  first frame with an `id:` arrives. */
  cursor?: string
}

/** A producer for a reconnectable turn. Extends the plain turn producer with a
 *  `register` hook the producer calls once the substrate run id is known. */
export interface ReconnectableTurnProducer<TEvent> extends DurableTurnProducer<TEvent> {
  /** Set by `runReconnectableTurn` before `produce()` is called. The producer
   *  invokes it as soon as `streamPrompt` yields `execution.started` so the
   *  handle is checkpointed mid-turn; it may call it again with an updated
   *  `cursor` as events stream. Each call overwrites the prior handle. */
  register?: (handle: RunHandle) => void
}

/** What a product supplies to build the live producer for a reconnectable
 *  turn. `register` is injected by `runReconnectableTurn`. */
export type ReconnectableProduce<TEvent> = (ctx: {
  /** Checkpoint the run handle. Call once `streamPrompt` yields the run id;
   *  call again to advance `cursor`. */
  register: (handle: RunHandle) => void
}) => DurableTurnProducer<TEvent>

/** What a product supplies to re-attach to an in-flight substrate run from a
 *  fresh worker. Receives the handle checkpointed by the original turn. The
 *  returned producer's `stream` is the replay stream; `finalText()` is the
 *  reconnected turn's final text once the stream drains. */
export type ReconnectProduce<TEvent> = (handle: RunHandle) => DurableTurnProducer<TEvent>

export interface RunReconnectableTurnOptions<TEvent> {
  store: DurableRunStore
  /** Stable per-turn run id. The same id on a retry is what enables both
   *  replay (completed turn) and reconnect (in-flight turn). */
  runId: string
  manifest: DurableRunManifest
  /** Stable per-isolate worker id. */
  workerId: string
  /** Lease window in ms. Default 900_000 (15 min) — a reconnectable turn is
   *  exactly the long-running case, so the lease must outlast the turn. */
  leaseMs?: number
  /** Human-readable step label. Default `turn`. */
  intent?: string
  /** Builds the live producer for a fresh turn. Called once, on a fresh run. */
  produce: ReconnectableProduce<TEvent>
  /** Re-attaches to an in-flight substrate run. Called on a retry that finds
   *  a `running` handle. Omit for substrates with no cross-process replay
   *  (tcloud) — a `running` handle then falls through to a re-run. */
  reconnect?: ReconnectProduce<TEvent>
  /** Synthesizes the single replay event from cached final text — used when a
   *  retry finds a *completed* turn (worker died after the turn finished). */
  replayEvent: (finalText: string) => TEvent
  /** Optional live accumulator — see `RunDurableTurnOptions.accumulate`. */
  accumulate?: (event: TEvent, current: string) => string | undefined
}

/** How the turn resolved — which of the three paths ran. */
export type ReconnectableTurnMode = 'fresh' | 'reconnected' | 'replayed' | 'rerun'

export interface ReconnectableTurnHandle<TEvent> {
  /** Drop-in stream. Fresh/rerun forward producer events; reconnected forwards
   *  the replay stream; replayed emits one `replayEvent(cachedText)`. */
  stream: AsyncGenerator<TEvent, void, unknown>
  /** Final text. Valid after `stream` drains. */
  finalText(): string
  /** Which path ran. Valid after `stream` drains. */
  mode(): ReconnectableTurnMode
  /** The run handle as last checkpointed. `undefined` if the producer never
   *  registered one (e.g. a tcloud turn). Valid after `stream` drains. */
  handle(): RunHandle | undefined
  /** The durable `RunRecord` for this turn. Valid after `stream` drains. */
  record(): RunRecord | undefined
}

/** Step 0 holds the run handle; step 1 holds the turn's final text. */
const HANDLE_STEP = 0
const TURN_STEP = 1

/** A handle in `running` state with no reconnect callback cannot be resumed —
 *  the turn must re-run. A `completed`/`failed` handle is informational only. */
function isReconnectable(handle: RunHandle | undefined): handle is RunHandle {
  return handle?.status === 'running'
}

function readHandleStep(steps: ReadonlyArray<StepRecord>): RunHandle | undefined {
  const step = steps.find((s) => s.stepIndex === HANDLE_STEP)
  if (!step || step.status !== 'completed') return undefined
  const result = step.result as { handle?: RunHandle } | undefined
  return result?.handle
}

function readTurnStep(steps: ReadonlyArray<StepRecord>): { finalText: string } | undefined {
  const step = steps.find((s) => s.stepIndex === TURN_STEP)
  if (!step || step.status !== 'completed') return undefined
  const result = step.result as { finalText?: string } | undefined
  return { finalText: result?.finalText ?? '' }
}

export function runReconnectableTurn<TEvent>(
  options: RunReconnectableTurnOptions<TEvent>,
): ReconnectableTurnHandle<TEvent> {
  const { store, runId, manifest, workerId } = options
  const leaseMs = options.leaseMs ?? 900_000
  const intent = options.intent ?? 'turn'
  const inputHash = canonicalHash(manifest.input)

  let accumulated = ''
  let mode: ReconnectableTurnMode = 'fresh'
  let currentHandle: RunHandle | undefined
  let finalRecord: RunRecord | undefined
  // Serializes handle-step writes. `register` may fire repeatedly as the
  // substrate streams; each write chains onto the prior so they land in call
  // order and never interleave with the terminal completed-handle write.
  let handleWrites: Promise<unknown> = Promise.resolve()

  /** Drain a producer's stream: forward events, accumulate text, checkpoint
   *  the turn step on clean drain, fail it on throw. Shared by the fresh,
   *  rerun, and reconnected paths — all three differ only in which producer
   *  they hand in and whether the turn step was already begun. */
  async function* drainAndCheckpoint(
    producer: DurableTurnProducer<TEvent>,
  ): AsyncGenerator<TEvent, void, unknown> {
    try {
      for await (const event of producer.stream) {
        if (options.accumulate) {
          const next = options.accumulate(event, accumulated)
          if (typeof next === 'string') accumulated = next
        }
        yield event
      }
      const producerText = producer.finalText()
      if (producerText) accumulated = producerText
      // Drain in-flight `register` writes BEFORE any further store write:
      // both touch the run record, and concurrent writers corrupt stores
      // that commit via tmp-file+rename.
      await handleWrites
      await store.completeStep({
        runId,
        stepIndex: TURN_STEP,
        result: { finalText: accumulated },
      })
      // Flip the handle to `completed` LAST so a late retry sees `completed`
      // — never a stale `running` it would wrongly reconnect to.
      if (currentHandle && currentHandle.status === 'running') {
        currentHandle = { ...currentHandle, status: 'completed' }
        await store.completeStep({
          runId,
          stepIndex: HANDLE_STEP,
          result: { handle: currentHandle },
        })
      }
      finalRecord = await store.endRun({
        runId,
        workerId,
        status: 'completed',
        outcome: { notes: intent, metadata: { chars: accumulated.length, mode } },
      })
    } catch (err) {
      // Drain in-flight `register` writes before failing so no handle write
      // outlives the turn (it would race store teardown). The handle stays
      // `running` — exactly what a reconnecting retry needs.
      await handleWrites
      await store.failStep({
        runId,
        stepIndex: TURN_STEP,
        error: { message: err instanceof Error ? err.message : String(err) },
      })
      finalRecord = await store.endRun({ runId, workerId, status: 'failed' })
      throw err
    }
  }

  async function* stream(): AsyncGenerator<TEvent, void, unknown> {
    const { completedSteps } = await store.startOrResume({
      runId,
      manifest,
      workerId,
      leaseMs,
    })

    // ── Replay path — the turn already finished ─────────────────────────
    const turnStep = readTurnStep(completedSteps)
    if (turnStep) {
      mode = 'replayed'
      accumulated = turnStep.finalText
      currentHandle = readHandleStep(completedSteps)
      yield options.replayEvent(accumulated)
      finalRecord = await store.endRun({ runId, workerId, status: 'completed' })
      return
    }

    // ── Reconnect path — an in-flight handle survived a worker crash ────
    const priorHandle = readHandleStep(completedSteps)
    if (isReconnectable(priorHandle) && options.reconnect) {
      mode = 'reconnected'
      currentHandle = priorHandle
      // The turn step may be `running`/`failed` from the dead worker. begin
      // bumps its attempt count; the reconnected stream re-checkpoints it.
      await store.beginStep({
        runId,
        stepIndex: TURN_STEP,
        intent,
        kind: 'llm',
        inputHash,
      })
      yield* drainAndCheckpoint(options.reconnect(priorHandle))
      return
    }

    // ── Fresh / rerun path — produce live ───────────────────────────────
    // A `running` handle with no reconnect callback (tcloud, or a sandbox
    // product that did not wire reconnect) cannot resume — it re-runs.
    mode = priorHandle ? 'rerun' : 'fresh'

    // The handle step is checkpointed up front as a placeholder so a retry
    // that crashes before `register` still sees the run shape. `register`
    // overwrites it with the real pointer once the substrate yields the id.
    const placeholder: RunHandle = { kind: 'tcloud', status: 'running' }
    await store.beginStep({
      runId,
      stepIndex: HANDLE_STEP,
      intent: `${intent}:handle`,
      kind: 'logic',
      inputHash,
    })
    await store.completeStep({
      runId,
      stepIndex: HANDLE_STEP,
      result: { handle: placeholder },
    })
    currentHandle = placeholder

    const register = (handle: RunHandle): void => {
      currentHandle = handle
      // The handle step is already `completed`; each `register` overwrites its
      // result. Writes chain through `handleWrites` so they persist in call
      // order and `drainAndCheckpoint` can await them before the terminal
      // completed-handle write. A crash before a write lands loses only the
      // pointer refinement, not correctness — a non-reconnectable handle
      // re-runs. A rejected write must not abort the turn, so it is absorbed.
      handleWrites = handleWrites
        .then(() => store.completeStep({ runId, stepIndex: HANDLE_STEP, result: { handle } }))
        .catch(() => undefined)
    }

    await store.beginStep({
      runId,
      stepIndex: TURN_STEP,
      intent,
      kind: 'llm',
      inputHash,
    })
    yield* drainAndCheckpoint(options.produce({ register }))
  }

  return {
    stream: stream(),
    finalText: () => accumulated,
    mode: () => mode,
    handle: () => currentHandle,
    record: () => finalRecord,
  }
}
