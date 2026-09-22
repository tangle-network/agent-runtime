import { sanitizeCanonicalEvent } from './sanitize-canonical-event'
import type { RuntimeTelemetryOptions } from './sanitize-shared'
import {
  pickPublicStreamFields,
  redactRecord,
  sanitizeAcquisitionPlan,
  sanitizeKnowledgeReadinessReport,
  sanitizeQuestion,
  sanitizeRuntimeSession,
  sanitizeTask,
} from './sanitize-shared'
import type { AgentTaskStatus, RuntimeStreamEvent } from './types'

export type RuntimeStreamEventSink = (event: RuntimeStreamEvent) => void

/** Reduce one runtime stream event to a serializable, telemetry-safe object. @stable */
export function sanitizeRuntimeStreamEvent(
  event: RuntimeStreamEvent,
  options: RuntimeTelemetryOptions = {},
): Record<string, unknown> {
  const withTask = 'task' in event && event.task ? { task: sanitizeTask(event.task, options) } : {}
  const withSession =
    'session' in event && event.session
      ? { session: sanitizeRuntimeSession(event.session, options) }
      : {}

  if (event.type === 'readiness_end') {
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      decision: event.decision,
      knowledge: sanitizeKnowledgeReadinessReport(event.knowledge, options),
    }
  }
  if (event.type === 'questions_start') {
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      questions: event.questions.map((question) => sanitizeQuestion(question, options)),
    }
  }
  if (event.type === 'questions_end') {
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      questions: event.questions.map((question) => sanitizeQuestion(question, options)),
      userAnswers: options.includeUserAnswers ? event.userAnswers : redactRecord(event.userAnswers),
    }
  }
  if (event.type === 'acquisition_start') {
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      acquisitionPlans: event.acquisitionPlans.map(sanitizeAcquisitionPlan),
    }
  }
  if (event.type === 'acquisition_end') {
    return {
      type: event.type,
      ...withTask,
      timestamp: event.timestamp,
      acquisitionPlans: event.acquisitionPlans.map(sanitizeAcquisitionPlan),
      acquiredEvidenceCount: event.acquiredEvidenceIds.length,
      acquiredEvidenceIds: options.includeEvidenceIds ? event.acquiredEvidenceIds : undefined,
    }
  }
  if (event.type === 'tool_call') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      args: options.includeControlPayloads ? event.args : undefined,
    }
  }
  if (event.type === 'tool_result') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      result: options.includeControlPayloads ? event.result : undefined,
    }
  }
  if (event.type === 'llm_call') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      model: event.model,
      tokensIn: event.tokensIn,
      tokensOut: event.tokensOut,
      costUsd: event.costUsd,
      latencyMs: event.latencyMs,
      finishReason: event.finishReason,
    }
  }
  if (event.type === 'artifact') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      artifactId: event.artifactId,
      name: event.name,
      mimeType: event.mimeType,
      uri: options.includeEvidenceIds ? event.uri : undefined,
      content: options.includeControlPayloads ? event.content : undefined,
      metadata: options.includeMetadata ? event.metadata : undefined,
    }
  }
  if (event.type === 'proposal_created') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      proposalId: event.proposalId,
      title: options.includeControlPayloads ? event.title : undefined,
      content: options.includeControlPayloads ? event.content : undefined,
      status: event.status,
    }
  }
  if (event.type === 'canonical_event') {
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      event: sanitizeCanonicalEvent(event.event, options),
      eventId: event.eventId,
      cursor: event.cursor,
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      timestamp: event.timestamp,
    }
  }
  if (event.type === 'final') {
    const error = event.error
    return {
      type: event.type,
      ...withTask,
      ...withSession,
      timestamp: event.timestamp,
      status: event.status,
      reason: event.reason,
      text: options.includeControlPayloads ? event.text : undefined,
      metadata: options.includeMetadata ? event.metadata : undefined,
      ...(error === undefined
        ? {}
        : {
            error: {
              kind: error.kind,
              message: error.message,
              status: error.status,
              body: options.includeControlPayloads ? error.body : undefined,
            },
          }),
    }
  }
  return {
    type: event.type,
    ...withTask,
    ...withSession,
    timestamp: 'timestamp' in event ? event.timestamp : undefined,
    ...pickPublicStreamFields(event),
  }
}

export interface RuntimeStreamEventSummary {
  eventCount: number
  eventCountsByType: Record<string, number>
  firstSessionId?: string
  finalStatus?: AgentTaskStatus
  finalReason?: string
  finalText: string
}

export interface RuntimeStreamEventCollector {
  onEvent: RuntimeStreamEventSink
  events: Array<Record<string, unknown>>
  summary(): RuntimeStreamEventSummary
}

/** Create a collector that stores sanitized events and a compact summary. @stable */
export function createRuntimeStreamEventCollector(
  options: RuntimeTelemetryOptions = {},
): RuntimeStreamEventCollector {
  const events: Array<Record<string, unknown>> = []
  const eventCountsByType: Record<string, number> = {}
  let firstSessionId: string | undefined
  let finalStatus: AgentTaskStatus | undefined
  let finalReason: string | undefined
  let finalText = ''
  return {
    events,
    onEvent: (event) => {
      events.push(sanitizeRuntimeStreamEvent(event, options))
      eventCountsByType[event.type] = (eventCountsByType[event.type] ?? 0) + 1
      if (event.type === 'text_delta') finalText += event.text
      if (
        !firstSessionId &&
        (event.type === 'session_created' || event.type === 'session_resumed')
      ) {
        firstSessionId = event.session.id
      }
      if (event.type === 'final') {
        finalStatus = event.status
        finalReason = event.reason
      }
    },
    summary() {
      return {
        eventCount: events.length,
        eventCountsByType: { ...eventCountsByType },
        firstSessionId,
        finalStatus,
        finalReason,
        finalText,
      }
    },
  }
}
