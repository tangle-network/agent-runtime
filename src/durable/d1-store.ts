/**
 * D1DurableRunStore — the production path for Cloudflare Workers. Backed by
 * a D1 (SQLite-compatible) database via the binding the worker already holds.
 *
 * Apply `./schema.sql` once before use; the store itself does not run DDL.
 * Migration version is recorded in `durable_schema_info`; consumers can
 * inspect `getSchemaVersion()` if they ship a migration tool.
 *
 * Why structural typing: agent-runtime stays Cloudflare-free at the dep
 * level. Consumers pass their `D1Database` binding — TypeScript matches the
 * minimal `D1DatabaseLike` surface below. Tests use the same interface with
 * a fake.
 */

import { manifestHash } from './identity'
import {
  DurableRunDivergenceError,
  DurableRunInputMismatchError,
  DurableRunLeaseHeldError,
  type DurableRunManifest,
  type DurableRunStore,
  type EventRecord,
  type RunHandle,
  type RunOutcome,
  type RunRecord,
  type StepError,
  type StepKind,
  type StepRecord,
  type StreamEventRecord,
} from './types'

const DEFAULT_LEASE_MS = 30_000

/**
 * Minimal D1 surface this store uses. Compatible with Cloudflare's
 * `D1Database` from `@cloudflare/workers-types`. Defined locally so
 * agent-runtime does not depend on workers-types at the package level.
 */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>
}

interface RunRow {
  run_id: string
  manifest_hash: string
  project_id: string
  scenario_id: string | null
  status: RunRecord['status']
  created_at: string
  updated_at: string
  completed_at: string | null
  lease_holder_id: string | null
  lease_expires_at: string | null
  outcome_json: string | null
  step_count: number
  handle_json: string | null
}

interface StreamEventRow {
  run_id: string
  seq: number
  event_id: string
  payload_json: string | null
  appended_at: string
}

interface StepRow {
  run_id: string
  step_index: number
  intent: string
  kind: string
  input_hash: string
  status: StepRecord['status']
  attempts: number
  result_json: string | null
  error_json: string | null
  started_at: string | null
  completed_at: string | null
}

interface EventRow {
  run_id: string
  key: string
  payload_json: string | null
  emitted_at: string
}

export class D1DurableRunStore implements DurableRunStore {
  constructor(private readonly db: D1DatabaseLike) {}

  /** Override for tests — defaults to Date.now(). */
  public now: () => number = () => Date.now()

  async startOrResume(input: {
    runId: string
    manifest: DurableRunManifest
    workerId: string
    leaseMs?: number
  }): ReturnType<DurableRunStore['startOrResume']> {
    const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS
    const hash = manifestHash(input.manifest)
    const nowMs = this.now()
    const nowIso = new Date(nowMs).toISOString()
    const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString()

    const existing = await this.db
      .prepare('SELECT * FROM durable_runs WHERE run_id = ?')
      .bind(input.runId)
      .first<RunRow>()

    if (!existing) {
      await this.db
        .prepare(
          `INSERT INTO durable_runs
             (run_id, manifest_hash, project_id, scenario_id, status,
              created_at, updated_at, lease_holder_id, lease_expires_at, step_count)
           VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, 0)`,
        )
        .bind(
          input.runId,
          hash,
          input.manifest.projectId,
          input.manifest.scenarioId ?? null,
          nowIso,
          nowIso,
          input.workerId,
          leaseExpiresAt,
        )
        .run()
      const record: RunRecord = {
        runId: input.runId,
        manifestHash: hash,
        projectId: input.manifest.projectId,
        scenarioId: input.manifest.scenarioId,
        status: 'running',
        createdAt: nowIso,
        updatedAt: nowIso,
        leaseHolderId: input.workerId,
        leaseExpiresAt,
        stepCount: 0,
      }
      return { run: record, completedSteps: [], leaseExpiresAt }
    }

    if (existing.manifest_hash !== hash) {
      throw new DurableRunInputMismatchError(
        `runId ${input.runId} exists with a different manifest hash; refuse to corrupt prior steps`,
      )
    }
    // Lease takeover — conditional UPDATE.
    const claim = await this.db
      .prepare(
        `UPDATE durable_runs
           SET lease_holder_id = ?,
               lease_expires_at = ?,
               updated_at = ?,
               status = CASE WHEN status IN ('completed','failed') THEN status ELSE 'running' END
         WHERE run_id = ?
           AND (
             lease_holder_id = ? OR
             lease_holder_id IS NULL OR
             lease_expires_at IS NULL OR
             lease_expires_at < ?
           )`,
      )
      .bind(input.workerId, leaseExpiresAt, nowIso, input.runId, input.workerId, nowIso)
      .run()
    const changes = claim.meta?.changes ?? 0
    if (changes === 0) {
      throw new DurableRunLeaseHeldError(
        `runId ${input.runId} leased by ${existing.lease_holder_id} until ${existing.lease_expires_at}`,
      )
    }
    const completedSteps = await this.readSteps(input.runId, 'completed')
    const record: RunRecord = rowToRunRecord({
      ...existing,
      lease_holder_id: input.workerId,
      lease_expires_at: leaseExpiresAt,
      updated_at: nowIso,
      status:
        existing.status === 'completed' || existing.status === 'failed'
          ? existing.status
          : 'running',
    })
    return { run: record, completedSteps, leaseExpiresAt }
  }

  async renewLease(input: {
    runId: string
    workerId: string
    leaseMs?: number
  }): Promise<{ ok: boolean; leaseExpiresAt?: string }> {
    const nowMs = this.now()
    const nowIso = new Date(nowMs).toISOString()
    const leaseExpiresAt = new Date(nowMs + (input.leaseMs ?? DEFAULT_LEASE_MS)).toISOString()
    const res = await this.db
      .prepare(
        `UPDATE durable_runs
           SET lease_expires_at = ?, updated_at = ?
         WHERE run_id = ?
           AND (lease_holder_id = ? OR lease_expires_at IS NULL OR lease_expires_at < ?)`,
      )
      .bind(leaseExpiresAt, nowIso, input.runId, input.workerId, nowIso)
      .run()
    const ok = (res.meta?.changes ?? 0) > 0
    return ok ? { ok: true, leaseExpiresAt } : { ok: false }
  }

  async loadStep(runId: string, stepIndex: number): Promise<StepRecord | undefined> {
    const row = await this.db
      .prepare('SELECT * FROM durable_steps WHERE run_id = ? AND step_index = ?')
      .bind(runId, stepIndex)
      .first<StepRow>()
    return row ? rowToStepRecord(row) : undefined
  }

  async beginStep(input: {
    runId: string
    stepIndex: number
    intent: string
    kind: StepKind
    inputHash: string
  }): Promise<StepRecord> {
    const nowIso = new Date(this.now()).toISOString()
    const prior = await this.loadStep(input.runId, input.stepIndex)
    if (prior) {
      if (prior.intent !== input.intent) {
        throw new DurableRunDivergenceError(
          `step ${input.stepIndex}: intent changed ('${prior.intent}' -> '${input.intent}')`,
        )
      }
      await this.db
        .prepare(
          `UPDATE durable_steps
             SET status='running', attempts = attempts + 1, started_at = ?, error_json = NULL
           WHERE run_id = ? AND step_index = ?`,
        )
        .bind(nowIso, input.runId, input.stepIndex)
        .run()
      await this.bumpUpdated(input.runId, nowIso)
      return {
        ...prior,
        attempts: prior.attempts + 1,
        status: 'running',
        startedAt: nowIso,
        error: undefined,
      }
    }
    await this.db
      .prepare(
        `INSERT INTO durable_steps
           (run_id, step_index, intent, kind, input_hash, status, attempts, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', 1, ?)`,
      )
      .bind(input.runId, input.stepIndex, input.intent, input.kind, input.inputHash, nowIso)
      .run()
    await this.db
      .prepare(
        `UPDATE durable_runs
           SET step_count = MAX(step_count, ?), updated_at = ?
         WHERE run_id = ?`,
      )
      .bind(input.stepIndex + 1, nowIso, input.runId)
      .run()
    return {
      runId: input.runId,
      stepIndex: input.stepIndex,
      intent: input.intent,
      kind: input.kind,
      inputHash: input.inputHash,
      status: 'running',
      attempts: 1,
      startedAt: nowIso,
    }
  }

  async completeStep(input: {
    runId: string
    stepIndex: number
    result: unknown
  }): Promise<StepRecord> {
    const nowIso = new Date(this.now()).toISOString()
    await this.db
      .prepare(
        `UPDATE durable_steps
           SET status='completed', result_json = ?, completed_at = ?, error_json = NULL
         WHERE run_id = ? AND step_index = ?`,
      )
      .bind(JSON.stringify(input.result ?? null), nowIso, input.runId, input.stepIndex)
      .run()
    await this.bumpUpdated(input.runId, nowIso)
    const row = await this.loadStep(input.runId, input.stepIndex)
    if (!row) {
      throw new Error(`durable-runs: completeStep cannot find step ${input.stepIndex}`)
    }
    return row
  }

  async failStep(input: {
    runId: string
    stepIndex: number
    error: StepError
  }): Promise<StepRecord> {
    const nowIso = new Date(this.now()).toISOString()
    await this.db
      .prepare(
        `UPDATE durable_steps
           SET status='failed', error_json = ?, completed_at = ?
         WHERE run_id = ? AND step_index = ?`,
      )
      .bind(JSON.stringify(input.error), nowIso, input.runId, input.stepIndex)
      .run()
    await this.bumpUpdated(input.runId, nowIso)
    const row = await this.loadStep(input.runId, input.stepIndex)
    if (!row) {
      throw new Error(`durable-runs: failStep cannot find step ${input.stepIndex}`)
    }
    return row
  }

  async endRun(input: {
    runId: string
    workerId: string
    status: 'completed' | 'failed'
    outcome?: RunOutcome
  }): Promise<RunRecord> {
    const nowIso = new Date(this.now()).toISOString()
    await this.db
      .prepare(
        `UPDATE durable_runs
           SET status = ?, completed_at = ?, updated_at = ?,
               outcome_json = ?,
               lease_holder_id = CASE WHEN lease_holder_id = ? THEN NULL ELSE lease_holder_id END,
               lease_expires_at = CASE WHEN lease_holder_id = ? THEN NULL ELSE lease_expires_at END
         WHERE run_id = ?`,
      )
      .bind(
        input.status,
        nowIso,
        nowIso,
        input.outcome ? JSON.stringify(input.outcome) : null,
        input.workerId,
        input.workerId,
        input.runId,
      )
      .run()
    const row = await this.db
      .prepare('SELECT * FROM durable_runs WHERE run_id = ?')
      .bind(input.runId)
      .first<RunRow>()
    if (!row) throw new Error(`durable-runs: endRun cannot find run ${input.runId}`)
    return rowToRunRecord(row)
  }

  async emitEvent(input: {
    runId: string
    key: string
    payload: unknown
  }): ReturnType<DurableRunStore['emitEvent']> {
    const nowIso = new Date(this.now()).toISOString()
    // INSERT OR IGNORE — first emit wins; subsequent inserts no-op.
    const res = await this.db
      .prepare(
        `INSERT OR IGNORE INTO durable_events (run_id, key, payload_json, emitted_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(input.runId, input.key, JSON.stringify(input.payload ?? null), nowIso)
      .run()
    const accepted = (res.meta?.changes ?? 0) > 0
    const row = await this.db
      .prepare('SELECT * FROM durable_events WHERE run_id = ? AND key = ?')
      .bind(input.runId, input.key)
      .first<EventRow>()
    if (!row) throw new Error('durable-runs: emitEvent failed to persist or read back')
    return {
      accepted,
      record: rowToEventRecord(row),
    }
  }

  async loadEvent(runId: string, key: string): Promise<EventRecord | undefined> {
    const row = await this.db
      .prepare('SELECT * FROM durable_events WHERE run_id = ? AND key = ?')
      .bind(runId, key)
      .first<EventRow>()
    return row ? rowToEventRecord(row) : undefined
  }

  async appendStreamEvent(input: {
    runId: string
    eventId: string
    payload: unknown
  }): ReturnType<DurableRunStore['appendStreamEvent']> {
    const nowIso = new Date(this.now()).toISOString()
    // INSERT OR IGNORE — the UNIQUE(run_id, event_id) index makes a re-append
    // a no-op; seq is the next monotonic value, computed atomically with the
    // insert. A new event_id never collides on the (run_id, seq) PK.
    const res = await this.db
      .prepare(
        `INSERT OR IGNORE INTO durable_stream_events (run_id, seq, event_id, payload_json, appended_at)
         VALUES (
           ?,
           (SELECT COALESCE(MAX(seq), -1) + 1 FROM durable_stream_events WHERE run_id = ?),
           ?, ?, ?
         )`,
      )
      .bind(input.runId, input.runId, input.eventId, JSON.stringify(input.payload ?? null), nowIso)
      .run()
    const accepted = (res.meta?.changes ?? 0) > 0
    const row = await this.db
      .prepare('SELECT * FROM durable_stream_events WHERE run_id = ? AND event_id = ?')
      .bind(input.runId, input.eventId)
      .first<StreamEventRow>()
    if (!row) throw new Error('durable-runs: appendStreamEvent failed to persist or read back')
    return { accepted, record: rowToStreamEventRecord(row) }
  }

  async readStreamEvents(
    runId: string,
    afterSeq?: number,
  ): Promise<ReadonlyArray<StreamEventRecord>> {
    const { results } = await this.db
      .prepare('SELECT * FROM durable_stream_events WHERE run_id = ? AND seq > ? ORDER BY seq')
      .bind(runId, afterSeq ?? -1)
      .all<StreamEventRow>()
    return results.map(rowToStreamEventRecord)
  }

  async setRunHandle(input: { runId: string; handle: RunHandle }): Promise<void> {
    const nowIso = new Date(this.now()).toISOString()
    await this.db
      .prepare('UPDATE durable_runs SET handle_json = ?, updated_at = ? WHERE run_id = ?')
      .bind(JSON.stringify(input.handle), nowIso, input.runId)
      .run()
  }

  async close(): Promise<void> {
    // D1 binding lifecycle is owned by the runtime; no-op.
  }

  /** Inspect the currently-applied schema version. */
  async getSchemaVersion(): Promise<number | undefined> {
    const row = await this.db
      .prepare('SELECT MAX(version) AS version FROM durable_schema_info')
      .first<{ version: number | null }>()
    return row?.version ?? undefined
  }

  // ── internals ──────────────────────────────────────────────────────

  private async readSteps(
    runId: string,
    status: StepRecord['status'],
  ): Promise<ReadonlyArray<StepRecord>> {
    const { results } = await this.db
      .prepare('SELECT * FROM durable_steps WHERE run_id = ? AND status = ? ORDER BY step_index')
      .bind(runId, status)
      .all<StepRow>()
    return results.map(rowToStepRecord)
  }

  private async bumpUpdated(runId: string, nowIso: string): Promise<void> {
    await this.db
      .prepare('UPDATE durable_runs SET updated_at = ? WHERE run_id = ?')
      .bind(nowIso, runId)
      .run()
  }
}

// ── row → record helpers ───────────────────────────────────────────────

function rowToRunRecord(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    manifestHash: row.manifest_hash,
    projectId: row.project_id,
    scenarioId: row.scenario_id ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    leaseHolderId: row.lease_holder_id ?? undefined,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
    outcome: row.outcome_json ? (JSON.parse(row.outcome_json) as RunOutcome) : undefined,
    stepCount: row.step_count,
    handle: row.handle_json ? (JSON.parse(row.handle_json) as RunHandle) : undefined,
  }
}

function rowToStreamEventRecord(row: StreamEventRow): StreamEventRecord {
  return {
    runId: row.run_id,
    seq: row.seq,
    eventId: row.event_id,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    appendedAt: row.appended_at,
  }
}

function rowToStepRecord(row: StepRow): StepRecord {
  return {
    runId: row.run_id,
    stepIndex: row.step_index,
    intent: row.intent,
    kind: row.kind as StepKind,
    inputHash: row.input_hash,
    status: row.status,
    attempts: row.attempts,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    error: row.error_json ? (JSON.parse(row.error_json) as StepError) : undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  }
}

function rowToEventRecord(row: EventRow): EventRecord {
  return {
    runId: row.run_id,
    key: row.key,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    emittedAt: row.emitted_at,
  }
}
