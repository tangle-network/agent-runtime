/**
 * One telemetry contract for every agent shape.
 *
 * `fromOtelSpans` reads OpenTelemetry GenAI fields and the explicit
 * `tangle.*` run fields, then produces one `RunRecord` per task attempt.
 * `analyzeRuns` summarizes those records.
 *
 * `toInsightReport(spans)` runs locally.
 * `shipToTangleOtlp(spans, opts)` posts the same spans to hosted ingest.
 */

import { createHash } from 'node:crypto'
import type { FailureClass } from '@tangle-network/agent-eval'
import { analyzeRuns, fromOtelSpans, type InsightReport } from '@tangle-network/agent-eval/contract'
import type { TraceSpanEvent } from '@tangle-network/agent-eval/hosted'
import { createOtelExporter } from '@tangle-network/agent-runtime'

export type { InsightReport, TraceSpanEvent }

/** One agent run, framework-agnostic. A shape produces a list of these. */
interface AgentRunBase {
  runId: string
  /** Stable identity of the agent, model, prompt, and settings being evaluated. */
  candidateId: string
  /** Stable task identity shared by every candidate that attempts the same task. */
  scenarioId: string
  /** Snapshot model id, e.g. `claude-sonnet-4-6@2025-05-08`. */
  model: string
  /** Task quality on 0..1, or null when the run has no valid quality label. */
  score: number | null
  inputTokens: number
  outputTokens: number
  startMs: number
  durationMs: number
  /** Canonical task-failure class. This does not imply process failure. */
  failureClass?: FailureClass
}

type AgentRunCost =
  | { costUsd: number; costProvenance: 'observed' }
  | { costUsd: null; costProvenance: 'uncaptured' }

type AgentRunTerminal =
  | { terminalOutcome: 'succeeded'; terminalFailureReason?: never }
  | { terminalOutcome: 'failed'; terminalFailureReason: string }

export type AgentRun = AgentRunBase & AgentRunCost & AgentRunTerminal

const NANO = 1_000_000n
const TRACE_ID = /^[0-9a-f]{32}$/
const SPAN_ID = /^[0-9a-f]{16}$/
const ZERO_TRACE_ID = '0'.repeat(32)
const ZERO_SPAN_ID = '0'.repeat(16)

/**
 * Build one task root and one model-call child for a framework-neutral run.
 * Run, candidate, and scenario identities are explicit and stable.
 */
export function otelSpansForRun(run: AgentRun): TraceSpanEvent[] {
  assertAgentRun(run)
  const start = BigInt(run.startMs) * NANO
  const end = start + BigInt(run.durationMs) * NANO
  const traceId = stableOtelId('trace', run.runId, 32)
  const rootSpanId = stableOtelId('span', `${run.runId}:root`, 16)
  const modelSpanId = distinctSpanId(stableOtelId('span', `${run.runId}:model:0`, 16), rootSpanId)
  const identity = {
    'tangle.runId': run.runId,
    'tangle.candidateId': run.candidateId,
    'tangle.scenarioId': run.scenarioId,
  }
  const rootAttributes: TraceSpanEvent['attributes'] = {
    ...identity,
    'openinference.span.kind': 'AGENT',
    'tangle.terminal.outcome': run.terminalOutcome,
    'tangle.cost.provenance': run.costProvenance,
    ...(run.score === null ? {} : { 'tangle.task.score': run.score }),
    ...(run.failureClass ? { 'tangle.task.failure_class': run.failureClass } : {}),
    ...(run.terminalOutcome === 'failed'
      ? { 'tangle.terminal.failure_reason': run.terminalFailureReason }
      : {}),
  }
  const modelAttributes: TraceSpanEvent['attributes'] = {
    ...identity,
    'openinference.span.kind': 'LLM',
    'gen_ai.request.model': run.model,
    'gen_ai.usage.input_tokens': run.inputTokens,
    'gen_ai.usage.output_tokens': run.outputTokens,
    'tangle.cost.provenance': run.costProvenance,
    ...(run.costUsd === null ? {} : { 'gen_ai.usage.cost_usd': run.costUsd }),
  }
  return [
    {
      traceId,
      spanId: rootSpanId,
      name: 'agent.run',
      startTimeUnixNano: start.toString(),
      endTimeUnixNano: end.toString(),
      'tangle.runId': run.runId,
      'tangle.scenarioId': run.scenarioId,
      attributes: rootAttributes,
      status:
        run.terminalOutcome === 'failed'
          ? { code: 'ERROR', message: run.terminalFailureReason }
          : { code: 'OK' },
    },
    {
      traceId,
      spanId: modelSpanId,
      parentSpanId: rootSpanId,
      name: 'gen_ai.chat',
      startTimeUnixNano: start.toString(),
      endTimeUnixNano: end.toString(),
      'tangle.runId': run.runId,
      'tangle.scenarioId': run.scenarioId,
      attributes: modelAttributes,
      status: { code: run.terminalOutcome === 'succeeded' ? 'OK' : 'UNSET' },
    },
  ]
}

function stableOtelId(domain: 'trace' | 'span', value: string, length: 16 | 32): string {
  const id = createHash('sha256')
    .update(`${domain}\0${value}`, 'utf8')
    .digest('hex')
    .slice(0, length)
  return /^0+$/.test(id) ? `${'0'.repeat(length - 1)}1` : id
}

function distinctSpanId(candidate: string, parent: string): string {
  if (candidate !== parent) return candidate
  const finalNibble = candidate.endsWith('0') ? '1' : '0'
  return `${candidate.slice(0, -1)}${finalNibble}`
}

function assertAgentRun(run: AgentRun): void {
  for (const [field, value] of [
    ['runId', run.runId],
    ['candidateId', run.candidateId],
    ['scenarioId', run.scenarioId],
    ['model', run.model],
  ] as const) {
    if (!value.trim()) throw new Error(`AgentRun.${field} must be non-empty`)
  }
  if (run.score !== null && (!Number.isFinite(run.score) || run.score < 0 || run.score > 1)) {
    throw new Error('AgentRun.score must be null or a finite number from 0 to 1')
  }
  for (const [field, value] of [
    ['inputTokens', run.inputTokens],
    ['outputTokens', run.outputTokens],
    ['startMs', run.startMs],
    ['durationMs', run.durationMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`AgentRun.${field} must be a non-negative safe integer`)
    }
  }
  if (run.costProvenance === 'observed') {
    if (typeof run.costUsd !== 'number' || !Number.isFinite(run.costUsd) || run.costUsd < 0) {
      throw new Error('AgentRun observed costUsd must be a non-negative finite number')
    }
  } else if (run.costProvenance === 'uncaptured') {
    if (run.costUsd !== null) {
      throw new Error('AgentRun uncaptured costUsd must be null')
    }
  } else {
    throw new Error('AgentRun.costProvenance must be observed or uncaptured')
  }
  if (run.terminalOutcome === 'succeeded') {
    if (run.terminalFailureReason !== undefined) {
      throw new Error('AgentRun succeeded terminal outcome cannot have a failure reason')
    }
  } else if (run.terminalOutcome === 'failed') {
    if (typeof run.terminalFailureReason !== 'string' || !run.terminalFailureReason.trim()) {
      throw new Error('AgentRun failed terminal outcome requires a non-empty reason')
    }
  } else {
    throw new Error('AgentRun.terminalOutcome must be succeeded or failed')
  }
  const traceId = stableOtelId('trace', run.runId, 32)
  const rootSpanId = stableOtelId('span', `${run.runId}:root`, 16)
  if (
    !TRACE_ID.test(traceId) ||
    traceId === ZERO_TRACE_ID ||
    !SPAN_ID.test(rootSpanId) ||
    rootSpanId === ZERO_SPAN_ID
  ) {
    throw new Error('AgentRun identities did not produce valid OpenTelemetry ids')
  }
}

/** Flatten many runs into one OTel span stream. */
export function spansForRuns(runs: AgentRun[]): TraceSpanEvent[] {
  return runs.flatMap(otelSpansForRun)
}

/** Analyze OTel spans locally without a hosted service. */
export async function toInsightReport(spans: TraceSpanEvent[]): Promise<InsightReport> {
  const runs = fromOtelSpans({ spans })
  return analyzeRuns({ runs })
}

export interface ShipOptions {
  /** Hosted ingest base; the route `/v1/traces` is appended. */
  endpoint: string
  /** Bearer key. The hosted service resolves the tenant from this key. */
  apiKey: string
  serviceName?: string
}

/** Post spans through the runtime OTLP exporter and confirm collector acceptance. */
export async function shipToTangleOtlp(spans: TraceSpanEvent[], opts: ShipOptions): Promise<void> {
  if (!opts.endpoint.trim()) throw new Error('shipToTangleOtlp: endpoint is required')
  if (!opts.apiKey.trim()) throw new Error('shipToTangleOtlp: apiKey is required')
  const exporter = createOtelExporter({
    endpoint: opts.endpoint,
    headers: { authorization: `Bearer ${opts.apiKey}` },
    serviceName: opts.serviceName ?? 'agents-of-all-shapes',
    maxQueueSize: Math.max(1, spans.length),
  })
  if (!exporter) throw new Error('shipToTangleOtlp: no OTLP endpoint configured')
  // OTLP status.code is numeric (UNSET=0, OK=1, ERROR=2); TraceSpanEvent carries the string enum.
  const statusCode = { UNSET: 0, OK: 1, ERROR: 2 } as const
  let shutdownStarted = false
  try {
    for (const span of spans) {
      exporter.exportSpan({
        traceId: span.traceId,
        spanId: span.spanId,
        ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
        name: span.name,
        kind: 1,
        startTimeUnixNano: span.startTimeUnixNano,
        endTimeUnixNano: span.endTimeUnixNano,
        attributes: Object.entries(span.attributes).map(([key, value]) => ({
          key,
          value:
            typeof value === 'number'
              ? Number.isInteger(value)
                ? { intValue: value.toString() }
                : { doubleValue: value }
              : typeof value === 'boolean'
                ? { boolValue: value }
                : { stringValue: value },
        })),
        ...(span.status
          ? { status: { code: statusCode[span.status.code], message: span.status.message } }
          : {}),
      })
    }
    shutdownStarted = true
    const result = await exporter.shutdown()
    if (!result.succeeded) {
      throw new Error(
        `shipToTangleOtlp: ${result.error ?? `${result.undeliveredSpans} spans undelivered`}`,
      )
    }
  } catch (error) {
    if (!shutdownStarted) await exporter.shutdown()
    throw error
  }
}
