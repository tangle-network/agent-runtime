/**
 * The snapshot reader for the supervisor-run TUI: turn the on-disk run layout into a `TopSnapshot`.
 * ANSI frame presentation lives in `./top-frame`; this module owns reading and projection.
 *
 * This module never derives a run path itself. Every directory and per-worker file it reads comes
 * from `../runtime/supervise/run-layout` — the same module the writers use — so the reader cannot
 * drift from the layout the way an independently-versioned copy of the contract would.
 *
 * Extracted from the `loops` repo (`src/top-model.ts`), which held a hand-joined copy of the
 * layout. Rendering is deliberately unchanged: raw ANSI, zero dependencies.
 *
 * This is the OPERATOR view: what is on disk right now, for a human watching a workspace. It
 * carries no model-call identity, so its per-supervisor totals cannot be joined with root stream
 * events without double counting. A client that needs one execution's totals reads
 * `projectPursuit` from `../durable` instead.
 *
 * @experimental
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  legacySupervisorRunsRoot,
  safeWorkerFile,
  supervisorRunsRoot,
  supervisorWorkersDir,
} from '../runtime/supervise/run-layout'

export interface TopSnapshot {
  readonly root: string
  readonly generatedAt: number
  readonly supervisors: SupervisorView[]
  /** `partial` when at least one discovered source could not be read completely. */
  readonly completeness: TopSnapshotCompleteness
  /** One bounded entry per skipped or partially read source; empty when complete. */
  readonly diagnostics: ReadonlyArray<TopSnapshotDiagnostic>
  /** Run directories found under the runs roots, readable or not. */
  readonly discovered: number
  /** Run directories whose state.json parsed into a valid supervisor view. */
  readonly loaded: number
}

export type TopSnapshotCompleteness = 'complete' | 'partial'

export type TopSnapshotDiagnosticSource =
  | 'supervisor-state'
  | 'journal'
  | 'progress'
  | 'worker-tail'

export type TopSnapshotDiagnosticReason =
  | 'unreadable'
  | 'partial-json'
  | 'invalid-state'
  | 'missing'

/**
 * One skipped or partially read snapshot source. `path` is relative to the run directory and
 * never carries file contents, so a diagnostic is safe to show or log without leaking run data.
 */
export interface TopSnapshotDiagnostic {
  readonly source: TopSnapshotDiagnosticSource
  readonly runId?: string
  readonly path: string
  readonly reason: TopSnapshotDiagnosticReason
}

export interface SupervisorBase {
  readonly id: string
  readonly status: string
  readonly task: string
  readonly workspaceDir: string
  readonly budget: number
  readonly verifyCmd?: string
  readonly workerModel?: string
  readonly driverModel?: string
  readonly verdict?: string
  readonly progress?: string
  readonly startedAt?: string
  readonly completedAt?: string
  readonly maxSandboxes?: number
  readonly maxLifetimeSeconds?: number
  readonly idleTimeoutSeconds?: number
  readonly maxUsd?: number
  readonly maxDepth?: number
}

export interface SupervisorView extends SupervisorBase {
  readonly stateDir: string
  readonly resultSpentUsd?: number
  readonly resultSpentTokens?: number
  readonly workers: WorkerView[]
  readonly progressTail: string[]
  readonly journalTail: TopJournalEvent[]
  readonly driverSpend: SpendStats
  readonly totals: SupervisorTotals
}

export interface WorkerView {
  readonly id: string
  readonly label: string
  readonly eventFile?: string
  readonly parent?: string
  readonly runtime?: string
  readonly status: 'running' | 'done' | 'down' | 'cancelled'
  readonly verdict?: string
  readonly infra?: boolean
  readonly startedAt?: string
  readonly endedAt?: string
  readonly latencyMs: number
  readonly budget?: BudgetStats
  readonly spend: SpendStats
  readonly metered: SpendStats
  readonly liveTail: string[]
  readonly outRef?: string
  readonly reason?: string
}

export interface SupervisorTotals {
  readonly workers: number
  readonly running: number
  readonly done: number
  readonly down: number
  readonly cancelled: number
  readonly inFlight: number
  readonly settled: number
  readonly tokensInput: number
  readonly tokensOutput: number
  readonly tokensTotal: number
  readonly usd: number
  readonly latencyMs: number
  readonly workerLatency: Distribution
}

export interface Distribution {
  readonly n: number
  readonly min: number
  readonly median: number
  readonly p90: number
  readonly max: number
}

export interface BudgetStats {
  readonly maxIterations?: number
  readonly maxTokens?: number
  readonly maxUsd?: number
}

export interface SpendStats {
  readonly iterations: number
  readonly tokensInput: number
  readonly tokensOutput: number
  readonly usd: number
  readonly ms: number
}

export type TopJournalEvent =
  | {
      readonly kind: 'spawned'
      readonly id: string
      readonly parent?: string
      readonly label?: string
      readonly budget?: unknown
      readonly runtime?: string
      readonly seq?: number
      readonly at?: string
    }
  | {
      readonly kind: 'settled'
      readonly id: string
      readonly status?: string
      readonly outRef?: string
      readonly verdict?: unknown
      readonly spent?: unknown
      readonly infra?: boolean
      readonly seq?: number
      readonly at?: string
    }
  | {
      readonly kind: 'cancelled'
      readonly spent?: unknown
      readonly id: string
      readonly reason?: string
      readonly seq?: number
      readonly at?: string
    }
  | {
      readonly kind: 'metered'
      readonly id: string
      readonly spend?: unknown
      readonly accountingOnly?: boolean
      readonly seq?: number
      readonly at?: string
    }
  | {
      readonly kind: 'progress'
      readonly id: string
      readonly spend?: unknown
      readonly seq?: number
      readonly at?: string
    }

interface SupervisorState extends SupervisorBase {
  readonly result?: {
    readonly spentUsd?: number
    readonly spentTokens?: number
  }
}

type MutableWorker = {
  -readonly [Key in keyof Omit<WorkerView, 'latencyMs'>]: WorkerView[Key]
}

interface WorkerEventTail {
  readonly file: string
  readonly lines: string[]
}

/** A diagnostic before its run id is attached; `loadTopSnapshot` adds `runId`. */
interface SourceDiagnostic {
  readonly source: TopSnapshotDiagnosticSource
  readonly path: string
  readonly reason: TopSnapshotDiagnosticReason
}

/**
 * What one snapshot source read produced: the value it could recover, and the bounded diagnostics
 * the read raised. Every reader returns this one shape, so the loader folds them identically.
 */
interface SourceRead<T> {
  readonly value: T
  readonly diagnostics: readonly SourceDiagnostic[]
}

const emptySpend: SpendStats = { iterations: 0, tokensInput: 0, tokensOutput: 0, usd: 0, ms: 0 }

/**
 * Read every supervisor run under one workspace into a single point-in-time snapshot.
 *
 * Pure with respect to the process: it only reads, and it never throws for a writer mid-append.
 * An unreadable or half-written source is still skipped — an operator view must survive a live
 * writer — but every skip is reported as one bounded `TopSnapshotDiagnostic`, so a client can
 * tell a removed run from a partial read. `now` is injectable so elapsed time is deterministic
 * under test.
 */
export function loadTopSnapshot(rootDir: string, now = Date.now()): TopSnapshot {
  const root = resolve(rootDir)
  const supervisors: SupervisorView[] = []
  const diagnostics: TopSnapshotDiagnostic[] = []
  let discovered = 0
  const report = (runId: string, sources: readonly SourceDiagnostic[]): void => {
    for (const source of sources) diagnostics.push({ ...source, runId })
  }
  // `.loops` is the pre-rename state dir; runs already on disk there stay visible.
  for (const runsRoot of [supervisorRunsRoot(root), legacySupervisorRunsRoot(root)]) {
    if (!existsSync(runsRoot)) continue
    for (const entry of readdirSync(runsRoot)) {
      const dir = join(runsRoot, entry)
      if (!isDirectory(dir)) continue
      discovered += 1
      const state = readSupervisorState(dir)
      report(entry, state.diagnostics)
      if (!state.value) continue
      const journal = readJournal(dir)
      const progress = readProgressTail(dir, 8)
      const workerEvents = readWorkerEventTails(supervisorWorkersDir(dir), 8)
      report(entry, [...journal.diagnostics, ...progress.diagnostics, ...workerEvents.diagnostics])
      supervisors.push(
        buildSupervisorView(
          state.value,
          dir,
          journal.value,
          progress.value,
          now,
          workerEvents.value,
        ),
      )
    }
  }
  supervisors.sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
  return {
    root,
    generatedAt: now,
    supervisors,
    completeness: diagnostics.length === 0 ? 'complete' : 'partial',
    diagnostics,
    discovered,
    loaded: supervisors.length,
  }
}

/**
 * The journal file a run dir actually carries. `createFileRunContext` — this repo's own durable
 * writer — names it `spawn-journal.jsonl`; `journal.jsonl` is the retired bare-event file older
 * runs left behind. First existing name wins; a reader that knew only the retired name would show
 * zero workers for every current run.
 */
const journalFileNames = ['spawn-journal.jsonl', 'journal.jsonl'] as const

function readJournal(eventDir: string): SourceRead<TopJournalEvent[]> {
  const path = journalFileNames.find((candidate) => existsSync(join(eventDir, candidate)))
  if (!path) return { value: [], diagnostics: [] }
  const read = readSourceFile(join(eventDir, path), 'journal', path)
  if (read.value === undefined) return { value: [], diagnostics: read.diagnostics }
  const out: TopJournalEvent[] = []
  let partial = false
  for (const line of read.value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const event = (parsed.event ?? parsed) as Record<string, unknown>
      if (isSpawnEvent(event)) out.push(event)
    } catch {
      // A corrupt line is expected while the writer is mid-append; keep the lines that parsed.
      partial = true
    }
  }
  return {
    value: out,
    diagnostics: partial ? [{ source: 'journal', path, reason: 'partial-json' }] : [],
  }
}

function buildSupervisorView(
  state: SupervisorState,
  stateDir: string,
  events: readonly TopJournalEvent[],
  progressTail: readonly string[],
  now: number,
  workerEventTails = new Map<string, WorkerEventTail>(),
): SupervisorView {
  const workers = new Map<string, MutableWorker>()
  let driverSpend = emptySpend
  // `state.json` and the spawn journal are written by DIFFERENT producers, and their ids need not
  // agree: the journal's root is the runtime's `runId`, which defaults to a literal unrelated to
  // the supervisor id the state file records. Recover the journal's own root from its parentless
  // root spawn, and treat EITHER id as the root everywhere. Checking only `state.id` — which the
  // metered/settled/cancelled branches used to do — manufactures a phantom worker named after the
  // runId that never settles, sorts first as RUNNING, and silently captures every steer and cancel.
  const journalRootId = events.find(
    (event) => event.kind === 'spawned' && !event.parent && event.label === 'root',
  )?.id
  const isRoot = (id: string): boolean => id === state.id || id === journalRootId

  for (const event of events) {
    if (event.kind === 'spawned') {
      if (isRoot(event.id) || (!event.parent && event.label === 'root')) continue
      const worker = ensureWorker(workers, event.id, event.label ?? event.id)
      worker.label = event.label ?? worker.label
      if (event.parent) worker.parent = event.parent
      if (event.runtime) worker.runtime = event.runtime
      worker.status = 'running'
      if (event.at) worker.startedAt = event.at
      const budget = parseBudget(event.budget)
      if (budget) worker.budget = budget
      continue
    }

    if (event.kind === 'settled') {
      if (isRoot(event.id)) continue
      const worker = ensureWorker(workers, event.id, event.id)
      worker.status = event.status === 'down' ? 'down' : 'done'
      if (event.at) worker.endedAt = event.at
      if (event.outRef) worker.outRef = event.outRef
      if (event.infra !== undefined) worker.infra = event.infra
      const verdict = describeVerdict(event.verdict)
      if (verdict) worker.verdict = verdict
      worker.spend = addSpend(worker.spend, parseSpend(event.spent))
      // Live progress is cumulative observation. The terminal spend replaces it, so do not add
      // the two channels or a worker's final cost would be counted twice.
      worker.metered = emptySpend
      continue
    }

    if (event.kind === 'cancelled') {
      if (isRoot(event.id)) continue
      const worker = ensureWorker(workers, event.id, event.id)
      worker.status = 'cancelled'
      if (event.at) worker.endedAt = event.at
      if (event.reason) worker.reason = event.reason
      if (event.spent !== undefined) {
        worker.spend = addSpend(worker.spend, parseSpend(event.spent))
        worker.metered = emptySpend
      }
      continue
    }

    if (event.kind === 'metered') {
      const spend = parseSpend(event.spend)
      if (isRoot(event.id)) {
        if (event.accountingOnly !== true) driverSpend = addSpend(driverSpend, spend)
      } else {
        const worker = ensureWorker(workers, event.id, event.id)
        if (event.accountingOnly !== true) worker.metered = addSpend(worker.metered, spend)
      }
      continue
    }

    if (event.kind === 'progress') {
      if (isRoot(event.id)) continue
      const worker = ensureWorker(workers, event.id, event.id)
      worker.metered = parseSpend(event.spend)
    }
  }

  const workerViews = [...workers.values()]
    .map((worker) => {
      // Tails are keyed by file stem, which the writer put through `safeWorkerFile`; a label
      // carrying characters that stem strips would otherwise never find its own events.
      const tail =
        workerEventTails.get(worker.label) ??
        workerEventTails.get(safeWorkerFile(worker.label)) ??
        workerEventTails.get(safeWorkerFile(worker.id)) ??
        workerEventTails.get(worker.id)
      worker.liveTail = tail?.lines ?? []
      if (tail?.file) worker.eventFile = tail.file
      return finalizeWorker(worker, now)
    })
    .sort((a, b) => compareWorker(a, b))

  const totals = supervisorTotals(state, workerViews, driverSpend, now)
  return {
    id: state.id,
    stateDir,
    status: state.status,
    task: state.task,
    workspaceDir: state.workspaceDir,
    budget: state.budget,
    ...(state.verifyCmd ? { verifyCmd: state.verifyCmd } : {}),
    ...(state.workerModel ? { workerModel: state.workerModel } : {}),
    ...(state.driverModel ? { driverModel: state.driverModel } : {}),
    ...(state.verdict ? { verdict: state.verdict } : {}),
    ...(state.progress ? { progress: state.progress } : {}),
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
    ...(state.completedAt ? { completedAt: state.completedAt } : {}),
    ...(state.maxSandboxes !== undefined ? { maxSandboxes: state.maxSandboxes } : {}),
    ...(state.maxLifetimeSeconds !== undefined
      ? { maxLifetimeSeconds: state.maxLifetimeSeconds }
      : {}),
    ...(state.idleTimeoutSeconds !== undefined
      ? { idleTimeoutSeconds: state.idleTimeoutSeconds }
      : {}),
    ...(state.maxUsd !== undefined ? { maxUsd: state.maxUsd } : {}),
    ...(state.maxDepth !== undefined ? { maxDepth: state.maxDepth } : {}),
    ...(state.result?.spentUsd !== undefined ? { resultSpentUsd: state.result.spentUsd } : {}),
    ...(state.result?.spentTokens !== undefined
      ? { resultSpentTokens: state.result.spentTokens }
      : {}),
    workers: workerViews,
    progressTail: [...progressTail],
    journalTail: events.slice(-12),
    driverSpend,
    totals,
  }
}

function ensureWorker(
  workers: Map<string, MutableWorker>,
  id: string,
  label: string,
): MutableWorker {
  const existing = workers.get(id)
  if (existing) return existing
  const created: MutableWorker = {
    id,
    label,
    status: 'running',
    spend: emptySpend,
    metered: emptySpend,
    liveTail: [],
  }
  workers.set(id, created)
  return created
}

function finalizeWorker(worker: MutableWorker, now: number): WorkerView {
  const startMs = parseTime(worker.startedAt)
  const endMs = parseTime(worker.endedAt) ?? (worker.status === 'running' ? now : startMs)
  const latencyMs = startMs !== undefined && endMs !== undefined ? Math.max(0, endMs - startMs) : 0
  return {
    id: worker.id,
    label: worker.label,
    ...(worker.eventFile ? { eventFile: worker.eventFile } : {}),
    ...(worker.parent ? { parent: worker.parent } : {}),
    ...(worker.runtime ? { runtime: worker.runtime } : {}),
    status: worker.status,
    ...(worker.verdict ? { verdict: worker.verdict } : {}),
    ...(worker.infra !== undefined ? { infra: worker.infra } : {}),
    ...(worker.startedAt ? { startedAt: worker.startedAt } : {}),
    ...(worker.endedAt ? { endedAt: worker.endedAt } : {}),
    latencyMs,
    ...(worker.budget ? { budget: worker.budget } : {}),
    spend: worker.spend,
    metered: worker.metered,
    liveTail: worker.liveTail,
    ...(worker.outRef ? { outRef: worker.outRef } : {}),
    ...(worker.reason ? { reason: worker.reason } : {}),
  }
}

function supervisorTotals(
  state: SupervisorState,
  workers: readonly WorkerView[],
  driverSpend: SpendStats,
  now: number,
): SupervisorTotals {
  const workerSpends = workers.map(totalSpend)
  const tokenInput = sum(workerSpends.map((spend) => spend.tokensInput)) + driverSpend.tokensInput
  const tokenOutput =
    sum(workerSpends.map((spend) => spend.tokensOutput)) + driverSpend.tokensOutput
  const computedUsd = sum(workerSpends.map((spend) => spend.usd)) + driverSpend.usd
  const usd = computedUsd > 0 ? computedUsd : (state.result?.spentUsd ?? 0)
  const started = parseTime(state.startedAt)
  const completed = parseTime(state.completedAt)
  const latencyMs = started !== undefined ? Math.max(0, (completed ?? now) - started) : 0
  const latencies = workers.map((worker) => worker.latencyMs).filter((ms) => ms > 0)
  return {
    workers: workers.length,
    running: workers.filter((worker) => worker.status === 'running').length,
    done: workers.filter((worker) => worker.status === 'done').length,
    down: workers.filter((worker) => worker.status === 'down').length,
    cancelled: workers.filter((worker) => worker.status === 'cancelled').length,
    inFlight: workers.filter((worker) => worker.status === 'running').length,
    settled: workers.filter((worker) => worker.status !== 'running').length,
    tokensInput: tokenInput,
    tokensOutput: tokenOutput,
    tokensTotal: tokenInput + tokenOutput,
    usd,
    latencyMs,
    workerLatency: distribution(latencies),
  }
}

export function aggregateSnapshot(snapshot: TopSnapshot): {
  supervisors: number
  workers: number
  running: number
  done: number
  down: number
  usd: number
  tokensInput: number
  tokensOutput: number
} {
  return {
    supervisors: snapshot.supervisors.length,
    workers: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.workers)),
    running: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.running)),
    done: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.done)),
    down: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.down)),
    usd: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.usd)),
    tokensInput: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.tokensInput)),
    tokensOutput: sum(snapshot.supervisors.map((supervisor) => supervisor.totals.tokensOutput)),
  }
}

function compareWorker(a: WorkerView, b: WorkerView): number {
  const aStart = parseTime(a.startedAt) ?? 0
  const bStart = parseTime(b.startedAt) ?? 0
  if (a.status === 'running' && b.status !== 'running') return -1
  if (b.status === 'running' && a.status !== 'running') return 1
  return aStart - bStart || a.label.localeCompare(b.label)
}

export function totalSpend(worker: WorkerView): SpendStats {
  return addSpend(worker.spend, worker.metered)
}

function addSpend(a: SpendStats, b: SpendStats): SpendStats {
  return {
    iterations: a.iterations + b.iterations,
    tokensInput: a.tokensInput + b.tokensInput,
    tokensOutput: a.tokensOutput + b.tokensOutput,
    usd: a.usd + b.usd,
    ms: a.ms + b.ms,
  }
}

export function parseSpend(value: unknown): SpendStats {
  if (!isRecord(value)) return emptySpend
  const tokens = isRecord(value.tokens) ? value.tokens : {}
  return {
    iterations: numberValue(value.iterations),
    tokensInput: numberValue(tokens.input),
    tokensOutput: numberValue(tokens.output),
    usd: numberValue(value.usd),
    ms: numberValue(value.ms),
  }
}

function parseBudget(value: unknown): BudgetStats | undefined {
  if (!isRecord(value)) return undefined
  const budget: BudgetStats = {
    ...(typeof value.maxIterations === 'number' ? { maxIterations: value.maxIterations } : {}),
    ...(typeof value.maxTokens === 'number' ? { maxTokens: value.maxTokens } : {}),
    ...(typeof value.maxUsd === 'number' ? { maxUsd: value.maxUsd } : {}),
  }
  return Object.keys(budget).length ? budget : undefined
}

function describeVerdict(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.valid === 'boolean') return value.valid ? 'valid' : 'invalid'
  if (typeof value.score === 'number') return `score ${value.score.toFixed(2)}`
  return undefined
}

function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { n: 0, min: 0, median: 0, p90: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[idx] ?? 0
}

/**
 * Read one source file under a run directory. An absent file is not a defect on its own — the
 * writer may not have reached it yet — so it reads as `undefined` with no diagnostic; only a
 * failed read raises one. `path` stays run-relative and never carries file contents.
 */
function readSourceFile(
  file: string,
  source: TopSnapshotDiagnosticSource,
  path: string,
): SourceRead<string | undefined> {
  if (!existsSync(file)) return { value: undefined, diagnostics: [] }
  try {
    return { value: readFileSync(file, 'utf8'), diagnostics: [] }
  } catch {
    return { value: undefined, diagnostics: [{ source, path, reason: 'unreadable' }] }
  }
}

function tailLines(raw: string | undefined, maxLines: number): string[] {
  if (raw === undefined) return []
  return raw.trim().split('\n').filter(Boolean).slice(-maxLines)
}

function readProgressTail(dir: string, maxLines: number): SourceRead<string[]> {
  const path = 'progress.ndjson'
  const read = readSourceFile(join(dir, path), 'progress', path)
  return { value: tailLines(read.value, maxLines), diagnostics: read.diagnostics }
}

function readWorkerEventTails(
  dir: string,
  maxLines: number,
): SourceRead<Map<string, WorkerEventTail>> {
  const out = new Map<string, WorkerEventTail>()
  if (!existsSync(dir)) return { value: out, diagnostics: [] }
  const workersDir = basename(dir)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return {
      value: out,
      diagnostics: [{ source: 'worker-tail', path: workersDir, reason: 'unreadable' }],
    }
  }
  const diagnostics: SourceDiagnostic[] = []
  for (const entry of entries) {
    // `<label>.inbox.ndjson` is the down-leg steer queue, not this worker's control-event log.
    if (!entry.endsWith('.ndjson') || entry.endsWith('.inbox.ndjson')) continue
    const file = join(dir, entry)
    const read = readSourceFile(file, 'worker-tail', join(workersDir, entry))
    diagnostics.push(...read.diagnostics)
    const lines = tailLines(read.value, maxLines)
    out.set(entry.slice(0, -'.ndjson'.length), { file, lines })
  }
  return { value: out, diagnostics }
}

function readSupervisorState(dir: string): SourceRead<SupervisorState | undefined> {
  const path = 'state.json'
  const read = readSourceFile(join(dir, path), 'supervisor-state', path)
  if (read.diagnostics.length > 0) return { value: undefined, diagnostics: read.diagnostics }
  if (read.value === undefined)
    return {
      value: undefined,
      diagnostics: [{ source: 'supervisor-state', path, reason: 'missing' }],
    }
  let parsed: Partial<SupervisorState>
  try {
    parsed = JSON.parse(read.value) as Partial<SupervisorState>
  } catch {
    return {
      value: undefined,
      diagnostics: [{ source: 'supervisor-state', path, reason: 'partial-json' }],
    }
  }
  if (!isSupervisorState(parsed))
    return {
      value: undefined,
      diagnostics: [{ source: 'supervisor-state', path, reason: 'invalid-state' }],
    }
  return { value: parsed, diagnostics: [] }
}

function isSupervisorState(value: Partial<SupervisorState> | undefined): value is SupervisorState {
  return (
    value !== undefined &&
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.task === 'string' &&
    typeof value.workspaceDir === 'string' &&
    typeof value.budget === 'number'
  )
}

function isSpawnEvent(value: Record<string, unknown>): value is TopJournalEvent {
  return (
    (value.kind === 'spawned' && typeof value.id === 'string') ||
    (value.kind === 'settled' && typeof value.id === 'string') ||
    (value.kind === 'cancelled' && typeof value.id === 'string') ||
    (value.kind === 'metered' && typeof value.id === 'string') ||
    (value.kind === 'progress' && typeof value.id === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
