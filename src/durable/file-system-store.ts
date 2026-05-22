/**
 * FileSystemDurableRunStore — durable-run substrate backed by a directory
 * tree under a single root. One subdir per run:
 *
 *   <root>/<runId>/
 *     run.json         — RunRecord (rewritten on every mutation; the only
 *                        scalar fields are status/lease, so this stays small)
 *     steps.jsonl      — append-only StepRecord stream; one JSON per line
 *     events.jsonl     — append-only EventRecord stream
 *     lease.json       — current leaseholder + deadline (separate from
 *                        run.json so renewLease writes one tiny file
 *                        instead of round-tripping the whole run record)
 *
 * Concurrency: the eval harness is single-process — we rely on Node's
 * append-mode semantics for atomicity of step / event writes (single-line
 * writes < PIPE_BUF are atomic on POSIX). For run.json / lease.json we write
 * to a `<file>.tmp` then `rename` to make replacement atomic. This is
 * sufficient for the single-process eval harness use case. Multi-process
 * concurrency on the SAME filesystem requires a flock-based extension;
 * for that path use D1DurableRunStore.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { appendFile, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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

interface LeaseFile {
  workerId: string
  leaseExpiresAt: string
}

export class FileSystemDurableRunStore implements DurableRunStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true })
  }

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
    const dir = this.runDir(input.runId)

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
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
      await this.writeRun(record)
      await this.writeLease(input.runId, { workerId: input.workerId, leaseExpiresAt })
      // Touch the jsonl files so listing them later doesn't ENOENT.
      await appendFile(join(dir, 'steps.jsonl'), '', 'utf8')
      await appendFile(join(dir, 'events.jsonl'), '', 'utf8')
      await appendFile(join(dir, 'stream-events.jsonl'), '', 'utf8')
      return { run: record, completedSteps: [], leaseExpiresAt }
    }

    const record = await this.readRun(input.runId)
    if (record.manifestHash !== hash) {
      throw new DurableRunInputMismatchError(
        `runId ${input.runId} exists with a different manifest hash; refuse to corrupt prior steps`,
      )
    }
    const lease = await this.readLeaseSafe(input.runId)
    const leaseStillLive =
      lease && lease.workerId !== input.workerId && new Date(lease.leaseExpiresAt).getTime() > nowMs
    if (leaseStillLive) {
      throw new DurableRunLeaseHeldError(
        `runId ${input.runId} leased by ${lease.workerId} until ${lease.leaseExpiresAt}`,
      )
    }
    const completedSteps = await this.readSteps(input.runId)
    const nextRecord: RunRecord = {
      ...record,
      status:
        record.status === 'completed' || record.status === 'failed' ? record.status : 'running',
      updatedAt: nowIso,
      leaseHolderId: input.workerId,
      leaseExpiresAt,
    }
    await this.writeRun(nextRecord)
    await this.writeLease(input.runId, { workerId: input.workerId, leaseExpiresAt })
    return { run: nextRecord, completedSteps, leaseExpiresAt }
  }

  async renewLease(input: {
    runId: string
    workerId: string
    leaseMs?: number
  }): Promise<{ ok: boolean; leaseExpiresAt?: string }> {
    const lease = await this.readLeaseSafe(input.runId)
    const nowMs = this.now()
    if (lease && lease.workerId !== input.workerId) {
      if (new Date(lease.leaseExpiresAt).getTime() > nowMs) {
        return { ok: false }
      }
    }
    const leaseExpiresAt = new Date(nowMs + (input.leaseMs ?? DEFAULT_LEASE_MS)).toISOString()
    await this.writeLease(input.runId, { workerId: input.workerId, leaseExpiresAt })
    return { ok: true, leaseExpiresAt }
  }

  async loadStep(runId: string, stepIndex: number): Promise<StepRecord | undefined> {
    const steps = await this.readSteps(runId, { includeFailed: true, includeRunning: true })
    return steps.find((s) => s.stepIndex === stepIndex)
  }

  async beginStep(input: {
    runId: string
    stepIndex: number
    intent: string
    kind: StepKind
    inputHash: string
  }): Promise<StepRecord> {
    const all = await this.readSteps(input.runId, { includeFailed: true, includeRunning: true })
    const prior = all.find((s) => s.stepIndex === input.stepIndex)
    const nowIso = new Date(this.now()).toISOString()
    if (prior) {
      if (prior.intent !== input.intent) {
        throw new DurableRunDivergenceError(
          `step ${input.stepIndex}: intent changed ('${prior.intent}' -> '${input.intent}')`,
        )
      }
      const rec: StepRecord = {
        ...prior,
        attempts: prior.attempts + 1,
        status: 'running',
        startedAt: nowIso,
        error: undefined,
      }
      await this.appendStep(input.runId, rec)
      await this.bumpRunUpdated(input.runId, nowIso)
      return rec
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
    await this.appendStep(input.runId, rec)
    // Bump run.stepCount opportunistically.
    const record = await this.readRun(input.runId)
    record.stepCount = Math.max(record.stepCount, input.stepIndex + 1)
    record.updatedAt = nowIso
    await this.writeRun(record)
    return rec
  }

  async completeStep(input: {
    runId: string
    stepIndex: number
    result: unknown
  }): Promise<StepRecord> {
    const all = await this.readSteps(input.runId, { includeFailed: true, includeRunning: true })
    const prior = all.find((s) => s.stepIndex === input.stepIndex)
    if (!prior) {
      throw new Error(
        `durable-runs: completeStep called before beginStep (step ${input.stepIndex})`,
      )
    }
    const nowIso = new Date(this.now()).toISOString()
    const rec: StepRecord = {
      ...prior,
      status: 'completed',
      result: input.result,
      completedAt: nowIso,
      error: undefined,
    }
    await this.appendStep(input.runId, rec)
    await this.bumpRunUpdated(input.runId, nowIso)
    return rec
  }

  async failStep(input: {
    runId: string
    stepIndex: number
    error: StepError
  }): Promise<StepRecord> {
    const all = await this.readSteps(input.runId, { includeFailed: true, includeRunning: true })
    const prior = all.find((s) => s.stepIndex === input.stepIndex)
    if (!prior) {
      throw new Error(`durable-runs: failStep called before beginStep (step ${input.stepIndex})`)
    }
    const nowIso = new Date(this.now()).toISOString()
    const rec: StepRecord = {
      ...prior,
      status: 'failed',
      error: input.error,
      completedAt: nowIso,
    }
    await this.appendStep(input.runId, rec)
    await this.bumpRunUpdated(input.runId, nowIso)
    return rec
  }

  async endRun(input: {
    runId: string
    workerId: string
    status: 'completed' | 'failed'
    outcome?: RunOutcome
  }): Promise<RunRecord> {
    const record = await this.readRun(input.runId)
    const nowIso = new Date(this.now()).toISOString()
    record.status = input.status
    record.outcome = input.outcome
    record.completedAt = nowIso
    record.updatedAt = nowIso
    const lease = await this.readLeaseSafe(input.runId)
    if (lease && lease.workerId === input.workerId) {
      record.leaseHolderId = undefined
      record.leaseExpiresAt = undefined
      await this.writeLease(input.runId, null)
    }
    await this.writeRun(record)
    return record
  }

  async emitEvent(input: {
    runId: string
    key: string
    payload: unknown
  }): ReturnType<DurableRunStore['emitEvent']> {
    const existing = await this.loadEvent(input.runId, input.key)
    if (existing) return { accepted: false, record: existing }
    const rec: EventRecord = {
      runId: input.runId,
      key: input.key,
      payload: input.payload,
      emittedAt: new Date(this.now()).toISOString(),
    }
    await appendFile(
      join(this.runDir(input.runId), 'events.jsonl'),
      `${JSON.stringify(rec)}\n`,
      'utf8',
    )
    return { accepted: true, record: rec }
  }

  async loadEvent(runId: string, key: string): Promise<EventRecord | undefined> {
    const path = join(this.runDir(runId), 'events.jsonl')
    if (!existsSync(path)) return undefined
    const content = await readFile(path, 'utf8')
    for (const line of content.split('\n').reverse()) {
      if (!line) continue
      const rec = JSON.parse(line) as EventRecord
      if (rec.key === key) return rec
    }
    return undefined
  }

  async appendStreamEvent(input: {
    runId: string
    eventId: string
    payload: unknown
  }): ReturnType<DurableRunStore['appendStreamEvent']> {
    const existing = await this.readStreamEventsRaw(input.runId)
    const dup = existing.find((e) => e.eventId === input.eventId)
    if (dup) return { accepted: false, record: dup }
    const rec: StreamEventRecord = {
      runId: input.runId,
      seq: existing.length,
      eventId: input.eventId,
      payload: input.payload,
      appendedAt: new Date(this.now()).toISOString(),
    }
    await appendFile(
      join(this.runDir(input.runId), 'stream-events.jsonl'),
      `${JSON.stringify(rec)}\n`,
      'utf8',
    )
    return { accepted: true, record: rec }
  }

  async readStreamEvents(
    runId: string,
    afterSeq?: number,
  ): Promise<ReadonlyArray<StreamEventRecord>> {
    const cutoff = afterSeq ?? -1
    return (await this.readStreamEventsRaw(runId)).filter((e) => e.seq > cutoff)
  }

  async setRunHandle(input: { runId: string; handle: RunHandle }): Promise<void> {
    const record = await this.readRun(input.runId)
    record.handle = input.handle
    record.updatedAt = new Date(this.now()).toISOString()
    await this.writeRun(record)
  }

  async close(): Promise<void> {
    // No persistent handles to close.
  }

  private async readStreamEventsRaw(runId: string): Promise<StreamEventRecord[]> {
    const path = join(this.runDir(runId), 'stream-events.jsonl')
    if (!existsSync(path)) return []
    const content = await readFile(path, 'utf8')
    const out: StreamEventRecord[] = []
    for (const line of content.split('\n')) {
      if (!line) continue
      out.push(JSON.parse(line) as StreamEventRecord)
    }
    return out.sort((a, b) => a.seq - b.seq)
  }

  /** @internal — used by tests to list runs in the store. */
  async _listRunIds(): Promise<string[]> {
    if (!existsSync(this.root)) return []
    const entries = await readdir(this.root, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  }

  // ── internals ──────────────────────────────────────────────────────

  private runDir(runId: string): string {
    return join(this.root, runId)
  }

  private async readRun(runId: string): Promise<RunRecord> {
    const path = join(this.runDir(runId), 'run.json')
    const content = await readFile(path, 'utf8')
    return JSON.parse(content) as RunRecord
  }

  private async writeRun(record: RunRecord): Promise<void> {
    const dir = this.runDir(record.runId)
    const path = join(dir, 'run.json')
    const tmp = `${path}.tmp`
    await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8')
    await rename(tmp, path)
  }

  private async readLeaseSafe(runId: string): Promise<LeaseFile | undefined> {
    const path = join(this.runDir(runId), 'lease.json')
    if (!existsSync(path)) return undefined
    try {
      const content = await readFile(path, 'utf8')
      if (!content.trim()) return undefined
      return JSON.parse(content) as LeaseFile
    } catch {
      return undefined
    }
  }

  private async writeLease(runId: string, lease: LeaseFile | null): Promise<void> {
    const path = join(this.runDir(runId), 'lease.json')
    const tmp = `${path}.tmp`
    await writeFile(tmp, lease ? JSON.stringify(lease) : '', 'utf8')
    await rename(tmp, path)
  }

  private async readSteps(
    runId: string,
    opts: { includeFailed?: boolean; includeRunning?: boolean } = {},
  ): Promise<StepRecord[]> {
    const path = join(this.runDir(runId), 'steps.jsonl')
    if (!existsSync(path)) return []
    const content = await readFile(path, 'utf8')
    // Append-only log: later writes for the same stepIndex override earlier
    // ones. Walk forward and keep the latest per index.
    const latest = new Map<number, StepRecord>()
    for (const line of content.split('\n')) {
      if (!line) continue
      const rec = JSON.parse(line) as StepRecord
      latest.set(rec.stepIndex, rec)
    }
    const out = [...latest.values()].sort((a, b) => a.stepIndex - b.stepIndex)
    return out.filter((s) => {
      if (s.status === 'completed') return true
      if (s.status === 'failed') return opts.includeFailed ?? false
      if (s.status === 'running') return opts.includeRunning ?? false
      return false
    })
  }

  private async appendStep(runId: string, rec: StepRecord): Promise<void> {
    await appendFile(join(this.runDir(runId), 'steps.jsonl'), `${JSON.stringify(rec)}\n`, 'utf8')
  }

  private async bumpRunUpdated(runId: string, nowIso: string): Promise<void> {
    const record = await this.readRun(runId)
    record.updatedAt = nowIso
    await this.writeRun(record)
  }
}
