/**
 * The OTLP spans Tangle Intelligence receives for one traced run or run record.
 * Attribute keys are verbatim: the plane's session, model and cost readers
 * exact-match them. Redaction applies to every customer payload before it is
 * hashed or attached.
 */
import { contentHash } from '@tangle-network/agent-eval'
import { ATTR, agentIdentityAttributes } from '@tangle-network/agent-trace-contract'
import { toOtlpAttributes } from '@tangle-network/agent-trace-contract/otlp'
import {
  buildLoopOtelSpans,
  buildRuntimeEventOtelSpans,
  flatOtelSpan,
  type OtelExporter,
  type OtelSpan,
} from '../otel-export'
import type { Redactor } from '../redact'
import { authoredAgentIdentity } from '../runtime/supervise/materialization'
import type { LoopTraceEvent } from '../runtime/types'
import type { RuntimeTelemetryOptions } from '../sanitize'
import type { EffortSettings } from './effort'
import type { IntelligenceConfig, RunRecord, TraceMeta, UsageSplit } from './index'
import { normalizeReportedUsage } from './usage'

/** The resolved outcome of one traced run, surfaced on the export span and
 *  available to the caller for downstream billing assertions. */
export interface TraceOutcome {
  runId: string
  traceId: string
  project: string
  /** The resolved effort settings this run executed under. */
  effort: EffortSettings
  /** True when this run ran as pure passthrough (the OFF floor). */
  intelligenceOff: boolean
  success?: boolean
  score?: number
  /** Per-class billing split. `intelligenceUsd` is `0` at the OFF tier. */
  usage: UsageSplit
}

/** What a client fixes once and every export reads. */
export interface TraceExportSettings {
  readonly project: string
  readonly intelligenceOff: boolean
  readonly redactor: Redactor
  readonly includeFullPayload: boolean
  readonly repo: IntelligenceConfig['repo']
  readonly runtimeTelemetry: RuntimeTelemetryOptions | undefined
}

function usageAttributes(
  usage: UsageSplit,
  intelligenceOff: boolean,
): Record<string, number | boolean> {
  const normalized = normalizeReportedUsage(usage, intelligenceOff)
  return {
    'tangle.usage.inference_usd': normalized.inferenceUsd,
    'tangle.usage.intelligence_usd': normalized.intelligenceUsd,
    ...(normalized.inferenceUsdKnown === false
      ? { 'tangle.usage.inference_usd_known': false }
      : {}),
    ...(normalized.intelligenceUsdKnown === false
      ? { 'tangle.usage.intelligence_usd_known': false }
      : {}),
    ...(normalized.estimatedInferenceUsd !== undefined
      ? { 'tangle.usage.inference_usd_estimated': normalized.estimatedInferenceUsd }
      : {}),
  }
}

/** Serialize a redacted value without dropping customer trace content. */
function serializeJson(value: unknown): string {
  let s: string
  if (typeof value === 'string') s = value
  else {
    try {
      s = JSON.stringify(value) ?? String(value)
    } catch {
      s = String(value)
    }
  }
  return s
}

function addPayloadAttributes(
  labels: Record<string, string | number | boolean>,
  key: string,
  value: unknown,
  includeFullPayload: boolean,
): void {
  const serialized = serializeJson(value)
  labels[`${key}_hash`] = contentHash(serialized)
  labels[`${key}_bytes`] = Buffer.byteLength(serialized, 'utf8')
  if (includeFullPayload) labels[key] = serialized
}

/** Export one flat run span for a traced call. */
export function exportTraceSpan(
  exporter: OtelExporter,
  settings: TraceExportSettings,
  meta: TraceMeta,
  outcome: TraceOutcome,
  output: unknown,
): void {
  const labels: Record<string, string | number | boolean> = {
    project: settings.project,
    'tangle.effort.intelligence_off': outcome.intelligenceOff,
    ...usageAttributes(outcome.usage, settings.intelligenceOff),
    ...(meta.model ? { 'gen_ai.request.model': meta.model } : {}),
    ...(meta.provider ? { 'provider.name': meta.provider } : {}),
    ...(typeof outcome.success === 'boolean' ? { 'tangle.outcome.success': outcome.success } : {}),
    ...(typeof outcome.score === 'number' ? { 'tangle.outcome.score': outcome.score } : {}),
    ...(meta.labels ?? {}),
  }
  const redactedInput = meta.input !== undefined ? settings.redactor(meta.input) : undefined
  const redactedOutput = output !== undefined ? settings.redactor(output) : undefined
  if (redactedInput !== undefined) {
    addPayloadAttributes(labels, 'tangle.input', redactedInput, settings.includeFullPayload)
  }
  if (redactedOutput !== undefined) {
    addPayloadAttributes(labels, 'tangle.output', redactedOutput, settings.includeFullPayload)
  }
  // Flat span with VERBATIM attribute keys — the plane's session/model/
  // cost readers exact-match `tangle.sessionId` / `gen_ai.request.model`,
  // so the loop-namespacing builder must not be used here.
  exporter.exportSpan(
    flatOtelSpan(
      'tangle.intelligence.run',
      { 'tangle.runId': outcome.runId, ...labels, [ATTR.spanKind]: 'AGENT' },
      outcome.traceId,
      Date.now(),
    ),
  )
}

/** The run span's attributes that come straight from the record. */
function runRecordAttributes(
  settings: TraceExportSettings,
  record: RunRecord,
): Record<string, string | number | boolean> {
  // Clamp the OFF billing invariant on export — the proof holds even if a
  // caller mis-reports an intelligence split at the OFF tier.
  const repository =
    record.repository ??
    (settings.repo ? `${settings.repo.owner}/${settings.repo.name}` : undefined)
  return {
    project: record.project,
    'tangle.target': record.target,
    'tangle.effort.intelligence_off': settings.intelligenceOff,
    ...usageAttributes(record.outcome.usage, settings.intelligenceOff),
    ...(record.model ? { 'gen_ai.request.model': record.model } : {}),
    ...(record.provider ? { 'provider.name': record.provider } : {}),
    ...(record.sessionId
      ? {
          'tangle.sessionId': record.sessionId,
          [ATTR.conversationId]: record.sessionId,
        }
      : {}),
    ...(record.harness ? { 'tangle.agent.harness': record.harness } : {}),
    ...(repository ? { 'vcs.repository.name': repository } : {}),
    ...(record.commitSha ? { 'vcs.ref.head.revision': record.commitSha } : {}),
    ...(record.timing
      ? {
          'tangle.started_at_ms': record.timing.startedAt,
          'tangle.completed_at_ms': record.timing.completedAt,
          'tangle.duration_ms': record.timing.durationMs,
        }
      : {}),
    ...(record.tokens
      ? {
          'gen_ai.usage.input_tokens': record.tokens.input,
          'gen_ai.usage.output_tokens': record.tokens.output,
          ...(record.tokens.tokensKnown === false ? { 'tangle.usage.tokens_known': false } : {}),
          ...(record.tokens.cachedInput !== undefined
            ? { 'gen_ai.usage.cache_read_input_tokens': record.tokens.cachedInput }
            : {}),
          ...(record.tokens.reasoning !== undefined
            ? { 'gen_ai.usage.reasoning_tokens': record.tokens.reasoning }
            : {}),
        }
      : {}),
    ...(typeof record.outcome.success === 'boolean'
      ? { 'tangle.outcome.success': record.outcome.success }
      : {}),
    ...(typeof record.outcome.score === 'number'
      ? { 'tangle.outcome.score': record.outcome.score }
      : {}),
    ...(record.error
      ? {
          'error.type': record.error.code ?? record.error.name,
          'error.message': serializeJson(settings.redactor(record.error.message)),
        }
      : {}),
    ...(record.runtimeEvents ? { 'tangle.runtime.event_count': record.runtimeEvents.length } : {}),
    ...(record.candidateExecution
      ? {
          'tangle.candidate.bundle_digest': record.candidateExecution.receipt.bundleDigest,
          'tangle.candidate.experiment_digest':
            record.candidateExecution.materializationReceipt.executionPlan.material.runCell
              .experimentDigest,
          'tangle.candidate.execution_id':
            record.candidateExecution.materializationReceipt.executionPlan.material.executionId,
          'tangle.candidate.execution_plan_digest':
            record.candidateExecution.receipt.executionPlanDigest,
          'tangle.candidate.materialization_receipt_digest':
            record.candidateExecution.receipt.materializationReceiptDigest,
          'tangle.candidate.succeeded':
            record.candidateExecution.receipt.termination.kind === 'exit' &&
            record.candidateExecution.receipt.termination.exitCode === 0 &&
            record.candidateExecution.receipt.benchmarkResult.material.passed,
          'tangle.candidate.run_receipt_digest': record.candidateExecution.receipt.digest,
        }
      : {}),
  }
}

/** Export the loop → round → iteration span tree with the shipped topology builder, never a second one. */
export function exportLoopSpans(
  exporter: OtelExporter,
  events: ReadonlyArray<LoopTraceEvent>,
  traceId: string,
  parentSpanId: string | undefined,
  redactor?: Redactor,
  decorate: (span: OtelSpan) => OtelSpan = (span) => span,
): void {
  const spans = buildLoopOtelSpans(
    events as ReadonlyArray<{
      kind: string
      runId: string
      timestamp: number
      payload: object
    }>,
    traceId,
    parentSpanId,
    redactor,
  )
  for (const span of spans) exporter.exportSpan(decorate(span))
}

/** Export a run record: its run span, then its runtime-event and loop spans under the same trace. */
export function exportRunRecordSpans(
  exporter: OtelExporter,
  settings: TraceExportSettings,
  record: RunRecord,
): void {
  const labels = runRecordAttributes(settings, record)
  if (record.profile) {
    addPayloadAttributes(
      labels,
      'tangle.agent.profile',
      settings.redactor(record.profile),
      settings.includeFullPayload,
    )
    if (record.profile.name) labels[ATTR.agentName] = record.profile.name
  }
  // Who acted, on the run span and on every span under it: the profile, and the harness the
  // record says actually ran it.
  const identity = agentIdentityAttributes({
    ...authoredAgentIdentity(record.profile),
    ...(record.harness ? { harness: record.harness } : {}),
  })
  const attributed = (span: OtelSpan): OtelSpan => withMissingAttributes(span, identity)
  Object.assign(labels, identity)
  const redactedInput = record.input !== undefined ? settings.redactor(record.input) : undefined
  const redactedOutput = record.output !== undefined ? settings.redactor(record.output) : undefined
  if (redactedInput !== undefined) {
    addPayloadAttributes(labels, 'tangle.input', redactedInput, settings.includeFullPayload)
  }
  if (redactedOutput !== undefined) {
    addPayloadAttributes(labels, 'tangle.output', redactedOutput, settings.includeFullPayload)
  }
  const now = Date.now()
  const runSpan = flatOtelSpan(
    'tangle.intelligence.run',
    // Declared AGENT: this span carries the run's model and token TOTAL, and an undeclared span
    // with tokens reads as one LLM call, which counts every call beneath it a second time.
    { 'tangle.runId': record.runId, ...labels, [ATTR.spanKind]: 'AGENT' },
    record.traceId,
    record.timing?.startedAt ?? now,
    undefined,
    record.timing?.completedAt ?? now,
  )
  exporter.exportSpan(runSpan)
  if (record.runtimeEvents && record.runtimeEvents.length > 0) {
    const spans = buildRuntimeEventOtelSpans(record.runtimeEvents, record.traceId, runSpan.spanId, {
      ...settings.runtimeTelemetry,
      redact: settings.redactor,
    })
    for (const span of spans) exporter.exportSpan(attributed(span))
  }
  // The loop topology (when present) exports under the SAME traceId, parented
  // under the run span — reusing the shipped builder, never a second one.
  if (record.loopEvents && record.loopEvents.length > 0) {
    exportLoopSpans(
      exporter,
      record.loopEvents,
      record.traceId,
      runSpan.spanId,
      settings.redactor,
      attributed,
    )
  }
}

/** `span` plus each of `attributes` it does not already carry; its own values win. */
function withMissingAttributes(span: OtelSpan, attributes: Record<string, string>): OtelSpan {
  const present = new Set((span.attributes ?? []).map((attribute) => attribute.key))
  const missing = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !present.has(key)),
  )
  if (Object.keys(missing).length === 0) return span
  return { ...span, attributes: [...(span.attributes ?? []), ...toOtlpAttributes(missing)] }
}
