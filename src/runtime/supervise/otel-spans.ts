/** Best-effort supervisor spans; the spawn journal owns replay and accounting. */

import { isRecord } from '@tangle-network/agent-core'
import {
  type AgentIdentity,
  ATTR,
  agentIdentityAttributes,
  LINK_KIND_ATTR,
} from '@tangle-network/agent-trace-contract'
import { msToUnixNano, toOtlpAttributes } from '@tangle-network/agent-trace-contract/otlp'
import { contentAddress } from '../../durable/content-address'
import type { OtelExportConfig, OtelExporter, OtelExportStats, OtelSpan } from '../../otel-export'
import { createOtelExporter, generateSpanId } from '../../otel-export'
import { defaultRedactor } from '../../redact'
import type { RuntimeHookEvent, RuntimeHooks } from '../../runtime-hooks'
import type { RuntimeTelemetryOptions } from '../../sanitize'
import type { Budget, Spend, SupervisedResult } from './types'
import type { TraceContext, WorkerTraceResolver } from './worker-trace'

/** OTEL status codes (`UNSET` / `OK` / `ERROR`) — the numeric wire values `OtelSpan.status` carries. */
const STATUS_UNSET = 0
const STATUS_OK = 1
const STATUS_ERROR = 2

/** Longest string attribute value written from free-form detail (identity/label attributes are never truncated). */
const MAX_DETAIL_CHARS = 256

/** OTLP span attribute values; exported because `SupervisorSpanOptions.attributes` is public. */
export type SupervisorSpanAttributes = Record<string, string | number | boolean>

type Attrs = SupervisorSpanAttributes

export interface SupervisorSpanOptions
  extends Pick<RuntimeTelemetryOptions, 'includeMetadata' | 'includeEvalDetails'> {
  /** The supervised run id (`SupervisorOpts.runId`): roots the trace and is the parent key of every depth-0 spawn. */
  readonly runId: string
  /** Bring your own exporter: FLUSHED but never shut down by `finish()`. Takes precedence over `exportConfig`. */
  readonly exporter?: OtelExporter
  /** Otherwise built with {@link createOtelExporter}; with no endpoint here or in
   *  `OTEL_EXPORTER_OTLP_ENDPOINT` the run emits nothing. */
  readonly exportConfig?: OtelExportConfig
  /** Trace id (32 hex chars); pass the caller's to JOIN an outer trace. Default: derived from
   *  `namespace` and `runId`, so a resumed run lands in the SAME trace. */
  readonly traceId?: string
  /** The run's storage identity (supplied by `supervise()`); absent, the trace derives from `runId`. */
  readonly namespace?: string
  /** Parent span id (16 hex chars) to hang the run's root span under — an inherited delegation span. */
  readonly parentSpanId?: string
  /** `agent.name` on the root span. Default `'supervisor'`. */
  readonly agentName?: string
  /** Extra attributes stamped on every span this recorder emits (subject, workspace, campaign, …). */
  readonly attributes?: Attrs
  /** Who the root agent is, stamped on the root span and the root manager's turns; every node carries its OWN profile. */
  readonly agentIdentity?: AgentIdentity
  /** Injectable clock; used only for the root span's start/end. Default `Date.now`. */
  readonly now?: () => number
}

/** How the supervised run ended, as `finish()` records it on the root span. */
export interface SupervisorSpanOutcome {
  readonly result?: SupervisedResult<unknown>
  /** A rejection out of the run itself (the supervisor never resolved). */
  readonly error?: unknown
}

export interface SupervisorSpanRecorder {
  /** Attach to `SupervisorOpts.hooks` (compose with a caller's own via `composeRuntimeHooks`). */
  readonly hooks: RuntimeHooks
  /** The trace every span of this run belongs to. */
  readonly traceId: string
  /** The run's root span id — pass it to a child process to join this trace. */
  readonly rootSpanId: string
  /**
   * The trace context a worker spawned BY node `spawningNodeId` inherits, so its spans join THIS
   * trace under that node's span. Threaded as `SupervisorOpts.workerTrace` (`supervise()` does
   * this) and seeded onto each child's `ExecutorContext`; a backend with an environment channel
   * stamps it with `workerTraceEnv`. An unknown node resolves to the root span.
   */
  readonly workerTrace: WorkerTraceResolver
  /** Close the root span (and any unsettled node, marked), export, flush. Idempotent; never throws. */
  finish(outcome?: SupervisorSpanOutcome): Promise<void>
  /** What this run's exporter has delivered and lost so far. Also surfaced once, as a
   *  `console.warn`, on `finish()` when the closing flush dropped spans. */
  stats(): OtelExportStats
}

/** A node span held open between its `agent.spawn` and its `agent.child`. */
interface OpenNode {
  readonly spanId: string
  readonly parentSpanId: string
  readonly name: string
  readonly startMs: number
  readonly attrs: Attrs
}

/** The state one recorder keeps about a run's span tree; the functions below are its transitions. */
interface RunTrace {
  readonly telemetry: RuntimeTelemetryOptions
  readonly runId: string
  readonly traceId: string
  readonly rootSpanId: string
  readonly rootStartMs: number
  readonly base: Attrs
  readonly rootIdentity: Attrs
  /** Who acted, per span: the root's identity, and each opened node's own. A turn whose node this
   *  recorder never opened names no one rather than borrowing the root's. */
  readonly modeledAttempts: Set<string>
  readonly identityOf: Map<string, Attrs>
  /** Node id → its open span. */
  readonly open: Map<string, OpenNode>
  /** Node id → its span id, seeded with the run id ⇒ the root span, because a depth-0 spawn's
   *  `parentId` is the run id itself and every deeper spawn's is a real node id. */
  readonly spanIdOf: Map<string, string>
}

interface SpanSpec {
  readonly spanId: string
  readonly parentSpanId: string | undefined
  readonly name: string
  readonly startMs: number
  readonly endMs: number
  readonly attrs: Attrs
  readonly status: number
  readonly message?: string | undefined
  readonly links?: OtelSpan['links']
}

function otelSpan(traceId: string, spec: SpanSpec): OtelSpan {
  return {
    traceId,
    spanId: spec.spanId,
    ...(spec.parentSpanId ? { parentSpanId: spec.parentSpanId } : {}),
    name: spec.name,
    kind: 1,
    startTimeUnixNano: msToUnixNano(spec.startMs),
    endTimeUnixNano: msToUnixNano(Math.max(spec.startMs, spec.endMs)),
    attributes: toOtlpAttributes(spec.attrs),
    ...(spec.links ? { links: spec.links } : {}),
    status: { code: spec.status, ...(spec.message ? { message: spec.message } : {}) },
  }
}

/** The span a node's event hangs under; a parent opened in an earlier process leaves the child on the root span (a placeholder). */
function parentSpan(
  t: RunTrace,
  parentId: string | undefined,
): { spanId: string; confidence: 'explicit' | 'unknown' } {
  const spanId = parentId === undefined ? undefined : t.spanIdOf.get(parentId)
  return spanId
    ? { spanId, confidence: 'explicit' }
    : { spanId: t.rootSpanId, confidence: 'unknown' }
}

function openNode(t: RunTrace, event: RuntimeHookEvent): void {
  const p = record(event.payload)
  const childId = str(p.childId)
  if (!childId) return
  const identity = agentIdentityAttributes(record(p.agent) as AgentIdentity)
  t.identityOf.set(childId, identity)
  const attrs = spawnAttributes(t.base, event, identity)

  const parent = parentSpan(t, event.parentId)
  attrs[ATTR.parentConfidence] = parent.confidence

  const spanId = generateSpanId()
  t.spanIdOf.set(childId, spanId)
  t.open.set(childId, {
    spanId,
    parentSpanId: parent.spanId,
    name: str(p.label) ?? 'node',
    startMs: event.timestamp,
    attrs,
  })
}

function settleNode(t: RunTrace, event: RuntimeHookEvent): OtelSpan | undefined {
  const p = record(event.payload)
  const childId = str(p.childId)
  if (!childId) return undefined
  const node = t.open.get(childId)
  if (!node) return undefined
  t.open.delete(childId)

  const down = str(p.status) === 'down'
  return otelSpan(t.traceId, {
    spanId: node.spanId,
    parentSpanId: node.parentSpanId,
    name: node.name,
    startMs: node.startMs,
    endMs: event.timestamp,
    attrs: settledAttributes(node.attrs, event, t.telemetry),
    status: down ? STATUS_ERROR : STATUS_OK,
    message: down
      ? t.telemetry.includeEvalDetails
        ? truncate(str(p.reason) ?? 'child down')
        : 'child down'
      : undefined,
  })
}

function turnSpan(t: RunTrace, event: RuntimeHookEvent): OtelSpan {
  const parentId = event.parentId
  // A turn with no node is the root manager's own.
  const parent = parentId
    ? parentSpan(t, parentId)
    : { spanId: t.rootSpanId, confidence: 'explicit' }
  const attrs: Attrs = {
    ...t.base,
    ...(t.identityOf.get(parentId ?? t.runId) ?? {}),
    [ATTR.parentConfidence]: parent.confidence,
    [ATTR.spanKind]: 'LLM',
    'inference.observation_kind': 'LLM',
    'tangle.supervise.node.kind': 'inference',
  }
  if (parentId) attrs['tangle.supervise.node.id'] = parentId
  const p = record(event.payload)
  assignTurnDetail(attrs, p, t.telemetry)
  const spend = assignSpend(attrs, p.spend)
  return otelSpan(t.traceId, {
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
    name: 'gen_ai.client.inference',
    startMs: event.timestamp - (spend?.ms ?? 0),
    endMs: event.timestamp,
    attrs,
    status: STATUS_OK,
  })
}

/** Runtime-owned metadata only: prompts, arguments, results and error messages stay private. */
function observationSpan(t: RunTrace, event: RuntimeHookEvent): OtelSpan {
  const p = record(event.payload)
  const nodeId =
    event.target === 'agent.steer' ? (str(p.nodeId) ?? t.runId) : (event.parentId ?? t.runId)
  const parent = parentSpan(t, nodeId)
  const attrs: Attrs = {
    ...t.base,
    ...(t.identityOf.get(nodeId) ?? {}),
    [ATTR.parentConfidence]: parent.confidence,
    'tangle.supervise.node.id': nodeId,
  }
  const attempt = str(p.attemptId)
  if (attempt) attrs[ATTR.attemptId] = attempt
  let name = event.target
  let links: OtelSpan['links']
  if (event.target === 'agent.model') {
    attrs[ATTR.spanKind] = 'LLM'
    name = 'gen_ai.client.inference'
    if (attempt) t.modeledAttempts.add(`${nodeId}:${attempt}`)
    const model = str(p.model)
    if (model) attrs[ATTR.model] = model
    for (const [field, key] of [
      ['tokensIn', ATTR.inputTokens],
      ['tokensOut', ATTR.outputTokens],
      ['costUsd', ATTR.costUsd],
    ] as const) {
      if (typeof p[field] === 'number' && Number.isFinite(p[field])) attrs[key] = p[field]
    }
  } else if (event.target === 'agent.tool_call') {
    attrs[ATTR.spanKind] = 'TOOL'
    const tool = str(p.toolName)
    if (tool) attrs[ATTR.toolName] = tool
    const call = str(p.toolCallId)
    if (call) attrs['tool.call_id'] = call
    if (typeof p.durationKnown === 'boolean') attrs['tangle.tool.duration_known'] = p.durationKnown
  } else {
    attrs[ATTR.spanKind] = 'CHAIN'
    if (event.target === 'agent.steer') {
      const target = str(p.nodeId)
      if (target) attrs['tangle.supervise.steer.node_id'] = target
      const senderSpan = event.parentId === undefined ? undefined : t.spanIdOf.get(event.parentId)
      if (senderSpan)
        links = [
          {
            traceId: t.traceId,
            spanId: senderSpan,
            attributes: toOtlpAttributes({ [LINK_KIND_ATTR]: 'steered_by' }),
          },
        ]
    } else {
      const control = record(p.controlRef)
      for (const key of ['provider', 'environmentId', 'executionId', 'sessionId'] as const) {
        const value = str(control[key])
        if (value) attrs[`tangle.execution.${key}`] = value
      }
      attrs['tangle.execution.phase'] = 'dispatched'
    }
  }
  const failed = p.status === 'error'
  if (typeof p.status === 'string') attrs['tangle.observation.status'] = p.status
  const errorType = str(record(p.error).type)
  if (errorType) attrs['error.type'] = truncate(errorType)
  return otelSpan(t.traceId, {
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
    name,
    startMs: typeof p.startedAt === 'number' ? p.startedAt : event.timestamp,
    endMs: typeof p.endedAt === 'number' ? p.endedAt : event.timestamp,
    attrs,
    status: failed ? STATUS_ERROR : p.status === 'ok' ? STATUS_OK : STATUS_UNSET,
    ...(links ? { links } : {}),
  })
}

/** The spans that close a run, yielded one at a time. A node still open never settled: its span is
 *  closed UNSET and explicitly marked, never dropped or reported as clean. */
function* closingSpans(
  t: RunTrace,
  opts: SupervisorSpanOptions,
  endMs: number,
  outcome: SupervisorSpanOutcome | undefined,
): Generator<OtelSpan> {
  for (const [nodeId, node] of t.open) {
    yield otelSpan(t.traceId, {
      spanId: node.spanId,
      parentSpanId: node.parentSpanId,
      name: node.name,
      startMs: node.startMs,
      endMs,
      attrs: {
        ...node.attrs,
        'tangle.supervise.node.status': 'unsettled',
        'tangle.supervise.node.settled': false,
        'tangle.supervise.node.id': nodeId,
      },
      status: STATUS_UNSET,
    })
  }
  t.open.clear()
  yield otelSpan(t.traceId, {
    spanId: t.rootSpanId,
    parentSpanId: opts.parentSpanId,
    name: 'supervisor.run',
    startMs: t.rootStartMs,
    endMs,
    attrs: {
      ...rootAttrs(t.base, opts.agentName ?? 'supervisor', outcome, opts),
      ...t.rootIdentity,
      ...(opts.parentSpanId ? { [ATTR.parentConfidence]: 'explicit' } : {}),
    },
    status: rootStatus(outcome),
    message: rootMessage(outcome, opts),
  })
}

/** Build the span recorder for one run, or `undefined` when no exporter resolves (off by default; "configured but unreachable" also costs nothing). */
export function createSupervisorSpanRecorder(
  opts: SupervisorSpanOptions,
): SupervisorSpanRecorder | undefined {
  const exporter = opts.exporter ?? createOtelExporter(opts.exportConfig)
  if (!exporter) return undefined
  // Only an exporter we built is ours to shut down.
  const ownsExporter = opts.exporter === undefined

  const now = opts.now ?? Date.now
  const traceId = normalizeTraceId(opts.traceId, opts.runId, opts.namespace)
  const rootSpanId = generateSpanId()
  const rootStartMs = now()
  const rootIdentity = agentIdentityAttributes(opts.agentIdentity)
  const trace: RunTrace = {
    telemetry: opts,
    runId: opts.runId,
    traceId,
    rootSpanId,
    rootStartMs,
    base: {
      'tangle.run.id': opts.runId,
      // The sample vocabulary our own OTLP producers already emit; kept so one reader groups a
      // supervised run with a pi/coding-CLI session without a per-producer special case.
      'tangle.sessionId': opts.runId,
      ...(opts.attributes ?? {}),
    },
    rootIdentity,
    modeledAttempts: new Set(),
    identityOf: new Map<string, Attrs>([[opts.runId, rootIdentity]]),
    open: new Map<string, OpenNode>(),
    spanIdOf: new Map<string, string>([[opts.runId, rootSpanId]]),
  }
  let finished = false

  /** Every export is best-effort: a throwing exporter must never reach the run. */
  const emit = (span: OtelSpan): void => {
    try {
      exporter.exportSpan(span)
    } catch {
      // Telemetry is not the work.
    }
  }

  const hooks: RuntimeHooks = {
    onEvent(event) {
      if (finished) return
      try {
        if (event.phase !== 'after') return
        if (event.target === 'agent.spawn') openNode(trace, event)
        else if (event.target === 'agent.child') {
          const settled = settleNode(trace, event)
          if (settled) emit(settled)
        } else if (event.target === 'agent.turn') {
          const attempt = str(record(event.payload).attemptId)
          if (!attempt || !trace.modeledAttempts.has(`${event.parentId}:${attempt}`))
            emit(turnSpan(trace, event))
        } else if (
          event.target === 'agent.model' ||
          event.target === 'agent.tool_call' ||
          event.target === 'agent.execution' ||
          event.target === 'agent.steer'
        )
          emit(observationSpan(trace, event))
      } catch {
        // A telemetry defect, never a run failure, whoever calls the hook.
      }
    },
  }

  return {
    hooks,
    traceId,
    rootSpanId,
    workerTrace(spawningNodeId: string): TraceContext {
      return { traceId, parentSpanId: trace.spanIdOf.get(spawningNodeId) ?? rootSpanId }
    },
    async finish(outcome?: SupervisorSpanOutcome): Promise<void> {
      if (finished) return
      finished = true
      const endMs = now()
      try {
        for (const closing of closingSpans(trace, opts, endMs, outcome)) emit(closing)
      } catch {}
      // Outside the span-building try so a rejected flush cannot skip shutdown; surfaced (one
      // warning per finish()) because a 401 or dead collector was previously silent.
      try {
        await exporter.flush()
      } catch (error) {
        const s = exporter.stats()
        console.warn(
          `[agent-runtime] supervisor span export dropped ${s.dropped} span(s): ${s.lastError ?? String(error)}`,
        )
      } finally {
        if (ownsExporter) await exporter.shutdown()
      }
    },
    stats: () => exporter.stats(),
  }
}

/** The attributes of a node span at `agent.spawn`, before its parent span is known. */
function spawnAttributes(base: Attrs, event: RuntimeHookEvent, identity: Attrs): Attrs {
  const p = record(event.payload)
  const label = str(p.label) ?? 'node'
  const runtime = str(p.runtime)
  const attrs: Attrs = {
    ...base,
    [ATTR.spanKind]: 'AGENT',
    'agent.name': label,
    'tangle.supervise.node.id': str(p.childId)!,
    'tangle.supervise.node.label': label,
    'tangle.supervise.node.kind': 'agent',
    // A nested driver subtree's own tree key joins a span to the journal rows that prove its spend.
    'tangle.supervise.tree.root': event.runId,
  }
  Object.assign(attrs, identity)
  if (event.parentId) attrs['tangle.supervise.node.parent_id'] = event.parentId
  if (runtime) attrs['tangle.supervise.node.runtime'] = runtime
  if (typeof p.depth === 'number') attrs['tangle.supervise.node.depth'] = p.depth
  // Every try of one keyed assignment shares its operation id and carries its own attempt id.
  const key = str(p.key)
  const operation = str(p.assignmentId) ?? key
  if (operation) attrs[ATTR.operationId] = operation
  const attempt = str(p.attemptId)
  if (attempt) attrs[ATTR.attemptId] = attempt
  if (key) attrs[ATTR.idempotencyKey] = key
  if (typeof event.stepIndex === 'number') attrs['tangle.supervise.node.ordinal'] = event.stepIndex
  if (p.resumed === true) attrs['tangle.supervise.node.resumed'] = true
  assignBudget(attrs, p.budget)
  return attrs
}

/** A node span's attributes at `agent.child`: the spawn-time ones plus how it settled. */
function settledAttributes(
  opened: Attrs,
  event: RuntimeHookEvent,
  telemetry: RuntimeTelemetryOptions,
): Attrs {
  const p = record(event.payload)
  const status = str(p.status)
  const attrs: Attrs = { ...opened, 'tangle.supervise.node.status': status ?? 'done' }
  assignFailure(attrs, p.failure)
  if (typeof event.stepIndex === 'number') attrs['tangle.supervise.node.seq'] = event.stepIndex
  if (typeof p.outRef === 'string') attrs['tangle.supervise.node.out_ref'] = p.outRef
  if (typeof p.valid === 'boolean') attrs['tangle.supervise.verdict.valid'] = p.valid
  if (typeof p.score === 'number') attrs['tangle.supervise.verdict.score'] = p.score
  if (status === 'down') {
    attrs['error.type'] = p.infra === true ? 'infra' : 'child-down'
    const reason = str(p.reason)
    if (reason && telemetry.includeEvalDetails) attrs['error.message'] = truncate(reason)
    if (typeof p.infra === 'boolean') attrs['tangle.supervise.node.infra'] = p.infra
  }
  // A wait node settles with its outcome instead of a spend — free by construction, not by
  // measurement, so it carries no token or cost attribute at all.
  const wokeBy = str(record(p.wait).settled)
  if (wokeBy) attrs['tangle.supervise.wait.settled'] = wokeBy
  assignSpend(attrs, p.spent)
  return attrs
}

/** Free-form `Scope.meter` detail: named keys get the canonical attribute, the rest ride
 *  namespaced and bounded so a caller's extra context survives without unbounded span growth. */
function assignTurnDetail(
  attrs: Attrs,
  payload: Record<string, unknown>,
  telemetry: RuntimeTelemetryOptions,
): void {
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'spend') continue
    if (key === 'driver' && typeof value === 'string') {
      attrs['agent.name'] = value
      attrs['inference.agent_name'] = value
      continue
    }
    if (key === 'model' && typeof value === 'string') {
      attrs['llm.model_name'] = value
      continue
    }
    if (!telemetry.includeMetadata) continue
    if (Array.isArray(value)) {
      const scalars = value.filter((v) => typeof v === 'string' || typeof v === 'number')
      if (scalars.length > 0) {
        attrs[`tangle.supervise.turn.${key}`] = truncate(scalars.join(','))
      }
      continue
    }
    if (typeof value === 'string') attrs[`tangle.supervise.turn.${key}`] = truncate(value)
    else if (typeof value === 'number' || typeof value === 'boolean') {
      attrs[`tangle.supervise.turn.${key}`] = value
    }
  }
}

function assignFailure(attrs: Attrs, value: unknown): void {
  const failure = record(value)
  for (const key of ['owner', 'code', 'providerCode'] as const) {
    const field = str(failure[key])
    if (field) attrs[`tangle.failure.${key}`] = field
  }
}

function rootAttrs(
  base: Attrs,
  agentName: string,
  outcome: SupervisorSpanOutcome | undefined,
  telemetry: RuntimeTelemetryOptions,
): Attrs {
  const attrs: Attrs = {
    ...base,
    [ATTR.spanKind]: 'AGENT',
    'inference.observation_kind': 'AGENT',
    'agent.name': agentName,
    'inference.agent_name': agentName,
    'tangle.supervise.node.kind': 'root',
  }
  const result = outcome?.result
  if (result) {
    attrs['tangle.supervise.result'] = result.kind
    if (result.kind === 'no-winner') {
      attrs['tangle.supervise.reason'] = result.reason
      attrs['tangle.supervise.down_count'] = result.downCount
      if (result.reason === 'driver-failed') {
        attrs['error.type'] = result.error.name
        assignFailure(attrs, result.error.failure)
        if (telemetry.includeEvalDetails) attrs['error.message'] = truncate(result.error.message)
      }
    }
    assignSpend(attrs, result.spentTotal)
  }
  if (outcome?.error !== undefined) {
    attrs['tangle.supervise.result'] = 'error'
    const err = outcome.error
    attrs['error.type'] = err instanceof Error ? err.name : typeof err
    if (telemetry.includeEvalDetails)
      attrs['error.message'] = truncate(err instanceof Error ? err.message : String(err))
  }
  return attrs
}

function rootStatus(outcome?: SupervisorSpanOutcome): number {
  if (outcome?.error !== undefined) return STATUS_ERROR
  if (!outcome?.result) return STATUS_UNSET
  return outcome.result.kind === 'winner' ? STATUS_OK : STATUS_ERROR
}

function rootMessage(
  outcome: SupervisorSpanOutcome | undefined,
  telemetry: RuntimeTelemetryOptions,
): string | undefined {
  if (outcome?.error !== undefined && telemetry.includeEvalDetails) {
    return truncate(outcome.error instanceof Error ? outcome.error.message : String(outcome.error))
  }
  const result = outcome?.result
  return result && result.kind === 'no-winner' ? result.reason : undefined
}

/** Write a `Spend` onto a span; a channel marked NOT known contributes no number and flags itself,
 *  so an unmeasured turn is never summed as free. Returns the spend it read (for the duration). */
function assignSpend(attrs: Attrs, value: unknown): Spend | undefined {
  if (!isRecord(value)) return undefined
  const spend = value as unknown as Spend
  const tokens = isRecord(spend.tokens) ? spend.tokens : undefined
  if (spend.tokensKnown === false) {
    attrs['tangle.supervise.tokens_known'] = false
  } else if (tokens) {
    if (typeof tokens.input === 'number') attrs['llm.token_count.prompt'] = tokens.input
    if (typeof tokens.output === 'number') attrs['llm.token_count.completion'] = tokens.output
  }
  if (spend.usdKnown === false) {
    attrs['tangle.supervise.cost_known'] = false
  } else if (typeof spend.usd === 'number' && Number.isFinite(spend.usd)) {
    attrs['llm.cost_usd'] = spend.usd
    attrs['tangle.cost.usd'] = spend.usd
  }
  if (typeof spend.iterations === 'number') attrs['tangle.supervise.iterations'] = spend.iterations
  if (typeof spend.ms === 'number' && spend.ms > 0) attrs['tangle.supervise.duration_ms'] = spend.ms
  // The platform channel travels with its provenance; an absent number emits no attribute.
  if (typeof spend.boxMinutes === 'number' && Number.isFinite(spend.boxMinutes)) {
    attrs['tangle.platform.box_minutes'] = spend.boxMinutes
  }
  if (spend.boxMinutesProvenance !== undefined) {
    attrs['tangle.platform.box_minutes_provenance'] = spend.boxMinutesProvenance
    attrs['tangle.platform.box_minutes_known'] = spend.boxMinutesKnown === true
  }
  // Absent means the live stream carried the counters: only another source is stated.
  if (spend.tokensProvenance !== undefined) {
    attrs['tangle.supervise.tokens_provenance'] = spend.tokensProvenance
  }
  return spend
}

function assignBudget(attrs: Attrs, value: unknown): void {
  if (!isRecord(value)) return
  const budget = value as unknown as Budget
  if (typeof budget.maxTokens === 'number') {
    attrs['tangle.supervise.budget.max_tokens'] = budget.maxTokens
  }
  if (typeof budget.maxIterations === 'number') {
    attrs['tangle.supervise.budget.max_iterations'] = budget.maxIterations
    attrs[ATTR.maxIterations] = budget.maxIterations
  }
  if (typeof budget.maxUsd === 'number') attrs['tangle.supervise.budget.max_usd'] = budget.maxUsd
  if (typeof budget.deadlineMs === 'number')
    attrs['tangle.supervise.budget.deadline_ms'] = budget.deadlineMs
  for (const [name, cap] of Object.entries(budget.resources ?? {})) {
    attrs[`tangle.supervise.budget.resource.${name}.limit`] = cap.limit
    attrs[`tangle.supervise.budget.resource.${name}.unit`] = cap.unit
  }
}

/** A trace id is 32 hex chars: a valid caller-supplied one is used verbatim, anything else (and the
 *  default) is DERIVED by content address from namespace and run id, so a resumed run rejoins its trace. */
function normalizeTraceId(
  traceId: string | undefined,
  runId: string,
  namespace: string | undefined,
): string {
  if (traceId && /^[0-9a-f]{32}$/i.test(traceId)) return traceId.toLowerCase()
  const source = traceId ?? (namespace === undefined ? runId : `${namespace}\u0000${runId}`)
  return contentAddress(source).slice('sha256:'.length, 'sha256:'.length + 32)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function truncate(value: string): string {
  value = String(defaultRedactor(value))
  return value.length > MAX_DETAIL_CHARS ? `${value.slice(0, MAX_DETAIL_CHARS)}…` : value
}
