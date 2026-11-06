/**
 * Trace context handed to a spawned worker so one supervised tree spans machines. `traceContextToEnv`
 * writes W3C `TRACEPARENT` and the legacy `TRACE_ID` / `PARENT_SPAN_ID` pair; readers take
 * `TRACEPARENT` first. The legacy pair stays so a child on the previous package still joins.
 * `PARENT_SPAN_ID` is the spawning node's span (`parentId`): at depth 0 the run root, otherwise the
 * driver child, and the only span that exists when the child's `ExecutorContext` is built. With
 * `SuperviseOptions.otel` unset, {@link workerTraceEnv} is empty and spawn environments stay
 * byte-identical. `Scope` stamps registry children. `supervise({ backend })` must pass the same seam
 * into `workerFromBackend` or the front door stamps nothing. Precedence is ambient `process.env`,
 * then this stamp, then `CliSeam.env`. A seam that sets the legacy pair gets `TRACEPARENT` rebuilt
 * from those ids. Ambient ids do not win; join an outer trace with `SupervisorSpanOptions.traceId`
 * and `parentSpanId`. `cli`, `sandbox`, and `bridge` propagate. `router`, `router-tools`,
 * `cli-worktree`, `cli-in-place`, and `provider` have no worker environment channel and do not.
 */

import { type TraceContext, traceContextToEnv } from '../../mcp/trace-propagation'
import type { ExecutorConfig } from './runtime'

/**
 * The census above, as a value the compiler checks. `satisfies` against every `ExecutorConfig`
 * discriminant means an EIGHTH backend arm cannot be added without classifying it here — the prose
 * alone could go stale silently, which is the failure this table exists to prevent.
 *
 * `true` = the arm has a real channel to the worker (environment or transport headers) and stamps
 * the context. `false` = it has none today; it is honestly unpropagated rather than silently
 * dropping.
 */
export const WORKER_TRACE_PROPAGATION = {
  cli: true,
  sandbox: true,
  router: false,
  'router-tools': false,
  bridge: true,
  'cli-worktree': false,
  'cli-in-place': false,
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

/**
 * The trace request headers for a worker dispatched over the cli-bridge HTTP transport — W3C
 * `traceparent` plus the legacy `x-trace-id` / `x-parent-span-id` pair the bridge also reads —
 * EMPTY when the run records no spans, which keeps the untraced request byte-identical. Derived
 * from the same dual-write the env channel uses ({@link workerTraceEnv}), so the header and env
 * spellings can never name different traces. `traceparent` is present only when a parent span id
 * exists (the W3C grammar requires one); the legacy pair still carries a lone trace id.
 */
export function workerTraceHeaders(ctx: WorkerTraceSeamCarrier): Record<string, string> {
  const env = workerTraceEnv(ctx)
  return {
    ...(env.TRACEPARENT !== undefined ? { traceparent: env.TRACEPARENT } : {}),
    ...(env.TRACE_ID !== undefined ? { 'x-trace-id': env.TRACE_ID } : {}),
    ...(env.PARENT_SPAN_ID !== undefined ? { 'x-parent-span-id': env.PARENT_SPAN_ID } : {}),
  }
}
