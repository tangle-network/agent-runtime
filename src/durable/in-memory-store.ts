/**
 * In-memory DurableRunStore for dev + tests. Single-process. All state lives
 * in maps. Lease enforcement is real (Date.now() vs lease deadline) so the
 * crash-recovery + multi-worker race tests run identically against this and
 * the file-system / D1 stores.
 */

import { manifestHash } from './identity'
import type {
  DurableRunManifest,
  DurableRunStore,
  EventRecord,
  RunOutcome,
  RunRecord,
  StepError,
  StepKind,
  StepRecord,
} from './types'
import {
  DurableRunDivergenceError,
  DurableRunInputMismatchError,
  DurableRunLeaseHeldError,
} from './types'

const DEFAULT_LEASE_MS = 30_000

interface RunState {
  record: RunRecord
  steps: Map<number, StepRecord>
  events: Map<string, EventRecord>
}

export class InMemoryDurableRunStore implements DurableRunStore {
  private readonly runs = new Map<string, RunState>()
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
    const leaseExpiresMs = nowMs + leaseMs
    const leaseExpiresAt = new Date(leaseExpiresMs).toISOString()

    let state = this.runs.get(input.runId)
    if (!state) {
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
      state = { record, steps: new Map(), events: new Map() }
      this.runs.set(input.runId, state)
      return { run: { ...record }, completedSteps: [], leaseExpiresAt }
    }

    if (state.record.manifestHash !== hash) {
      throw new DurableRunInputMismatchError(
        `runId ${input.runId} exists with a different manifest hash; refuse to corrupt prior steps`,
      )
    }
    // Lease check — held by another worker with a non-expired lease.
    const leaseStillLive =
      state.record.leaseHolderId !== undefined &&
      state.record.leaseHolderId !== input.workerId &&
      state.record.leaseExpiresAt !== undefined &&
      new Date(state.record.leaseExpiresAt).getTime() > nowMs
    if (leaseStillLive) {
      throw new DurableRunLeaseHeldError(
        `runId ${input.runId} is leased by ${state.record.leaseHolderId} until ${state.record.leaseExpiresAt}`,
      )
    }
    // Acquire / renew.
    state.record.leaseHolderId = input.workerId
    state.record.leaseExpiresAt = leaseExpiresAt
    state.record.status =
      state.record.status === 'completed' || state.record.status === 'failed'
        ? state.record.status
        : 'running'
    state.record.updatedAt = nowIso
    const completed = [...state.steps.values()]
      .filter((s) => s.status === 'completed')
      .sort((a, b) => a.stepIndex - b.stepIndex)
    return {
      run: { ...state.record },
      completedSteps: completed.map((s) => ({ ...s })),
      leaseExpiresAt,
    }
  }

  async renewLease(input: {
    runId: string
    workerId: string
    leaseMs?: number
  }): Promise<{ ok: boolean; leaseExpiresAt?: string }> {
    const state = this.runs.get(input.runId)
    if (!state) return { ok: false }
    const nowMs = this.now()
    if (state.record.leaseHolderId !== input.workerId) {
      // Lease lapsed — another worker may have taken over.
      if (state.record.leaseExpiresAt && new Date(state.record.leaseExpiresAt).getTime() > nowMs) {
        return { ok: false }
      }
    }
    const leaseExpiresMs = nowMs + (input.leaseMs ?? DEFAULT_LEASE_MS)
    const leaseExpiresAt = new Date(leaseExpiresMs).toISOString()
    state.record.leaseHolderId = input.workerId
    state.record.leaseExpiresAt = leaseExpiresAt
    state.record.updatedAt = new Date(nowMs).toISOString()
    return { ok: true, leaseExpiresAt }
  }

  async loadStep(runId: string, stepIndex: number): Promise<StepRecord | undefined> {
    const state = this.runs.get(runId)
    return state ? cloneStep(state.steps.get(stepIndex)) : undefined
  }

  async beginStep(input: {
    runId: string
    stepIndex: number
    intent: string
    kind: StepKind
    inputHash: string
  }): Promise<StepRecord> {
    const state = this.requireRun(input.runId)
    const nowIso = new Date(this.now()).toISOString()
    const prior = state.steps.get(input.stepIndex)
    if (prior) {
      if (prior.intent !== input.intent) {
        throw new DurableRunDivergenceError(
          `step ${input.stepIndex}: intent changed across replays ('${prior.intent}' -> '${input.intent}')`,
        )
      }
      // Begin called again — bump attempts. A prior failed or running step
      // can re-execute; a prior completed step would be filtered before begin
      // is called (the runner short-circuits on cached results).
      prior.attempts += 1
      prior.status = 'running'
      prior.startedAt = nowIso
      prior.error = undefined
      state.record.updatedAt = nowIso
      return cloneStep(prior)!
    }
    const rec: StepRecord = {
      runId: input.runId,
      stepIndex: input.stepIndex,
      intent: input.intent,
      kind: input.kind,
      inputHash: input.inputHash,
      status: 'running',
      attempts: 1,
      startedAt: nowIso,
    }
    state.steps.set(input.stepIndex, rec)
    state.record.stepCount = Math.max(state.record.stepCount, input.stepIndex + 1)
    state.record.updatedAt = nowIso
    return cloneStep(rec)!
  }

  async completeStep(input: {
    runId: string
    stepIndex: number
    result: unknown
  }): Promise<StepRecord> {
    const state = this.requireRun(input.runId)
    const rec = state.steps.get(input.stepIndex)
    if (!rec) {
      throw new Error(
        `durable-runs: completeStep called before beginStep (step ${input.stepIndex})`,
      )
    }
    const nowIso = new Date(this.now()).toISOString()
    rec.status = 'completed'
    rec.result = input.result
    rec.completedAt = nowIso
    rec.error = undefined
    state.record.updatedAt = nowIso
    return cloneStep(rec)!
  }

  async failStep(input: {
    runId: string
    stepIndex: number
    error: StepError
  }): Promise<StepRecord> {
    const state = this.requireRun(input.runId)
    const rec = state.steps.get(input.stepIndex)
    if (!rec) {
      throw new Error(`durable-runs: failStep called before beginStep (step ${input.stepIndex})`)
    }
    const nowIso = new Date(this.now()).toISOString()
    rec.status = 'failed'
    rec.error = input.error
    rec.completedAt = nowIso
    state.record.updatedAt = nowIso
    return cloneStep(rec)!
  }

  async endRun(input: {
    runId: string
    workerId: string
    status: 'completed' | 'failed'
    outcome?: RunOutcome
  }): Promise<RunRecord> {
    const state = this.requireRun(input.runId)
    const nowIso = new Date(this.now()).toISOString()
    state.record.status = input.status
    state.record.outcome = input.outcome
    state.record.completedAt = nowIso
    state.record.updatedAt = nowIso
    // Release lease iff caller still holds it.
    if (state.record.leaseHolderId === input.workerId) {
      state.record.leaseHolderId = undefined
      state.record.leaseExpiresAt = undefined
    }
    return { ...state.record }
  }

  async emitEvent(input: {
    runId: string
    key: string
    payload: unknown
  }): ReturnType<DurableRunStore['emitEvent']> {
    const state = this.requireRun(input.runId)
    const existing = state.events.get(input.key)
    if (existing) {
      return { accepted: false, record: { ...existing } }
    }
    const rec: EventRecord = {
      runId: input.runId,
      key: input.key,
      payload: input.payload,
      emittedAt: new Date(this.now()).toISOString(),
    }
    state.events.set(input.key, rec)
    return { accepted: true, record: { ...rec } }
  }

  async loadEvent(runId: string, key: string): Promise<EventRecord | undefined> {
    const state = this.runs.get(runId)
    if (!state) return undefined
    const rec = state.events.get(key)
    return rec ? { ...rec } : undefined
  }

  async close(): Promise<void> {
    this.runs.clear()
  }

  // ── test helpers ───────────────────────────────────────────────────
  /** @internal — used by tests to inspect lease metadata. */
  _inspect(runId: string): RunRecord | undefined {
    const s = this.runs.get(runId)
    return s ? { ...s.record } : undefined
  }

  /** @internal — used by tests to simulate lease expiry. */
  _expireLease(runId: string): void {
    const s = this.runs.get(runId)
    if (s) {
      s.record.leaseHolderId = undefined
      s.record.leaseExpiresAt = undefined
    }
  }

  private requireRun(runId: string): RunState {
    const s = this.runs.get(runId)
    if (!s) {
      throw new Error(`durable-runs: run ${runId} not found (must call startOrResume first)`)
    }
    return s
  }
}

function cloneStep(rec: StepRecord | undefined): StepRecord | undefined {
  if (!rec) return undefined
  return { ...rec, error: rec.error ? { ...rec.error } : undefined }
}
