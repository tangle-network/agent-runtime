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
  /**
   * Per-attempt wall-clock deadline in ms. If a single fetch attempt does
   * not return headers within this window the attempt is aborted and
   * retried. Default 120000 (2 min). Without this a hung upstream blocks
   * the attempt indefinitely — observed in production as a 15-minute
   * `fetch failed` that burned an entire eval persona. Set to 0 to disable.
   */
  requestTimeoutMs?: number
}

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const

function pickRetryDelayMs(attempt: number, policy: Required<BackendRetryPolicy>): number {
  const exp = policy.initialBackoffMs * 2 ** (attempt - 1)
  const capped = Math.min(exp, policy.maxBackoffMs)
  const jitter = capped * policy.jitter * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(capped + jitter))
}

/**
 * Derive a per-attempt AbortSignal that fires when EITHER the caller's
 * signal aborts OR `timeoutMs` elapses. `dispose()` clears the timer so a
 * completed attempt doesn't leak a pending timeout. `timeoutMs <= 0`
 * disables the deadline (caller signal still propagates).
 */
function withTimeout(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  if (timeoutMs <= 0) {
    return { signal: callerSignal ?? new AbortController().signal, dispose: () => undefined }
  }
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  )
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }
  const onCallerAbort = () => controller.abort(callerSignal?.reason ?? new Error('aborted'))
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    },
  }
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
    requestTimeoutMs: options.retry?.requestTimeoutMs ?? 120_000,
  }
  return {
    kind,
    start(_input, context) {
      return newRuntimeSession(kind, context.requestedSessionId)
    },
    async *stream(input, context) {
      const url = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`
      // `stream_options.include_usage` instructs OpenAI-compatible providers
      // (and the Tangle Router) to emit a final usage chunk in the SSE stream.
      // Without this the response carries no token counts and every downstream
      // ledger reads zero. Providers that don't recognize the field ignore it.
      const requestBody = JSON.stringify({
        model: options.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: input.messages ?? [
          { role: 'user', content: input.message ?? context.task.intent },
        ],
      })
      let response: Response | undefined
      let lastStatus = 0
      // The last thrown transport error (timeout abort, DNS / connection
      // failure). Network throws are retryable just like 5xx — without this
      // a `fetch failed` propagated immediately and burned the attempt.
      let lastThrown: unknown
      for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
        lastThrown = undefined
        // Per-attempt deadline: abort a hung upstream instead of waiting
        // forever. Linked to context.signal so a caller cancel still wins.
        const attemptSignal = withTimeout(context.signal, retryPolicy.requestTimeoutMs)
        try {
          response = await fetcher(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: requestBody,
            signal: attemptSignal.signal,
          })
        } catch (err) {
          attemptSignal.dispose()
          // A caller-initiated abort is terminal — do not retry it.
          if (context.signal?.aborted) throw err
          lastThrown = err
          response = undefined
          if (attempt === retryPolicy.maxAttempts) break
          await sleep(pickRetryDelayMs(attempt, retryPolicy), context.signal)
          continue
        }
        attemptSignal.dispose()
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
      if (!response) {
        const reason = lastThrown instanceof Error ? lastThrown.message : String(lastThrown)
        throw new BackendTransportError(
          kind,
          `chat backend unreachable after ${retryPolicy.maxAttempts} attempts: ${reason}`,
          { status: 0 },
        )
      }
      if (!response.ok) {
        throw new BackendTransportError(kind, `chat backend returned ${lastStatus || 'unknown'}`, {
          status: lastStatus || 0,
        })
      }
      yield* streamResponseEvents(response, context, options.model)
    },
  }
}

/**
 * Token usage accumulated across an SSE stream. OpenAI emits a single final
 * `usage` chunk; Anthropic emits `input_tokens` on `message_start` and
 * `output_tokens` on the terminal `message_delta`. We accept both — and the
 * router proxy may forward either shape depending on which upstream answered.
 */
interface StreamUsageAccumulator {
  tokensIn?: number
  tokensOut?: number
  model?: string
  finishReason?: string
  saw: boolean
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
    // `@tangle-network/sandbox` `box.streamTask` emits `message.part.updated`
    // with a nested part: `{ type: 'message.part.updated', data: { part:
    // { type: 'text', text: '…' } } }`. Walk into `data.part.text` so the
    // canonical sandbox-SDK shape produces a `text_delta` natively — no
    // per-product `mapEvent` shim required. Tool parts are picked up by
    // the `tool_call` / `tool_result` branches below; non-text parts here
    // fall through to `undefined` (the consumer can opt in via `mapEvent`).
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
  requestedModel: string,
): AsyncIterable<RuntimeStreamEvent> {
  const body = response.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const usage: StreamUsageAccumulator = { saw: false }
  const startedAt = Date.now()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    for (const event of drainStreamBuffer(false)) yield event
  }
  buffer += decoder.decode().replace(/\r\n/g, '\n')
  for (const event of drainStreamBuffer(true)) yield event
  if (buffer.trim()) {
    const event = parseStreamChunk(buffer, context, usage)
    if (event) yield event
  }
  // Synthesize a single `llm_call` event from accumulated usage. We only emit
  // when the upstream actually reported tokens — silent zeros would corrupt
  // every cost ledger that observes the stream. Consumers that need to detect
  // missing usage can check `tokensIn === undefined`.
  if (usage.saw) {
    yield {
      type: 'llm_call',
      task: context.task,
      session: context.session,
      model: usage.model ?? requestedModel,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      // `costUsd` is intentionally absent — pricing tables live in consumers
      // (agent-eval's `estimateCost`, MetricsCollector). Emitting a wrong
      // number here is worse than emitting none.
      latencyMs: Date.now() - startedAt,
      finishReason: usage.finishReason,
      timestamp: nowIso(),
    }
  }

  function* drainStreamBuffer(flush: boolean): Iterable<RuntimeStreamEvent> {
    for (;;) {
      const sseBoundary = buffer.indexOf('\n\n')
      if (sseBoundary >= 0) {
        const chunk = buffer.slice(0, sseBoundary)
        buffer = buffer.slice(sseBoundary + 2)
        const event = parseStreamChunk(chunk, context, usage)
        if (event) yield event
        continue
      }

      const newline = buffer.indexOf('\n')
      if (newline >= 0 && !buffer.slice(0, newline).startsWith('data:')) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const event = parseStreamChunk(line, context, usage)
        if (event) yield event
        continue
      }

      if (flush && buffer.trim() && !buffer.trimStart().startsWith('data:')) {
        const line = buffer
        buffer = ''
        const event = parseStreamChunk(line, context, usage)
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
  usage: StreamUsageAccumulator,
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
    captureStreamUsage(parsed, usage)
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
    // Anthropic shape: `content_block_delta` carries `delta.text` for streamed
    // text. The router proxies these through verbatim, so handle them here.
    if (stringValue(parsed.type) === 'content_block_delta') {
      const d = parsed.delta as Record<string, unknown> | undefined
      const text = stringValue(d?.text)
      if (text) {
        return {
          type: 'text_delta',
          task: context.task,
          session: context.session,
          text,
          timestamp: nowIso(),
        }
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

/**
 * Accumulate token usage from any SSE chunk shape the router may emit.
 *
 *  - OpenAI: a final chunk before `[DONE]` with `{ usage: { prompt_tokens,
 *    completion_tokens, total_tokens } }` and (often) empty `choices`. The
 *    `model` field is on every chunk and the last `choices[0].finish_reason`
 *    carries the stop reason.
 *  - Anthropic: `message_start` carries `message.model` and
 *    `message.usage.input_tokens`. The terminal `message_delta` carries
 *    `usage.output_tokens` and `delta.stop_reason`.
 */
function captureStreamUsage(parsed: Record<string, unknown>, usage: StreamUsageAccumulator): void {
  const model = stringValue(parsed.model)
  if (model && !usage.model) usage.model = model

  const openAiUsage = parsed.usage as Record<string, unknown> | undefined
  if (openAiUsage && typeof openAiUsage === 'object') {
    const promptTokens = numberValue(openAiUsage.prompt_tokens)
    const completionTokens = numberValue(openAiUsage.completion_tokens)
    const inputTokens = numberValue(openAiUsage.input_tokens)
    const outputTokens = numberValue(openAiUsage.output_tokens)
    if (promptTokens !== undefined) {
      usage.tokensIn = promptTokens
      usage.saw = true
    } else if (inputTokens !== undefined) {
      usage.tokensIn = (usage.tokensIn ?? 0) + inputTokens
      usage.saw = true
    }
    if (completionTokens !== undefined) {
      usage.tokensOut = completionTokens
      usage.saw = true
    } else if (outputTokens !== undefined) {
      usage.tokensOut = (usage.tokensOut ?? 0) + outputTokens
      usage.saw = true
    }
  }

  const type = stringValue(parsed.type)
  if (type === 'message_start') {
    const message = parsed.message as Record<string, unknown> | undefined
    const messageModel = stringValue(message?.model)
    if (messageModel && !usage.model) usage.model = messageModel
    const messageUsage = message?.usage as Record<string, unknown> | undefined
    const inputTokens = numberValue(messageUsage?.input_tokens)
    if (inputTokens !== undefined) {
      usage.tokensIn = inputTokens
      usage.saw = true
    }
    const outputTokens = numberValue(messageUsage?.output_tokens)
    if (outputTokens !== undefined) {
      usage.tokensOut = (usage.tokensOut ?? 0) + outputTokens
      usage.saw = true
    }
  }
  if (type === 'message_delta') {
    const delta = parsed.delta as Record<string, unknown> | undefined
    const stopReason = stringValue(delta?.stop_reason)
    if (stopReason) usage.finishReason = stopReason
  }

  const choices = parsed.choices
  if (Array.isArray(choices)) {
    const finishReason = stringValue(
      (choices[0] as Record<string, unknown> | undefined)?.finish_reason,
    )
    if (finishReason) usage.finishReason = finishReason
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
