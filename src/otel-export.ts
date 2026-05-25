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

export interface OtelExportConfig {
  /** OTLP endpoint. Reads OTEL_EXPORTER_OTLP_ENDPOINT env by default. */
  endpoint?: string
  /** OTLP headers. Reads OTEL_EXPORTER_OTLP_HEADERS env by default. */
  headers?: Record<string, string>
  /** Batch size before flush. Default 64. */
  batchSize?: number
  /** Flush interval ms. Default 5000. */
  flushIntervalMs?: number
  /** Resource attributes stamped on every export. */
  resourceAttributes?: Record<string, string | number | boolean>
  /** Service name. Default 'agent-runtime'. */
  serviceName?: string
}

export interface OtelExporter {
  /** Export a span. */
  exportSpan(span: OtelSpan): void
  /** Force flush pending spans. */
  flush(): Promise<void>
  /** Shutdown cleanly. */
  shutdown(): Promise<void>
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
  scopeSpans: Array<{ scope: { name: string; version: string }; spans: OtelSpan[] }>
}

interface OtlpExport {
  resourceSpans: OtlpResourceSpans[]
}

const SCOPE = { name: '@tangle-network/agent-runtime', version: '0.23.0' }

/**
 * Create an OTEL exporter. Returns undefined when no endpoint is configured.
 */
export function createOtelExporter(config?: OtelExportConfig): OtelExporter | undefined {
  const resolvedEndpoint =
    config?.endpoint ??
    (typeof process !== 'undefined' ? process.env.OTEL_EXPORTER_OTLP_ENDPOINT : undefined)
  if (!resolvedEndpoint) return undefined
  const endpoint: string = resolvedEndpoint

  const headers = config?.headers ?? parseHeadersFromEnv()
  const batchSize = config?.batchSize ?? 64
  const flushIntervalMs = config?.flushIntervalMs ?? 5000
  const serviceName = config?.serviceName ?? 'agent-runtime'
  const resourceAttrs = config?.resourceAttributes ?? {}

  const pending: OtelSpan[] = []
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false

  const exporter: OtelExporter = {
    exportSpan(span: OtelSpan): void {
      if (stopped) return
      pending.push(span)
      if (pending.length >= batchSize) {
        void doFlush()
      }
    },

    async flush(): Promise<void> {
      await doFlush()
    },

    async shutdown(): Promise<void> {
      stopped = true
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
      await doFlush()
    },
  }

  timer = setInterval(() => {
    if (pending.length > 0) void doFlush()
  }, flushIntervalMs)
  if (typeof timer === 'object' && 'unref' in timer) {
    ;(timer as NodeJS.Timeout).unref()
  }

  async function doFlush(): Promise<void> {
    if (pending.length === 0) return
    const batch = pending.splice(0)
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
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    } catch {
      // Best-effort — telemetry export must not crash the runtime.
    }
  }

  return exporter
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
    traceId: padTraceId(traceId),
    spanId,
    parentSpanId: parentSpanId ? padSpanId(parentSpanId) : undefined,
    name: event.kind,
    kind: 1,
    startTimeUnixNano: ts,
    endTimeUnixNano: ts,
    attributes: toAttributes(attrs),
    status: { code: 1 },
  }
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
  return Object.entries(record).map(([key, value]) => ({
    key,
    value:
      typeof value === 'number'
        ? Number.isInteger(value)
          ? { intValue: value.toString() }
          : { doubleValue: value }
        : typeof value === 'boolean'
          ? { boolValue: value }
          : { stringValue: value },
  }))
}

function msToNs(ms: number): string {
  return (BigInt(Math.floor(ms)) * 1_000_000n).toString()
}

function padSpanId(id: string): string {
  const cleaned = id.replace(/-/g, '')
  return cleaned.slice(0, 16).padEnd(16, '0')
}

function padTraceId(id: string): string {
  const cleaned = id.replace(/-/g, '')
  return cleaned.slice(0, 32).padEnd(32, '0')
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
