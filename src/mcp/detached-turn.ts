/**
 * @experimental
 *
 * Detached delegation turns over the sandbox SDK's `driveTurn` primitive.
 *
 * Two halves of one story:
 *
 *   - {@link runDetachedTurn} — the dispatch side. A single-session delegate
 *     (single-variant coder / researcher) acquires a box, binds the sandbox id
 *     into the record's `detachedSessionRef`, then advances the turn with
 *     repeated `driveTurn` ticks instead of holding a live SSE stream. The
 *     session id is deterministic and supplied at submit time, so a process
 *     crash between ticks loses nothing — the turn keeps running in the box.
 *
 *   - {@link createDriveTurnResumeDriver} — the resume side. A
 *     `DelegationResumeDriver` that re-attaches restored in-flight records to
 *     their detached runs: parse the record's ref, resolve the box, advance the
 *     turn one `driveTurn` pass per `tick()`, and map the SDK's three states
 *     (`completed | running | failed`) onto `DelegationResumeTick`.
 *
 * Both sides type the box structurally ({@link DriveTurnCapableBox}) so tests
 * inject fakes and the module never requires the sandbox SDK at runtime — the
 * SDK stays an optional peer, exactly like the executors' `SandboxClient` seam.
 *
 * Tradeoffs of detached mode (why it is opt-in, not the default): a detached
 * turn yields one terminal payload instead of a live event stream, so kernel
 * token/cost aggregation is not produced for that turn. The trace sinks still
 * observe detached work — `runDetachedTurn` synthesizes a single-iteration
 * loop event stream (see `RunDetachedTurnOptions.traceEmitter`) so the span
 * topology joins the inherited trace context, with cost/tokens reported as 0
 * under the `'detached-turn'` driver tag. Multi-variant fanout stays on the
 * streaming `runLoop` path — N concurrent sessions cannot be expressed as one
 * resume key, and winner selection needs every candidate.
 */

import type { SandboxEvent } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'
import type { AgentRunSpec, LoopTraceEmitter, LoopTraceEvent, SandboxClient } from '../runtime'
import { createSandboxForSpec } from '../runtime'
import { deleteBoxSafe, sleep, throwAbort, throwIfAborted } from '../runtime/util'
import type { DelegationRecord, DelegationResumeDriver, DelegationResumeTick } from './task-queue'
import type { DelegationProgress, DelegationResultPayload } from './types'

const DEFAULT_TICK_INTERVAL_MS = 5000

/**
 * Structural mirror of the sandbox SDK's `TurnDriveResult` (>= 0.6).
 * Discriminated on `state`; `failed` is terminal and deterministic per the
 * SDK contract — re-invoking with the same ids returns the same outcome.
 *
 * @experimental
 */
export type DriveTurnTick =
  | { state: 'completed'; text: string; result: Record<string, unknown> }
  | { state: 'running'; startedAt?: Date; elapsedMs?: number }
  | { state: 'failed'; error: string }

/**
 * The box surface detached turns need. `SandboxInstance`
 * (`@tangle-network/sandbox` >= 0.6) satisfies it structurally; tests pass
 * in-memory fakes. `_sessionCancel` is the SDK's remote-cancellation surface —
 * optional here because older SDKs / fakes may not expose it; when present it
 * is invoked on abort so the remote run actually stops.
 *
 * @experimental
 */
export interface DriveTurnCapableBox {
  driveTurn(
    message: string,
    opts: { sessionId: string; turnId?: string; wallCapMs?: number },
  ): Promise<DriveTurnTick>
  _sessionCancel?(id: string): Promise<void>
}

/**
 * Decoded `DelegationRecord.detachedSessionRef`. `sandboxId` is absent between
 * submit and box acquisition — a record restored in that window is not
 * resumable (there is no box to resume on) and the resume driver fails it
 * loud rather than dispatching onto a guessed box.
 *
 * @experimental
 */
export interface DetachedSessionRefParts {
  sessionId: string
  sandboxId?: string
}

/**
 * Encode ref parts into the JSON-safe string stored on the record:
 * `session=<id>` before the box exists, `sandbox=<id>;session=<id>` once
 * bound. Ids must not contain the `;`/`=` delimiters.
 *
 * @experimental
 */
export function formatDetachedSessionRef(parts: DetachedSessionRefParts): string {
  assertRefComponent('sessionId', parts.sessionId)
  if (parts.sandboxId === undefined) return `session=${parts.sessionId}`
  assertRefComponent('sandboxId', parts.sandboxId)
  return `sandbox=${parts.sandboxId};session=${parts.sessionId}`
}

/** @experimental Inverse of {@link formatDetachedSessionRef}; throws `ValidationError` on malformed input. */
export function parseDetachedSessionRef(raw: string): DetachedSessionRefParts {
  const fields = new Map<string, string>()
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=')
    const key = eq === -1 ? '' : pair.slice(0, eq)
    const value = eq === -1 ? '' : pair.slice(eq + 1)
    if ((key !== 'session' && key !== 'sandbox') || value.length === 0 || fields.has(key)) {
      throw new ValidationError(
        `parseDetachedSessionRef: malformed detachedSessionRef ${JSON.stringify(raw)} — expected "session=<id>" or "sandbox=<id>;session=<id>"`,
      )
    }
    fields.set(key, value)
  }
  const sessionId = fields.get('session')
  if (!sessionId) {
    throw new ValidationError(
      `parseDetachedSessionRef: detachedSessionRef ${JSON.stringify(raw)} carries no session id`,
    )
  }
  const sandboxId = fields.get('sandbox')
  return { sessionId, ...(sandboxId !== undefined ? { sandboxId } : {}) }
}

function assertRefComponent(name: string, value: string): void {
  if (value.length === 0 || value.includes(';') || value.includes('=')) {
    throw new ValidationError(
      `formatDetachedSessionRef: ${name} ${JSON.stringify(value)} must be non-empty and free of ";" / "="`,
    )
  }
}

/** @experimental The terminal payload of a finished detached turn. */
export interface DetachedTurn {
  /** Final assistant text. */
  text: string
  /** The SDK's cached AgentExecutionResult-shape record for the turn. */
  result: Record<string, unknown>
}

/**
 * Synthesize the terminal event array a detached turn settles through. Shaped
 * so the existing event-stream output adapters (coder, researcher) parse it:
 * `data.result` for adapters that read a structured terminal record, `data.text`
 * for adapters that scan assistant text for the fenced result block.
 *
 * @experimental
 */
export function detachedTurnEvents(sessionId: string, turn: DetachedTurn): SandboxEvent[] {
  return [
    {
      type: 'result',
      id: sessionId,
      data: {
        text: turn.text,
        finalText: turn.text,
        success: true,
        result: turn.result,
      },
    } as SandboxEvent,
  ]
}

/** @experimental */
export interface RunDetachedTurnOptions {
  /** Sandbox client used to acquire the box (the delegate's executor client). */
  client: SandboxClient
  /** Profile + overrides for box acquisition — same spec the streaming path uses. */
  spec: AgentRunSpec<unknown>
  /** The full turn prompt; consumed by `driveTurn`'s dispatch leg. */
  prompt: string
  /** Deterministic resume key, minted at submit time (`parseDetachedSessionRef(ref).sessionId`). */
  sessionId: string
  /**
   * Called once the box exists, with its sandbox id. Callers persist
   * `formatDetachedSessionRef({ sandboxId, sessionId })` onto the record here so
   * a restart can resolve the box again.
   */
  bindSandbox(sandboxId: string): void
  signal: AbortSignal
  report(progress: DelegationProgress): void
  /** Delay between `running` ticks (ms). Default 5000. */
  tickIntervalMs?: number
  /** Wall-clock cap forwarded to `driveTurn` — the SDK cancels and fails a session past it. */
  wallCapMs?: number
  /**
   * Loop-trace sink. When set, the detached turn synthesizes a
   * single-iteration loop span tree (`runId` = `sessionId`, driver
   * `'detached-turn'`) so trace-context inheritance survives the detached
   * path — the same events the streaming `runLoop` path would emit, minus
   * per-token telemetry: `driveTurn` yields one terminal payload, so token
   * and cost figures are structurally unavailable and reported as 0 under
   * this driver tag.
   */
  traceEmitter?: LoopTraceEmitter
  /** Physical placement stamped on the synthesized dispatch event. Default `'sibling'`. */
  placement?: 'sibling' | 'fleet'
}

/**
 * Dispatch one detached turn and advance it to a terminal state with
 * `driveTurn` ticks. The first tick dispatches (idempotent on `sessionId`);
 * subsequent ticks poll. On abort the remote session is cancelled via
 * `_sessionCancel` when the box exposes it. The box is torn down on every
 * in-process exit path (success, failure, abort) — only a process death skips
 * teardown, which is exactly the case the resume driver re-attaches to.
 *
 * @experimental
 */
export async function runDetachedTurn(options: RunDetachedTurnOptions): Promise<DetachedTurn> {
  const intervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS
  const trace = createDetachedTurnTrace(options)
  trace.started()
  const box = await createSandboxForSpec(options.client, options.spec, options.signal).catch(
    (err) => {
      trace.ended(err instanceof Error ? err.message : String(err))
      throw err
    },
  )
  const drive = box as Partial<DriveTurnCapableBox>
  const onAbort = () => {
    void drive._sessionCancel?.(options.sessionId).catch(() => {})
  }
  try {
    if (typeof drive.driveTurn !== 'function') {
      throw new ValidationError(
        'runDetachedTurn: the acquired sandbox exposes no driveTurn(message, { sessionId }) — ' +
          'detached dispatch requires @tangle-network/sandbox >= 0.6 and a session-backed ' +
          'placement (sibling/fleet); disable detached dispatch for this executor.',
      )
    }
    const sandboxId = (box as { id?: unknown }).id
    if (typeof sandboxId !== 'string' || sandboxId.length === 0) {
      throw new ValidationError(
        'runDetachedTurn: the acquired sandbox carries no id — without it the detached run ' +
          'cannot be resumed after a restart, so refusing to dispatch detached.',
      )
    }
    options.bindSandbox(sandboxId)
    trace.dispatched(sandboxId)
    options.signal.addEventListener('abort', onAbort, { once: true })
    for (;;) {
      throwIfAborted(options.signal)
      const tick = await drive.driveTurn(options.prompt, {
        sessionId: options.sessionId,
        turnId: options.sessionId,
        ...(options.wallCapMs !== undefined ? { wallCapMs: options.wallCapMs } : {}),
      })
      throwIfAborted(options.signal)
      if (tick.state === 'completed') {
        trace.ended()
        return { text: tick.text, result: tick.result }
      }
      if (tick.state === 'failed') {
        throw new Error(`detached turn ${options.sessionId} failed: ${tick.error}`)
      }
      options.report({ iteration: 0, phase: detachedRunningPhase(tick.elapsedMs) })
      await sleep(intervalMs, options.signal)
    }
  } catch (err) {
    trace.ended(err instanceof Error ? err.message : String(err))
    throw err
  } finally {
    options.signal.removeEventListener('abort', onAbort)
    if (options.signal.aborted) onAbort()
    await deleteBoxSafe(box)
  }
}

/**
 * Synthesize the single-iteration loop event stream for one detached turn so
 * the trace sinks (OTEL exporter, delegation journal) observe detached work
 * exactly like a streamed `runLoop` run. `runId` = the deterministic session
 * id; cost/token figures are structurally unavailable on the `driveTurn`
 * surface and emitted as 0 under the `'detached-turn'` driver tag.
 */
function createDetachedTurnTrace(options: RunDetachedTurnOptions): {
  started(): void
  dispatched(sandboxId: string): void
  ended(error?: string): void
} {
  const emitter = options.traceEmitter
  if (!emitter) {
    return { started() {}, dispatched() {}, ended() {} }
  }
  const runId = options.sessionId
  const agentRunName = options.spec.name ?? options.spec.profile.name ?? 'detached-turn'
  const startMs = Date.now()
  let done = false
  const emit = (event: LoopTraceEvent): void => {
    void emitter.emit(event)
  }
  return {
    started(): void {
      emit({
        kind: 'loop.started',
        runId,
        timestamp: startMs,
        payload: {
          driver: 'detached-turn',
          agentRunNames: [agentRunName],
          maxIterations: 1,
          maxConcurrency: 1,
        },
      })
      emit({
        kind: 'loop.iteration.started',
        runId,
        timestamp: startMs,
        payload: { iterationIndex: 0, agentRunName, taskHash: options.sessionId },
      })
    },
    dispatched(sandboxId: string): void {
      emit({
        kind: 'loop.iteration.dispatch',
        runId,
        timestamp: Date.now(),
        payload: {
          iterationIndex: 0,
          agentRunName,
          placement: options.placement ?? 'sibling',
          sandboxId,
        },
      })
    },
    ended(error?: string): void {
      if (done) return
      done = true
      const endMs = Date.now()
      emit({
        kind: 'loop.iteration.ended',
        runId,
        timestamp: endMs,
        payload: {
          iterationIndex: 0,
          agentRunName,
          costUsd: 0,
          durationMs: endMs - startMs,
          ...(error !== undefined ? { error } : {}),
        },
      })
      emit({
        kind: 'loop.ended',
        runId,
        timestamp: endMs,
        payload: {
          ...(error === undefined ? { winnerIterationIndex: 0 } : {}),
          totalCostUsd: 0,
          durationMs: endMs - startMs,
          iterations: 1,
        },
      })
    },
  }
}

function detachedRunningPhase(elapsedMs: number | undefined): string {
  return elapsedMs === undefined
    ? 'detached-running'
    : `detached-running ${Math.round(elapsedMs / 1000)}s`
}

/** @experimental */
export interface DriveTurnResumeDriverOptions {
  /**
   * Resolve the live box owning a detached session. The bin wires this to the
   * sandbox client's `get(sandboxId)`; throw when the box no longer exists —
   * a thrown tick settles the record as failed, which is the truth.
   */
  resolveSandbox(sandboxId: string): Promise<DriveTurnCapableBox>
  /**
   * Rebuild the turn prompt from the persisted record. Only consumed by
   * `driveTurn`'s dispatch leg — i.e. when the previous process died after
   * binding the box but before the session was dispatched. Must reproduce the
   * prompt the delegate would have sent.
   */
  buildMessage(record: DelegationRecord): string
  /**
   * Map a completed turn onto the delegation's typed output payload (parse +
   * validate per profile). Throw when the resumed result does not pass the
   * profile's gate — the queue settles the record as failed with that error.
   */
  settleOutput(
    turn: DetachedTurn,
    record: DelegationRecord,
    ctx: { signal: AbortSignal },
  ): Promise<DelegationResultPayload['output']> | DelegationResultPayload['output']
  /** Delay between `running` ticks (ms). Default 5000. */
  intervalMs?: number
  /** Wall-clock cap forwarded to `driveTurn` on every tick. */
  wallCapMs?: number
}

/**
 * Build the `driveTurn`-backed {@link DelegationResumeDriver}. Each `tick()`
 * is one settle/poll/dispatch pass:
 *
 *   - ref without a sandbox binding → `failed` (`DetachedSessionUnboundError`):
 *     the previous process died before a box existed; there is nothing to resume.
 *   - `driveTurn` `completed` → `settleOutput` → `completed` tick.
 *   - `running` → progress via `ctx.report`, `running` tick (queue re-ticks
 *     after `intervalMs`).
 *   - `failed` → `failed` tick (`DetachedTurnFailedError`) — terminal per the
 *     SDK's deterministic-failure contract.
 *
 * Abort: the queue stops ticking once `cancel()` flips the record, so remote
 * cancellation is hooked onto `ctx.signal` (once per task) and fires
 * `_sessionCancel` when the SDK surface exposes it. The driver never deletes
 * boxes — it cannot know whether `sandboxId` is a disposable sibling or a
 * fleet machine, and destroying a fleet machine would be unrecoverable.
 *
 * @experimental
 */
export function createDriveTurnResumeDriver(
  options: DriveTurnResumeDriverOptions,
): DelegationResumeDriver {
  const cancelHooked = new Set<string>()
  return {
    intervalMs: options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS,
    async tick({ record, detachedSessionRef }, ctx): Promise<DelegationResumeTick> {
      const ref = parseDetachedSessionRef(detachedSessionRef)
      if (ref.sandboxId === undefined) {
        return {
          state: 'failed',
          error: {
            message:
              `detached session "${ref.sessionId}" was never bound to a sandbox — the previous ` +
              'process died before the box was acquired, so the turn was never dispatched and ' +
              'cannot be resumed',
            kind: 'DetachedSessionUnboundError',
          },
        }
      }
      const box = await options.resolveSandbox(ref.sandboxId)
      if (!cancelHooked.has(record.taskId)) {
        cancelHooked.add(record.taskId)
        ctx.signal.addEventListener(
          'abort',
          () => {
            void box._sessionCancel?.(ref.sessionId).catch(() => {})
          },
          { once: true },
        )
      }
      if (ctx.signal.aborted) throwAbort()
      const tick = await box.driveTurn(options.buildMessage(record), {
        sessionId: ref.sessionId,
        turnId: ref.sessionId,
        ...(options.wallCapMs !== undefined ? { wallCapMs: options.wallCapMs } : {}),
      })
      if (tick.state === 'completed') {
        const output = await options.settleOutput(
          { text: tick.text, result: tick.result },
          record,
          {
            signal: ctx.signal,
          },
        )
        return { state: 'completed', output }
      }
      if (tick.state === 'failed') {
        return {
          state: 'failed',
          error: {
            message: `detached turn ${ref.sessionId} failed: ${tick.error}`,
            kind: 'DetachedTurnFailedError',
          },
        }
      }
      ctx.report({ iteration: 0, phase: detachedRunningPhase(tick.elapsedMs) })
      return { state: 'running' }
    },
  }
}
