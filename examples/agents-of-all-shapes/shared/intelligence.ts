/**
 * The ONE pipe every agent shape converges on.
 *
 * Tangle Intelligence does not care what framework produced a run — it
 * consumes OpenTelemetry GenAI spans. `fromOtelSpans` reads the standard
 * `gen_ai.*` semantic conventions (plus `tangle.*` aliases and a generic
 * `score`), turns each trace into a `RunRecord`, and `analyzeRuns` produces
 * the `InsightReport` decision packet — composite distribution, lift CI,
 * Pareto, failure clustering, ranked recommendations.
 *
 * Two ways to use it, same engine:
 *   - `toInsightReport(spans)` — in-process, zero infra. No sandbox, no
 *     hosted endpoint, no server. This is the QA path every shape verifies.
 *   - `shipToTangleOtlp(spans, opts)` — POST the same spans to the hosted
 *     `/v1/otlp/v1/traces` ingest for the dashboard. Optional.
 */

import type { RunRecord } from '@tangle-network/agent-eval'
import { analyzeRuns, fromOtelSpans, type InsightReport } from '@tangle-network/agent-eval/contract'
import type { TraceSpanEvent } from '@tangle-network/agent-eval/hosted'
import { createOtelExporter } from '@tangle-network/agent-runtime'

export type { InsightReport, TraceSpanEvent }

type FailureClass = NonNullable<RunRecord['failureClass']>

/** One agent run, framework-agnostic. A shape produces a list of these. */
export interface AgentRun {
  runId: string
  /** Snapshot model id, e.g. `claude-sonnet-4-6@2025-05-08`. */
  model: string
  /** Outcome quality on 0..1 (your judge / eval / rubric score). */
  score: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  startMs: number
  durationMs: number
  /** Canonical task-failure class for an unsuccessful task. */
  failureClass?: FailureClass
  /** Domain-specific detail carried under a non-success failure class. */
  failureMode?: string
}

const nanosecondsPerMillisecond = 1_000_000n

function unixNanoseconds(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds)) {
    throw new RangeError(`OTel timestamps require whole safe milliseconds, got ${milliseconds}`)
  }
  return (BigInt(milliseconds) * nanosecondsPerMillisecond).toString()
}

/**
 * Canonical OTel GenAI spans for one agent run. Any framework that emits
 * these standard attributes (`gen_ai.request.model`, `gen_ai.usage.*`,
 * `gen_ai.usage.cost_usd`) plus `gen_ai.evaluation.score.value` lands here
 * byte-identically —
 * Mastra, the Claude Agent SDK, agno, an OpenAI-compatible router, or the
 * Tangle runtime. That is the whole point: one wire, every shape.
 */
export function otelSpansForRun(run: AgentRun): TraceSpanEvent[] {
  const start = unixNanoseconds(run.startMs)
  const end = unixNanoseconds(run.startMs + run.durationMs)
  const spans: TraceSpanEvent[] = [
    {
      traceId: run.runId,
      spanId: `${run.runId}::run`,
      name: 'agent.run',
      startTimeUnixNano: start,
      endTimeUnixNano: end,
      attributes: {
        'tangle.candidateId': 'example-baseline',
        'tangle.scenarioId': run.runId,
        'gen_ai.evaluation.score.value': run.score,
        ...(run.failureClass ? { 'tangle.task.failure_class': run.failureClass } : {}),
        ...(run.failureMode ? { 'tangle.task.failure_mode': run.failureMode } : {}),
      },
      status: run.failureClass ? { code: 'ERROR', message: run.failureMode } : { code: 'OK' },
    },
    {
      traceId: run.runId,
      spanId: `${run.runId}::llm`,
      parentSpanId: `${run.runId}::run`,
      name: 'gen_ai.chat',
      startTimeUnixNano: start,
      endTimeUnixNano: end,
      attributes: {
        'gen_ai.request.model': run.model,
        'gen_ai.usage.input_tokens': run.inputTokens,
        'gen_ai.usage.output_tokens': run.outputTokens,
        'gen_ai.usage.cost_usd': run.costUsd,
      },
      status: { code: 'OK' },
    },
  ]
  return spans
}

/** Flatten many runs into one OTel span stream. */
export function spansForRuns(runs: AgentRun[]): TraceSpanEvent[] {
  return runs.flatMap(otelSpansForRun)
}

/** In-process intelligence: OTel spans → RunRecords → InsightReport. No
 *  sandbox, no server, no deploy. The verifiable QA path. */
export async function toInsightReport(spans: TraceSpanEvent[]): Promise<InsightReport> {
  const runs = fromOtelSpans({ spans })
  return analyzeRuns({ runs })
}

export interface ShipOptions {
  /** Hosted ingest base; the route `/v1/traces` is appended. */
  endpoint: string
  /** `sk-tan-...` key — tenant resolves from the Bearer, never the payload. */
  apiKey: string
  serviceName?: string
}

/** Optional hosted path: POST the same OTel spans to Tangle Intelligence's OTLP/HTTP ingest via the
 *  runtime's OWN exporter — `createOtelExporter` builds the resourceSpans envelope, appends `/v1/traces`,
 *  and batches the POST. No hand-rolled wire format; the same primitive the runtime uses in production. */
export async function shipToTangleOtlp(spans: TraceSpanEvent[], opts: ShipOptions): Promise<void> {
  const exporter = createOtelExporter({
    endpoint: opts.endpoint,
    headers: { authorization: `Bearer ${opts.apiKey}` },
    serviceName: opts.serviceName ?? 'agents-of-all-shapes',
  })
  if (!exporter) throw new Error('shipToTangleOtlp: no OTLP endpoint configured')
  // OTLP status.code is numeric (UNSET=0, OK=1, ERROR=2); TraceSpanEvent carries the string enum.
  const statusCode = { UNSET: 0, OK: 1, ERROR: 2 } as const
  for (const s of spans) {
    exporter.exportSpan({
      traceId: s.traceId,
      spanId: s.spanId,
      name: s.name,
      startTimeUnixNano: String(s.startTimeUnixNano),
      endTimeUnixNano: String(s.endTimeUnixNano),
      attributes: Object.entries(s.attributes).map(([key, value]) => ({
        key,
        value: typeof value === 'number' ? { doubleValue: value } : { stringValue: String(value) },
      })),
      ...(s.status
        ? { status: { code: statusCode[s.status.code], message: s.status.message } }
        : {}),
    })
  }
  await exporter.flush()
}
