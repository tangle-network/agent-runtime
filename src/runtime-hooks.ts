/**
 *
 * Runtime hook contracts. Hooks are execution-scoped observers, not part of an
 * `AgentProfile`: profiles stay portable agent recipes; hooks attach to the
 * loop or product harness that is running the profile.
 *
 * @experimental
 */

export type RuntimeHookPhase = 'before' | 'after' | 'error' | 'event'

export type RuntimeHookTarget =
  | 'agent.run'
  | 'agent.turn'
  | 'agent.tool_call'
  | 'agent.spawn'
  | 'agent.child'
  | 'agent.plan'
  | 'agent.decision'
  | (string & {})

export type RuntimeDecisionKind =
  | 'continue'
  | 'verify'
  | 'ask'
  | 'retry'
  | 'stop'
  | 'memory-write'
  | 'memory-read'
  | 'tool-select'
  | 'skill-select'
  | 'workflow-select'
  | 'surface-promote'
  | (string & {})

export interface RuntimeHookEvent<Payload = unknown> {
  id: string
  runId: string
  scenarioId?: string
  target: RuntimeHookTarget
  phase: RuntimeHookPhase
  timestamp: number
  stepIndex?: number
  parentId?: string
  payload?: Payload
  metadata?: Record<string, unknown>
}

export interface RuntimeHookContext {
  signal?: AbortSignal
}

export interface RuntimeDecisionEvidenceRef {
  source: string
  id: string
  detail?: string
  metadata?: Record<string, unknown>
}

export interface RuntimeDecisionPoint {
  id: string
  runId: string
  scenarioId?: string
  stepIndex: number
  kind: RuntimeDecisionKind
  candidateActions: string[]
  context?: string
  evidence: RuntimeDecisionEvidenceRef[]
  metadata?: Record<string, unknown>
}

export interface RuntimeHookErrorContext {
  hook: 'onEvent' | 'onDecisionPoint'
  eventId?: string
  target?: RuntimeHookTarget
  phase?: RuntimeHookPhase
  decisionId?: string
  decisionKind?: RuntimeDecisionKind
}

/**
 * The observation seam attached to a running loop (never to the portable genome).
 * Implement the optional hooks to receive lifecycle events, semantic decision points,
 * and hook errors. Author with {@link defineRuntimeHooks} for inference, and attach N
 * observers at once with {@link composeRuntimeHooks} — there is ONE event stream, not a
 * callback-prop zoo.
 */
export interface RuntimeHooks {
  /**
   * General before/after/event hook. Use this for telemetry, memory capture,
   * policy wrapping, child lifecycle observers, or product-specific extension
   * points.
   */
  onEvent?: (event: RuntimeHookEvent, context: RuntimeHookContext) => void | Promise<void>
  /**
   * Semantic decision hook. Belief-state evaluation consumes this, but runtime
   * code should keep emitting ordinary lifecycle events as the base layer.
   */
  onDecisionPoint?: (
    point: RuntimeDecisionPoint,
    context: RuntimeHookContext,
  ) => void | Promise<void>
  onHookError?: (error: Error, context: RuntimeHookErrorContext) => void | Promise<void>
}

/** Identity helper that types a {@link RuntimeHooks} literal so the fields are inferred. */
export function defineRuntimeHooks(hooks: RuntimeHooks): RuntimeHooks {
  return hooks
}

/**
 * Merge several {@link RuntimeHooks} into one. Falsy entries are dropped (so you can
 * pass `flag && hooks`), and every observer's `onEvent`/`onDecisionPoint` fires for each
 * event. Use this to attach N observers to a loop instead of a second event bus.
 */
export function composeRuntimeHooks(
  ...entries: Array<RuntimeHooks | undefined | null | false>
): RuntimeHooks {
  const hooks = entries.filter((entry): entry is RuntimeHooks => !!entry)
  return {
    onEvent: hooks.some((hook) => hook.onEvent)
      ? (event, context) => {
          const pending: Promise<unknown>[] = []
          for (const hook of hooks) {
            const result = hook.onEvent?.(event, context)
            if (isThenable(result)) pending.push(Promise.resolve(result))
          }
          if (pending.length > 0) return Promise.all(pending).then(() => undefined)
          return undefined
        }
      : undefined,
    onDecisionPoint: hooks.some((hook) => hook.onDecisionPoint)
      ? (point, context) => {
          const pending: Promise<unknown>[] = []
          for (const hook of hooks) {
            const result = hook.onDecisionPoint?.(point, context)
            if (isThenable(result)) pending.push(Promise.resolve(result))
          }
          if (pending.length > 0) return Promise.all(pending).then(() => undefined)
          return undefined
        }
      : undefined,
    onHookError: hooks.some((hook) => hook.onHookError)
      ? (error, context) => {
          const pending: Promise<unknown>[] = []
          for (const hook of hooks) {
            const result = hook.onHookError?.(error, context)
            if (isThenable(result)) pending.push(Promise.resolve(result))
          }
          if (pending.length > 0) return Promise.all(pending).then(() => undefined)
          return undefined
        }
      : undefined,
  }
}

/** Fire `hooks.onEvent`, swallowing sync throws and surfacing async failures to `onError`. */
export function notifyRuntimeHookEvent(
  hooks: RuntimeHooks | undefined,
  event: RuntimeHookEvent,
  context: RuntimeHookContext = {},
): void {
  const onEvent = hooks?.onEvent
  if (!onEvent) return

  try {
    const result = onEvent(event, context)
    if (isThenable(result)) {
      void result.catch((error) => {
        notifyRuntimeHookError(hooks, toError(error), {
          hook: 'onEvent',
          eventId: event.id,
          target: event.target,
          phase: event.phase,
        })
      })
    }
  } catch (error) {
    notifyRuntimeHookError(hooks, toError(error), {
      hook: 'onEvent',
      eventId: event.id,
      target: event.target,
      phase: event.phase,
    })
  }
}

/** Fire `hooks.onDecisionPoint`, swallowing sync throws and surfacing async failures to `onError`. */
export function notifyRuntimeDecisionPoint(
  hooks: RuntimeHooks | undefined,
  point: RuntimeDecisionPoint,
  context: RuntimeHookContext = {},
): void {
  const onDecisionPoint = hooks?.onDecisionPoint
  if (!onDecisionPoint) return

  try {
    const result = onDecisionPoint(point, context)
    if (isThenable(result)) {
      void result.catch((error) => {
        notifyRuntimeHookError(hooks, toError(error), {
          hook: 'onDecisionPoint',
          decisionId: point.id,
          decisionKind: point.kind,
        })
      })
    }
  } catch (error) {
    notifyRuntimeHookError(hooks, toError(error), {
      hook: 'onDecisionPoint',
      decisionId: point.id,
      decisionKind: point.kind,
    })
  }
}

function notifyRuntimeHookError(
  hooks: RuntimeHooks | undefined,
  error: Error,
  context: RuntimeHookErrorContext,
): void {
  try {
    const result = hooks?.onHookError?.(error, context)
    if (isThenable(result)) void result.catch(() => undefined)
  } catch {
    // Hook errors must never become agent-loop errors.
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
