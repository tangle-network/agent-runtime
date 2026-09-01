/**
 * Supervisor tree → OTLP spans. OPT-IN, off by default.
 *
 * WHY. A supervised tree is legible today only by parsing this package's own spawn journal, so
 * every other multi-agent shape on the machine (a coding-CLI's subagents, a pi fanout, ad-hoc tool
 * parallelism) needs its own bespoke reader. A span carrying `parent_span_id` IS a tree, and any
 * system can emit one — so emitting spans makes the supervisor readable by the same viewer as
 * everything else, with no per-system reader.
 *
 * WHAT IT IS NOT. This is telemetry, never the record of truth. The spawn journal remains the sole
 * durable ledger for replay/resume and for cost; nothing here is read back, and a run whose export
 * fails is unaffected in every observable way. The two data models are deliberately separate.
 *
 * HOW IT ATTACHES. This is a pure `RuntimeHooks` observer over the lifecycle events `Scope` ALREADY
 * emits — `agent.spawn` (a node opened), `agent.child` (a node settled), `agent.turn` (a driver
 * inference turn was metered). It adds no event, mutates no journal, and changes no result. Because
 * `Scope` re-seeds the same hooks into every nested scope (`makeNestedScopeSeam`), one observer sees
 * the WHOLE recursion at arbitrary depth.
 *
 * SPAN SHAPE. One span per supervised node, opened at spawn and closed at settle, parented to its
 * parent node's span; the run root is the trace. Driver inference rides as an `LLM` child span under
 * the node that metered it. Attributes reuse the vocabulary the rest of the stack already reads
 * (`openinference.span.kind`, `agent.name`, `llm.token_count.*`, `llm.cost_usd`, `tangle.cost.usd`)
 * — see `@tangle-network/agent-eval`'s `src/trace/attribute-vocabulary.ts`, which is the consumer.
 *
 * UNKNOWN IS NEVER ZERO. `Spend.tokensKnown === false` / `usdKnown === false` mark work that
 * HAPPENED with an unreported count. Those spans OMIT the token/cost attribute entirely and set
 * `tangle.supervise.tokens_known` / `tangle.supervise.cost_known` to `false`, so a reader can never
 * mistake an unmeasured turn for a free one.
 */

import { contentAddress } from '../../durable/spawn-journal'
import type { OtelExportConfig, OtelExporter, OtelSpan } from '../../otel-export'
import { createOtelExporter, generateSpanId, toOtelAttributes } from '../../otel-export'
import type { RuntimeHookEvent, RuntimeHooks } from '../../runtime-hooks'
import type { Budget, Spend, SupervisedResult } from './types'
import type { TraceContext, WorkerTraceResolver } from './worker-trace'

/** OTEL status codes (`UNSET` / `OK` / `ERROR`) — the numeric wire values `OtelSpan.status` carries. */
const STATUS_UNSET = 0
const STATUS_OK = 1
const STATUS_ERROR = 2

/** Longest string attribute value written from free-form detail, so an oversized turn payload
 *  cannot inflate a span. Identity/label attributes we control are never truncated. */
const MAX_DETAIL_CHARS = 256

/** OTLP span attribute values. Exported because `SupervisorSpanOptions.attributes` is public and
 *  a consumer cannot name the type it is asked to supply otherwise. */
export type SupervisorSpanAttributes = Record<string, string | number | boolean>

type Attrs = SupervisorSpanAttributes

export interface SupervisorSpanOptions {
  /**
   * The supervised run id (`SupervisorOpts.runId`). Roots the trace, identifies the root span, and
   * is the parent lookup key for every depth-0 spawn (a root scope's `parentId` IS the run id).
   */
  readonly runId: string
  /**
   * Bring your own exporter. It is FLUSHED but never shut down by `finish()` — a caller that owns
   * the exporter owns its lifecycle. Takes precedence over `exportConfig`.
   */
  readonly exporter?: OtelExporter
  /**
   * Otherwise build one with {@link createOtelExporter}. With no `endpoint` here it reads
   * `OTEL_EXPORTER_OTLP_ENDPOINT`, and with neither it resolves to `undefined` — which makes
   * {@link createSupervisorSpanRecorder} return `undefined` and the run emit nothing.
   */
  readonly exportConfig?: OtelExportConfig
  /**
   * Trace id (32 hex chars). Pass the caller's own to JOIN an outer trace. Default: derived
   * deterministically from `runId`, so a resumed run lands in the SAME trace as the process that
   * started it.
   */
  readonly traceId?: string
  /** Parent span id (16 hex chars) to hang the run's root span under — an inherited delegation span. */
  readonly parentSpanId?: string
  /** `agent.name` on the root span. Default `'supervisor'`. */
  readonly agentName?: string
  /** Extra attributes stamped on every span this recorder emits (subject, workspace, campaign, …). */
  readonly attributes?: Attrs
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
   * The trace context a worker spawned BY node `spawningNodeId` should inherit, so its own spans
   * join THIS trace under the span of the node that spawned it. Thread it to a run as
   * `SupervisorOpts.workerTrace` (`supervise()` does this whenever it builds a recorder) and the
   * `Scope` seeds it onto every child's `ExecutorContext`; a backend with an environment channel
   * stamps it with `workerTraceEnv`. An unknown node — one whose span was never opened — resolves
   * to the run's root span rather than to nothing, so a worker is never filed outside its own run.
   */
  readonly workerTrace: WorkerTraceResolver
  /**
   * Close the root span (and any node that never settled, marked as such), export, and flush. Safe
   * to call twice; never throws — a telemetry failure is not a run failure.
   */
  finish(outcome?: SupervisorSpanOutcome): Promise<void>
}

/** A node span held open between its `agent.spawn` and its `agent.child`. */
interface OpenNode {
  readonly spanId: string
  readonly parentSpanId: string
  readonly name: string
  readonly startMs: number
  readonly attrs: Attrs
}

/**
 * Build the span recorder for one supervised run, or `undefined` when no exporter resolves — the
 * off-by-default path. A run that passes no `exporter` and no `exportConfig` never reaches this
 * function at all; one that passes an `exportConfig` with no endpoint (and no env endpoint) gets
 * `undefined` here, so "configured but unreachable" also costs nothing.
 */
export function createSupervisorSpanRecorder(
  opts: SupervisorSpanOptions,
): SupervisorSpanRecorder | undefined {
  const exporter = opts.exporter ?? createOtelExporter(opts.exportConfig)
  if (!exporter) return undefined
  // Only an exporter we built is ours to shut down.
  const ownsExporter = opts.exporter === undefined

  const now = opts.now ?? Date.now
  const traceId = normalizeTraceId(opts.traceId, opts.runId)
  const rootSpanId = generateSpanId()
  const rootStartMs = now()
  const base: Attrs = {
    'tangle.run.id': opts.runId,
    // The sample vocabulary our own OTLP producers already emit; kept so one reader groups a
    // supervised run with a pi/coding-CLI session without a per-producer special case.
    'tangle.sessionId': opts.runId,
    ...(opts.attributes ?? {}),
  }

  /** Node id → its open span. Seeded with the run id ⇒ the root span, because a depth-0 spawn's
   *  `parentId` is the run id itself and every deeper spawn's is a real node id. */
  const open = new Map<string, OpenNode>()
  const spanIdOf = new Map<string, string>([[opts.runId, rootSpanId]])
  let finished = false

  /** Every export is best-effort: a throwing exporter must never reach the run. */
  const emit = (span: OtelSpan): void => {
    try {
      exporter.exportSpan(span)
    } catch {
      // Telemetry is not the work.
    }
  }

  const span = (
    spanId: string,
    parentSpanId: string | undefined,
    name: string,
    startMs: number,
    endMs: number,
    attrs: Attrs,
    status: number,
    message?: string,
  ): OtelSpan => ({
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name,
    kind: 1,
    startTimeUnixNano: msToNano(startMs),
    endTimeUnixNano: msToNano(Math.max(startMs, endMs)),
    attributes: toOtelAttributes(attrs),
    status: { code: status, ...(message ? { message } : {}) },
  })

  function onSpawn(event: RuntimeHookEvent): void {
    const p = record(event.payload)
    const childId = str(p.childId)
    if (!childId) return
    const label = str(p.label) ?? 'node'
    const runtime = str(p.runtime)
    const isWait = runtime === 'wait'
    const attrs: Attrs = {
      ...base,
      // A wait-state node holds no executor and burns nothing; `CHAIN` keeps a token/cost reader
      // from counting it as an agent that reported nothing.
      'openinference.span.kind': isWait ? 'CHAIN' : 'AGENT',
      'agent.name': label,
      'tangle.supervise.node.id': childId,
      'tangle.supervise.node.label': label,
      'tangle.supervise.node.kind': isWait ? 'wait' : 'agent',
      // The journal tree this node lives in: a nested driver subtree gets its own tree key, which
      // is what joins a span back to the journal rows that prove its spend.
      'tangle.supervise.tree.root': event.runId,
    }
    if (event.parentId) attrs['tangle.supervise.node.parent_id'] = event.parentId
    if (runtime) attrs['tangle.supervise.node.runtime'] = runtime
    if (typeof p.depth === 'number') attrs['tangle.supervise.node.depth'] = p.depth
    if (typeof event.stepIndex === 'number')
      attrs['tangle.supervise.node.ordinal'] = event.stepIndex
    if (p.resumed === true) attrs['tangle.supervise.node.resumed'] = true
    assignBudget(attrs, p.budget)

    const spanId = generateSpanId()
    spanIdOf.set(childId, spanId)
    open.set(childId, {
      spanId,
      parentSpanId: (event.parentId && spanIdOf.get(event.parentId)) || rootSpanId,
      name: label,
      startMs: event.timestamp,
      attrs,
    })
  }

  function onSettled(event: RuntimeHookEvent): void {
    const p = record(event.payload)
    const childId = str(p.childId)
    if (!childId) return
    const node = open.get(childId)
    if (!node) return
    open.delete(childId)

    const status = str(p.status)
    const down = status === 'down'
    const attrs: Attrs = { ...node.attrs, 'tangle.supervise.node.status': status ?? 'done' }
    if (typeof event.stepIndex === 'number') attrs['tangle.supervise.node.seq'] = event.stepIndex
    if (typeof p.outRef === 'string') attrs['tangle.supervise.node.out_ref'] = p.outRef
    if (typeof p.valid === 'boolean') attrs['tangle.supervise.verdict.valid'] = p.valid
    if (typeof p.score === 'number') attrs['tangle.supervise.verdict.score'] = p.score
    if (down) {
      attrs['error.type'] = p.infra === true ? 'infra' : 'child-down'
      const reason = str(p.reason)
      if (reason) attrs['error.message'] = truncate(reason)
      if (typeof p.infra === 'boolean') attrs['tangle.supervise.node.infra'] = p.infra
    }
    // A wait node settles with its outcome instead of a spend — free by construction, not by
    // measurement, so it carries no token or cost attribute at all.
    const wait = record(p.wait)
    const wokeBy = str(wait.settled)
    if (wokeBy) attrs['tangle.supervise.wait.settled'] = wokeBy
    assignSpend(attrs, p.spent)

    emit(
      span(
        node.spanId,
        node.parentSpanId,
        node.name,
        node.startMs,
        event.timestamp,
        attrs,
        down ? STATUS_ERROR : STATUS_OK,
        down ? (str(p.reason) ?? 'child down') : undefined,
      ),
    )
  }

  function onTurn(event: RuntimeHookEvent): void {
    const p = record(event.payload)
    const parentId = event.parentId
    const parentSpanId = (parentId && spanIdOf.get(parentId)) || rootSpanId
    const attrs: Attrs = {
      ...base,
      'openinference.span.kind': 'LLM',
      'inference.observation_kind': 'LLM',
      'tangle.supervise.node.kind': 'inference',
    }
    if (parentId) attrs['tangle.supervise.node.id'] = parentId
    // Free-form `Scope.meter` detail: named keys get the canonical attribute, the rest ride
    // namespaced and bounded so a caller's extra context survives without unbounded span growth.
    for (const [key, value] of Object.entries(p)) {
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
    const spend = assignSpend(attrs, p.spend)
    const endMs = event.timestamp + (spend?.ms ?? 0)
    emit(
      span(
        generateSpanId(),
        parentSpanId,
        'gen_ai.client.inference',
        event.timestamp,
        endMs,
        attrs,
        STATUS_OK,
      ),
    )
  }

  const hooks: RuntimeHooks = {
    onEvent(event) {
      if (finished) return
      try {
        if (event.phase !== 'after') return
        if (event.target === 'agent.spawn') onSpawn(event)
        else if (event.target === 'agent.child') onSettled(event)
        else if (event.target === 'agent.turn') onTurn(event)
      } catch {
        // A malformed payload or a broken exporter is a telemetry defect, never a run failure.
        // `notifyRuntimeHookEvent` would already contain a throw; this makes it true regardless of
        // who calls the hook.
      }
    },
  }

  return {
    hooks,
    traceId,
    rootSpanId,
    workerTrace(spawningNodeId: string): TraceContext {
      return { traceId, parentSpanId: spanIdOf.get(spawningNodeId) ?? rootSpanId }
    },
    async finish(outcome?: SupervisorSpanOutcome): Promise<void> {
      if (finished) return
      finished = true
      const endMs = now()
      try {
        // A node still open here never settled — the run was aborted, cancelled, or died with it in
        // flight. Its span is closed UNSET and explicitly marked, never silently dropped and never
        // reported as a clean finish.
        for (const [nodeId, node] of open) {
          emit(
            span(
              node.spanId,
              node.parentSpanId,
              node.name,
              node.startMs,
              endMs,
              {
                ...node.attrs,
                'tangle.supervise.node.status': 'unsettled',
                'tangle.supervise.node.settled': false,
                'tangle.supervise.node.id': nodeId,
              },
              STATUS_UNSET,
            ),
          )
        }
        open.clear()
        emit(
          span(
            rootSpanId,
            opts.parentSpanId,
            'supervisor.run',
            rootStartMs,
            endMs,
            rootAttrs(base, opts.agentName ?? 'supervisor', outcome),
            rootStatus(outcome),
            rootMessage(outcome),
          ),
        )
        await exporter.flush()
        if (ownsExporter) await exporter.shutdown()
      } catch {
        // Telemetry is not the work.
      }
    },
  }
}

// ── Attribute mapping ─────────────────────────────────────────────────────────

function rootAttrs(base: Attrs, agentName: string, outcome?: SupervisorSpanOutcome): Attrs {
  const attrs: Attrs = {
    ...base,
    'openinference.span.kind': 'AGENT',
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
        attrs['error.message'] = truncate(result.error.message)
      }
    }
    assignSpend(attrs, result.spentTotal)
  }
  if (outcome?.error !== undefined) {
    attrs['tangle.supervise.result'] = 'error'
    const err = outcome.error
    attrs['error.type'] = err instanceof Error ? err.name : typeof err
    attrs['error.message'] = truncate(err instanceof Error ? err.message : String(err))
  }
  return attrs
}

function rootStatus(outcome?: SupervisorSpanOutcome): number {
  if (outcome?.error !== undefined) return STATUS_ERROR
  if (!outcome?.result) return STATUS_UNSET
  return outcome.result.kind === 'winner' ? STATUS_OK : STATUS_ERROR
}

function rootMessage(outcome?: SupervisorSpanOutcome): string | undefined {
  if (outcome?.error !== undefined) {
    return truncate(outcome.error instanceof Error ? outcome.error.message : String(outcome.error))
  }
  const result = outcome?.result
  return result && result.kind === 'no-winner' ? result.reason : undefined
}

/**
 * Write a `Spend` onto a span, honouring the "a missing measurement is never zero" invariant: a
 * channel marked NOT known contributes no number at all and instead flags itself, so nothing
 * downstream can sum an unmeasured turn as free. Returns the spend it read (for the duration).
 */
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
  // The platform channel travels with its provenance, so a span never presents a derived box time
  // as a platform receipt. An absent number emits no attribute at all rather than a zero.
  if (typeof spend.boxMinutes === 'number' && Number.isFinite(spend.boxMinutes)) {
    attrs['tangle.platform.box_minutes'] = spend.boxMinutes
  }
  if (spend.boxMinutesProvenance !== undefined) {
    attrs['tangle.platform.box_minutes_provenance'] = spend.boxMinutesProvenance
    attrs['tangle.platform.box_minutes_known'] = spend.boxMinutesKnown === true
  }
  // Absent means the executor's live stream carried the counters, so no attribute is emitted for
  // it: a span states only that the receipt came from somewhere else.
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
  }
  if (typeof budget.maxUsd === 'number') attrs['tangle.supervise.budget.max_usd'] = budget.maxUsd
}

// ── Small helpers ─────────────────────────────────────────────────────────────

/**
 * A trace id must be 32 hex characters. A caller-supplied one is used verbatim when it already is;
 * anything else (and the default) is DERIVED from the run id by content address — deterministic, so
 * a resumed run rejoins the trace its first process opened rather than forking a new one.
 */
function normalizeTraceId(traceId: string | undefined, runId: string): string {
  if (traceId && /^[0-9a-f]{32}$/i.test(traceId)) return traceId.toLowerCase()
  return contentAddress(traceId ?? runId).slice('sha256:'.length, 'sha256:'.length + 32)
}

function msToNano(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.floor(ms) : 0
  return (BigInt(safe) * 1_000_000n).toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function truncate(value: string): string {
  return value.length > MAX_DETAIL_CHARS ? `${value.slice(0, MAX_DETAIL_CHARS)}…` : value
}
