import type { DurablePlan, Part, StreamEvent } from '@tangle-network/agent-interface'
import type { RuntimeTelemetryOptions } from './sanitize-shared'

const REDACTED_CANONICAL_VALUE = '[redacted]'

export function sanitizeCanonicalEvent(
  event: StreamEvent,
  options: RuntimeTelemetryOptions,
): StreamEvent | Record<string, unknown> {
  if (options.includeControlPayloads) return event
  switch (event.type) {
    case 'message.part.updated':
      return {
        type: event.type,
        part: sanitizeCanonicalPart(event.part),
        ...(event.delta === undefined ? {} : { delta: REDACTED_CANONICAL_VALUE }),
      }
    case 'tool-heartbeat':
      return { type: event.type, partId: event.partId, elapsedMs: event.elapsedMs }
    case 'tool-slow':
      return {
        type: event.type,
        partId: event.partId,
        elapsedMs: event.elapsedMs,
        thresholdMs: event.thresholdMs,
      }
    case 'model-processing':
      return {
        type: event.type,
        phase: event.phase,
        ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
      }
    case 'status':
      return { type: event.type, status: event.status }
    case 'warning':
      return { type: event.type, code: event.code }
    case 'raw':
      return { type: event.type, backend: event.backend, event: REDACTED_CANONICAL_VALUE }
    case 'session.updated':
      return {
        type: event.type,
        sessionId: event.sessionId,
        ...(event.time === undefined ? {} : { time: event.time }),
      }
    case 'interaction':
      return { type: event.type, request: sanitizeInteractionRequest(event.request) }
    case 'interaction.cancel':
      return { type: event.type, id: event.id }
    case 'plan.submitted':
      return { type: event.type, plan: sanitizeDurablePlan(event.plan) }
  }
}

function sanitizeCanonicalPart(part: Part): Record<string, unknown> {
  const identity = {
    id: part.id,
    sessionID: part.sessionID,
    messageID: part.messageID,
    type: part.type,
  }
  switch (part.type) {
    case 'tool':
      return {
        ...identity,
        ...(part.callID === undefined ? {} : { callID: part.callID }),
        state: { status: part.state.status },
      }
    case 'file':
      return {
        ...identity,
        ...(part.mediaType === undefined ? {} : { mediaType: part.mediaType }),
      }
    case 'subtask':
      return { ...identity, agent: REDACTED_CANONICAL_VALUE }
    case 'text':
    case 'reasoning':
      return { ...identity, text: REDACTED_CANONICAL_VALUE }
  }
}

function sanitizeInteractionRequest(request: {
  id: string
  kind: string
  answerSpec: { fields: ReadonlyArray<{ type: string; required?: boolean }> }
}): Record<string, unknown> {
  return {
    id: request.id,
    kind: request.kind,
    answerSpec: {
      fields: request.answerSpec.fields.map((field) => ({
        type: field.type,
        ...(field.required === undefined ? {} : { required: field.required }),
      })),
    },
  }
}

function sanitizeDurablePlan(plan: DurablePlan): Record<string, unknown> {
  return {
    id: plan.id,
    revision: plan.revision,
    submittedAt: plan.submittedAt,
  }
}
