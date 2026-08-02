/**
 * Trace context handed DOWN to a spawned worker, so one supervised tree spans machines.
 *
 * WHY. `otel-spans.ts` makes the supervisor's own tree readable by any trace viewer, but it stops at
 * the process boundary: a worker running on a remote sandbox or in a child process opens its OWN
 * trace root, so the viewer shows two unrelated trees for one run. A worker that inherits the
 * parent's trace id and the spawning node's span id emits spans that JOIN the parent's trace, and
 * the viewer assembles the whole cross-machine tree with no viewer change.
 *
 * THE WIRE IS W3C `TRACEPARENT`, dual-written with the legacy pair. `traceContextToEnv`
 * (`src/mcp/trace-propagation.ts`) writes `TRACEPARENT` (the convention the ecosystem — OTel SDKs,
 * collectors, the Claude Code harness binary — reads at spawn) ALONGSIDE the bespoke
 * `TRACE_ID` / `PARENT_SPAN_ID` pair this package shipped first, and `readTraceContextFromEnv()`
 * reads `TRACEPARENT` first with the legacy pair as fallback. The bespoke pair is the fork, not
 * the standard; it is kept for one release so children on the previous package version still join,
 * then removed in the next major.
 *
 * WHICH SPAN. The stamped `PARENT_SPAN_ID` is the span of the node that DID the spawning — the
 * scope's own `parentId` — not the span of the worker's own node. At depth 0 that is the run's root
 * span; inside a driver's nested scope it is that driver child's span, so a depth-2 worker joins
 * under the middle node rather than the root. That is also the only span guaranteed to exist at the
 * moment the child's `ExecutorContext` is built (the worker's own node span is opened by the
 * `agent.spawn` hook that fires just after), so the wire needs no ordering assumption.
 *
 * OFF WHEN TRACING IS OFF. The context reaches an executor only through the `ExecutorContext` seam
 * this module names, and that seam is seeded only when a run configured `SuperviseOptions.otel` AND
 * an exporter resolved. With tracing off there is no seam, {@link workerTraceEnv} returns an empty
 * record, and every spawn environment is byte-identical to what it was before this module existed.
 *
 * TWO SEEDING SITES, because there are two ways a worker's `ExecutorContext` gets built. `Scope`
 * seeds it per child for anything the executor registry resolves — that is the path that knows the
 * spawning node and reaches arbitrary depth. `workerFromBackend` (what `supervise({ backend })`
 * uses) instead builds its leaf executor eagerly and hands it back as a bring-your-own `Executor`,
 * which the registry resolves WITHOUT consulting the scope's context at all; `supervise()` therefore
 * passes the seam to `workerFromBackend` itself, resolved against the run root, which is the node
 * that spawns every front-door worker. Miss that second site and the front door looks wired and
 * stamps nothing.
 *
 * PRECEDENCE, from lowest to highest:
 *   1. the supervisor process's own `process.env` (ambient inheritance),
 *   2. the trace context stamped here,
 *   3. the caller's own seam env (`CliSeam.env`).
 * A caller who sets `TRACE_ID` / `PARENT_SPAN_ID` on a seam wins — theirs is a deliberate
 * declaration about the worker. Ambient `process.env` does NOT win: when the supervisor process was
 * itself launched as someone's worker, its inherited ids describe the SUPERVISOR's place in an
 * outer trace, and reusing them for a child would file the child's spans under the wrong parent.
 * The supported way to join that outer trace is `SupervisorSpanOptions.traceId` / `parentSpanId`
 * (feed them from `readTraceContextFromEnv()`), which makes the recorder's own ids the outer ones
 * and so makes every stamped child inherit them too.
 *
 * WHICH BACKENDS PROPAGATE. Only a backend with a real environment channel to the worker can carry
 * this, and the ones that cannot say so here rather than dropping it silently:
 *   - `cli`           YES — `CliSeam.env` → the spawned subprocess.
 *   - `sandbox`       YES — `CreateSandboxOptions.env` on the box the worker runs in (single-shot
 *                     and steerable). This is the cross-MACHINE case the feature exists for.
 *   - `router`,
 *     `router-tools`  NO — a direct model HTTP call. There is no worker process to inherit anything.
 *   - `bridge`,
 *     `cli-worktree`  NO — the work is dispatched over cli-bridge HTTP or through a local harness
 *                     transport that exposes no environment channel. Wiring these means adding that
 *                     channel to the transport first; until then they are honestly unpropagated.
 *   - `provider`      NO — `AgentEnvironmentProvider` has no environment field on its port.
 */

import { type TraceContext, traceContextToEnv } from '../../mcp/trace-propagation'
import type { ExecutorConfig } from './runtime'

/**
 * The census above, as a value the compiler checks. `satisfies` against every `ExecutorConfig`
 * discriminant means an EIGHTH backend arm cannot be added without classifying it here — the prose
 * alone could go stale silently, which is the failure this table exists to prevent.
 *
 * `true` = the arm has a real environment channel to the worker and stamps the context.
 * `false` = it has none today; it is honestly unpropagated rather than silently dropping.
 */
export const WORKER_TRACE_PROPAGATION = {
  cli: true,
  sandbox: true,
  router: false,
  'router-tools': false,
  bridge: false,
  'cli-worktree': false,
  provider: false,
} as const satisfies Record<ExecutorConfig['backend'], boolean>

export type { TraceContext }

/**
 * Seam key the `Scope` seeds a {@link TraceContext} under on each child's `ExecutorContext.seams`.
 * Single-sourced here so the scope and every backend agree on it without a circular import — the
 * same arrangement `nestedScopeSeamKey` uses.
 */
export const workerTraceSeamKey = 'worker-trace'

/**
 * Resolve the trace context a worker spawned BY `spawningNodeId` should inherit. `undefined` means
 * this run records no spans, so nothing is stamped. Supplied by
 * `SupervisorSpanRecorder.workerTrace` and threaded to the scope as `SupervisorOpts.workerTrace`.
 */
export type WorkerTraceResolver = (spawningNodeId: string) => TraceContext | undefined

/**
 * What the two readers below need off an `ExecutorContext` — its seam bag, and nothing else.
 * Structural (not an `ExecutorContext` import) so this module stays free of the keystone type
 * surface, and exported because it is part of a public signature.
 */
export interface WorkerTraceSeamCarrier {
  readonly seams: Readonly<Record<string, unknown>>
}

/**
 * Read the inherited trace context off an `ExecutorContext`, or `undefined` when the run records no
 * spans. Fails CLOSED on a malformed seam value (returns `undefined`) rather than stamping a
 * half-formed id that would produce an unjoinable orphan span downstream.
 */
export function readWorkerTraceContext(ctx: WorkerTraceSeamCarrier): TraceContext | undefined {
  const seam = ctx.seams[workerTraceSeamKey]
  if (seam === undefined || seam === null || typeof seam !== 'object') return undefined
  const { traceId, parentSpanId } = seam as { traceId?: unknown; parentSpanId?: unknown }
  if (typeof traceId !== 'string' || traceId.length === 0) return undefined
  return {
    traceId,
    ...(typeof parentSpanId === 'string' && parentSpanId.length > 0 ? { parentSpanId } : {}),
  }
}

/**
 * The trace env to merge into a worker's environment — `TRACEPARENT` plus the legacy
 * `TRACE_ID` / `PARENT_SPAN_ID` pair (dual-written for one release) — EMPTY when the run
 * records no spans, which is what keeps the untraced path byte-identical. Merge it BELOW the
 * caller's own seam env so a deliberately-set id wins (see the precedence note above).
 */
export function workerTraceEnv(ctx: WorkerTraceSeamCarrier): Record<string, string> {
  const traceContext = readWorkerTraceContext(ctx)
  return traceContext ? traceContextToEnv(traceContext) : {}
}
