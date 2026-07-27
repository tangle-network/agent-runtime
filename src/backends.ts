/**
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
 *
 * @stable
 */

import { BackendTransportError } from './errors'
import { newRuntimeSession, nowIso, touchSession } from './sessions'
import type {
  AgentBackendContext,
  AgentBackendInput,
  AgentExecutionBackend,
  OpenAIChatResponseFormat,
  OpenAIChatTool,
  OpenAIChatToolChoice,
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

/**
 *
 * OpenAI-compat streaming backend. Routes `runAgentTaskStream` through any
 * `POST /chat/completions` endpoint that speaks OpenAI's SSE protocol —
 * Tangle Router, OpenAI direct, OpenRouter, Groq, DeepSeek, Together. The
 * router also fronts Anthropic models in Anthropic-native SSE shape; this
 * backend handles both.
 *
 * ### Tool calls
 *
 * Pass `tools` (and optionally `toolChoice`) to forward an OpenAI Chat
 * Completions `tools[]` array on every request. Streamed `tool_call` chunks
 * are buffered until the model finalizes them (either `finish_reason:
 * 'tool_calls'` for OpenAI shape or a `content_block_stop` for Anthropic
 * `tool_use` blocks proxied through the router), then emitted as a single
 * `tool_call` RuntimeStreamEvent with the assembled `args`.
 *
 * The backend does NOT execute tools — it surfaces calls for the caller's
 * own dispatcher (typically the product's MCP / sandbox runtime) to fulfill
 * and feed back as a subsequent `messages` turn. This keeps the transport
 * thin and lets the agent host own tool dispatch policy.
 *
 * ### Fail-loud errors
 *
 * Non-success HTTP responses (4xx/5xx) and exhausted retry budgets throw
 * `BackendTransportError` from inside the `stream()` generator. The runtime
 * catches the throw, yields a `backend_error` with a typed `error` field
 * (`kind`, `status`, truncated `body`) and a terminal `final` event with
 * `status: 'failed'` carrying the same detail. Consumers MUST map
 * `final.error` onto their `RunRecord.error` — silently treating an empty
 * `finalText` as "agent produced nothing" hides credit exhaustion, auth
 * failure, and upstream outages.
 *
 * @stable
 */
export function createOpenAICompatibleBackend<
  TInput extends AgentBackendInput = AgentBackendInput,
>(options: {
  apiKey: string
  baseUrl: string
  model: string
  kind?: string
  /**
   * OpenAI Chat Completions `tools[]` definitions surfaced to the model on
   * every request. Omit to send a tool-free request (existing behavior).
   * The runtime makes no assumption about the dispatcher — calls stream out
   * as `tool_call` events and the caller is responsible for executing them
   * and feeding `tool_result` messages back on a follow-up turn.
   */
  tools?: ReadonlyArray<OpenAIChatTool>
  /**
   * OpenAI Chat Completions `tool_choice`. Default `undefined` (request
   * omits the field; provider falls back to its own default — typically
   * `'auto'`).
   */
  toolChoice?: OpenAIChatToolChoice
  /**
   * OpenAI Chat Completions `response_format`. Omit for provider default text.
   */
  responseFormat?: OpenAIChatResponseFormat
  /** OpenAI Chat Completions `temperature`. Omit for provider default. */
  temperature?: number
  /** Maximum completion tokens, sent as OpenAI-compatible `max_tokens`. Omit for provider default. */
  maxTokens?: number
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
      const bodyPayload: Record<string, unknown> = {
        model: options.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: input.messages ?? [
          { role: 'user', content: input.message ?? context.task.intent },
        ],
      }
      if (options.tools && options.tools.length > 0) {
        bodyPayload.tools = options.tools
        if (options.toolChoice !== undefined) bodyPayload.tool_choice = options.toolChoice
      }
      if (options.responseFormat !== undefined) {
        bodyPayload.response_format = options.responseFormat
      }
      if (options.temperature !== undefined) {
        bodyPayload.temperature = options.temperature
      }
      if (options.maxTokens !== undefined) {
        bodyPayload.max_tokens = options.maxTokens
      }
      const requestBody = JSON.stringify(bodyPayload)
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
              // Cross-gateway forwarding: when this call is part of a
              // multi-agent conversation, the runner stamps run/turn/
              // depth/forwarded-auth headers onto the context. They flow
              // through to the downstream gateway verbatim so the original
              // user gets billed, the recursion depth stays bounded, and
              // the trace correlates across hops.
              ...(context.propagatedHeaders ?? {}),
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
        // Capture the upstream body so the operator sees *why* the call
        // failed (e.g. `free_tier_limit`, `invalid_api_key`,
        // `model_not_found`). Truncate aggressively — HTML error pages from a
        // misconfigured proxy can be megabytes and would otherwise bloat
        // every persisted event. Best-effort: if body reading throws we
        // still surface the status code.
        let body: string | undefined
        try {
          const raw = await response.text()
          body = raw.length > MAX_ERROR_BODY_BYTES ? `${raw.slice(0, MAX_ERROR_BODY_BYTES)}…` : raw
        } catch {
          body = undefined
        }
        throw new BackendTransportError(kind, `chat backend returned ${lastStatus || 'unknown'}`, {
          status: lastStatus || 0,
          body,
        })
      }
      yield* streamResponseEvents(response, context, options.model)
    },
  }
}

/**
 * Cap the captured error body. 2 KiB is enough to carry a JSON error envelope
 * with a structured `code`/`message` payload (the router returns ~150 bytes
 * for a free-tier denial; OpenAI returns ~300 bytes for invalid auth) without
 * letting an HTML error page balloon persisted events.
 */
const MAX_ERROR_BODY_BYTES = 2048

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
    // `@tangle-network/sandbox` `box.streamPrompt` emits `message.part.updated`
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
  // Tool-call assembly is stateful across SSE chunks: both OpenAI and
  // Anthropic streamed `arguments`/`partial_json` incrementally and the
  // final event is only safe to emit once we see a `finish_reason:
  // 'tool_calls'` or `content_block_stop` for the relevant index.
  const toolCalls: ToolCallAccumulator = new Map()
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
    for (const event of parseStreamChunk(buffer, context, usage, toolCalls)) yield event
  }
  // Flush any tool calls the model never closed via `finish_reason` — the
  // upstream may have terminated the stream without a terminal chunk (e.g.
  // when the proxy proactively forwards `[DONE]`). Emitting these here is
  // strictly safer than silently dropping a tool call the agent intended.
  for (const event of flushPendingToolCalls(toolCalls, context)) yield event
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
        for (const event of parseStreamChunk(chunk, context, usage, toolCalls)) yield event
        continue
      }

      const newline = buffer.indexOf('\n')
      if (newline >= 0 && !buffer.slice(0, newline).startsWith('data:')) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        for (const event of parseStreamChunk(line, context, usage, toolCalls)) yield event
        continue
      }

      if (flush && buffer.trim() && !buffer.trimStart().startsWith('data:')) {
        const line = buffer
        buffer = ''
        for (const event of parseStreamChunk(line, context, usage, toolCalls)) yield event
        continue
      }

      break
    }
  }
}

/**
 * Per-tool-call accumulator. Keyed by either OpenAI `index` (cast to string)
 * or Anthropic `content_block` `index`. Holds the streamed identifier, name,
 * and string-form `arguments` so we can emit a single typed `tool_call`
 * event once the stream signals the call is finalized.
 */
type ToolCallAccumulator = Map<
  string,
  {
    id?: string
    name?: string
    /** Accumulated JSON-string `arguments` / `input` payload. */
    argsRaw: string
    /** Source format: OpenAI delta vs Anthropic `tool_use` block. */
    source: 'openai' | 'anthropic'
    /** Set true once the model signals this call is complete. */
    finalized: boolean
  }
>

function* parseStreamChunk(
  chunk: string,
  context: AgentBackendContext,
  usage: StreamUsageAccumulator,
  toolCalls: ToolCallAccumulator,
): Iterable<RuntimeStreamEvent> {
  const lines = chunk.split(/\r?\n/)
  const dataLines = lines.filter((line) => line.startsWith('data:'))
  if (
    dataLines.length === 0 &&
    lines.every((line) => {
      const trimmed = line.trim()
      return trimmed.length === 0 || trimmed.startsWith(':')
    })
  ) {
    return
  }
  const data =
    dataLines.length > 0
      ? dataLines.map((line) => line.slice(5).trimStart()).join('\n')
      : chunk.trim()
  if (!data || data === '[DONE]') return
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(data) as Record<string, unknown>
  } catch {
    yield {
      type: 'text_delta',
      task: context.task,
      session: context.session,
      text: data,
      timestamp: nowIso(),
    }
    return
  }
  captureStreamUsage(parsed, usage)
  const choices = parsed.choices
  const choice = Array.isArray(choices)
    ? (choices[0] as Record<string, unknown> | undefined)
    : undefined
  const delta = choice?.delta as Record<string, unknown> | undefined
  const message = choice?.message as Record<string, unknown> | undefined

  // ── OpenAI streamed `tool_calls` deltas ─────────────────────────────
  const deltaToolCalls = delta?.tool_calls
  if (Array.isArray(deltaToolCalls)) {
    for (const tc of deltaToolCalls) {
      if (!tc || typeof tc !== 'object') continue
      const rec = tc as Record<string, unknown>
      const id = stringValue(rec.id)
      const key = deltaToolCallKey(rec, id, toolCalls)
      const acc = toolCalls.get(key) ?? { argsRaw: '', source: 'openai' as const, finalized: false }
      if (id) acc.id = id
      const fn = rec.function as Record<string, unknown> | undefined
      const name = stringValue(fn?.name)
      if (name) acc.name = name
      const args = stringValue(fn?.arguments)
      if (args) acc.argsRaw += args
      toolCalls.set(key, acc)
    }
  }
  // `message.tool_calls` is the non-streamed shape — the model returned a
  // complete tool call in one chunk. Treat the whole array as terminal.
  const messageToolCalls = message?.tool_calls
  if (Array.isArray(messageToolCalls)) {
    for (const tc of messageToolCalls) {
      if (!tc || typeof tc !== 'object') continue
      const rec = tc as Record<string, unknown>
      const fn = rec.function as Record<string, unknown> | undefined
      const idx = numberValue(rec.index) ?? messageToolCalls.indexOf(tc)
      const key = `openai:${idx}`
      const acc = toolCalls.get(key) ?? { argsRaw: '', source: 'openai' as const, finalized: false }
      const id = stringValue(rec.id)
      if (id) acc.id = id
      const name = stringValue(fn?.name)
      if (name) acc.name = name
      const args = stringValue(fn?.arguments)
      if (args) acc.argsRaw += args
      acc.finalized = true
      toolCalls.set(key, acc)
    }
  }

  const finishReason = stringValue(choice?.finish_reason)
  if (finishReason === 'tool_calls') {
    // Model signaled it's done streaming tool calls — flush every OpenAI-
    // sourced pending entry. Subsequent chunks (usage, [DONE]) won't add
    // more.
    for (const [key, acc] of toolCalls) {
      if (acc.source === 'openai' && !acc.finalized) acc.finalized = true
      toolCalls.set(key, acc)
    }
  }

  // ── Anthropic shape (proxied through router) ────────────────────────
  const eventType = stringValue(parsed.type)
  if (eventType === 'content_block_start') {
    const block = parsed.content_block as Record<string, unknown> | undefined
    if (block && stringValue(block.type) === 'tool_use') {
      const idx = numberValue(parsed.index) ?? 0
      const key = `anthropic:${idx}`
      toolCalls.set(key, {
        id: stringValue(block.id),
        name: stringValue(block.name),
        argsRaw: '',
        source: 'anthropic',
        finalized: false,
      })
    }
  }
  if (eventType === 'content_block_delta') {
    const d = parsed.delta as Record<string, unknown> | undefined
    const dType = stringValue(d?.type)
    if (dType === 'input_json_delta') {
      const idx = numberValue(parsed.index) ?? 0
      const key = `anthropic:${idx}`
      const acc = toolCalls.get(key)
      if (acc) {
        const partial = stringValue(d?.partial_json) ?? ''
        acc.argsRaw += partial
        toolCalls.set(key, acc)
      }
    } else {
      const text = stringValue(d?.text)
      if (text) {
        yield {
          type: 'text_delta',
          task: context.task,
          session: context.session,
          text,
          timestamp: nowIso(),
        }
      }
    }
  }
  if (eventType === 'content_block_stop') {
    const idx = numberValue(parsed.index) ?? 0
    const key = `anthropic:${idx}`
    const acc = toolCalls.get(key)
    if (acc) {
      acc.finalized = true
      toolCalls.set(key, acc)
    }
  }

  // Emit any tool calls that just became finalized. Done eagerly per-chunk so
  // consumers see the call as soon as it's safe — the analyst loop watches
  // `tool_call` events for delegation-pattern detection.
  for (const event of drainFinalizedToolCalls(toolCalls, context)) yield event

  // ── Text deltas ──────────────────────────────────────────────────────
  const text =
    stringValue(delta?.content) ?? stringValue(message?.content) ?? stringValue(parsed.text)
  if (text) {
    yield {
      type: 'text_delta',
      task: context.task,
      session: context.session,
      text,
      timestamp: nowIso(),
    }
    return
  }
  const mapped = mapCommonBackendEvent(parsed, context)
  if (mapped) yield mapped
}

function* drainFinalizedToolCalls(
  toolCalls: ToolCallAccumulator,
  context: AgentBackendContext,
): Iterable<RuntimeStreamEvent> {
  for (const [key, acc] of toolCalls) {
    if (!acc.finalized) continue
    toolCalls.delete(key)
    yield buildToolCallEvent(acc, context)
  }
}

function* flushPendingToolCalls(
  toolCalls: ToolCallAccumulator,
  context: AgentBackendContext,
): Iterable<RuntimeStreamEvent> {
  for (const [key, acc] of toolCalls) {
    toolCalls.delete(key)
    yield buildToolCallEvent(acc, context)
  }
}

/**
 * The accumulator key one streamed `delta.tool_calls[]` entry belongs to.
 *
 * OpenAI's streaming contract puts `index` on every fragment, so fragments of
 * the same call concatenate under `openai:<index>`. Some OpenAI-COMPATIBLE
 * gateways do not: the Tangle router's Gemini lane emits N COMPLETE tool calls
 * inside a single delta, each with a distinct `id` and no `index` at all.
 * Defaulting those to index 0 concatenated every call's `arguments` into one
 * string, which then failed `JSON.parse` and was surfaced as a raw string — so
 * a turn that asked for six deliverables silently produced none.
 *
 * Resolution order:
 *   1. `index` present  → spec path, key by index (cross-delta fragments join).
 *   2. `id` present     → key by id; distinct ids are distinct calls, and a
 *                         repeated id still concatenates correctly.
 *   3. neither          → an argument-only continuation fragment; append to the
 *                         last-OPENED unfinalized OpenAI entry. `Map` iteration
 *                         is insertion-ordered and `set` on an existing key does
 *                         not reorder, so this is the most recently STARTED call
 *                         still taking arguments — which is the one a gateway
 *                         streaming calls sequentially is continuing.
 */
function deltaToolCallKey(
  rec: Record<string, unknown>,
  id: string | undefined,
  toolCalls: ToolCallAccumulator,
): string {
  const idx = numberValue(rec.index)
  if (idx !== undefined) return `openai:${idx}`
  if (id) return `openai:id:${id}`
  let last: string | undefined
  for (const [key, acc] of toolCalls) {
    if (acc.source === 'openai' && !acc.finalized) last = key
  }
  return last ?? 'openai:0'
}

function buildToolCallEvent(
  acc: { id?: string; name?: string; argsRaw: string; source: 'openai' | 'anthropic' },
  context: AgentBackendContext,
): RuntimeStreamEvent {
  // `argsRaw` is JSON-string by the provider contract (OpenAI streams an
  // escaped JSON string; Anthropic streams `partial_json` chunks). Parse
  // best-effort — surface the raw string if parsing fails so downstream
  // doesn't lose the call entirely.
  let args: unknown = acc.argsRaw
  if (acc.argsRaw.length > 0) {
    try {
      args = JSON.parse(acc.argsRaw)
    } catch {
      args = acc.argsRaw
    }
  } else {
    args = {}
  }
  return {
    type: 'tool_call',
    task: context.task,
    session: context.session,
    toolName: acc.name ?? 'tool',
    toolCallId: acc.id,
    args,
    timestamp: nowIso(),
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
