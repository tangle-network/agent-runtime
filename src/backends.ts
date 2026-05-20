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
/**
 * Retry policy for transient transport errors (rate limits, upstream
 * timeouts). Defaults to 5 attempts with exponential backoff starting at
 * 1s, ±25% jitter, capped at 30s. Set `maxAttempts: 1` to disable retries.
 *
 * Retried status codes:
 *   - 408 Request Timeout
 *   - 425 Too Early
 *   - 429 Too Many Requests
 *   - 500 / 502 / 503 / 504 — upstream transient failures
 *
 * Hard failures (401, 403, 4xx other than the above) propagate immediately.
 */
export interface BackendRetryPolicy {
  /** Total attempts including the first try. Default 5. */
  maxAttempts?: number
  /** Initial backoff in ms before the second attempt. Default 1000. */
  initialBackoffMs?: number
  /** Hard ceiling on backoff in ms. Default 30000. */
  maxBackoffMs?: number
  /** Jitter fraction in [0, 1]. Default 0.25 (±25%). */
  jitter?: number
  /** Status codes that trigger a retry. Default: 408, 425, 429, 500, 502, 503, 504. */
  retryStatuses?: ReadonlyArray<number>
}

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const

function pickRetryDelayMs(attempt: number, policy: Required<BackendRetryPolicy>): number {
  const exp = policy.initialBackoffMs * 2 ** (attempt - 1)
  const capped = Math.min(exp, policy.maxBackoffMs)
  const jitter = capped * policy.jitter * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(capped + jitter))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'))
      return
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createOpenAICompatibleBackend<
  TInput extends AgentBackendInput = AgentBackendInput,
>(options: {
  apiKey: string
  baseUrl: string
  model: string
  kind?: string
  fetchImpl?: typeof fetch
  retry?: BackendRetryPolicy
}): AgentExecutionBackend<TInput> {
  const fetcher = options.fetchImpl ?? fetch
  const kind = options.kind ?? 'tcloud'
  const retryPolicy: Required<BackendRetryPolicy> = {
    maxAttempts: options.retry?.maxAttempts ?? 5,
    initialBackoffMs: options.retry?.initialBackoffMs ?? 1000,
    maxBackoffMs: options.retry?.maxBackoffMs ?? 30000,
    jitter: options.retry?.jitter ?? 0.25,
    retryStatuses: options.retry?.retryStatuses ?? DEFAULT_RETRY_STATUSES,
  }
  return {
    kind,
    start(_input, context) {
      return newRuntimeSession(kind, context.requestedSessionId)
    },
    async *stream(input, context) {
      let response: Response | undefined
      let lastStatus = 0
      for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
        response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
        if (response.ok) break
        lastStatus = response.status
        if (!retryPolicy.retryStatuses.includes(response.status)) break
        if (attempt === retryPolicy.maxAttempts) break
        // Drain the failed body so the connection can be reused.
        try {
          await response.body?.cancel()
        } catch {
          // Best-effort — some runtimes don't expose cancel.
        }
        const delayMs = pickRetryDelayMs(attempt, retryPolicy)
        await sleep(delayMs, context.signal)
      }
      if (!response || !response.ok) {
        throw new BackendTransportError(kind, `chat backend returned ${lastStatus || 'unknown'}`, {
          status: lastStatus || 0,
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
