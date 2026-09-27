//#region src/runtime-hooks.d.ts
/**
 *
 * Runtime hook contracts. Hooks are execution-scoped observers, not part of an
 * `AgentProfile`: profiles stay portable agent recipes; hooks attach to the
 * loop or product harness that is running the profile.
 *
 * A `pursuitId` is deliberately orthogonal to `runId`: a pursuit can span many
 * resumed/retried/forked runs while every event remains attributable to the
 * durable objective that caused it. The observer plane is outside the agent
 * environment and must never be required for agent correctness.
 *
 * @experimental
 */
type RuntimeHookPhase = 'before' | 'after' | 'error' | 'event';
type RuntimeHookTarget = 'agent.run' | 'agent.turn' | 'agent.tool_call' | 'agent.spawn' | 'agent.child' | 'agent.plan' | 'agent.decision' | (string & {});
type RuntimeDecisionKind = 'continue' | 'verify' | 'ask' | 'retry' | 'stop' | 'memory-write' | 'memory-read' | 'tool-select' | 'skill-select' | 'workflow-select' | 'surface-promote' | (string & {});
interface RuntimeHookEvent<Payload = unknown> {
  id: string;
  /** Stable identity for the long-lived objective. One pursuit may contain many runs. */
  pursuitId?: string;
  runId: string;
  scenarioId?: string;
  target: RuntimeHookTarget;
  phase: RuntimeHookPhase;
  timestamp: number;
  stepIndex?: number;
  parentId?: string;
  payload?: Payload;
  metadata?: Record<string, unknown>;
}
interface RuntimeHookContext {
  signal?: AbortSignal;
}
interface RuntimeDecisionEvidenceRef {
  source: string;
  id: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}
interface RuntimeDecisionPoint {
  id: string;
  /** Stable identity for the long-lived objective. One pursuit may contain many runs. */
  pursuitId?: string;
  runId: string;
  scenarioId?: string;
  stepIndex: number;
  kind: RuntimeDecisionKind;
  candidateActions: string[];
  context?: string;
  evidence: RuntimeDecisionEvidenceRef[];
  metadata?: Record<string, unknown>;
}
interface RuntimeHookErrorContext {
  hook: 'onEvent' | 'onDecisionPoint';
  eventId?: string;
  target?: RuntimeHookTarget;
  phase?: RuntimeHookPhase;
  decisionId?: string;
  decisionKind?: RuntimeDecisionKind;
}
/**
 * The observation seam attached to a running loop (never to the portable genome).
 * Implement the optional hooks to receive lifecycle events, semantic decision points,
 * and hook errors. Author with {@link defineRuntimeHooks} for inference, and attach N
 * observers at once with {@link composeRuntimeHooks} — there is ONE event stream, not a
 * callback-prop zoo.
 */
interface RuntimeHooks {
  /**
   * General before/after/event hook. Use this for telemetry, memory capture,
   * policy wrapping, child lifecycle observers, or product-specific extension
   * points.
   */
  onEvent?: (event: RuntimeHookEvent, context: RuntimeHookContext) => void | Promise<void>;
  /**
   * Semantic decision hook. Belief-state evaluation consumes this, but runtime
   * code should keep emitting ordinary lifecycle events as the base layer.
   */
  onDecisionPoint?: (point: RuntimeDecisionPoint, context: RuntimeHookContext) => void | Promise<void>;
  onHookError?: (error: Error, context: RuntimeHookErrorContext) => void | Promise<void>;
}
/** Identity helper that types a {@link RuntimeHooks} literal so the fields are inferred. */
declare function defineRuntimeHooks(hooks: RuntimeHooks): RuntimeHooks;
/**
 * Merge several {@link RuntimeHooks} into one. Falsy entries are dropped (so you can
 * pass `flag && hooks`), and every observer's `onEvent`/`onDecisionPoint` fires for each
 * event. Use this to attach N observers to a loop instead of a second event bus.
 */
declare function composeRuntimeHooks(...entries: Array<RuntimeHooks | undefined | null | false>): RuntimeHooks;
/** Fire `hooks.onEvent`, swallowing sync throws and surfacing async failures to `onError`. */
declare function notifyRuntimeHookEvent(hooks: RuntimeHooks | undefined, event: RuntimeHookEvent, context?: RuntimeHookContext): void;
/** Fire `hooks.onDecisionPoint`, swallowing sync throws and surfacing async failures to `onError`. */
declare function notifyRuntimeDecisionPoint(hooks: RuntimeHooks | undefined, point: RuntimeDecisionPoint, context?: RuntimeHookContext): void;
//#endregion
export { RuntimeHookErrorContext as a, RuntimeHookTarget as c, defineRuntimeHooks as d, notifyRuntimeDecisionPoint as f, RuntimeHookContext as i, RuntimeHooks as l, RuntimeDecisionKind as n, RuntimeHookEvent as o, notifyRuntimeHookEvent as p, RuntimeDecisionPoint as r, RuntimeHookPhase as s, RuntimeDecisionEvidenceRef as t, composeRuntimeHooks as u };
//# sourceMappingURL=runtime-hooks-Bj6wJHlH.d.ts.map