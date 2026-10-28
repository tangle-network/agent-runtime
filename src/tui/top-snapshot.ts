/** Read-only topology, activity and accounting over writer-owned workspace and durable journals.
 * ANSI presentation lives in `./top-frame`.
 * @experimental
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isRecord } from '@tangle-network/agent-core'
import { FileObserverJournal } from '../durable/observer-journal'
import {
  type PursuitProjection,
  type PursuitRunProjection,
  projectPursuit,
} from '../durable/observer-projection'
import { readFailureRecord, readSettleRecord } from '../durable/settle-record'
import { FileSpawnJournal } from '../durable/spawn-journal/journal-store'
import { spawnJournalRecordEvents } from '../durable/spawn-journal/record-events'
import { discoverDurableSupervisionRun } from '../durable/supervision-discovery'
import type { RouteFlowEvent } from '../mcp/tools/coordination-route-contracts'
import { FileCoordinationLog } from '../runtime/supervise/coordination-log'
import { nodeStreamFile, ROOT_STREAM_FILE } from '../runtime/supervise/root-stream'
import {
  legacySupervisorRunsRoot,
  safeWorkerFile,
  supervisorRunsRoot,
} from '../runtime/supervise/run-layout'
import { rootCoordinationOwner } from '../runtime/supervise/supervise-identity'
import type { Budget, Spend, SpendChannel } from '../runtime/supervise/types'
import { type RecordedEvents, readRecordedEvents } from './top-transcript'
import { workflowJournal } from './workflow-journal'

export interface TopSnapshot {
  readonly root: string
  readonly generatedAt: number
  readonly supervisors: SupervisorView[]
  /** Canonical facts, including unknown accounting and requested/observed identities. */
  readonly pursuit?: PursuitProjection
  /** `partial` when at least one discovered source could not be read completely. */
  readonly completeness: TopSnapshotCompleteness
  /** One bounded entry per skipped or partially read source; empty when complete. */
  readonly diagnostics: ReadonlyArray<TopSnapshotDiagnostic>
  /** Run directories found under the runs roots, readable or not. */
  readonly discovered: number
  /** Run directories projected into a valid supervisor view. */
  readonly loaded: number
}

export type TopSnapshotCompleteness = 'complete' | 'partial'

export type TopSnapshotDiagnosticSource =
  | 'observer-journal'
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
export interface TopSnapshotDiagnostic extends SourceDiagnostic {
  readonly runId?: string
}

interface SupervisorBase {
  readonly id: string
  readonly status: string
  readonly task: string
  readonly workspaceDir: string
  readonly budget: number
  readonly budgetKnown?: boolean
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
  readonly outcome?:
    | { readonly kind: 'winner' }
    | { readonly kind: 'no-winner' | 'failed'; readonly reason: string }
  readonly lastRoute?: Extract<RouteFlowEvent, { kind: 'stopped' | 'unrouted' }>
  readonly reason?: string
  /** Epoch milliseconds of actual recorded executor activity, independent of tail truncation. */
  readonly lastActivityAt?: number
  /** Median gap between all recorded activity instants, including real zero gaps. */
  readonly medianEventGapMs?: number
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
  /** Epoch milliseconds of actual recorded executor activity, independent of tail truncation. */
  readonly lastActivityAt?: number
  /** Median gap between all recorded activity instants, including real zero gaps. */
  readonly medianEventGapMs?: number
  readonly outRef?: string
  /** The conversation the executor retained at settlement, when it retained one. */
  readonly transcript?: { readonly ref: string; readonly harness: string }
  readonly reason?: string
}

export interface SupervisorTotals
  extends Pick<SpendStats, 'tokensInput' | 'tokensOutput' | 'usd' | 'usdKnown' | 'tokensKnown'> {
  readonly workers: number
  readonly running: number
  readonly done: number
  readonly down: number
  readonly cancelled: number
  readonly inFlight: number
  readonly settled: number
  readonly tokensTotal: number
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

export type BudgetStats = Partial<Pick<Budget, 'maxIterations' | 'maxTokens' | 'maxUsd'>>

export interface SpendStats
  extends Readonly<Pick<Spend, 'iterations' | 'usd' | 'ms' | 'usdKnown' | 'tokensKnown'>> {
  readonly tokensInput: number
  readonly tokensOutput: number
}

export type TopJournalEvent = {
  readonly id: string
  readonly seq?: number
  readonly at?: string
} & (
  | {
      readonly kind: 'spawned'
      readonly parent?: string
      readonly label?: string
      readonly budget?: unknown
      readonly runtime?: string
    }
  | {
      readonly kind: 'settled'
      readonly status?: string
      readonly outRef?: string
      readonly verdict?: unknown
      readonly spent?: unknown
      readonly infra?: boolean
    }
  | {
      readonly kind: 'cancelled'
      readonly spent?: unknown
      readonly reason?: string
    }
  | {
      readonly kind: 'metered'
      readonly spend?: unknown
      readonly accountingOnly?: boolean
    }
  | {
      readonly kind: 'progress'
      readonly spend?: unknown
    }
)

interface SupervisorState extends SupervisorBase {
  readonly result?: {
    readonly spentUsd?: number
    readonly spentTokens?: number
  }
}

type MutableWorker = {
  -readonly [Key in keyof Omit<WorkerView, 'latencyMs'>]: WorkerView[Key]
}

/** A diagnostic before its run id is attached; `loadTopSnapshot` adds `runId`. */
interface SourceDiagnostic {
  readonly source: TopSnapshotDiagnosticSource
  readonly path: string
  readonly reason: TopSnapshotDiagnosticReason
}

/** A recovered value and bounded, run-relative read diagnostics. */
interface SourceRead<T> {
  readonly value: T
  readonly diagnostics: readonly SourceDiagnostic[]
}

const emptySpend: SpendStats = { iterations: 0, tokensInput: 0, tokensOutput: 0, usd: 0, ms: 0 }

/** Read a point-in-time view without writing to the run. Missing or partial sources report
 * bounded diagnostics, and live event readers cache append offsets. `now` controls elapsed time.
 */
export function loadTopSnapshot(rootDir: string, now?: number): TopSnapshot
export function loadTopSnapshot(
  rootDir: string,
  options: { runDir: string; now?: number; format?: 'workflow' | 'journal' },
): Promise<TopSnapshot>
export function loadTopSnapshot(
  rootDir: string,
  input: number | { runDir: string; now?: number; format?: 'workflow' | 'journal' } = Date.now(),
): TopSnapshot | Promise<TopSnapshot> {
  if (typeof input !== 'number' && input.format === 'journal')
    return loadDurableTopSnapshot(rootDir, input.runDir, input.now ?? Date.now(), false)
  if (typeof input !== 'number' && input.format === 'workflow') {
    const root = resolve(rootDir),
      dir = resolve(input.runDir),
      now = input.now ?? Date.now()
    const read = readSourceFile(join(dir, 'journal.jsonl'), 'journal', 'journal.jsonl')
    if (read.value === undefined)
      return Promise.resolve(
        topSnapshot(
          root,
          now,
          [],
          read.diagnostics.length
            ? [...read.diagnostics]
            : [{ source: 'journal', path: 'journal.jsonl', reason: 'missing' }],
        ),
      )
    try {
      const journal = workflowJournal(dir, read.value)
      const supervisor = buildSupervisorView(
        {
          id: journal.id,
          task: journal.id,
          status: 'unobserved',
          workspaceDir: root,
          budget: 0,
          budgetKnown: false,
          ...(journal.first ? { startedAt: journal.first } : {}),
        },
        dir,
        journal.events,
        [],
        now,
        journal.tails,
      )
      return Promise.resolve(
        topSnapshot(root, now, [
          {
            ...supervisor,
            driverSpend: { ...supervisor.driverSpend, usdKnown: false, tokensKnown: false },
            totals: { ...supervisor.totals, usdKnown: false, tokensKnown: false },
          },
        ]),
      )
    } catch {
      return Promise.resolve(
        topSnapshot(
          root,
          now,
          [],
          [{ source: 'journal', path: 'journal.jsonl', reason: 'invalid-state' }],
        ),
      )
    }
  }
  if (typeof input !== 'number')
    return loadDurableTopSnapshot(rootDir, input.runDir, input.now ?? Date.now())
  const now = input
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
      const progress = readSourceFile(join(dir, 'progress.ndjson'), 'progress', 'progress.ndjson')
      const workerEvents = readWorkerEventTails(dir)
      report(entry, [...journal.diagnostics, ...progress.diagnostics, ...workerEvents.diagnostics])
      supervisors.push(
        buildSupervisorView(
          state.value,
          dir,
          journal.value,
          tailLines(progress.value, 8),
          now,
          workerEvents.value,
        ),
      )
    }
  }
  supervisors.sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
  return topSnapshot(root, now, supervisors, diagnostics, discovered)
}

function topSnapshot(
  root: string,
  now: number,
  supervisors: SupervisorView[],
  diagnostics: TopSnapshotDiagnostic[] = [],
  discovered = 1,
  pursuit?: PursuitProjection,
): TopSnapshot {
  return {
    root,
    generatedAt: now,
    supervisors,
    completeness: diagnostics.length ? 'partial' : 'complete',
    diagnostics,
    discovered,
    loaded: supervisors.length,
    ...(pursuit ? { pursuit } : {}),
  }
}

/** Observer-backed and older spawn-only runs share topology; missing accounting stays unknown. */
async function loadDurableTopSnapshot(
  rootDir: string,
  runDir: string,
  now: number,
  observed = true,
): Promise<TopSnapshot> {
  const root = resolve(rootDir)
  let pursuit: PursuitProjection | undefined
  let source: TopSnapshotDiagnosticSource = observed ? 'observer-journal' : 'journal'
  let path = observed ? 'observer.jsonl' : 'spawn-journal.jsonl'
  try {
    if (typeof runDir !== 'string' || !runDir.trim())
      throw new TypeError('runDir must be non-empty')
    if (observed) {
      const journal = await FileObserverJournal.open(join(resolve(runDir), path))
      if (!journal) return topSnapshot(root, now, [], [{ source, path, reason: 'missing' }])
      pursuit = projectPursuit(await journal.read())
    }
    source = 'journal'
    path = '.'
    const discovery = await discoverDurableSupervisionRun(runDir)
    path = 'spawn-journal.jsonl'
    const journal = new FileSpawnJournal(discovery.spawnJournalPath)
    const latest = new Map(pursuit?.runs.map((run) => [run.runId, run]))
    // A child's metered turns already belong to its spawn tree, not another supervisor row.
    const ids = pursuit
      ? [...latest.keys()].filter(
          (id) => !discovery.roots.some((parent) => id.startsWith(`${parent}/`)),
        )
      : discovery.roots
    path = 'result.json'
    const settled = await readSettleRecord(discovery.runDir)
    if (settled && !ids.includes(settled.tree.root))
      throw new Error('settle root is not discovered')
    path = 'failure.json'
    const failure = await readFailureRecord(discovery.runDir)
    const tails = readWorkerEventTails(discovery.runDir)
    const log = new FileCoordinationLog(discovery.coordinationLogPath)
    path = 'coordination-log.jsonl'
    const supervisors = await Promise.all(
      ids.map(async (id) => {
        const accounting = latest.get(id)
        const binding = discovery.roots.indexOf(id)
        // Retained admissions can predate the spawn journal. An existing journal must bind the root.
        if (binding < 0 && existsSync(discovery.spawnJournalPath))
          throw new Error('observer run has no discovered spawn root')
        const events = binding < 0 ? [] : ((await journal.loadTree(id)) ?? [])
        const spawn = events.find((event) => event.kind === 'spawned' && event.id === id)
        const budget = spawn?.kind === 'spawned' ? spawn.budget?.maxTokens : undefined
        const outcome: SupervisorView['outcome'] =
          settled?.tree.root === id
            ? settled.kind === 'winner'
              ? { kind: 'winner' }
              : { kind: 'no-winner', reason: settled.reason }
            : failure?.runId === id && accounting?.status === 'down'
              ? { kind: 'failed', reason: failure.error.message }
              : undefined
        const prior =
          spawn?.kind === 'spawned' && spawn.identity
            ? await log.load(id, rootCoordinationOwner(spawn.identity))
            : undefined
        let lastRoute: SupervisorView['lastRoute']
        for (const { event } of prior?.records ?? []) {
          if (
            event.type === 'route' &&
            (event.route.kind === 'stopped' || event.route.kind === 'unrouted')
          )
            lastRoute = event.route
        }
        const startedAt = accounting
          ? new Date(accounting.firstObservedAt).toISOString()
          : discovery.rootsBegunAt[binding]
        const view = buildSupervisorView(
          {
            id,
            task: id,
            workspaceDir: root,
            status: accounting?.status ?? 'running',
            budget: budget ?? 0,
            budgetKnown: budget !== undefined,
            ...(startedAt == null ? {} : { startedAt }),
            ...(accounting?.settledAt === undefined
              ? {}
              : { completedAt: new Date(accounting.settledAt).toISOString() }),
          },
          discovery.runDir,
          events.filter(isSpawnEvent),
          accounting?.error ? [accounting.error] : [],
          now,
          tails.value,
          accounting,
        )
        if (!accounting) Object.assign(view.totals, { usdKnown: false, tokensKnown: false })
        if (outcome)
          Object.assign(view, {
            outcome,
            status: outcome.kind === 'winner' ? 'done' : outcome.kind,
          })
        if (lastRoute)
          Object.assign(view, {
            lastRoute,
            reason: lastRoute.kind === 'stopped' ? lastRoute.reason : lastRoute.detail,
          })
        else if (outcome && 'reason' in outcome) Object.assign(view, { reason: outcome.reason })
        return view
      }),
    )
    return topSnapshot(
      root,
      now,
      supervisors,
      [
        ...(!observed
          ? [
              {
                source: 'observer-journal' as const,
                path: 'observer.jsonl',
                reason: 'missing' as const,
              },
            ]
          : []),
        ...tails.diagnostics,
      ],
      observed ? 1 : ids.length,
      pursuit,
    )
  } catch (error) {
    const reason =
      isRecord(error) && typeof error.code === 'string' ? 'unreadable' : 'invalid-state'
    return topSnapshot(root, now, [], [{ source, path, reason }], 1, pursuit)
  }
}

function observerSpend(spend: Spend | undefined, gaps: readonly SpendChannel[] = []): SpendStats {
  const parsed = parseSpend(spend)
  return {
    ...parsed,
    usdKnown: spend !== undefined && parsed.usdKnown !== false && !gaps.includes('usd'),
    tokensKnown: spend !== undefined && parsed.tokensKnown !== false && !gaps.includes('tokens'),
  }
}

/** Current writer-owned journal first; retain the retired name for recorded runs. */
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
      const events =
        parsed.kind === 'event' || parsed.kind === 'events'
          ? spawnJournalRecordEvents(parsed)
          : [parsed]
      for (const event of events) if (isSpawnEvent(event)) out.push(event)
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

/** The settled spawn event's retained-conversation receipt, read without widening the public
 *  `TopJournalEvent` type; the spawn journal already validated the record. */
function retainedTranscript(event: object): { ref: string; harness: string } | undefined {
  const retained = (event as { harnessTranscript?: unknown }).harnessTranscript
  if (typeof retained !== 'object' || retained === null) return undefined
  const { status, transcriptRef, harness } = retained as Record<string, unknown>
  return status === 'available' && typeof transcriptRef === 'string' && typeof harness === 'string'
    ? { ref: transcriptRef, harness }
    : undefined
}

/** The canonical spawn receipt owns the cause; the public journal view stays compatible. */
function recordedReason(event?: object): string | undefined {
  const reason = (event as { reason?: unknown } | undefined)?.reason
  return typeof reason === 'string' ? reason : undefined
}

function buildSupervisorView(
  state: SupervisorState,
  stateDir: string,
  events: readonly TopJournalEvent[],
  progressTail: readonly string[],
  now: number,
  workerEventTails = new Map<string, RecordedEvents>(),
  accounting?: PursuitRunProjection,
): SupervisorView {
  const workers = new Map<string, MutableWorker>()
  let driverSpend = emptySpend
  // State and journal have different producers and root ids. Exclude both, or the journal's
  // root becomes a phantom running worker that captures steer and cancel operations.
  const journalRootId = events.find(
    (event) => event.kind === 'spawned' && !event.parent && event.label === 'root',
  )?.id
  const isRoot = (id: string): boolean => id === state.id || id === journalRootId
  const terminal = events
    .filter((event) => isRoot(event.id) && (event.kind === 'settled' || event.kind === 'cancelled'))
    .at(-1)
  const rootReason = recordedReason(terminal)

  for (const event of events) {
    if (isRoot(event.id) || (event.kind === 'spawned' && !event.parent && event.label === 'root')) {
      if (event.kind === 'metered' && event.accountingOnly !== true) {
        driverSpend = addSpend(driverSpend, parseSpend(event.spend))
      }
      continue
    }
    const worker = ensureWorker(workers, event.id)
    if (event.kind === 'spawned') {
      worker.label = event.label ?? worker.label
      if (event.parent) worker.parent = event.parent
      if (event.runtime) worker.runtime = event.runtime
      worker.status = 'running'
      if (event.at) worker.startedAt = event.at
      const budget = parseBudget(event.budget)
      if (budget) worker.budget = budget
    } else if (event.kind === 'settled' || event.kind === 'cancelled') {
      if (event.at) worker.endedAt = event.at
      const reason = recordedReason(event)
      if (reason !== undefined) worker.reason = reason
      if (event.kind === 'settled') {
        worker.status = event.status === 'down' ? 'down' : 'done'
        if (event.outRef) worker.outRef = event.outRef
        const transcript = retainedTranscript(event)
        if (transcript) worker.transcript = transcript
        if (event.infra !== undefined) worker.infra = event.infra
        const verdict = describeVerdict(event.verdict)
        if (verdict) worker.verdict = verdict
      } else {
        worker.status = 'cancelled'
      }
      if (event.kind === 'settled' || event.spent !== undefined) {
        worker.spend = addSpend(worker.spend, parseSpend(event.spent))
        // Live progress is cumulative; terminal spend replaces it rather than counting it twice.
        worker.metered = emptySpend
      }
    } else if (event.kind === 'progress') {
      worker.metered = parseSpend(event.spend)
    } else if (event.accountingOnly !== true) {
      worker.metered = addSpend(worker.metered, parseSpend(event.spend))
    }
  }

  if (accounting) {
    driverSpend = observerSpend(accounting.totals.exclusiveByNode[accounting.runId])
    for (const worker of workers.values()) {
      worker.spend = observerSpend(
        accounting.totals.exclusiveByNode[worker.id],
        accounting.spendGaps?.find((gap) => gap.id === worker.id)?.channels,
      )
      worker.metered = emptySpend
    }
  }
  const workerViews = [...workers.values()]
    .map((worker) => {
      // Tails are keyed by file stem, which the writer put through `safeWorkerFile`; a label
      // carrying characters that stem strips would otherwise never find its own events.
      const tail =
        workerEventTails.get(join(stateDir, nodeStreamFile(worker.id))) ??
        workerEventTails.get(worker.label) ??
        workerEventTails.get(safeWorkerFile(worker.label)) ??
        workerEventTails.get(safeWorkerFile(worker.id)) ??
        workerEventTails.get(worker.id)
      worker.liveTail = tail?.lines ?? []
      if (tail) {
        worker.eventFile = tail.file
        Object.assign(worker, tail.activity)
      }
      return finalizeWorker(worker, now)
    })
    .sort((a, b) => compareWorker(a, b))

  const totals = supervisorTotals(state, workerViews, driverSpend, now)
  if (accounting) {
    const spend = observerSpend(
      accounting.totals.inclusive,
      accounting.spendGaps?.flatMap((gap) => gap.channels),
    )
    Object.assign(totals, spend, { tokensTotal: spend.tokensInput + spend.tokensOutput })
  }
  return {
    id: state.id,
    stateDir,
    ...(rootReason === undefined ? {} : { reason: rootReason }),
    ...workerEventTails.get(join(stateDir, ROOT_STREAM_FILE))?.activity,
    status:
      accounting && accounting.status !== 'running'
        ? accounting.status
        : terminal?.kind === 'settled'
          ? (terminal.status ?? state.status)
          : terminal
            ? 'cancelled'
            : state.status,
    task: state.task,
    workspaceDir: state.workspaceDir,
    budget: state.budget,
    ...(state.budgetKnown === undefined ? {} : { budgetKnown: state.budgetKnown }),
    ...selectFields(
      state,
      [
        'verifyCmd',
        'workerModel',
        'driverModel',
        'verdict',
        'progress',
        'startedAt',
        'completedAt',
      ],
      Boolean,
    ),
    ...selectFields(
      state,
      ['maxSandboxes', 'maxLifetimeSeconds', 'idleTimeoutSeconds', 'maxUsd', 'maxDepth'],
      (value) => value !== undefined,
    ),
    ...(state.result?.spentUsd !== undefined ? { resultSpentUsd: state.result.spentUsd } : {}),
    ...(state.result?.spentTokens !== undefined
      ? { resultSpentTokens: state.result.spentTokens }
      : {}),
    ...(!state.completedAt && terminal?.at ? { completedAt: terminal.at } : {}),
    workers: workerViews,
    progressTail: [...progressTail],
    journalTail: events.slice(-12),
    driverSpend,
    totals,
  }
}

function selectFields<T, K extends keyof T>(
  value: T,
  keys: readonly K[],
  include: (value: T[K]) => boolean,
): Partial<Pick<T, K>> {
  const selected: Partial<Pick<T, K>> = {}
  for (const key of keys) if (include(value[key])) selected[key] = value[key]
  return selected
}

function ensureWorker(workers: Map<string, MutableWorker>, id: string): MutableWorker {
  const existing = workers.get(id)
  if (existing) return existing
  const created: MutableWorker = {
    id,
    label: id,
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
  return { ...worker, latencyMs }
}

function supervisorTotals(
  state: SupervisorState,
  workers: readonly WorkerView[],
  driverSpend: SpendStats,
  now: number,
): SupervisorTotals {
  const spend = workers.map(totalSpend).reduce(addSpend, driverSpend)
  const counts = { running: 0, done: 0, down: 0, cancelled: 0 }
  for (const worker of workers) counts[worker.status] += 1
  const started = parseTime(state.startedAt)
  const completed = parseTime(state.completedAt)
  const latencyMs = started !== undefined ? Math.max(0, (completed ?? now) - started) : 0
  const latencies = workers.map((worker) => worker.latencyMs).filter((ms) => ms > 0)
  return {
    workers: workers.length,
    ...counts,
    ...(spend.usdKnown === false ? { usdKnown: false } : {}),
    ...(spend.tokensKnown === false ? { tokensKnown: false } : {}),
    inFlight: counts.running,
    settled: workers.length - counts.running,
    tokensInput: spend.tokensInput,
    tokensOutput: spend.tokensOutput,
    tokensTotal: spend.tokensInput + spend.tokensOutput,
    usd: spend.usd > 0 ? spend.usd : (state.result?.spentUsd ?? 0),
    latencyMs,
    workerLatency: distribution(latencies),
  }
}

export function aggregateSnapshot(snapshot: TopSnapshot) {
  const complete = snapshot.completeness === 'complete'
  return {
    usdKnown: complete && snapshot.supervisors.every((row) => row.totals.usdKnown !== false),
    tokensKnown: complete && snapshot.supervisors.every((row) => row.totals.tokensKnown !== false),
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
    ...(a.usdKnown === false || b.usdKnown === false ? { usdKnown: false } : {}),
    ...(a.tokensKnown === false || b.tokensKnown === false ? { tokensKnown: false } : {}),
  }
}

export function parseSpend(value: unknown): SpendStats {
  if (!isRecord(value)) return emptySpend
  const tokens = isRecord(value.tokens) ? value.tokens : {}
  return {
    ...(value.usdKnown === false ? { usdKnown: false } : {}),
    ...(value.tokensKnown === false || tokens.tokensKnown === false ? { tokensKnown: false } : {}),
    iterations: numberValue(value.iterations),
    tokensInput: numberValue(tokens.input),
    tokensOutput: numberValue(tokens.output),
    usd: numberValue(value.usd),
    ms: numberValue(value.ms),
  }
}

function parseBudget(value: unknown): BudgetStats | undefined {
  if (!isRecord(value)) return undefined
  const budget = selectFields(
    value,
    ['maxIterations', 'maxTokens', 'maxUsd'],
    (entry) => typeof entry === 'number',
  ) as BudgetStats
  return Object.keys(budget).length ? budget : undefined
}

function describeVerdict(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.valid === 'boolean') return value.valid ? 'valid' : 'invalid'
  if (typeof value.score === 'number') return `score ${value.score.toFixed(2)}`
  return undefined
}

function distribution(values: readonly number[]): Distribution {
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

/** Missing files can predate their writer; failed reads report a path-only diagnostic. */
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

function readWorkerEventTails(dir: string): SourceRead<Map<string, RecordedEvents>> {
  const out = new Map<string, RecordedEvents>()
  const diagnostics: SourceDiagnostic[] = []
  const read = (path: string, key = join(dir, path)) => {
    try {
      if (existsSync(join(dir, path))) out.set(key, readRecordedEvents(join(dir, path)))
    } catch {
      diagnostics.push({ source: 'worker-tail', path, reason: 'unreadable' })
    }
  }
  read(ROOT_STREAM_FILE)
  for (const folder of ['workers', 'streams']) {
    if (!existsSync(join(dir, folder))) continue
    try {
      for (const entry of readdirSync(join(dir, folder))) {
        // Inbox steer requests are not evidence that the executor emitted progress.
        if (folder === 'workers' && entry.endsWith('.ndjson') && !entry.endsWith('.inbox.ndjson'))
          read(join(folder, entry), entry.slice(0, -'.ndjson'.length))
        else if (folder === 'streams' && entry.endsWith('.jsonl')) read(join(folder, entry))
      }
    } catch {
      diagnostics.push({ source: 'worker-tail', path: folder, reason: 'unreadable' })
    }
  }
  return { value: out, diagnostics }
}

function readSupervisorState(dir: string): SourceRead<SupervisorState | undefined> {
  const path = 'state.json'
  const read = readSourceFile(join(dir, path), 'supervisor-state', path)
  if (read.diagnostics.length > 0) return { value: undefined, diagnostics: read.diagnostics }
  const failed = (reason: TopSnapshotDiagnosticReason): SourceRead<undefined> => ({
    value: undefined,
    diagnostics: [{ source: 'supervisor-state', path, reason }],
  })
  if (read.value === undefined) return failed('missing')
  try {
    const parsed: unknown = JSON.parse(read.value)
    return isSupervisorState(parsed) ? { value: parsed, diagnostics: [] } : failed('invalid-state')
  } catch {
    return failed('partial-json')
  }
}

function isSupervisorState(value: unknown): value is SupervisorState {
  return (
    isRecord(value) &&
    ['id', 'status', 'task', 'workspaceDir'].every((key) => typeof value[key] === 'string') &&
    typeof value.budget === 'number'
  )
}

function isSpawnEvent<T>(value: T): value is T & TopJournalEvent {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    ['spawned', 'settled', 'cancelled', 'metered', 'progress'].includes(value.kind)
  )
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
