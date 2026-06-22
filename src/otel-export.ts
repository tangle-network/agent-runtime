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

const SCOPE = { name: '@tangle-network/agent-runtime', version: '0.33.0' }

/**
 * Current (non-deprecated) OpenTelemetry GenAI semantic-convention keys.
 * Registry: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/
 * NB: `gen_ai.system` / `gen_ai.usage.prompt_tokens` / `completion_tokens` are
 * DEPRECATED — do not emit them. We use `provider.name` + `input/output_tokens`.
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
  const tid = padTraceId(traceId)
  return buildLoopSpanNodes(events).map((node) => ({
    traceId: tid,
    spanId: node.spanId,
    parentSpanId: node.parentSpanId
      ? padSpanId(node.parentSpanId)
      : rootParentSpanId
        ? padSpanId(rootParentSpanId)
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
