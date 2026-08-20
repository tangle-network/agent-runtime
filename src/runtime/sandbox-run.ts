/**
 * `openSandboxRun` — the ONE harness-agnostic seam for running an agent in a
 * sandbox over a persistent artifact: run it, stream it, RESUME the same session
 * across turns. Domain-agnostic: a coding agent, a research agent, a tax/legal
 * agent — all flow through this; the domain lives only in the `Deliverable<Out>`
 * the caller supplies, never in a per-domain copy of this function.
 *
 * It is a thin facade (NOT a new layer) over code that already exists and is
 * already hardened:
 *   - `acquireSandbox` — cold-start / 502-503-504 / gateway-timeout recovery,
 *   - `buildBackendOptions` — the harness IS `backend.type` (opencode / codex /
 *     claude-code / kimi-code / hermes / pi); the only "which agent" knob,
 *   - `createSandboxLineage` — `start` mints a session; `resume` continues the
 *     SAME server-side session with a fail-loud `assertSessionLive`.
 *
 * The one genuinely-new piece is {@link Deliverable}: it widens the pure
 * `OutputAdapter.parse(events)` to ALSO admit a post-turn read off the box FS —
 * the structural gap that made the bench gates hand-roll `box.fs.read`, because a
 * large produced file (a git diff, a generated document) truncates in the chat
 * stream and a pure events-parser cannot reach the workspace. Per the SDK, a
 * RELATIVE `deliverable.path` resolves from the workspace root and an ABSOLUTE one
 * (e.g. `/tmp/solution.patch`) reads the container filesystem directly — both are
 * valid; pick the one the agent actually wrote to. Avoid `..` traversal segments.
 *
 * What this deliberately does NOT do (so it stays a facade, not slop): no custom
 * reconnect/replay (the SDK + platform own per-session buffering + `Last-Event-ID`);
 * no fork verb (fanout lives in `runAgentRounds`; `SandboxLineage.fork` keeps
 * live Sandbox branching and the legacy CRIU fallback behind one internal seam).
 * It is also distinct from `runAgentRounds`: `runAgentRounds` is the multi-round, driver-driven
 * kernel (fresh box per round, events deliverable); this is a SINGLE rollout +
 * artifact-or-events deliverable + resume over ONE persistent box.
 */

import type { PromptOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { type AgentRunOutcome, createAgentRunOutcomeTracker } from '@tangle-network/sandbox/runtime'
import type { RuntimeHooks, RuntimeHookTarget } from '../runtime-hooks'
import { notifyRuntimeHookEvent } from '../runtime-hooks'
import { boxReadErrorMessage, readBoxPathWithRetry } from './box-read-retry'
import { probeSandboxCapabilities } from './sandbox-capabilities'
import { notifySandboxEventObserver } from './sandbox-events'
import { createSandboxLineage, type SandboxLineageHandle } from './sandbox-lineage'
import type { AgentRunSpec, SandboxClient } from './types'
import { isAbortError, randomSuffix } from './util'

/**
 * How a typed deliverable `Out` is materialized from a finished turn.
 * - `events`   — pure parse over the event array (identical to `OutputAdapter`).
 * - `artifact` — read a file off the box AFTER the turn drains, then map it (+ the
 *                events). For diffs/codebases/documents that don't fit the chat
 *                stream. `path` relative ⇒ workspace root; absolute ⇒ container FS.
 *
 * @experimental
 */
export type Deliverable<Out> =
  | { kind: 'events'; fromEvents: (events: SandboxEvent[]) => Out }
  | { kind: 'artifact'; path: string; fromArtifact: (raw: string, events: SandboxEvent[]) => Out }

/**
 * One finished turn over the artifact. A failed FS read is surfaced in `readError`
 * (never masked as an empty deliverable) so a caller distinguishes "agent produced
 * nothing" from a transport/FS fault.
 *
 * @experimental
 */
export interface TurnResult<Out> {
  out: Out
  events: SandboxEvent[]
  /** Outcome settled by the public Sandbox tracker after the stream drained. */
  outcome: AgentRunOutcome
  readError?: string
}

/**
 * Thrown when a turn is aborted/timed-out mid-settle. Carries the events drained
 * BEFORE the abort fired (and any in-progress `readError`) so an aborted run is
 * DIAGNOSABLE — the caller can tell never-started (`events: []`) from looped
 * (many events, no terminal `result`) from produced-nothing-then-cancelled.
 *
 * `name === 'AbortError'`, so existing `err.name === 'AbortError'` callers (the
 * loop kernel, scope, supervise runtime) keep matching it unchanged.
 *
 * @experimental
 */
export class SandboxRunAbortError extends Error {
  override readonly name = 'AbortError'
  /** Events drained from the stream before the abort interrupted the turn. */
  readonly events: SandboxEvent[]
  /** The last artifact read error, if the abort fired during the retry loop. */
  readonly readError?: string
  constructor(events: SandboxEvent[], readError?: string) {
    super('aborted')
    this.events = events
    if (readError !== undefined) this.readError = readError
  }
}

/** @experimental A live run over ONE persistent artifact (box + session). Close it
 *  when done — `close()` tears the box down. */
export interface SandboxRun<Out> {
  readonly box: SandboxInstance
  readonly sessionId: string
  /** First turn over the fresh box (mints the session). Throws if already started. */
  start(prompt: string): Promise<TurnResult<Out>>
  /** Continue THE SAME session over THE SAME artifact — a resumed turn/rollout. */
  resume(prompt: string): Promise<TurnResult<Out>>
  close(): Promise<void>
}

/** Prompt options forwarded to every sandbox prompt turn in this run. The
 * runtime owns `sessionId` and `signal` so callers cannot accidentally break
 * resume or cancellation semantics while still setting backend-level prompt
 * controls such as `timeoutMs`.
 *
 * @experimental
 */
export type OpenSandboxRunPromptOptions = Omit<PromptOptions, 'signal' | 'sessionId'>

/** Context available after the box/session exists and before the first prompt is
 * drained. Intended for benchmark-owned workspace setup such as cloning a repo
 * into a fixed path. */
export interface OpenSandboxRunBeforeStartContext {
  readonly box: SandboxInstance
  readonly sessionId: string
  readonly signal: AbortSignal
}

/** @experimental */
export interface OpenSandboxRunOptions {
  /** Profile + sandbox env/overrides. `sandboxOverrides.backend.type` is the harness. */
  agentRun: AgentRunSpec<string>
  signal: AbortSignal
  /** Optional execution-scoped observers. Hook failures never fail the run. */
  hooks?: RuntimeHooks
  /** Stable run id for trace joins. Defaults to a short runtime-minted id. */
  runId?: string
  /** Optional benchmark/scenario id carried into emitted hook events. */
  scenarioId?: string
  /** Per-prompt sandbox SDK options forwarded to both `start()` and `resume()`.
   *  The runtime still owns the session id and abort signal for each turn. */
  promptOptions?: OpenSandboxRunPromptOptions
  /** Optional pre-start workspace setup. Runs after `lineage.start()` creates the
   * box/session and before the first prompt stream is consumed. A thrown error
   * fails the turn before the agent spends tokens. */
  beforeStart?: (ctx: OpenSandboxRunBeforeStartContext) => Promise<void> | void
  /** Receives a defensive copy of every streamed event. Observer work is
   * non-blocking; synchronous throws and rejected promises never fail the run. */
  onSandboxEvent?: (
    event: SandboxEvent,
    meta: {
      turnIndex: number
      turnKind: 'start' | 'resume'
      agentRunName: string
    },
  ) => void | PromiseLike<void>
  /** Test seam for deterministic hook timestamps. Defaults to `Date.now`. */
  now?: () => number
  /** Bounds box-creation bursts inside lineage fanout. Default from lineage. */
  maxConcurrency?: number
  /** Base backoff (ms) for retrying a transient artifact `fs.read` failure; the i-th
   *  retry waits `readRetryDelayMs * i`. Default 1000. Set 0 to disable the wait (tests). */
  readRetryDelayMs?: number
}

/**
 * Open a sandbox run. Harness-agnostic: the harness lives in
 * `options.agentRun.sandboxOverrides.backend.type`, so opencode/codex/claude-code/
 * kimi-code all flow through this one entrypoint with identical env/auth wiring.
 *
 * @experimental
 */
export async function openSandboxRun<Out>(
  client: SandboxClient,
  options: OpenSandboxRunOptions,
  deliverable: Deliverable<Out>,
): Promise<SandboxRun<Out>> {
  const runId = options.runId ?? `sandbox-run-${randomSuffix()}`
  const now = options.now ?? Date.now
  const agentRunName = options.agentRun.name ?? options.agentRun.profile.name ?? 'agent'
  const capabilities = await probeSandboxCapabilities(client)
  const lineage = createSandboxLineage(client, capabilities, {
    ...(options.maxConcurrency !== undefined ? { maxConcurrency: options.maxConcurrency } : {}),
  })
  let handle: SandboxLineageHandle | undefined
  let started = false
  let runStartedAt: number | undefined
  let failed = false
  let turnCount = 0

  function emit(event: {
    target: RuntimeHookTarget
    phase: 'before' | 'after' | 'error'
    timestamp: number
    stepIndex?: number
    payload?: Record<string, unknown>
  }): void {
    notifyRuntimeHookEvent(
      options.hooks,
      {
        id: `${runId}:${event.target}:${event.phase}${
          event.stepIndex === undefined ? '' : `:${event.stepIndex}`
        }`,
        runId,
        scenarioId: options.scenarioId,
        target: event.target,
        phase: event.phase,
        timestamp: event.timestamp,
        stepIndex: event.stepIndex,
        payload: event.payload,
        metadata: { producer: 'openSandboxRun' },
      },
      { signal: options.signal },
    )
  }

  const runPayload = (): Record<string, unknown> => ({
    agentName: agentRunName,
    profileName: options.agentRun.profile.name,
    backendType: backendType(options.agentRun),
    deliverableKind: deliverable.kind,
    ...(deliverable.kind === 'artifact' ? { deliverablePath: deliverable.path } : {}),
    ...(handle ? { sessionId: handle.sessionId, sandboxId: handle.box.id } : {}),
  })

  const turnPayload = (
    prompt: string,
    turnKind: 'start' | 'resume',
    startedAt: number,
    result?: TurnResult<Out>,
    error?: unknown,
  ): Record<string, unknown> => ({
    ...runPayload(),
    turnKind,
    promptChars: prompt.length,
    promptHash: hashText(prompt),
    ...(result !== undefined || error !== undefined
      ? { durationMs: Math.max(0, now() - startedAt) }
      : {}),
    ...(result
      ? {
          eventCount: result.events.length,
          eventTypes: eventTypeCounts(result.events),
          ...(result.readError !== undefined ? { readError: result.readError } : {}),
        }
      : {}),
    ...(error !== undefined ? { error: errorMessage(error) } : {}),
  })

  // `box` is passed in (not read from the closed-over `handle`) so the invariant
  // is type-level, not call-order discipline.
  async function settle(
    box: SandboxInstance,
    events: AsyncIterable<SandboxEvent>,
    turnIndex: number,
    turnKind: 'start' | 'resume',
  ): Promise<TurnResult<Out>> {
    const collected: SandboxEvent[] = []
    const outcomeTracker = createAgentRunOutcomeTracker()
    // The stream itself can throw an AbortError when the run is cancelled mid-drain;
    // re-throw it carrying the events drained so far so the partial trace is not lost.
    try {
      for await (const ev of events) {
        collected.push(ev)
        outcomeTracker.observe(ev)
        notifySandboxEventObserver(ev, options.onSandboxEvent, {
          turnIndex,
          turnKind,
          agentRunName,
        })
      }
    } catch (err) {
      if (isAbortError(err)) throw new SandboxRunAbortError(collected)
      throw err
    }
    const outcome = outcomeTracker.finish()
    if (deliverable.kind === 'events') {
      return { out: deliverable.fromEvents(collected), events: collected, outcome }
    }
    if (options.signal.aborted) throw new SandboxRunAbortError(collected)
    // The data plane can transiently 404 a just-written artifact (write not yet
    // flushed, or an edge-read blip) — retry a few times with backoff before
    // declaring the deliverable empty, so a transient read failure is not recorded
    // as "the agent produced nothing".
    const attempted = await readBoxPathWithRetry(box.fs.read.bind(box.fs), deliverable.path, {
      attempts: 4,
      delayMs: options.readRetryDelayMs ?? 1000,
      signal: options.signal,
      beforeAttempt: (lastError) => {
        if (options.signal.aborted)
          throw new SandboxRunAbortError(collected, boxReadErrorMessage(lastError))
      },
    })
    const raw = attempted.succeeded ? attempted.text : ''
    const readError = attempted.succeeded ? undefined : boxReadErrorMessage(attempted.error)
    return {
      out: deliverable.fromArtifact(raw, collected),
      events: collected,
      outcome,
      ...(readError !== undefined ? { readError } : {}),
    }
  }

  return {
    get box(): SandboxInstance {
      if (!handle) throw new Error('openSandboxRun: box unavailable before start()')
      return handle.box
    },
    get sessionId(): string {
      if (!handle) throw new Error('openSandboxRun: sessionId unavailable before start()')
      return handle.sessionId
    },
    async start(prompt) {
      if (started)
        throw new Error(
          'openSandboxRun: start() already called — use resume() to continue the session',
        )
      started = true
      runStartedAt = now()
      emit({
        target: 'agent.run',
        phase: 'before',
        timestamp: runStartedAt,
        payload: { ...runPayload(), turnCount: 0 },
      })
      const stepIndex = turnCount
      const turnStartedAt = now()
      emit({
        target: 'agent.turn',
        phase: 'before',
        timestamp: turnStartedAt,
        stepIndex,
        payload: turnPayload(prompt, 'start', turnStartedAt),
      })
      // lineage.start uses only spec.profile + sandboxOverrides (the prompt is passed
      // directly, not via taskToPrompt), so the task type is irrelevant here.
      try {
        const r = await lineage.start(
          options.agentRun as AgentRunSpec<unknown>,
          prompt,
          options.signal,
          options.promptOptions,
        )
        handle = r.handle
        await options.beforeStart?.({
          box: handle.box,
          sessionId: handle.sessionId,
          signal: options.signal,
        })
        const result = await settle(handle.box, r.events, stepIndex, 'start')
        turnCount += 1
        emit({
          target: 'agent.turn',
          phase: 'after',
          timestamp: now(),
          stepIndex,
          payload: turnPayload(prompt, 'start', turnStartedAt, result),
        })
        return result
      } catch (error) {
        failed = true
        emit({
          target: 'agent.turn',
          phase: 'error',
          timestamp: now(),
          stepIndex,
          payload: turnPayload(prompt, 'start', turnStartedAt, undefined, error),
        })
        emit({
          target: 'agent.run',
          phase: 'error',
          timestamp: now(),
          payload: { ...runPayload(), turnCount, error: errorMessage(error) },
        })
        throw error
      }
    },
    async resume(prompt) {
      if (!handle) throw new Error('openSandboxRun: resume() called before start()')
      const stepIndex = turnCount
      const turnStartedAt = now()
      emit({
        target: 'agent.turn',
        phase: 'before',
        timestamp: turnStartedAt,
        stepIndex,
        payload: turnPayload(prompt, 'resume', turnStartedAt),
      })
      try {
        const result = await settle(
          handle.box,
          await lineage.continue(handle, prompt, options.signal, options.promptOptions),
          stepIndex,
          'resume',
        )
        turnCount += 1
        emit({
          target: 'agent.turn',
          phase: 'after',
          timestamp: now(),
          stepIndex,
          payload: turnPayload(prompt, 'resume', turnStartedAt, result),
        })
        return result
      } catch (error) {
        failed = true
        emit({
          target: 'agent.turn',
          phase: 'error',
          timestamp: now(),
          stepIndex,
          payload: turnPayload(prompt, 'resume', turnStartedAt, undefined, error),
        })
        emit({
          target: 'agent.run',
          phase: 'error',
          timestamp: now(),
          payload: { ...runPayload(), turnCount, error: errorMessage(error) },
        })
        throw error
      }
    },
    async close() {
      await lineage.teardown()
      if (runStartedAt !== undefined) {
        emit({
          target: 'agent.run',
          phase: 'after',
          timestamp: now(),
          payload: {
            ...runPayload(),
            turnCount,
            status: failed ? 'error' : 'completed',
            durationMs: Math.max(0, now() - runStartedAt),
          },
        })
      }
    },
  }
}

function backendType<Task>(spec: AgentRunSpec<Task>): unknown {
  const backend = spec.sandboxOverrides?.backend as { type?: unknown } | undefined
  return backend?.type
}

function eventTypeCounts(events: SandboxEvent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
  return counts
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
