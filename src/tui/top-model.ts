/**
 * The read side of the supervisor-run TUI: turn the on-disk run layout into one `TopSnapshot`, and
 * render that snapshot to an ANSI frame.
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
      readonly id: string
      readonly reason?: string
      readonly seq?: number
      readonly at?: string
    }
  | {
      readonly kind: 'metered'
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

interface MutableWorker {
  id: string
  label: string
  eventFile?: string
  parent?: string
  runtime?: string
  status: 'running' | 'done' | 'down' | 'cancelled'
  verdict?: string
  infra?: boolean
  startedAt?: string
  endedAt?: string
  budget?: BudgetStats
  spend: SpendStats
  metered: SpendStats
  liveTail: string[]
  outRef?: string
  reason?: string
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

export interface RenderOptions {
  readonly width?: number
  readonly height?: number
  readonly color?: boolean
  readonly selectedSupervisorId?: string
  readonly selectedWorkerId?: string
  readonly focus?: 'supervisors' | 'workers'
  readonly mode?: 'overview' | 'detail' | 'log'
  readonly notice?: string
  readonly steerInput?: {
    readonly active: boolean
    readonly value: string
    readonly workerLabel?: string
  }
}

export interface RenderTarget {
  readonly row: number
  readonly kind: 'supervisor' | 'worker'
  readonly id: string
  readonly supervisorId?: string
}

export interface RenderedTopFrame {
  readonly frame: string
  readonly targets: RenderTarget[]
}

const emptySpend: SpendStats = { iterations: 0, tokensInput: 0, tokensOutput: 0, usd: 0, ms: 0 }
// Width accounting depends on stripping SGR sequences, which begin with a literal ESC. Matching
// the control character is the point of an ANSI-aware renderer, not an accident.
// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR sequences begin with ESC
const ansiPattern = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  inverse: '\x1b[7m',
}

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
      continue
    }

    if (event.kind === 'cancelled') {
      if (isRoot(event.id)) continue
      const worker = ensureWorker(workers, event.id, event.id)
      worker.status = 'cancelled'
      if (event.at) worker.endedAt = event.at
      if (event.reason) worker.reason = event.reason
      continue
    }

    if (event.kind === 'metered') {
      const spend = parseSpend(event.spend)
      if (isRoot(event.id)) {
        driverSpend = addSpend(driverSpend, spend)
      } else {
        const worker = ensureWorker(workers, event.id, event.id)
        worker.metered = addSpend(worker.metered, spend)
      }
    }
  }

  const workerViews = [...workers.values()]
    .map((worker) => {
      // Tails are keyed by file stem, which the writer put through `safeWorkerFile`; a label
      // carrying characters that stem strips would otherwise never find its own events.
      const tail =
        workerEventTails.get(worker.label) ??
        workerEventTails.get(safeWorkerFile(worker.label)) ??
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

/** Render one snapshot to an ANSI frame. Use this when nothing needs to be clickable. */
export function renderTopFrame(snapshot: TopSnapshot, options: RenderOptions = {}): string {
  return renderTopFrameWithLayout(snapshot, options).frame
}

/**
 * Render one snapshot, returning the frame together with the row→entity map a mouse click resolves
 * against. The layout is the only thing that knows which row is which run or worker, so emitting it
 * alongside the text is what keeps click handling out of the renderer.
 */
export function renderTopFrameWithLayout(
  snapshot: TopSnapshot,
  options: RenderOptions = {},
): RenderedTopFrame {
  const width = Math.max(88, options.width ?? 128)
  const height = Math.max(24, options.height ?? 42)
  const color = options.color ?? false
  const focus = options.focus ?? 'supervisors'
  const mode = options.mode ?? 'overview'
  const selectedSupervisor = selectSupervisor(snapshot, options.selectedSupervisorId)
  const selectedWorker = selectedSupervisor
    ? selectWorker(selectedSupervisor, options.selectedWorkerId)
    : undefined
  const targets: RenderTarget[] = []
  const lines: string[] = []

  const push = (line = '', target?: Omit<RenderTarget, 'row'>) => {
    if (lines.length >= height) return
    if (target) targets.push({ row: lines.length, ...target })
    lines.push(fitAnsi(line, width))
  }

  const aggregate = aggregateSnapshot(snapshot)
  push(
    `${paint('SUPERVISOR TOP', 'bold', color)} ${paint(snapshot.root, 'dim', color)}  ` +
      `runs ${aggregate.supervisors}  workers ${aggregate.workers}  live ${aggregate.running}  ` +
      `done ${aggregate.done}  down ${aggregate.down}  ` +
      `${formatMoney(aggregate.usd)}  tok ${formatTokens(aggregate.tokensInput)}/${formatTokens(aggregate.tokensOutput)}`,
  )
  push(
    `${paint('keys', 'dim', color)} up/down select  left/right run  tab focus  enter detail  o overview  l log  s steer  c cancel  mouse  q quit`,
  )
  if (options.notice) push(paint(options.notice, 'yellow', color))
  if (snapshot.completeness === 'partial')
    push(
      paint(
        `partial snapshot: ${snapshot.diagnostics.length} source${
          snapshot.diagnostics.length === 1 ? '' : 's'
        } skipped or truncated; runs loaded ${snapshot.loaded}/${snapshot.discovered}`,
        'yellow',
        color,
      ),
    )
  if (options.steerInput?.active) push(renderSteerInput(options.steerInput, width, color))
  push(rule(width, color))

  if (snapshot.supervisors.length === 0) {
    if (snapshot.discovered > 0) {
      push(paint('NO READABLE SUPERVISORS', 'yellow', color))
      push(
        `${snapshot.discovered} run director${snapshot.discovered === 1 ? 'y' : 'ies'} found under ${supervisorRunsRoot(snapshot.root)}, none readable`,
      )
    } else {
      push(paint('NO SUPERVISORS', 'yellow', color))
      push(`No run state under ${supervisorRunsRoot(snapshot.root)}`)
    }
    push(
      `A run appears here once its driver writes state.json; re-point with: agent-runtime-top <root>`,
    )
    return { frame: `${lines.join('\n')}\n`, targets }
  }

  push(sectionTitle('SUPERVISORS', focus === 'supervisors', color))
  push(
    `  id                    status       workers       spend        tok in/out       latency      task`,
  )
  for (const supervisor of snapshot.supervisors.slice(0, 9)) {
    const selected = supervisor.id === selectedSupervisor?.id
    const status = statusText(supervisor.status, color)
    const pointer = selected ? paint('>', 'cyan', color) : ' '
    const rowFocus = selected && focus === 'supervisors' ? 'inverse' : undefined
    const workerSummary = `${supervisor.totals.running}/${supervisor.totals.workers} live`
    const task = compact(supervisor.task, 34)
    const line =
      `${pointer} ${pad(supervisor.id, 21)} ${pad(status, 12)} ${pad(workerSummary, 13)} ` +
      `${pad(formatMoney(supervisor.totals.usd), 12)} ` +
      `${pad(`${formatTokens(supervisor.totals.tokensInput)}/${formatTokens(supervisor.totals.tokensOutput)}`, 16)} ` +
      `${pad(formatDuration(supervisor.totals.latencyMs), 12)} ${task}`
    push(rowFocus ? paint(line, rowFocus, color) : line, { kind: 'supervisor', id: supervisor.id })
  }

  if (!selectedSupervisor) return { frame: `${lines.join('\n')}\n`, targets }

  push()
  push(sectionTitle(`WORKERS ${selectedSupervisor.id}`, focus === 'workers', color))
  push(
    `  id           state        runtime    latency      cost        tok in/out       score     detail`,
  )
  for (const worker of selectedSupervisor.workers.slice(0, 12)) {
    const selected = worker.id === selectedWorker?.id
    const pointer = selected ? paint('>', 'cyan', color) : ' '
    const rowFocus = selected && focus === 'workers' ? 'inverse' : undefined
    const score = worker.verdict ?? (worker.status === 'done' ? 'done' : worker.status)
    const detail = worker.reason ?? worker.outRef ?? worker.parent ?? ''
    const spend = totalSpend(worker)
    const line =
      `${pointer} ${pad(worker.label, 12)} ${pad(statusText(worker.status, color), 12)} ` +
      `${pad(worker.runtime ?? '-', 10)} ${pad(formatDuration(worker.latencyMs), 12)} ` +
      `${pad(formatMoney(spend.usd), 11)} ` +
      `${pad(`${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`, 16)} ` +
      `${pad(compact(score, 9), 10)} ${compact(detail, 30)}`
    push(rowFocus ? paint(line, rowFocus, color) : line, {
      kind: 'worker',
      id: worker.id,
      supervisorId: selectedSupervisor.id,
    })
  }
  if (selectedSupervisor.workers.length === 0) push('  no workers spawned yet')

  push()
  push(sectionTitle('OBSERVABILITY', false, color))
  for (const line of renderStatusBars(selectedSupervisor, width, color)) push(line)
  push()
  for (const line of renderCostBars(selectedSupervisor, width, color)) push(line)
  push()
  for (const line of renderTokenBars(selectedSupervisor, width, color)) push(line)
  push()
  for (const line of renderLatencyHistogram(selectedSupervisor, width, color)) push(line)

  push()
  if (mode === 'log') {
    push(sectionTitle('JOURNAL TAIL', false, color))
    for (const line of renderJournalTail(selectedSupervisor, width, color)) push(line)
  } else {
    push(sectionTitle(mode === 'detail' ? 'DETAIL' : 'RUN SUMMARY', false, color))
    for (const line of renderDetail(selectedSupervisor, selectedWorker, mode, width, color))
      push(line)
  }

  return { frame: `${lines.join('\n')}\n`, targets }
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

function aggregateSnapshot(snapshot: TopSnapshot): {
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

function totalSpend(worker: WorkerView): SpendStats {
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

function parseSpend(value: unknown): SpendStats {
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

function renderStatusBars(supervisor: SupervisorView, width: number, color: boolean): string[] {
  const total = Math.max(1, supervisor.totals.workers)
  const barWidth = Math.max(12, Math.min(28, width - 58))
  return [
    `status  ` +
      `${pad('running', 9)} ${bar(supervisor.totals.running, total, barWidth, '#', color, 'yellow')} ${supervisor.totals.running}` +
      `   ${pad('done', 5)} ${bar(supervisor.totals.done, total, barWidth, '#', color, 'green')} ${supervisor.totals.done}` +
      `   ${pad('down', 5)} ${bar(supervisor.totals.down, total, barWidth, '#', color, 'red')} ${supervisor.totals.down}`,
  ]
}

function renderCostBars(supervisor: SupervisorView, width: number, color: boolean): string[] {
  const workers = supervisor.workers
    .map((worker) => ({ worker, spend: totalSpend(worker) }))
    .sort((a, b) => b.spend.usd - a.spend.usd)
    .slice(0, 6)
  const maxUsd = Math.max(
    0.000001,
    ...workers.map((row) => row.spend.usd),
    supervisor.driverSpend.usd,
  )
  const out = [
    `cost   total ${formatMoney(supervisor.totals.usd)}  driver ${formatMoney(supervisor.driverSpend.usd)}`,
  ]
  const barWidth = Math.max(18, Math.min(46, width - 38))
  for (const row of workers) {
    out.push(
      `  ${pad(row.worker.label, 12)} ${bar(row.spend.usd, maxUsd, barWidth, '$', color, 'magenta')} ${formatMoney(row.spend.usd)}`,
    )
  }
  if (workers.length === 0) out.push('  no worker cost yet')
  return out
}

function renderTokenBars(supervisor: SupervisorView, width: number, color: boolean): string[] {
  const rows = supervisor.workers
    .map((worker) => ({
      worker,
      spend: totalSpend(worker),
      total: totalSpend(worker).tokensInput + totalSpend(worker).tokensOutput,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)
  const maxTokens = Math.max(
    1,
    ...rows.map((row) => row.total),
    supervisor.driverSpend.tokensInput + supervisor.driverSpend.tokensOutput,
  )
  const out = [
    `tokens total in ${formatTokens(supervisor.totals.tokensInput)} / out ${formatTokens(supervisor.totals.tokensOutput)}  ` +
      `driver ${formatTokens(supervisor.driverSpend.tokensInput)}/${formatTokens(supervisor.driverSpend.tokensOutput)}`,
  ]
  const barWidth = Math.max(18, Math.min(46, width - 44))
  for (const row of rows) {
    out.push(
      `  ${pad(row.worker.label, 12)} ${stackedTokenBar(row.spend.tokensInput, row.spend.tokensOutput, maxTokens, barWidth, color)} ` +
        `${formatTokens(row.spend.tokensInput)}/${formatTokens(row.spend.tokensOutput)}`,
    )
  }
  if (rows.length === 0) out.push('  no worker tokens yet')
  return out
}

function renderLatencyHistogram(
  supervisor: SupervisorView,
  width: number,
  color: boolean,
): string[] {
  const values = supervisor.workers.map((worker) => worker.latencyMs).filter((value) => value > 0)
  const summary = supervisor.totals.workerLatency
  const out = [
    `latency n=${summary.n}  min ${formatDuration(summary.min)}  p50 ${formatDuration(summary.median)}  ` +
      `p90 ${formatDuration(summary.p90)}  max ${formatDuration(summary.max)}`,
  ]
  if (values.length === 0) {
    out.push('  no latency samples yet')
    return out
  }
  const bins = histogram(values, 6)
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count))
  const barWidth = Math.max(18, Math.min(48, width - 34))
  for (const bin of bins) {
    out.push(
      `  ${pad(`${formatDuration(bin.min)}-${formatDuration(bin.max)}`, 15)} ` +
        `${bar(bin.count, maxCount, barWidth, '#', color, 'blue')} ${bin.count}`,
    )
  }
  return out
}

function renderDetail(
  supervisor: SupervisorView,
  worker: WorkerView | undefined,
  mode: 'overview' | 'detail' | 'log',
  width: number,
  color: boolean,
): string[] {
  if (mode === 'detail' && worker) {
    const spend = totalSpend(worker)
    return [
      `worker ${paint(worker.label, 'bold', color)} (${worker.id})  ${statusText(worker.status, color)}  latency ${formatDuration(worker.latencyMs)}`,
      `tokens in/out ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}  cost ${formatMoney(spend.usd)}  iterations ${spend.iterations}`,
      `parent ${worker.parent ?? '-'}  runtime ${worker.runtime ?? '-'}  out ${worker.outRef ?? '-'}${worker.infra ? '  infra' : ''}`,
      `events ${compact(worker.eventFile ?? '-', width - 8)}`,
      ...(worker.reason ? [`reason ${compact(worker.reason, width - 7)}`] : []),
      ...renderWorkerTail(worker, width, color),
    ]
  }

  const caps = [
    supervisor.maxSandboxes !== undefined ? `boxes ${supervisor.maxSandboxes}` : undefined,
    supervisor.maxUsd !== undefined ? `max ${formatMoney(supervisor.maxUsd)}` : undefined,
    supervisor.maxDepth !== undefined ? `depth ${supervisor.maxDepth}` : undefined,
    supervisor.maxLifetimeSeconds !== undefined
      ? `ttl ${supervisor.maxLifetimeSeconds}s`
      : undefined,
  ].filter((value): value is string => value !== undefined)
  return [
    `task ${compact(supervisor.task, width - 7)}`,
    `workspace ${compact(supervisor.workspaceDir, width - 12)}`,
    `verify ${compact(supervisor.verifyCmd ?? '-', width - 9)}`,
    `models worker ${supervisor.workerModel ?? '-'} / driver ${supervisor.driverModel ?? '-'}  caps ${caps.join(' | ') || '-'}`,
    `progress ${compact(supervisor.progress ?? supervisor.verdict ?? supervisor.status, width - 10)}`,
  ]
}

function renderJournalTail(supervisor: SupervisorView, width: number, color: boolean): string[] {
  if (supervisor.journalTail.length === 0) return ['  no journal events yet']
  return supervisor.journalTail.map((event) => {
    const at = event.at ? formatClock(event.at) : '--:--:--'
    if (event.kind === 'spawned')
      return `  ${at} ${paint('spawn', 'yellow', color)}  ${pad(event.label ?? event.id, 16)} ${event.id}`
    if (event.kind === 'settled') {
      const spend = parseSpend(event.spent)
      return `  ${at} ${statusText(event.status ?? 'settled', color)} ${pad(event.id, 18)} ${formatMoney(spend.usd)} ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`
    }
    if (event.kind === 'metered') {
      const spend = parseSpend(event.spend)
      return `  ${at} ${paint('meter', 'cyan', color)}  ${pad(event.id, 18)} ${formatMoney(spend.usd)} ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`
    }
    return `  ${at} ${paint('cancel', 'red', color)} ${pad(event.id, 18)} ${compact(event.reason ?? '', width - 32)}`
  })
}

function renderWorkerTail(worker: WorkerView, width: number, color: boolean): string[] {
  if (worker.liveTail.length === 0) return ['live events: none recorded yet']
  return [
    'live events:',
    ...worker.liveTail
      .slice(-5)
      .map((line) => `  ${paint(compact(formatWorkerEvent(line), width - 2), 'dim', color)}`),
  ]
}

function renderSteerInput(
  input: NonNullable<RenderOptions['steerInput']>,
  width: number,
  color: boolean,
): string {
  const target = input.workerLabel ?? '-'
  const value = compact(input.value, Math.max(10, width - target.length - 14))
  return `${paint('steer', 'cyan', color)} ${target} > ${value}${paint('_', 'inverse', color)}`
}

function formatWorkerEvent(line: string): string {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    const at = typeof parsed.at === 'string' ? formatClock(parsed.at) : '--:--:--'
    const kind = typeof parsed.kind === 'string' ? parsed.kind : 'event'
    if (kind === 'progress')
      return `${at} progress iter ${numberValue(parsed.iteration)} ${String(parsed.phase ?? '')}`
    if (kind === 'message') {
      const state = parsed.queued === true ? 'queued' : 'sent'
      const source =
        typeof parsed.source === 'string' && parsed.source.length > 0 ? `${parsed.source} ` : ''
      const message =
        typeof parsed.message === 'string' && parsed.message.length > 0 ? ` ${parsed.message}` : ''
      return `${at} ${source}steer ${state} delivered=${String(parsed.delivered)}${message}`
    }
    if (kind === 'verify') {
      return `${at} verify passed=${String(parsed.passed)} exit=${String(parsed.exitCode ?? '-')}${evidenceSnippet(parsed.outputTail, 160)}`
    }
    if (kind === 'finished') {
      const branch = typeof parsed.branch === 'string' ? ` branch=${parsed.branch}` : ''
      const files = typeof parsed.filesChanged === 'number' ? ` files=${parsed.filesChanged}` : ''
      const tests =
        typeof parsed.testPassed === 'boolean' ? ` tests=${String(parsed.testPassed)}` : ''
      return `${at} finished passed=${String(parsed.passed)} patchBytes=${numberValue(parsed.patchBytes)}${files}${tests}${branch}${evidenceSnippet(parsed.evidence, 220)}`
    }
    if (kind === 'error') return `${at} error ${String(parsed.error ?? '')}`
    return `${at} ${kind}`
  } catch {
    return line
  }
}

/** One-line the settle evidence / verify tail a worker event carries so the
 *  failure is legible in the tail view (the full block stays in the ndjson). */
function evidenceSnippet(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine ? ` :: ${compact(oneLine, max)}` : ''
}

function histogram(
  values: readonly number[],
  count: number,
): Array<{ min: number; max: number; count: number }> {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return [{ min, max, count: values.length }]
  const step = (max - min) / count
  return Array.from({ length: count }, (_, index) => {
    const low = min + step * index
    const high = index === count - 1 ? max : min + step * (index + 1)
    const binCount = values.filter(
      (value) => value >= low && (index === count - 1 ? value <= high : value < high),
    ).length
    return { min: low, max: high, count: binCount }
  }).filter((bin) => bin.count > 0)
}

function bar(
  value: number,
  max: number,
  width: number,
  ch: string,
  color: boolean,
  colorName: keyof typeof colors,
): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / Math.max(max, 0.000001)) * width)))
  const text = ch.repeat(filled).padEnd(width, '.')
  return paint(text, colorName, color)
}

function stackedTokenBar(
  input: number,
  output: number,
  max: number,
  width: number,
  color: boolean,
): string {
  const inputWidth = Math.round((input / Math.max(max, 1)) * width)
  const outputWidth = Math.round((output / Math.max(max, 1)) * width)
  const clippedInput = Math.min(width, inputWidth)
  const clippedOutput = Math.min(width - clippedInput, outputWidth)
  const rest = Math.max(0, width - clippedInput - clippedOutput)
  return `${paint('#'.repeat(clippedInput), 'cyan', color)}${paint('+'.repeat(clippedOutput), 'green', color)}${'.'.repeat(rest)}`
}

function sectionTitle(title: string, focused: boolean, color: boolean): string {
  const text = focused ? `[${title}]` : title
  return paint(text, focused ? 'cyan' : 'bold', color)
}

function statusText(status: string, color: boolean): string {
  if (['completed', 'done', 'delivered', 'valid'].includes(status))
    return paint(status.toUpperCase(), 'green', color)
  if (['failed', 'down', 'cancelled', 'invalid', 'error'].includes(status))
    return paint(status.toUpperCase(), 'red', color)
  if (['running', 'spawned', 'settled'].includes(status))
    return paint(status.toUpperCase(), 'yellow', color)
  return paint(status.toUpperCase(), 'white', color)
}

function selectSupervisor(
  snapshot: TopSnapshot,
  requested: string | undefined,
): SupervisorView | undefined {
  if (requested) {
    const found = snapshot.supervisors.find((supervisor) => supervisor.id === requested)
    if (found) return found
  }
  return snapshot.supervisors[0]
}

function selectWorker(
  supervisor: SupervisorView,
  requested: string | undefined,
): WorkerView | undefined {
  if (requested) {
    const found = supervisor.workers.find((worker) => worker.id === requested)
    if (found) return found
  }
  return supervisor.workers[0]
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
    (value.kind === 'metered' && typeof value.id === 'string')
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

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function formatClock(value: string): string {
  const parsed = parseTime(value)
  if (parsed === undefined) return '--:--:--'
  return new Date(parsed).toISOString().slice(11, 19)
}

function formatMoney(value: number): string {
  if (value === 0) return '$0'
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return `${Math.round(value)}`
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`
  return `${(minutes / 60).toFixed(1)}h`
}

function compact(value: string, width: number): string {
  if (width <= 1) return ''
  if (value.length <= width) return value
  return `${value.slice(0, width - 1)}~`
}

function pad(value: string, width: number): string {
  const visible = visibleLength(value)
  if (visible >= width) return fitAnsi(value, width)
  return `${value}${' '.repeat(width - visible)}`
}

function rule(width: number, color: boolean): string {
  return paint('-'.repeat(width), 'dim', color)
}

function paint(
  value: string,
  colorName: keyof typeof colors | undefined,
  enabled: boolean,
): string {
  if (!enabled || !colorName) return value
  return `${colors[colorName]}${value}${colors.reset}`
}

function visibleLength(value: string): number {
  return stripAnsi(value).length
}

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '')
}

function fitAnsi(value: string, width: number): string {
  if (visibleLength(value) <= width) return value
  let out = ''
  let visible = 0
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch === '\x1b') {
      const rest = value.slice(i)
      // An escape sequence must be copied whole and counted as zero visible columns; truncating
      // inside one would emit a half-sequence the terminal interprets against the next line.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR sequences begin with ESC
      const match = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(rest)
      if (match) {
        out += match[0]
        i += match[0].length - 1
        continue
      }
    }
    if (visible >= width - 1) {
      out += '~'
      break
    }
    out += ch
    visible += 1
  }
  if (out.includes('\x1b[') && !out.endsWith(colors.reset)) out += colors.reset
  return out
}
