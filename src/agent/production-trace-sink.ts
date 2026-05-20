/**
 * `createProductionTraceSink` — the production-side capture primitive
 * every vertical agent's chat handler wires in once.
 *
 * Closes the data-leak: until now, every production chat session emitted
 * zero replayable trace data. Eval runs captured everything; production
 * captured nothing. RL training corpora, research analyses, and the
 * self-improvement loop all ran on synthetic personas. This primitive
 * makes every real user conversation a piece of data the downstream
 * channels (Prime Intellect, GEPA, research, canaries, analyst loop)
 * can consume.
 *
 * Wiring (per agent, ~10 lines in the production chat handler):
 *
 *   ```ts
 *   const sink = createProductionTraceSink({
 *     projectId: 'tax-agent',
 *     otlp: { endpoint: env.LANGFUSE_OTEL_ENDPOINT, authHeader: env.LANGFUSE_OTEL_AUTH },
 *     runRecordStore: drizzleRunRecordStore(db),
 *     feedbackStore: drizzleFeedbackStore(db),
 *   })
 *
 *   const emitter = new TraceEmitter(sink.traceStore, {
 *     onRunComplete: [sink.onRunComplete],
 *   })
 *   await emitter.startRun({
 *     scenarioId: sessionId,
 *     projectId: 'tax-agent',
 *     layer: 'app-runtime',
 *   })
 *   // ... existing chat flow, with LLM/tool spans emitted ...
 *   await emitter.endRun({ pass, score })
 *   // sink.onRunComplete fires automatically:
 *   //   1. composes RunRecord, persists to runRecordStore
 *   //   2. exports run as OTLP, POSTs to Langfuse
 *   //   3. logs failures (does NOT throw — never crashes the chat handler)
 *   ```
 *
 * Separately, the agent's feedback endpoint calls `sink.recordFeedback`
 * to write user thumbs-up/thumbs-down (or richer labels) into the
 * FeedbackTrajectory store — the corpus DPO/KTO trainers consume.
 *
 * Cloudflare Worker semantics: the sink buffers spans in memory through
 * the request lifetime (via agent-eval's `InMemoryTraceStore`).
 * `onRunComplete` is awaited (typically inside `ctx.waitUntil`) so the
 * worker stays alive long enough to flush. The OTLP POST is fire-and-
 * forget — failures are logged but never surface to the chat user.
 */

import {
  exportRunAsOtlp,
  type FeedbackLabel,
  type FeedbackTrajectoryStore,
  InMemoryTraceStore,
  type RunCompleteHook,
  type RunCompleteHookContext,
  type TraceStore,
} from '@tangle-network/agent-eval'

// ── public API ───────────────────────────────────────────────────────

export interface ProductionTraceSinkOpts {
  /**
   * Stable agent identifier — appears in OTLP `service.name`, every
   * RunRecord row, every FeedbackTrajectory row. MUST match the
   * agent's repo name to keep cross-repo telemetry joinable.
   */
  projectId: string

  /**
   * OTLP forwarding target. Typically Langfuse's HTTP receiver. Omit to
   * disable OTLP export (RunRecord persistence still works).
   *
   * `authHeader` is the full header value (e.g. `Basic <base64>`); the
   * sink does NOT base64-encode for you.
   */
  otlp?: {
    endpoint: string
    authHeader?: string
    /** Optional resource attributes merged into every span batch. */
    resourceAttributes?: Record<string, string | number | boolean>
  }

  /**
   * Durable RunRecord persistence. Per-vertical agents implement this
   * over their own DB (Drizzle / D1 / Postgres). Optional — when omitted,
   * RunRecords stay in-memory and are lost when the worker isolate ends.
   */
  runRecordStore?: ProductionRunRecordStore

  /**
   * Durable feedback persistence. Used by `recordFeedback`; agents wire
   * their thumbs-up/down + free-text feedback endpoints to call into the
   * sink, which writes a `FeedbackLabel` into a `FeedbackTrajectory`.
   *
   * Optional — when omitted, `recordFeedback` is a no-op.
   */
  feedbackStore?: FeedbackTrajectoryStore

  /**
   * Pluggable fetch — defaults to globalThis.fetch. Tests inject a
   * mocked fetch.
   */
  fetch?: typeof fetch

  /**
   * Pluggable structured logger — defaults to console.warn for failures.
   * The sink NEVER throws on flush failure; it logs and returns.
   */
  log?: (msg: string, fields?: Record<string, unknown>) => void
}

/**
 * Durable per-agent RunRecord persistence. Each vertical implements over
 * its own DB. The sink calls `append` once per `endRun`.
 */
export interface ProductionRunRecordStore {
  append(record: ProductionRunRecord): Promise<void>
}

/**
 * Minimal canonical row the sink composes on `endRun`. Per-agent DB
 * adapters extend with their own fields; the sink only writes what
 * the runtime canonically captures.
 */
export interface ProductionRunRecord {
  runId: string
  projectId: string
  scenarioId: string
  variantId?: string
  startedAt: string
  endedAt: string
  status: 'completed' | 'failed' | 'aborted'
  pass?: boolean
  score?: number
  failureClass?: string
  notes?: string
  /** Echoed back from `emitter.startRun({ tags })`. */
  tags?: Record<string, string>
  /** Span row count — useful for diagnostics. */
  spanCount: number
}

export interface ProductionTraceSink {
  /**
   * The TraceStore the agent's `TraceEmitter` writes to. In-memory by
   * design: spans accumulate through the chat session, flush at
   * `onRunComplete`. The runtime never reads from this store directly —
   * the sink reads from it during the flush step.
   */
  traceStore: TraceStore

  /**
   * Hook the agent passes into
   * `new TraceEmitter(store, { onRunComplete: [sink.onRunComplete] })`.
   * Fires once per chat session at `endRun` time. Composes the
   * RunRecord, persists, and ships OTLP. Errors are logged, never thrown.
   */
  onRunComplete: RunCompleteHook

  /**
   * Append a user feedback label (thumbs-up/down, correction, severity)
   * to the FeedbackTrajectory for a completed run. Creates a minimal
   * trajectory anchored to the run if one doesn't exist; appends the
   * label if it does. No-op when `feedbackStore` is undefined.
   *
   * Returns the trajectory id (existing or freshly created) for the
   * agent's API to link back to the session, or `null` on no-op /
   * error.
   */
  recordFeedback(input: RecordFeedbackInput): Promise<string | null>
}

export interface RecordFeedbackInput {
  /** Run id from the original `emitter.startRun`. */
  runId: string
  /** The user-supplied feedback label. */
  label: FeedbackLabel
  /** Optional scenario id (mirrors the run's). */
  scenarioId?: string
  /** Optional pre-existing trajectory id if the agent tracks them separately. */
  trajectoryId?: string
}

// ── factory ──────────────────────────────────────────────────────────

export function createProductionTraceSink(
  opts: ProductionTraceSinkOpts,
): ProductionTraceSink {
  const log = opts.log ?? defaultLog
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const traceStore = new InMemoryTraceStore()

  const onRunComplete: RunCompleteHook = async (ctx: RunCompleteHookContext) => {
    // 1. Compose canonical RunRecord and persist if a store is wired.
    if (opts.runRecordStore) {
      try {
        const record = await composeRunRecord(traceStore, ctx, opts.projectId)
        await opts.runRecordStore.append(record)
      } catch (err) {
        log('runRecordStore.append failed', {
          runId: ctx.runId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // 2. Export the run as OTLP and POST to the configured collector.
    if (opts.otlp) {
      try {
        const resourceAttrs: Record<string, string | number | boolean> = {
          'service.name': opts.projectId,
          ...(opts.otlp.resourceAttributes ?? {}),
        }
        const otlpPayload = await exportRunAsOtlp(traceStore, ctx.runId, resourceAttrs)
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (opts.otlp.authHeader) headers.authorization = opts.otlp.authHeader
        const res = await fetchImpl(opts.otlp.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(otlpPayload),
        })
        if (!res.ok) {
          log('OTLP POST non-2xx', {
            runId: ctx.runId,
            status: res.status,
            endpoint: opts.otlp.endpoint,
          })
        }
      } catch (err) {
        log('OTLP POST threw', {
          runId: ctx.runId,
          error: err instanceof Error ? err.message : String(err),
          endpoint: opts.otlp.endpoint,
        })
      }
    }
  }

  const recordFeedback = async (
    input: RecordFeedbackInput,
  ): Promise<string | null> => {
    if (!opts.feedbackStore) return null
    const trajectoryId = input.trajectoryId ?? `traj-${input.runId}`
    try {
      const existing = await opts.feedbackStore.get(trajectoryId)
      if (existing) {
        await opts.feedbackStore.appendLabel(trajectoryId, input.label)
        return trajectoryId
      }
      // Create a minimal trajectory anchored to the run; the agent's eval-time
      // pipeline can backfill richer task / attempts data when it replays.
      await opts.feedbackStore.save({
        id: trajectoryId,
        projectId: opts.projectId,
        scenarioId: input.scenarioId ?? input.runId,
        task: { intent: 'chat', context: { runId: input.runId } },
        attempts: [],
        labels: [input.label],
        createdAt: new Date().toISOString(),
      })
      return trajectoryId
    } catch (err) {
      log('feedbackStore write failed', {
        runId: input.runId,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  return { traceStore, onRunComplete, recordFeedback }
}

// ── helpers ──────────────────────────────────────────────────────────

async function composeRunRecord(
  store: TraceStore,
  ctx: RunCompleteHookContext,
  projectId: string,
): Promise<ProductionRunRecord> {
  const run = await store.getRun(ctx.runId)
  const spans = await store.spans({ runId: ctx.runId })
  // Run timestamps are epoch ms in the trace schema; consumers downstream
  // expect ISO strings (DB columns, dashboards, dataset joins) so we convert
  // at the sink boundary.
  const now = Date.now()
  const startedAtMs = run?.startedAt ?? now
  const endedAtMs = run?.endedAt ?? now
  return {
    runId: ctx.runId,
    projectId,
    scenarioId: run?.scenarioId ?? ctx.runId,
    variantId: run?.variantId,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    status: ctx.status,
    pass: ctx.outcome?.pass,
    score: ctx.outcome?.score,
    failureClass: ctx.outcome?.failureClass,
    notes: ctx.outcome?.notes,
    tags: run?.tags,
    spanCount: spans.length,
  }
}

function defaultLog(msg: string, fields?: Record<string, unknown>): void {
  if (fields) console.warn(`[production-trace-sink] ${msg}`, fields)
  else console.warn(`[production-trace-sink] ${msg}`)
}
