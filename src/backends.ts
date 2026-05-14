/**
 * @stable
 *
 * Backend factories for `runAgentTaskStream`. Three shapes ship in core:
 *
 *  - `createIterableBackend` — wrap any custom async iterable into a backend
 *  - `createSandboxPromptBackend` — sandbox / sidecar `streamPrompt` clients
 *  - `createOpenAICompatibleBackend` — OpenAI-style chat completions endpoints
 *
 * Adapters stay thin: domain repos own auth, model selection, and the concrete
 * tool surface. The factories handle session creation, stream normalization,
 * and graceful end-of-stream signalling.
 */

import { BackendTransportError } from './errors'
import { newRuntimeSession, nowIso, touchSession } from './sessions'
import type {
  AgentBackendContext,
  AgentBackendInput,
  AgentExecutionBackend,
  RuntimeSession,
  RuntimeStreamEvent,
} from './types'

/** @stable */
export function createIterableBackend<TInput extends AgentBackendInput>(options: {
  kind: string
  start?: AgentExecutionBackend<TInput>['start']
  resume?: AgentExecutionBackend<TInput>['resume']
  stream: AgentExecutionBackend<TInput>['stream']
  stop?: AgentExecutionBackend<TInput>['stop']
}): AgentExecutionBackend<TInput> {
  return options
}

/** @stable */
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

/** @stable */
export function createOpenAICompatibleBackend<
  TInput extends AgentBackendInput = AgentBackendInput,
>(options: {
  apiKey: string
  baseUrl: string
  model: string
  kind?: string
  fetchImpl?: typeof fetch
}): AgentExecutionBackend<TInput> {
  const fetcher = options.fetchImpl ?? fetch
  const kind = options.kind ?? 'tcloud'
  return {
    kind,
    start(_input, context) {
      return newRuntimeSession(kind, context.requestedSessionId)
    },
    async *stream(input, context) {
      const response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          stream: true,
          messages: input.messages ?? [
            { role: 'user', content: input.message ?? context.task.intent },
          ],
        }),
        signal: context.signal,
      })
      if (!response.ok) {
        throw new BackendTransportError(kind, `chat backend returned ${response.status}`, {
          status: response.status,
        })
      }
      yield* streamResponseEvents(response, context)
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
    const text = stringValue(data.text) ?? stringValue(data.delta) ?? stringValue(record.text)
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

async function* streamResponseEvents(
  response: Response,
  context: AgentBackendContext,
): AsyncIterable<RuntimeStreamEvent> {
  const body = response.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    for (const event of drainStreamBuffer(false)) yield event
  }
  buffer += decoder.decode().replace(/\r\n/g, '\n')
  for (const event of drainStreamBuffer(true)) yield event
  if (buffer.trim()) {
    const event = parseStreamChunk(buffer, context)
    if (event) yield event
  }

  function* drainStreamBuffer(flush: boolean): Iterable<RuntimeStreamEvent> {
    for (;;) {
      const sseBoundary = buffer.indexOf('\n\n')
      if (sseBoundary >= 0) {
        const chunk = buffer.slice(0, sseBoundary)
        buffer = buffer.slice(sseBoundary + 2)
        const event = parseStreamChunk(chunk, context)
        if (event) yield event
        continue
      }

      const newline = buffer.indexOf('\n')
      if (newline >= 0 && !buffer.slice(0, newline).startsWith('data:')) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const event = parseStreamChunk(line, context)
        if (event) yield event
        continue
      }

      if (flush && buffer.trim() && !buffer.trimStart().startsWith('data:')) {
        const line = buffer
        buffer = ''
        const event = parseStreamChunk(line, context)
        if (event) yield event
        continue
      }

      break
    }
  }
}

function parseStreamChunk(
  chunk: string,
  context: AgentBackendContext,
): RuntimeStreamEvent | undefined {
  const lines = chunk.split(/\r?\n/)
  const dataLines = lines.filter((line) => line.startsWith('data:'))
  const data =
    dataLines.length > 0
      ? dataLines.map((line) => line.slice(5).trimStart()).join('\n')
      : chunk.trim()
  if (!data || data === '[DONE]') return undefined
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    const choices = parsed.choices
    const choice = Array.isArray(choices)
      ? (choices[0] as Record<string, unknown> | undefined)
      : undefined
    const delta = choice?.delta as Record<string, unknown> | undefined
    const message = choice?.message as Record<string, unknown> | undefined
    const text =
      stringValue(delta?.content) ?? stringValue(message?.content) ?? stringValue(parsed.text)
    if (text) {
      return {
        type: 'text_delta',
        task: context.task,
        session: context.session,
        text,
        timestamp: nowIso(),
      }
    }
    return mapCommonBackendEvent(parsed, context)
  } catch {
    return {
      type: 'text_delta',
      task: context.task,
      session: context.session,
      text: data,
      timestamp: nowIso(),
    }
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
