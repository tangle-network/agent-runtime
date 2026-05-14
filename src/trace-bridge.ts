/**
 * @stable
 *
 * Bridge from runtime stream events to the agent-eval trace schema.
 *
 * Before this module, consumers (legal-agent's chat.ts, gtm-agent's runtime
 * route) hand-rolled an adapter from `RuntimeStreamEvent` -> `TraceEvent` per
 * repo. The mapping is mechanical and the destination schema is owned by
 * agent-eval, so the adapter belongs in runtime, not in N consumer repos.
 *
 * The bridge is intentionally one-way (runtime -> agent-eval). The reverse
 * mapping is degenerate (agent-eval events have no session / task affinity)
 * and would invite consumers to round-trip through agent-eval, defeating the
 * point of the runtime-specific shape.
 */

import type { EventKind, TraceEvent } from '@tangle-network/agent-eval'

import { ValidationError } from './errors'
import type { RuntimeStreamEvent } from './types'

/** @stable */
export interface TraceBridgeOptions {
  /**
   * Stable `runId` to stamp on every emitted `TraceEvent`. Required because
   * agent-eval's `TraceEvent.runId` is non-optional.
   */
  runId: string
  /**
   * Optional `spanId` to attach when an event maps to a known span (for
   * example, an outer runtime-task span the consumer is already emitting).
   */
  spanId?: string
  /**
   * Optional id generator; default = monotonic counter scoped to this bridge
   * instance. Override for deterministic tests or to integrate with a wider
   * id-allocator (uuid, ksuid).
   */
  newEventId?: () => string
}

/** @stable */
export interface TraceBridge {
  /**
   * Map a single `RuntimeStreamEvent` to a `TraceEvent`. Returns `undefined`
   * for events that have no useful trace projection (text deltas, reasoning
   * deltas — these belong inside an `LlmSpan.output`, not as separate trace
   * events).
   */
  toTraceEvent(event: RuntimeStreamEvent): TraceEvent | undefined
  /** Convenience: drain an iterable of stream events into trace events. */
  drain(events: Iterable<RuntimeStreamEvent>): TraceEvent[]
}

/**
 * @stable
 *
 * Build a stateful bridge. State is intentionally minimal — only the event-id
 * counter — because the runtime stream already carries timestamps and the
 * caller already knows the `runId`.
 */
export function createTraceBridge(options: TraceBridgeOptions): TraceBridge {
  if (!options.runId) {
    throw new ValidationError('createTraceBridge: runId is required')
  }
  let counter = 0
  const newEventId = options.newEventId ?? (() => `evt-${++counter}`)
  const baseSpanId = options.spanId

  const toTraceEvent = (event: RuntimeStreamEvent): TraceEvent | undefined => {
    const projection = projectToTraceEvent(event)
    if (!projection) return undefined
    return {
      eventId: newEventId(),
      runId: options.runId,
      spanId: baseSpanId,
      kind: projection.kind,
      timestamp: timestampFor(event),
      payload: projection.payload,
    }
  }

  return {
    toTraceEvent,
    drain(events) {
      const out: TraceEvent[] = []
      for (const event of events) {
        const trace = toTraceEvent(event)
        if (trace) out.push(trace)
      }
      return out
    },
  }
}

/**
 * @stable
 *
 * One-shot convenience for callers who don't want to hold a bridge instance.
 * Internally allocates a single-use bridge so id-generation stays consistent
 * within the call.
 */
export function toAgentEvalTrace(
  event: RuntimeStreamEvent,
  options: TraceBridgeOptions,
): TraceEvent | undefined {
  return createTraceBridge(options).toTraceEvent(event)
}

interface TraceProjection {
  kind: EventKind
  payload: Record<string, unknown>
}

function projectToTraceEvent(event: RuntimeStreamEvent): TraceProjection | undefined {
  switch (event.type) {
    case 'task_start':
      return {
        kind: 'log',
        payload: { phase: 'task_start', taskId: event.task.id, intent: event.task.intent },
      }
    case 'readiness_start':
      return { kind: 'log', payload: { phase: 'readiness_start', taskId: event.task.id } }
    case 'readiness_end':
      return {
        kind: event.decision.passed ? 'log' : 'policy_violation',
        payload: {
          phase: 'readiness_end',
          taskId: event.task.id,
          status: event.decision.status,
          readinessScore: event.decision.readinessScore,
          blockingGapIds: event.decision.blockingGapIds,
          nonBlockingGapIds: event.decision.nonBlockingGapIds,
          reason: event.decision.reason,
        },
      }
    case 'questions_start':
      return {
        kind: 'log',
        payload: { phase: 'questions_start', questionCount: event.questions.length },
      }
    case 'questions_end':
      return {
        kind: 'log',
        payload: {
          phase: 'questions_end',
          questionCount: event.questions.length,
          answerCount: Object.keys(event.userAnswers).length,
        },
      }
    case 'acquisition_start':
      return {
        kind: 'log',
        payload: { phase: 'acquisition_start', planCount: event.acquisitionPlans.length },
      }
    case 'acquisition_end':
      return {
        kind: 'log',
        payload: {
          phase: 'acquisition_end',
          planCount: event.acquisitionPlans.length,
          evidenceCount: event.acquiredEvidenceIds.length,
        },
      }
    case 'session_created':
    case 'session_resumed':
      return {
        kind: 'log',
        payload: {
          phase: event.type,
          sessionId: event.session.id,
          backend: event.session.backend,
        },
      }
    case 'backend_start':
    case 'backend_end':
      return { kind: 'log', payload: { phase: event.type, backend: event.backend } }
    case 'backend_error':
      return {
        kind: 'error',
        payload: {
          backend: event.backend,
          message: event.message,
          recoverable: event.recoverable,
        },
      }
    case 'tool_call':
      return {
        kind: 'log',
        payload: {
          phase: 'tool_call',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          // Args intentionally omitted at this layer; consumers attach the
          // payload to a `ToolSpan` if they need to retain it. Trace events
          // are point-in-time markers, not the canonical store for tool I/O.
        },
      }
    case 'tool_result':
      return {
        kind: 'log',
        payload: {
          phase: 'tool_result',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
        },
      }
    case 'llm_call':
      return {
        kind: 'log',
        payload: {
          phase: 'llm_call',
          model: event.model,
          tokensIn: event.tokensIn,
          tokensOut: event.tokensOut,
          costUsd: event.costUsd,
          latencyMs: event.latencyMs,
          finishReason: event.finishReason,
        },
      }
    case 'artifact':
      return {
        kind: 'state_mutation',
        payload: {
          phase: 'artifact',
          artifactId: event.artifactId,
          name: event.name,
          mimeType: event.mimeType,
        },
      }
    case 'task_end':
      return {
        kind: event.status === 'failed' || event.status === 'aborted' ? 'error' : 'log',
        payload: { phase: 'task_end', status: event.status, reason: event.reason },
      }
    case 'final':
      return {
        kind: event.status === 'failed' || event.status === 'aborted' ? 'error' : 'log',
        payload: { phase: 'final', status: event.status, reason: event.reason },
      }
    case 'text_delta':
    case 'reasoning_delta':
      // Token-level deltas don't map cleanly to `TraceEvent`. Consumers that
      // want the final text should accumulate it into an `LlmSpan.output` or
      // a `final` event, both of which the bridge does cover.
      return undefined
    default: {
      // Exhaustiveness fallback; future event types should add a case above.
      const exhaust: never = event
      void exhaust
      return undefined
    }
  }
}

function timestampFor(event: RuntimeStreamEvent): number {
  const iso = 'timestamp' in event ? event.timestamp : undefined
  if (!iso) return Date.now()
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : Date.now()
}
