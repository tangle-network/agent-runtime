import type { AgentTaskSpec, AgentTaskStatus, RuntimeStreamEvent } from './types'

/** Opt-ins for fields that may contain user or tenant data. */
export interface RuntimeTelemetryOptions {
  /** Include task intent and inputs. */
  includeTaskData?: boolean
  /** Include streamed text, tool payloads, artifacts, proposals, and error details. */
  includeEventData?: boolean
  /** Include task, artifact, session, and final metadata. */
  includeMetadata?: boolean
}

/** Convert one runtime event into a redacted plain object. */
export function sanitizeRuntimeStreamEvent(
  event: RuntimeStreamEvent,
  options: RuntimeTelemetryOptions = {},
): Record<string, unknown> {
  const base = {
    type: event.type,
    ...('task' in event && event.task ? { task: sanitizeTask(event.task, options) } : {}),
    ...('timestamp' in event ? { timestamp: event.timestamp } : {}),
  }

  switch (event.type) {
    case 'turn_start':
      return {
        ...base,
        provider: event.provider,
        sessionId: event.sessionId,
      }
    case 'text_delta':
    case 'reasoning_delta':
      return {
        ...base,
        text: options.includeEventData ? event.text : undefined,
        textChars: event.text.length,
      }
    case 'tool_call':
      return {
        ...base,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        args: options.includeEventData ? event.args : undefined,
      }
    case 'tool_result':
      return {
        ...base,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        result: options.includeEventData ? event.result : undefined,
      }
    case 'llm_call':
      return {
        ...base,
        model: event.model,
        tokensIn: event.tokensIn,
        tokensOut: event.tokensOut,
        costUsd: event.costUsd,
        latencyMs: event.latencyMs,
        finishReason: event.finishReason,
      }
    case 'artifact':
      return {
        ...base,
        artifactId: event.artifactId,
        name: event.name,
        mimeType: event.mimeType,
        uri: options.includeEventData ? event.uri : undefined,
        content: options.includeEventData ? event.content : undefined,
        metadata: options.includeMetadata ? event.metadata : undefined,
      }
    case 'proposal_created':
      return {
        ...base,
        proposalId: event.proposalId,
        title: options.includeEventData ? event.title : undefined,
        content: options.includeEventData ? event.content : undefined,
        status: event.status,
      }
    case 'turn_error':
      return {
        ...base,
        provider: event.provider,
        sessionId: event.sessionId,
        recoverable: event.recoverable,
        error: {
          kind: event.error.kind,
          status: event.error.status,
          message: options.includeEventData ? event.error.message : undefined,
          body: options.includeEventData ? event.error.body : undefined,
        },
      }
    case 'final':
      return {
        ...base,
        sessionId: event.sessionId,
        status: event.status,
        reason: options.includeEventData ? event.reason : undefined,
        text: options.includeEventData ? event.text : undefined,
        textChars: event.text?.length ?? 0,
        metadata: options.includeMetadata ? event.metadata : undefined,
        ...(event.error
          ? {
              error: {
                kind: event.error.kind,
                status: event.error.status,
                message: options.includeEventData ? event.error.message : undefined,
                body: options.includeEventData ? event.error.body : undefined,
              },
            }
          : {}),
      }
  }
}

function sanitizeTask(
  task: AgentTaskSpec,
  options: RuntimeTelemetryOptions,
): Record<string, unknown> {
  return {
    id: task.id,
    domain: task.domain,
    intent: options.includeTaskData ? task.intent : '[redacted]',
    inputs:
      options.includeTaskData && task.inputs ? task.inputs : task.inputs ? '[redacted]' : undefined,
    metadata:
      options.includeMetadata && task.metadata
        ? task.metadata
        : task.metadata
          ? '[redacted]'
          : undefined,
  }
}

export type RuntimeStreamEventSink = (event: RuntimeStreamEvent) => void

export interface RuntimeStreamEventSummary {
  eventCount: number
  eventCountsByType: Record<string, number>
  sessionId?: string
  finalStatus?: AgentTaskStatus
  finalReason?: string
  textChars: number
  text?: string
}

export interface RuntimeStreamEventCollector {
  onEvent: RuntimeStreamEventSink
  events: Array<Record<string, unknown>>
  summary(): RuntimeStreamEventSummary
}

/** Collect redacted runtime events and a small summary. */
export function createRuntimeStreamEventCollector(
  options: RuntimeTelemetryOptions = {},
): RuntimeStreamEventCollector {
  const events: Array<Record<string, unknown>> = []
  const eventCountsByType: Record<string, number> = {}
  let sessionId: string | undefined
  let finalStatus: AgentTaskStatus | undefined
  let finalReason: string | undefined
  let textChars = 0
  let text = ''

  return {
    events,
    onEvent(event) {
      events.push(sanitizeRuntimeStreamEvent(event, options))
      eventCountsByType[event.type] = (eventCountsByType[event.type] ?? 0) + 1
      if (event.type === 'turn_start' || event.type === 'turn_error' || event.type === 'final') {
        sessionId ??= event.sessionId
      }
      if (event.type === 'text_delta') {
        textChars += event.text.length
        if (options.includeEventData) text += event.text
      }
      if (event.type === 'final') {
        finalStatus = event.status
        finalReason = options.includeEventData ? event.reason : undefined
      }
    },
    summary() {
      return {
        eventCount: events.length,
        eventCountsByType: { ...eventCountsByType },
        sessionId,
        finalStatus,
        finalReason,
        textChars,
        ...(options.includeEventData ? { text } : {}),
      }
    },
  }
}
