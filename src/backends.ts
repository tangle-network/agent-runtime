/**
 * Provider-neutral backend adapters for `runAgentTaskStream`.
 *
 * Model inference is deliberately absent. Paid model work enters the Runtime executor with an
 * exact `AgentProfile`; these adapters only normalize a caller-owned iterable or sandbox stream.
 *
 * @stable
 */

import { newRuntimeSession, nowIso, touchSession } from './sessions'
import type {
  AgentBackendContext,
  AgentBackendInput,
  AgentExecutionBackend,
  RuntimeSession,
  RuntimeStreamEvent,
} from './types'

/** Wrap any custom async-iterable stream into a typed `AgentExecutionBackend`. @stable */
export function createIterableBackend<TInput extends AgentBackendInput>(options: {
  kind: string
  start?: AgentExecutionBackend<TInput>['start']
  resume?: AgentExecutionBackend<TInput>['resume']
  stream: AgentExecutionBackend<TInput>['stream']
  stop?: AgentExecutionBackend<TInput>['stop']
}): AgentExecutionBackend<TInput> {
  return options
}

/** Build an `AgentExecutionBackend` backed by a sandbox/sidecar `streamPrompt` call. @stable */
export function createSandboxPromptBackend<
  TBox,
  TInput extends AgentBackendInput = AgentBackendInput,
>(options: {
  kind?: string
  getBox(input: TInput, context: Omit<AgentBackendContext, 'session'>): Promise<TBox> | TBox
  streamPrompt(box: TBox, message: string, context: AgentBackendContext): AsyncIterable<unknown>
  mapEvent?: (event: unknown, context: AgentBackendContext) => RuntimeStreamEvent | undefined
  getSessionId?: (box: TBox, input: TInput) => string | undefined
}): AgentExecutionBackend<TInput> {
  const kind = options.kind ?? 'sandbox'
  return {
    kind,
    async start(input, context) {
      const box = await options.getBox(input, context)
      return newRuntimeSession(
        kind,
        options.getSessionId?.(box, input) ?? context.requestedSessionId,
        { resumable: true },
      )
    },
    resume(session) {
      return touchSession({ ...session, status: 'active' })
    },
    async *stream(input, context) {
      const box = await options.getBox(input, context)
      const message = input.message ?? input.messages?.at(-1)?.content ?? context.task.intent
      for await (const event of options.streamPrompt(box, message, context)) {
        const mapped = options.mapEvent?.(event, context) ?? mapCommonBackendEvent(event, context)
        if (mapped) yield mapped
      }
    },
  }
}

/** @internal */
export function normalizeBackendStreamEvent(
  event: RuntimeStreamEvent,
  task: AgentBackendContext['task'],
  session: RuntimeSession,
): RuntimeStreamEvent {
  if (
    'task' in event &&
    event.task &&
    'session' in event &&
    event.session &&
    'timestamp' in event &&
    event.timestamp
  ) {
    return event
  }
  return {
    ...event,
    task: 'task' in event && event.task ? event.task : task,
    session: 'session' in event && event.session ? event.session : session,
    timestamp: 'timestamp' in event && event.timestamp ? event.timestamp : nowIso(),
  } as RuntimeStreamEvent
}

function mapCommonBackendEvent(
  event: unknown,
  context: AgentBackendContext,
): RuntimeStreamEvent | undefined {
  if (!event || typeof event !== 'object') return undefined
  const record = event as Record<string, unknown>
  const type = String(record.type ?? '')
  const data =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : record
  if (type === 'message.part.updated' || type === 'text_delta' || type === 'delta') {
    const part = data.part as Record<string, unknown> | undefined
    const partText =
      part !== undefined &&
      typeof part === 'object' &&
      (part.type === 'text' || part.type === undefined)
        ? stringValue(part.text)
        : undefined
    const text =
      stringValue(data.text) ?? stringValue(data.delta) ?? stringValue(record.text) ?? partText
    return text
      ? {
          type: 'text_delta',
          task: context.task,
          session: context.session,
          text,
          timestamp: nowIso(),
        }
      : undefined
  }
  if (type === 'reasoning_delta') {
    const text = stringValue(data.text) ?? stringValue(record.text)
    return text
      ? {
          type: 'reasoning_delta',
          task: context.task,
          session: context.session,
          text,
          timestamp: nowIso(),
        }
      : undefined
  }
  if (type === 'tool_call') {
    return {
      type: 'tool_call',
      task: context.task,
      session: context.session,
      toolName: stringValue(data.name) ?? stringValue(record.toolName) ?? 'tool',
      toolCallId: stringValue(data.id) ?? stringValue(record.toolCallId),
      args: data.args ?? data.input ?? record.args,
      timestamp: nowIso(),
    }
  }
  if (type === 'tool_result') {
    return {
      type: 'tool_result',
      task: context.task,
      session: context.session,
      toolName: stringValue(data.name) ?? stringValue(record.toolName) ?? 'tool',
      toolCallId: stringValue(data.id) ?? stringValue(record.toolCallId),
      result: data.result ?? data.output ?? record.result,
      timestamp: nowIso(),
    }
  }
  if (type === 'artifact') {
    const artifactId =
      stringValue(data.artifactId) ?? stringValue(data.id) ?? stringValue(record.artifactId)
    if (!artifactId) return undefined
    return {
      type: 'artifact',
      task: context.task,
      session: context.session,
      artifactId,
      name: stringValue(data.name) ?? stringValue(record.name),
      mimeType: stringValue(data.mimeType) ?? stringValue(record.mimeType),
      uri: stringValue(data.uri) ?? stringValue(record.uri),
      content: stringValue(data.content) ?? stringValue(data.body) ?? stringValue(record.content),
      metadata:
        data.metadata && typeof data.metadata === 'object'
          ? (data.metadata as Record<string, unknown>)
          : undefined,
      timestamp: nowIso(),
    }
  }
  if (type === 'proposal_created' || type === 'proposal' || type === 'filing') {
    const proposalId =
      stringValue(data.proposalId) ?? stringValue(data.id) ?? stringValue(record.proposalId)
    if (!proposalId) return undefined
    const status = stringValue(data.status) ?? stringValue(record.status)
    return {
      type: 'proposal_created',
      task: context.task,
      session: context.session,
      proposalId,
      title: stringValue(data.title) ?? stringValue(record.title) ?? proposalId,
      status:
        status === 'pending' || status === 'approved' || status === 'rejected' ? status : undefined,
      content: stringValue(data.content) ?? stringValue(data.body) ?? stringValue(record.content),
      timestamp: nowIso(),
    }
  }
  if (type === 'result' || type === 'final') {
    const text = stringValue(data.finalText) ?? stringValue(data.text) ?? stringValue(record.text)
    return text
      ? {
          type: 'text_delta',
          task: context.task,
          session: context.session,
          text,
          timestamp: nowIso(),
        }
      : undefined
  }
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
