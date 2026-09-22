/**
 * OTEL span exporter — streams LoopTraceEvents to an OTLP/HTTP collector.
 *
 * Reads OTEL_EXPORTER_OTLP_ENDPOINT + OTEL_EXPORTER_OTLP_HEADERS from env
 * when no explicit config is given. Keeps the runtime dep-free from
 * @opentelemetry/sdk-trace-base — minimal OTLP/JSON serializer.
 *
 * The exporter accepts both raw OtelSpan objects and LoopTraceEvents
 * (which get converted to OTLP spans automatically).
 */

import { createHash } from 'node:crypto'
import { type RuntimeTelemetryOptions, sanitizeRuntimeStreamEvent } from './sanitize'
import type { RuntimeStreamEvent } from './types'

export interface OtelExportConfig {
  /** OTLP endpoint. Reads OTEL_EXPORTER_OTLP_ENDPOINT env by default. */
  endpoint?: string
  /** OTLP headers. Reads OTEL_EXPORTER_OTLP_HEADERS env by default. */
  headers?: Record<string, string>
  /** Batch size before flush. Default 64. */
  batchSize?: number
  /** Flush interval ms. Default 5000. */
  flushIntervalMs?: number
  /** Maximum spans retained across queued and active exports. Default 2048. */
  maxQueueSize?: number
  /** Initial retry delay after a failed automatic export. Default 1000ms. */
  retryInitialDelayMs?: number
  /** Maximum retry delay after repeated failures. Default 30000ms. */
  retryMaxDelayMs?: number
  /** Deadline for the request and response body. Default 10000ms. */
  requestTimeoutMs?: number
  /** Maximum response body size. Default 65536 bytes. */
  maxResponseBytes?: number
  /** Called when a new span is dropped because the queue is full. */
  onDrop?: (event: OtelDropEvent) => void
  /** Resource attributes stamped on every export. */
  resourceAttributes?: Record<string, string | number | boolean>
  /** Service name. Default 'agent-runtime'. */
  serviceName?: string
}

export interface OtelDropEvent {
  readonly reason: 'queue_full'
  readonly droppedCount: 1
  readonly totalDropped: number
  readonly queueSize: number
  readonly maxQueueSize: number
}

/** Lifetime delivery totals observed when an explicit flush settles. */
export interface OtelFlushResult {
  /** True only when every submitted span was confirmed and none were dropped. */
  readonly succeeded: boolean
  readonly deliveredSpans: number
  readonly undeliveredSpans: number
  readonly droppedSpans: number
  readonly error?: string
}

export interface OtelExporter {
  /** Queue a valid OTLP span. Throws after shutdown or for malformed input. */
  exportSpan(span: OtelSpan): void
  /** Flush pending spans and report confirmed, retained, and dropped totals. */
  flush(): Promise<OtelFlushResult>
  /** Stop accepting spans and report delivery of every pending span. */
  shutdown(): Promise<OtelFlushResult>
}

export interface OtelSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind?: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes?: OtelAttribute[]
  status?: { code: number; message?: string }
}

export interface OtelAttribute {
  key: string
  value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean }
}

interface OtlpResourceSpans {
  resource: { attributes: OtelAttribute[] }
  scopeSpans: Array<{ scope: { name: string; version?: string }; spans: OtelSpan[] }>
}

interface OtlpExport {
  resourceSpans: OtlpResourceSpans[]
}

const SCOPE = { name: '@tangle-network/agent-runtime' }
const TRACE_ID = /^[0-9a-f]{32}$/
const SPAN_ID = /^[0-9a-f]{16}$/
const ZERO_TRACE_ID = '0'.repeat(32)
const ZERO_SPAN_ID = '0'.repeat(16)

/**
 * Current (non-deprecated) OpenTelemetry GenAI semantic-convention keys.
 * Registry: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/
 * NB: `gen_ai.system` / `gen_ai.usage.prompt_tokens` / `completion_tokens` are
 * deprecated. Emit the current input/output token keys instead.
 */
const GEN_AI = {
  operation: 'gen_ai.operation.name',
  agentName: 'gen_ai.agent.name',
  conversationId: 'gen_ai.conversation.id',
  inputTokens: 'gen_ai.usage.input_tokens',
  outputTokens: 'gen_ai.usage.output_tokens',
} as const

/**
 * Create an OTEL exporter. Returns undefined when no endpoint is configured.
 */
export function createOtelExporter(config?: OtelExportConfig): OtelExporter | undefined {
  const resolvedEndpoint =
    config?.endpoint ??
    (typeof process !== 'undefined' ? process.env.OTEL_EXPORTER_OTLP_ENDPOINT : undefined)
  if (!resolvedEndpoint) return undefined
  const endpoint: string = resolvedEndpoint

  const headers = { ...(config?.headers ?? parseHeadersFromEnv()) }
  const batchSize = config?.batchSize ?? 64
  const flushIntervalMs = config?.flushIntervalMs ?? 5000
  const maxQueueSize = config?.maxQueueSize ?? 2048
  const retryInitialDelayMs = config?.retryInitialDelayMs ?? 1000
  const retryMaxDelayMs = config?.retryMaxDelayMs ?? 30000
  const requestTimeoutMs = config?.requestTimeoutMs ?? 10000
  const maxResponseBytes = config?.maxResponseBytes ?? 65536
  assertPositiveInteger(batchSize, 'batchSize')
  assertPositiveInteger(flushIntervalMs, 'flushIntervalMs')
  assertPositiveInteger(maxQueueSize, 'maxQueueSize')
  assertPositiveInteger(retryInitialDelayMs, 'retryInitialDelayMs')
  assertPositiveInteger(retryMaxDelayMs, 'retryMaxDelayMs')
  assertPositiveInteger(requestTimeoutMs, 'requestTimeoutMs')
  assertPositiveInteger(maxResponseBytes, 'maxResponseBytes')
  if (retryMaxDelayMs < retryInitialDelayMs) {
    throw new Error('OTLP exporter retryMaxDelayMs must be at least retryInitialDelayMs')
  }
  const serviceName = config?.serviceName ?? 'agent-runtime'
  if (!serviceName.trim()) throw new Error('OTLP exporter serviceName must be non-empty')
  const resourceAttrs = { ...(config?.resourceAttributes ?? {}) }

  const pending: OtelSpan[] = []
  let intervalTimer: ReturnType<typeof setInterval> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let inFlight: Promise<void> | undefined
  let inFlightBatch: OtelSpan[] | undefined
  let activeTransport: Promise<void> | undefined
  let consecutiveFailures = 0
  let totalDelivered = 0
  let totalDropped = 0

  const exporter: OtelExporter = {
    exportSpan(span: OtelSpan): void {
      if (stopped) throw new Error('OTLP exporter is shut down')
      assertExportableSpan(span)
      const queueSize = pending.length + (inFlightBatch?.length ?? 0)
      if (queueSize >= maxQueueSize) {
        totalDropped += 1
        notifyDrop(
          Object.freeze({
            reason: 'queue_full',
            droppedCount: 1,
            totalDropped,
            queueSize,
            maxQueueSize,
          }),
        )
        return
      }
      pending.push(snapshotOtelSpan(span))
      if (pending.length >= batchSize) {
        runAutomaticFlush()
      }
    },

    async flush(): Promise<OtelFlushResult> {
      return flushResult()
    },

    async shutdown(): Promise<OtelFlushResult> {
      stopped = true
      if (intervalTimer !== undefined) {
        clearInterval(intervalTimer)
        intervalTimer = undefined
      }
      clearRetryTimer()
      return flushResult()
    },
  }

  intervalTimer = setInterval(() => {
    if (pending.length > 0 && retryTimer === undefined && activeTransport === undefined) {
      runAutomaticFlush()
    }
  }, flushIntervalMs)
  if (typeof intervalTimer === 'object' && 'unref' in intervalTimer) {
    ;(intervalTimer as NodeJS.Timeout).unref()
  }

  function runAutomaticFlush(): void {
    if (activeTransport !== undefined) return
    void startFlush().catch(() => {
      // The retained batch is retried by scheduleRetry.
    })
  }

  function startFlush(): Promise<void> {
    if (inFlight) return inFlight
    if (activeTransport) {
      return Promise.reject(
        new Error('OTLP export cannot retry while a timed-out transport request remains in flight'),
      )
    }
    if (pending.length === 0) return Promise.resolve()
    const batch = pending.splice(0)
    inFlightBatch = batch
    const operation = send(batch)
      .then(() => {
        totalDelivered += batch.length
        consecutiveFailures = 0
        clearRetryTimer()
      })
      .catch((error: unknown) => {
        pending.unshift(...batch)
        consecutiveFailures += 1
        scheduleRetry()
        throw asError(error)
      })
      .finally(() => {
        if (inFlight === operation) {
          inFlight = undefined
          inFlightBatch = undefined
        }
        if (
          !stopped &&
          activeTransport === undefined &&
          retryTimer === undefined &&
          pending.length >= batchSize
        ) {
          runAutomaticFlush()
        }
      })
    inFlight = operation
    return operation
  }

  async function drain(): Promise<void> {
    clearRetryTimer()
    while (true) {
      if (pending.length === 0 && !inFlight) return
      await (inFlight ?? startFlush())
    }
  }

  async function flushResult(): Promise<OtelFlushResult> {
    let failure: Error | undefined
    try {
      await drain()
    } catch (cause) {
      failure = asError(cause)
    }
    const undeliveredSpans = pending.length + (inFlightBatch?.length ?? 0)
    const succeeded = failure === undefined && undeliveredSpans === 0 && totalDropped === 0
    const dropError =
      totalDropped > 0 ? `${totalDropped} span${totalDropped === 1 ? '' : 's'} dropped` : undefined
    return Object.freeze({
      succeeded,
      deliveredSpans: totalDelivered,
      undeliveredSpans,
      droppedSpans: totalDropped,
      ...(failure ? { error: failure.message } : dropError ? { error: dropError } : {}),
    })
  }

  function scheduleRetry(): void {
    if (stopped || retryTimer !== undefined || activeTransport !== undefined) return
    const exponent = Math.min(consecutiveFailures - 1, 30)
    const delayMs = Math.min(retryInitialDelayMs * 2 ** exponent, retryMaxDelayMs)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      runAutomaticFlush()
    }, delayMs)
    if (typeof retryTimer === 'object' && 'unref' in retryTimer) {
      ;(retryTimer as NodeJS.Timeout).unref()
    }
  }

  function clearRetryTimer(): void {
    if (retryTimer === undefined) return
    clearTimeout(retryTimer)
    retryTimer = undefined
  }

  function notifyDrop(event: OtelDropEvent): void {
    try {
      config?.onDrop?.(event)
    } catch {
      // Telemetry observation must not affect the application.
    }
  }

  async function send(batch: OtelSpan[]): Promise<void> {
    const body: OtlpExport = {
      resourceSpans: [
        {
          resource: {
            attributes: toAttributes({
              'service.name': serviceName,
              ...resourceAttrs,
            }),
          },
          scopeSpans: [{ scope: SCOPE, spans: batch }],
        },
      ],
    }
    const url = `${endpoint.replace(/\/+$/, '')}/v1/traces`
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const request = sendRequest(controller.signal).then(
      () => ({ kind: 'accepted' as const }),
      (cause: unknown) => ({ kind: 'failed' as const, error: asError(cause) }),
    )
    const trackedTransport = request.then(() => undefined)
    activeTransport = trackedTransport
    void trackedTransport.then(() => {
      if (activeTransport === trackedTransport) {
        activeTransport = undefined
        if (!stopped && !inFlight && pending.length > 0) scheduleRetry()
      }
    })
    const deadline = new Promise<{ kind: 'timeout'; error: Error }>((resolve) => {
      timeout = setTimeout(() => {
        const error = new Error(
          `OTLP export request to ${url} timed out after ${requestTimeoutMs}ms`,
        )
        controller.abort(error)
        resolve({ kind: 'timeout', error })
      }, requestTimeoutMs)
    })

    try {
      const outcome = await Promise.race([request, deadline])
      if (outcome.kind === 'failed' || outcome.kind === 'timeout') throw outcome.error
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      controller.abort()
    }

    async function sendRequest(signal: AbortSignal): Promise<void> {
      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
          redirect: 'error',
          signal,
        })
      } catch (cause) {
        throw new Error(`OTLP export request to ${url} failed: ${errorMessage(cause)}`, { cause })
      }
      await assertOtlpResponseAccepted(response, url, maxResponseBytes, signal)
    }
  }

  return exporter
}

async function assertOtlpResponseAccepted(
  response: Response,
  url: string,
  maxResponseBytes: number,
  signal: AbortSignal,
): Promise<void> {
  let responseBody: string
  try {
    responseBody = await readResponseBody(response, maxResponseBytes, signal)
  } catch (cause) {
    if (cause instanceof OtelResponseSizeError) throw cause
    throw new Error(`OTLP export to ${url} could not read the HTTP ${response.status} response`, {
      cause,
    })
  }

  const detail = responseBody.trim()
  if (!response.ok) {
    throw new Error(
      `OTLP export to ${url} was rejected with HTTP ${response.status}${
        detail ? `: ${detail.slice(0, 500)}` : ''
      }`,
    )
  }
  if (!detail) return

  let payload: unknown
  try {
    payload = JSON.parse(detail)
  } catch (cause) {
    throw new Error(`OTLP export to ${url} returned invalid JSON after HTTP ${response.status}`, {
      cause,
    })
  }
  if (!isRecord(payload)) {
    throw new Error(`OTLP export to ${url} returned a non-object response`)
  }

  const partialSuccess = payload.partialSuccess
  if (partialSuccess === undefined) return
  if (!isRecord(partialSuccess)) {
    throw new Error(`OTLP export to ${url} returned invalid partialSuccess metadata`)
  }

  const rejectedSpans = otlpUnsignedInteger(
    partialSuccess.rejectedSpans ?? '0',
    'partialSuccess.rejectedSpans',
  )
  const partialErrorMessage = partialSuccess.errorMessage
  if (partialErrorMessage !== undefined && typeof partialErrorMessage !== 'string') {
    throw new Error(`OTLP export to ${url} returned a non-string partialSuccess.errorMessage`)
  }
  if (rejectedSpans > 0n) {
    const message = partialErrorMessage?.trim()
      ? `: ${partialErrorMessage.trim().slice(0, 500)}`
      : ''
    throw new Error(
      `OTLP export to ${url} rejected ${rejectedSpans.toString()} spans despite HTTP ${response.status}${message}`,
    )
  }
}

class OtelResponseSizeError extends Error {}

async function readResponseBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let bytesRead = 0
  const cancelOnAbort = () => {
    void reader.cancel(signal.reason).catch(() => {})
  }
  signal.addEventListener('abort', cancelOnAbort, { once: true })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new OtelResponseSizeError(
          `OTLP response exceeded the ${maxBytes}-byte response limit`,
        )
      }
      body += decoder.decode(value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    signal.removeEventListener('abort', cancelOnAbort)
    reader.releaseLock()
  }
}

/**
 * Convert a LoopTraceEvent into an OtelSpan for export.
 */
export function loopEventToOtelSpan(
  event: {
    kind: string
    runId: string
    timestamp: number
    payload: object
  },
  traceId: string,
  parentSpanId?: string,
): OtelSpan {
  const spanId = generateSpanId()
  const attrs: Record<string, string | number | boolean> = {
    'loop.event_kind': event.kind,
    'loop.run_id': event.runId,
  }
  for (const [k, v] of Object.entries(event.payload)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      attrs[`loop.${k}`] = v
    }
  }
  const ts = msToNs(event.timestamp)
  return {
    traceId: otelTraceId(traceId),
    spanId,
    parentSpanId: parentSpanId ? otelSpanId(parentSpanId) : undefined,
    name: event.kind,
    kind: 1,
    startTimeUnixNano: ts,
    endTimeUnixNano: ts,
    attributes: toAttributes(attrs),
    status: { code: 1 },
  }
}

/**
 * Build a single flat OtelSpan whose attribute keys are emitted VERBATIM — no
 * `loop.` namespace. Use for non-loop spans (e.g. the intelligence per-run
 * span) whose keys ARE the downstream contract (`gen_ai.request.model`,
 * `tangle.sessionId`) and are exact-matched by readers. `loopEventToOtelSpan`
 * namespaces payload keys because loop payload fields are free-form; do not
 * reuse it for spans with contract keys.
 */
export function flatOtelSpan(
  name: string,
  attributes: Record<string, string | number | boolean>,
  traceId: string,
  timestampMs: number,
  parentSpanId?: string,
  endTimestampMs = timestampMs,
): OtelSpan {
  const start = msToNs(timestampMs)
  const end = msToNs(Math.max(timestampMs, endTimestampMs))
  return {
    traceId: otelTraceId(traceId),
    spanId: generateSpanId(),
    parentSpanId: parentSpanId ? otelSpanId(parentSpanId) : undefined,
    name,
    kind: 1,
    startTimeUnixNano: start,
    endTimeUnixNano: end,
    attributes: toAttributes(attributes),
    status: { code: 1 },
  }
}

export interface RuntimeEventOtelOptions extends RuntimeTelemetryOptions {
  /** Final customer redactor applied after the schema-aware runtime sanitizer. */
  redact?: (value: unknown) => unknown
}

function eventTimestampMs(event: RuntimeStreamEvent): number {
  if ('timestamp' in event && typeof event.timestamp === 'string') {
    const parsed = Date.parse(event.timestamp)
    if (Number.isFinite(parsed)) return parsed
    throw new Error(`runtime event timestamp is invalid: ${event.timestamp}`)
  }
  return Date.now()
}

function serialized(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function mcpIdentity(toolName: string): { server?: string; tool?: string } {
  if (!toolName.startsWith('mcp__')) return {}
  const [, server, ...toolParts] = toolName.split('__')
  return {
    ...(server ? { server } : {}),
    ...(toolParts.length > 0 ? { tool: toolParts.join('__') } : {}),
  }
}

/** Convert normalized runtime events into lossless, redacted child spans. */
export function buildRuntimeEventOtelSpans(
  events: ReadonlyArray<RuntimeStreamEvent>,
  traceId: string,
  parentSpanId?: string,
  options: RuntimeEventOtelOptions = {},
): OtelSpan[] {
  return events.map((event) => {
    const sanitized = sanitizeRuntimeStreamEvent(event, options)
    const safe = options.redact ? options.redact(sanitized) : sanitized
    const record =
      safe && typeof safe === 'object' && !Array.isArray(safe)
        ? (safe as Record<string, unknown>)
        : { value: safe }
    const attrs: Record<string, string | number | boolean> = {
      'tangle.runtime.event_type': event.type,
      'tangle.runtime.event': serialized(record),
    }
    let name = `tangle.runtime.${event.type}`

    if (event.type === 'tool_call' || event.type === 'tool_result') {
      name = `agent.${event.type}`
      attrs['tool.name'] = event.toolName
      if (event.toolCallId) attrs['tool.call_id'] = event.toolCallId
      const mcp = mcpIdentity(event.toolName)
      if (mcp.server) attrs['mcp.server'] = mcp.server
      if (mcp.tool) attrs['mcp.tool.name'] = mcp.tool
      const payload = event.type === 'tool_call' ? record.args : record.result
      if (payload !== undefined) {
        attrs[event.type === 'tool_call' ? 'tool.input' : 'tool.output'] = serialized(payload)
      }
    } else if (event.type === 'llm_call') {
      name = 'gen_ai.client.inference'
      attrs['gen_ai.request.model'] = event.model
      if (event.tokensIn !== undefined) attrs['gen_ai.usage.input_tokens'] = event.tokensIn
      if (event.tokensOut !== undefined) attrs['gen_ai.usage.output_tokens'] = event.tokensOut
      if (event.costUsd !== undefined) attrs['tangle.cost.usd'] = event.costUsd
      if (event.latencyMs !== undefined) attrs['tangle.latency_ms'] = event.latencyMs
      if (event.finishReason !== undefined)
        attrs['gen_ai.response.finish_reasons'] = event.finishReason
    } else if (event.type === 'turn_error') {
      attrs['error.type'] = event.error.kind
      attrs['error.message'] = event.message
    } else if (event.type === 'final') {
      attrs['tangle.outcome.status'] = event.status
      attrs['tangle.outcome.reason'] = event.reason
      if (event.error) {
        attrs['error.type'] = event.error.kind
        attrs['error.message'] = event.error.message
      }
    }

    const startMs = eventTimestampMs(event)
    const endMs =
      event.type === 'llm_call' && event.latencyMs !== undefined && Number.isFinite(event.latencyMs)
        ? startMs + event.latencyMs
        : startMs
    const span = flatOtelSpan(name, attrs, traceId, startMs, parentSpanId, endMs)
    if (event.type === 'turn_error' || (event.type === 'final' && event.status !== 'completed')) {
      span.status = { code: 2, message: attrs['error.message']?.toString() ?? event.type }
    }
    return span
  })
}

/**
 * Sink-neutral node in a reconstructed loop span tree. The root node's
 * `parentSpanId` is `undefined` — sinks decide how to parent it (the OTEL
 * mapper attaches the inherited delegation span; the delegation journal
 * leaves it as the tree root).
 */
export interface LoopSpanNode {
  spanId: string
  parentSpanId?: string
  /** `'loop'` | `'loop.round'` | `'loop.iteration'`. */
  name: string
  /** Topology level: loop root, plan round, or iteration branch. */
  kind: 'loop' | 'round' | 'branch'
  startMs: number
  endMs: number
  attrs: Record<string, string | number | boolean>
  /** True when the iteration carried an error — maps to OTEL status code 2. */
  error: boolean
}

/**
 * Build a nested, real-duration OTLP span tree for ONE loop run from its full
 * ordered `LoopTraceEvent` stream. Unlike `loopEventToOtelSpan` (one flat,
 * zero-duration span per event), this reconstructs the topology hierarchy a
 * GenAI trace viewer renders natively:
 *
 *   loop (invoke_workflow)
 *     └─ loop.round[k] (invoke_workflow)   ← tangle.loop.move.{kind,width,rationale}
 *          ├─ loop.iteration[i] (invoke_agent)  ← gen_ai.agent.name + usage + verdict + placement
 *          └─ …
 *
 * Attributes follow the current GenAI semconv (`gen_ai.*`) where they apply and
 * a namespaced `tangle.loop.*` / `tangle.cost.usd` extension for topology /
 * verdict / placement / cost (not yet standardized). Pure: feed it a buffered
 * per-runId event array (e.g. flushed on `loop.ended`) and export the result.
 */
export function buildLoopOtelSpans(
  events: ReadonlyArray<{ kind: string; runId: string; timestamp: number; payload: object }>,
  traceId: string,
  rootParentSpanId?: string,
): OtelSpan[] {
  const tid = otelTraceId(traceId)
  return buildLoopSpanNodes(events).map((node) => ({
    traceId: tid,
    spanId: otelSpanId(node.spanId),
    parentSpanId: node.parentSpanId
      ? otelSpanId(node.parentSpanId)
      : rootParentSpanId
        ? otelSpanId(rootParentSpanId)
        : undefined,
    name: node.name,
    kind: 1,
    startTimeUnixNano: msToNs(node.startMs),
    endTimeUnixNano: msToNs(node.endMs),
    attributes: toAttributes(node.attrs),
    status: { code: node.error ? 2 : 1 },
  }))
}

/**
 * Sink-neutral core behind {@link buildLoopOtelSpans}: reconstruct the
 * loop → round → branch span tree from one run's ordered `LoopTraceEvent`
 * stream. Consumed by the OTEL mapper above and by the MCP delegation
 * journal's compact trace tee — one topology reconstruction, two sinks.
 * Tolerates partial streams (a run that never reached `loop.ended` closes
 * at the last observed event's timestamp).
 */
export function buildLoopSpanNodes(
  events: ReadonlyArray<{ kind: string; runId: string; timestamp: number; payload: object }>,
): LoopSpanNode[] {
  if (events.length === 0) return []
  const out: LoopSpanNode[] = []
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined
  const rec = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : {}

  const started = events.find((e) => e.kind === 'loop.started')
  const ended = events.find((e) => e.kind === 'loop.ended')
  const runId = events[0]?.runId ?? ''
  const rootStart = started?.timestamp ?? events[0]!.timestamp
  const rootEnd = ended?.timestamp ?? events[events.length - 1]!.timestamp
  const rootId = generateSpanId()

  const make = (
    spanId: string,
    parentSpanId: string | undefined,
    name: string,
    kind: LoopSpanNode['kind'],
    startMs: number,
    endMs: number,
    attrs: Record<string, string | number | boolean>,
    error = false,
  ): LoopSpanNode => ({
    spanId,
    parentSpanId,
    name,
    kind,
    startMs,
    endMs,
    attrs,
    error,
  })

  // root
  const sp = rec(started?.payload)
  const rootAttrs: Record<string, string | number | boolean> = {
    [GEN_AI.operation]: 'invoke_workflow',
    [GEN_AI.conversationId]: runId,
    // Explicit run identity under the tangle namespace so a consuming system of
    // record (Tangle Intelligence's run spine) maps this span tree to one run
    // deterministically, instead of inferring it from the conversation id.
    'tangle.run.id': runId,
    'tangle.loop.driver': str(sp.driver) ?? 'driver',
  }
  if (Array.isArray(sp.agentRunNames) && sp.agentRunNames.length > 0) {
    rootAttrs['tangle.loop.agents'] = sp.agentRunNames.map(String).join(',')
    // Subject grain: the primary agent/profile this run drove. Lets the spine
    // group runs under the thing being worked on rather than one service-wide
    // bucket. `agentRunNames[0]` is the lead agent on a fan-out.
    rootAttrs['tangle.subject.key'] = String(sp.agentRunNames[0])
  }
  if (ended) {
    const ep = rec(ended.payload)
    const win = num(ep.winnerIterationIndex)
    if (win !== undefined) rootAttrs['tangle.loop.winner.iteration_index'] = win
    const cost = num(ep.totalCostUsd)
    if (cost !== undefined) rootAttrs['tangle.cost.usd'] = cost
    const dur = num(ep.durationMs)
    if (dur !== undefined) rootAttrs['tangle.loop.duration_ms'] = dur
    const iters = num(ep.iterations)
    if (iters !== undefined) rootAttrs['tangle.loop.iterations'] = iters
  }
  out.push(make(rootId, undefined, 'loop', 'loop', rootStart, rootEnd, rootAttrs))

  // rounds + iterations
  const iterStartTs = new Map<number, number>()
  const placementByIdx = new Map<number, Record<string, string>>()
  let currentRoundId: string | undefined
  let pendingRound:
    | { id: string; start: number; attrs: Record<string, string | number | boolean> }
    | undefined
  const flushRound = (endMs: number) => {
    if (!pendingRound) return
    out.push(
      make(
        pendingRound.id,
        rootId,
        'loop.round',
        'round',
        pendingRound.start,
        endMs,
        pendingRound.attrs,
      ),
    )
    pendingRound = undefined
  }

  for (const e of events) {
    const p = rec(e.payload)
    switch (e.kind) {
      case 'loop.plan': {
        flushRound(e.timestamp)
        const id = generateSpanId()
        const roundIdx = num(p.roundIndex) ?? 0
        const attrs: Record<string, string | number | boolean> = {
          [GEN_AI.operation]: 'invoke_workflow',
          'tangle.loop.round.index': roundIdx,
          'tangle.loop.move.kind': str(p.moveKind) ?? 'unknown',
          'tangle.loop.move.round': roundIdx,
          'tangle.loop.move.width': num(p.plannedCount) ?? 0,
        }
        const r = str(p.rationale)
        if (r) attrs['tangle.loop.move.rationale'] = r
        const parent = num(p.parentIndex)
        if (parent !== undefined) attrs['tangle.loop.move.parent_index'] = parent
        if (Array.isArray(p.childIndices) && p.childIndices.length > 0) {
          attrs['tangle.loop.move.child_indices'] = p.childIndices.map(String).join(',')
        }
        pendingRound = { id, start: e.timestamp, attrs }
        currentRoundId = id
        break
      }
      case 'loop.iteration.started': {
        const idx = num(p.iterationIndex)
        if (idx !== undefined) iterStartTs.set(idx, e.timestamp)
        break
      }
      case 'loop.iteration.dispatch': {
        const idx = num(p.iterationIndex)
        if (idx === undefined) break
        const place: Record<string, string> = {}
        const kind = str(p.placement)
        if (kind) place['tangle.loop.placement.kind'] = kind
        const sid = str(p.sandboxId)
        if (sid) place['tangle.sandbox.id'] = sid
        const fid = str(p.fleetId)
        if (fid) place['tangle.fleet.id'] = fid
        const mid = str(p.machineId)
        if (mid) place['tangle.machine.id'] = mid
        placementByIdx.set(idx, place)
        break
      }
      case 'loop.iteration.ended': {
        const idx = num(p.iterationIndex) ?? 0
        const start = iterStartTs.get(idx) ?? e.timestamp
        const err = str(p.error)
        const attrs: Record<string, string | number | boolean> = {
          [GEN_AI.operation]: 'invoke_agent',
          'tangle.loop.iteration.index': idx,
        }
        const agent = str(p.agentRunName)
        if (agent) attrs[GEN_AI.agentName] = agent
        const tu = rec(p.tokenUsage)
        const inTok = num(tu.input)
        if (inTok !== undefined) attrs[GEN_AI.inputTokens] = inTok
        const outTok = num(tu.output)
        if (outTok !== undefined) attrs[GEN_AI.outputTokens] = outTok
        const cost = num(p.costUsd)
        if (cost !== undefined) attrs['tangle.cost.usd'] = cost
        const verdict = rec(p.verdict)
        if (typeof verdict.valid === 'boolean') attrs['tangle.loop.verdict.valid'] = verdict.valid
        const score = num(verdict.score)
        if (score !== undefined) attrs['tangle.loop.verdict.score'] = score
        if (err) attrs['tangle.loop.error'] = err
        const gid = num(p.groupId)
        if (gid !== undefined) attrs['tangle.loop.iteration.group_id'] = gid
        const par = num(p.parentIndex)
        if (par !== undefined) attrs['tangle.loop.iteration.parent_index'] = par
        const dur = num(p.durationMs)
        if (dur !== undefined) attrs['tangle.loop.iteration.duration_ms'] = dur
        const preview = str(p.outputPreview)
        if (preview) attrs['tangle.loop.iteration.output_preview'] = preview
        Object.assign(attrs, placementByIdx.get(idx) ?? {})
        out.push(
          make(
            generateSpanId(),
            currentRoundId ?? rootId,
            'loop.iteration',
            'branch',
            start,
            e.timestamp,
            attrs,
            err !== undefined,
          ),
        )
        break
      }
      case 'loop.decision': {
        if (pendingRound) {
          const dec = str(p.decision)
          if (dec) pendingRound.attrs['tangle.loop.decision'] = dec
          flushRound(e.timestamp)
        }
        currentRoundId = undefined
        break
      }
    }
  }
  flushRound(rootEnd)
  return out
}

function parseHeadersFromEnv(): Record<string, string> {
  if (typeof process === 'undefined') return {}
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (key) out[key] = value
  }
  return out
}

function toAttributes(record: Record<string, string | number | boolean>): OtelAttribute[] {
  return Object.entries(record).map(([key, value]) => {
    if (!key) throw new Error('OTLP attribute key must be non-empty')
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`OTLP attribute ${key} must be finite`)
    }
    return {
      key,
      value:
        typeof value === 'number'
          ? Number.isInteger(value)
            ? { intValue: value.toString() }
            : { doubleValue: value }
          : typeof value === 'boolean'
            ? { boolValue: value }
            : { stringValue: value },
    }
  })
}

function msToNs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0 || ms > Number.MAX_SAFE_INTEGER) {
    throw new Error('OTLP timestamp must be a non-negative finite safe number of milliseconds')
  }
  const wholeMs = Math.floor(ms)
  const fractionalNs = Math.round((ms - wholeMs) * 1_000_000)
  return (BigInt(wholeMs) * 1_000_000n + BigInt(fractionalNs)).toString()
}

function otelSpanId(id: string): string {
  return otelId(id, SPAN_ID, ZERO_SPAN_ID, 16, 'span')
}

function otelTraceId(id: string): string {
  return otelId(id, TRACE_ID, ZERO_TRACE_ID, 32, 'trace')
}

function otelId(
  id: string,
  pattern: RegExp,
  zero: string,
  length: number,
  domain: 'trace' | 'span',
): string {
  const normalized = id.toLowerCase()
  if (pattern.test(normalized) && normalized !== zero) return normalized
  const hashed = createHash('sha256')
    .update(`${domain}\0${id}`, 'utf8')
    .digest('hex')
    .slice(0, length)
  return hashed === zero ? `${'0'.repeat(length - 1)}1` : hashed
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  const id = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return id === ZERO_SPAN_ID ? `${'0'.repeat(15)}1` : id
}

function snapshotOtelSpan(span: OtelSpan): OtelSpan {
  const attributes: OtelAttribute[] | undefined = span.attributes?.map((attribute) => {
    const snapshot: OtelAttribute = {
      key: attribute.key,
      value: { ...attribute.value },
    }
    Object.freeze(snapshot.value)
    return Object.freeze(snapshot)
  })
  if (attributes) Object.freeze(attributes)
  const snapshot: OtelSpan = {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
    name: span.name,
    ...(span.kind === undefined ? {} : { kind: span.kind }),
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    ...(attributes === undefined ? {} : { attributes }),
    ...(span.status === undefined ? {} : { status: Object.freeze({ ...span.status }) }),
  }
  return Object.freeze(snapshot)
}

function assertExportableSpan(span: OtelSpan): void {
  if (!span.name) throw new Error('OTLP span name must be non-empty')
  assertOtelId(span.traceId, TRACE_ID, ZERO_TRACE_ID, 'traceId')
  assertOtelId(span.spanId, SPAN_ID, ZERO_SPAN_ID, 'spanId')
  if (span.parentSpanId !== undefined) {
    assertOtelId(span.parentSpanId, SPAN_ID, ZERO_SPAN_ID, 'parentSpanId')
    if (span.parentSpanId === span.spanId) {
      throw new Error('OTLP span parentSpanId must differ from spanId')
    }
  }
  const start = unixNano(span.startTimeUnixNano, 'startTimeUnixNano')
  const end = unixNano(span.endTimeUnixNano, 'endTimeUnixNano')
  if (end < start)
    throw new Error('OTLP span endTimeUnixNano must be at or after startTimeUnixNano')
  if (span.kind !== undefined && (!Number.isInteger(span.kind) || span.kind < 0 || span.kind > 5)) {
    throw new Error('OTLP span kind must be an integer from 0 to 5')
  }
  if (
    span.status !== undefined &&
    (!Number.isInteger(span.status.code) || span.status.code < 0 || span.status.code > 2)
  ) {
    throw new Error('OTLP span status code must be 0, 1, or 2')
  }
  const keys = new Set<string>()
  for (const attribute of span.attributes ?? []) {
    if (!attribute.key) throw new Error('OTLP attribute key must be non-empty')
    if (keys.has(attribute.key)) {
      throw new Error(`OTLP span contains duplicate attribute ${attribute.key}`)
    }
    keys.add(attribute.key)
    const values = Object.values(attribute.value).filter((value) => value !== undefined)
    if (values.length !== 1) {
      throw new Error(`OTLP attribute ${attribute.key} must contain exactly one value`)
    }
    if (
      attribute.value.doubleValue !== undefined &&
      !Number.isFinite(attribute.value.doubleValue)
    ) {
      throw new Error(`OTLP attribute ${attribute.key} must be finite`)
    }
    if (attribute.value.intValue !== undefined && !/^-?\d+$/.test(attribute.value.intValue)) {
      throw new Error(`OTLP attribute ${attribute.key} intValue must be an integer string`)
    }
  }
}

function assertOtelId(id: string, pattern: RegExp, zero: string, field: string): void {
  if (!pattern.test(id) || id === zero) {
    throw new Error(`OTLP span ${field} must be a non-zero lowercase hexadecimal identifier`)
  }
}

function unixNano(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`OTLP span ${field} must be an unsigned integer string`)
  return BigInt(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function otlpUnsignedInteger(value: unknown, field: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`OTLP response ${field} must be a non-negative safe integer`)
    }
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  throw new Error(`OTLP response ${field} must be a non-negative integer string`)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`OTLP exporter ${field} must be a positive safe integer`)
  }
}

// ─── Eval-run ingest (self-improvement provenance) ───────────────────────────
//
// Tangle Intelligence has a first-class, non-trace record for self-improvement
// runs: POST /v1/ingest/eval-runs ("Mode D"). Each generation carries a
// `surfaceHash` (the proposed-change identity) + arbitrary `surface` provenance;
// a later `gate-decided` event re-emits the same `runId` (idempotent upsert) with
// a real `gateDecision` + `holdoutLift`, so proposal→verdict is one diffable
// record. This is how a consumer's RSI loop records WHAT it changed, WHY, from
// which evidence — the audit trail behind agentic self-improvement.

/** Wire version the eval-runs ingest enforces (X-Tangle-Wire-Version + body). */
export const INTELLIGENCE_WIRE_VERSION = '2026-05-26.v1'

export interface EvalRunGeneration {
  /** 0-based ordinal of this generation within the run (required by ingest). */
  index: number
  /** Identity of the proposed surface change (content-addressed hash). */
  surfaceHash: string
  /** Arbitrary provenance for this generation (rationale, evidence, source). */
  surface?: unknown
  /** Per-scenario results; empty until the generation is measured. */
  cells?: unknown[]
  /** Mean composite score (0 when unmeasured — pair with labels.measured). */
  compositeMean: number
  costUsd: number
  durationMs: number
}

export interface EvalRunEvent {
  runId: string
  runDir: string
  /** ISO timestamp. */
  timestamp: string
  status:
    | 'started'
    | 'baseline-complete'
    | 'generation-complete'
    | 'gate-decided'
    | 'finished'
    | 'errored'
  labels?: Record<string, string>
  baseline?: EvalRunGeneration
  generations?: EvalRunGeneration[]
  gateDecision?: 'ship' | 'hold' | 'need_more_work' | 'model_ceiling' | 'arch_ceiling'
  holdoutLift?: number
  totalCostUsd: number
  totalDurationMs: number
  errorMessage?: string
}

export interface EvalRunsExportConfig {
  /** Bearer key — tenant is resolved server-side from it. Reads TANGLE_API_KEY. */
  apiKey?: string
  /** Intelligence base. Reads TANGLE_INTELLIGENCE_URL env, else prod. */
  base?: string
  /** Idempotency-Key header (e.g. the runId) — safe retries + upsert. */
  idempotencyKey?: string
}

export interface EvalRunsExportResult {
  ok: boolean
  status: number
  accepted: number
  rejected: Array<{ index: number; reason: string }>
}

const DEFAULT_INTELLIGENCE_BASE = 'https://intelligence.tangle.tools'

/**
 * Ship self-improvement eval-run events to Tangle Intelligence and return the
 * accepted and rejected event counts. Throws on a missing key or network
 * failure; HTTP rejection is returned in `ok` and `status`.
 */
export async function exportEvalRuns(
  events: EvalRunEvent[],
  config?: EvalRunsExportConfig,
): Promise<EvalRunsExportResult> {
  if (events.length === 0) return { ok: true, status: 0, accepted: 0, rejected: [] }
  const apiKey =
    config?.apiKey ?? (typeof process !== 'undefined' ? process.env.TANGLE_API_KEY : undefined)
  if (!apiKey)
    throw new Error('exportEvalRuns: apiKey required (pass config.apiKey or set TANGLE_API_KEY)')
  const base =
    config?.base ??
    (typeof process !== 'undefined' ? process.env.TANGLE_INTELLIGENCE_URL : undefined) ??
    DEFAULT_INTELLIGENCE_BASE
  const url = `${base.replace(/\/+$/, '')}/v1/ingest/eval-runs`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'X-Tangle-Wire-Version': INTELLIGENCE_WIRE_VERSION,
      ...(config?.idempotencyKey ? { 'Idempotency-Key': config.idempotencyKey } : {}),
    },
    body: JSON.stringify({ wireVersion: INTELLIGENCE_WIRE_VERSION, events }),
  })
  let parsed: { accepted?: number; rejected?: Array<{ index: number; reason: string }> } = {}
  try {
    parsed = (await res.json()) as typeof parsed
  } catch {
    // non-JSON body (e.g. 5xx HTML) — leave parsed empty
  }
  return {
    ok: res.ok,
    status: res.status,
    accepted: parsed.accepted ?? (res.ok ? events.length : 0),
    rejected: parsed.rejected ?? [],
  }
}
