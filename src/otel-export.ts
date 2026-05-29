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
  /** Intelligence base. Reads INTELLIGENCE_BASE env, else prod. */
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
 * Ship self-improvement eval-run events to Tangle Intelligence. Unlike the
 * best-effort span exporter, this RESOLVES with the ingest verdict (accepted /
 * rejected per event) so a consumer's loop can assert its provenance landed.
 * Throws only on a missing key or network failure.
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
    (typeof process !== 'undefined' ? process.env.INTELLIGENCE_BASE : undefined) ??
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
