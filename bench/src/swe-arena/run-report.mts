/**
 * Deterministic run observability for supervisor cells.
 *
 * Every completed cell (one arm × one instance × one rep) leaves the same
 * artifacts on disk: the supervision journal (`ws/.loops/supervisor/<id>/journal.jsonl`),
 * the per-worker control/progress logs (`.../workers/<label>.ndjson` + `<label>.inbox.ndjson`),
 * the supervisor `state.json`, the arm's `result.json` / `judge.json` / `driver.log`,
 * and the delivered patch. Answering "did the supervisor STEER anyone? how many waves?
 * were workers idle? what did each role cost?" has meant hand-grepping those files after
 * every experiment. This module reads them once and answers deterministically.
 *
 * Two layers, deliberately split:
 *   • `computeRunReport` is PURE — it takes already-read file contents and returns the
 *     report. Every metric is testable from a synthetic journal string with no fs.
 *   • `collectRunReportSources` / `writeRunReport` do the I/O (including the opencode
 *     sqlite worker-token join, which is the only non-file source).
 *
 * UNAVAILABLE ≠ ZERO. Every metric whose backing artifact can be missing is typed
 * `Measured<T> = T | { unavailable: reason }`. A supervisor that steered nobody reports
 * `steers: 0`; a supervisor whose worker logs were never written reports
 * `steers: unavailable: no workers/ dir under <supRunDir>`. The markdown renders those
 * differently on purpose (`0` vs `unavailable — <reason>`), because the two have driven
 * opposite conclusions about the same architecture.
 *
 * Related published tooling: the `traces` CLI (`npx @tangle-network/traces analyze`)
 * covers the HARNESS-SESSION layer — per-session model calls, token/cost tables, latency
 * distributions, stuck-loop detection, tool-error rates, skill/subagent adoption — keyed
 * off `~/.local/share/opencode` (and the other harness stores). It has no notion of a
 * supervision tree: no journal reader, no steer/wave/concurrency/utilization/delegation-depth
 * metric, no accepted-vs-rejected worker accounting. This module covers exactly that gap
 * and does not re-derive what `traces` already reports; `traceCommand` on the report names
 * the command to run for the session-level view of the same cell.
 */

import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// Unavailable-aware metric type.
// ---------------------------------------------------------------------------

/** A metric that could not be computed, with the reason its artifact was missing. */
export interface Unavailable {
  readonly unavailable: string
}

/** A metric value, or the reason it is unknown. NEVER collapse `unavailable` to 0. */
export type Measured<T> = T | Unavailable

export function unavailable(reason: string): Unavailable {
  return { unavailable: reason }
}

export function isUnavailable(v: unknown): v is Unavailable {
  return typeof v === 'object' && v !== null && typeof (v as Unavailable).unavailable === 'string'
}

/** Render a measured scalar for the markdown/headline: `0` and `unavailable` stay distinct. */
export function showMeasured(v: Measured<number | string | boolean | null>): string {
  if (isUnavailable(v)) return `unavailable — ${v.unavailable}`
  if (v === null) return 'null'
  return String(v)
}

// ---------------------------------------------------------------------------
// Raw sources — exactly the bytes the pure function needs.
// ---------------------------------------------------------------------------

/** One worker's on-disk logs, as read. `null` = the file did not exist. */
export interface WorkerLogSource {
  readonly label: string
  /** `workers/<label>.ndjson` — started / progress / finished / message events. */
  readonly events: string | null
  /** `workers/<label>.inbox.ndjson` — the durable steer queue (one line per steer). */
  readonly inbox: string | null
  /** `workers/<label>.patch` byte length, or null when absent. */
  readonly patchBytes: number | null
}

/**
 * Everything `computeRunReport` reads. Each field is `null` when its artifact was
 * absent, which is what turns the dependent metrics into `unavailable` rather than 0.
 */
export interface RunReportSources {
  /** Cell directory (`<outDir>/runs/<iid>/<arm>`), used for labels only. */
  readonly cellDir: string
  readonly instanceId: string | null
  readonly arm: string | null
  /** `ws/.loops/supervisor/<id>` — null when no supervisor run dir exists. */
  readonly supRunDir: string | null
  /** `journal.jsonl` text. */
  readonly journal: string | null
  /** `brain.jsonl` text — loops' per-brain-call tap (finish_reason, max_tokens, tool calls). */
  readonly brainLog: string | null
  /** `state.json` text. */
  readonly state: string | null
  /** `progress.ndjson` text. */
  readonly progress: string | null
  /** Per-worker logs; `null` = the `workers/` directory itself was missing. */
  readonly workers: readonly WorkerLogSource[] | null
  /** Why `workers` is null (only set when it is). */
  readonly workersMissingReason: string | null
  /** Arm `result.json` text. */
  readonly result: string | null
  /**
   * Arm `judge.json` text, or the matching ledger row re-encoded as one. Runners that
   * write the verdict straight to the ledger (the factory path) leave no `judge.json`,
   * so the ledger row is the same fact from the same run — not a substitute measurement.
   */
  readonly judge: string | null
  /** Where `judge` came from, for the report's provenance line. */
  readonly judgeSource: string | null
  /** Delivered unified-diff patch text. */
  readonly patch: string | null
  /** `driver.log` text (used for the outer driver's steer verbs + deadline evidence). */
  readonly driverLog: string | null
  /** Worker tokens recovered from the opencode session store; null = store unavailable. */
  readonly opencodeWorkerTokens: { sessions: number; input: number; output: number } | null
  readonly opencodeMissingReason: string | null
}

// ---------------------------------------------------------------------------
// Journal shapes (structurally parsed — the journal is the contract, not the type).
// ---------------------------------------------------------------------------

interface JournalEvent {
  kind?: unknown
  id?: unknown
  parent?: unknown
  label?: unknown
  status?: unknown
  verdict?: unknown
  reason?: unknown
  seq?: unknown
  at?: unknown
  spend?: unknown
  spent?: unknown
}

interface Tokens {
  input: number
  output: number
}

interface SpendLike {
  tokens: Tokens
  usd: number
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function readSpend(v: unknown): SpendLike {
  const rec = asRecord(v)
  const tok = asRecord(rec.tokens)
  return { tokens: { input: num(tok.input), output: num(tok.output) }, usd: num(rec.usd) }
}

function parseJsonl(text: string | null): Record<string, unknown>[] {
  if (text === null) return []
  const out: Record<string, unknown>[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null) out.push(parsed as Record<string, unknown>)
    } catch {
      // A torn last line (driver killed mid-append) is skipped, never fatal.
    }
  }
  return out
}

function parseJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function ms(at: unknown): number | null {
  if (typeof at !== 'string') return null
  const t = Date.parse(at)
  return Number.isFinite(t) ? t : null
}

// ---------------------------------------------------------------------------
// Report shape.
// ---------------------------------------------------------------------------

export interface SteerBreakdown {
  readonly worker: string
  /** Steer requests durably queued to this worker's inbox. */
  readonly queued: number
  /** Steers the worker's executor actually accepted (control event `delivered:true`). */
  readonly delivered: number
}

export interface OrchestrationMetrics {
  readonly workersSpawned: Measured<number>
  readonly workersSettled: Measured<number>
  readonly workersCancelled: Measured<number>
  /** THE HEADLINE: mid-task steers the brain sent to live workers. 0 ≠ unavailable. */
  readonly steers: Measured<number>
  readonly steersDelivered: Measured<number>
  readonly steersByWorker: Measured<readonly SteerBreakdown[]>
  /** Outer-driver `supervisor_steer` tool calls seen in driver.log (a second steer path). */
  readonly driverSteerCalls: Measured<number>
  /**
   * Spawn waves. A wave is a maximal run of worker spawns with no settle/cancel between
   * them: wave N+1 begins at the first spawn issued after at least one worker from an
   * earlier wave has settled. Structural, not a time threshold — no tunable constant.
   */
  readonly waves: Measured<number>
  readonly waveSizes: Measured<readonly number[]>
  readonly maxConcurrency: Measured<number>
  /** Worker spawns issued after the first settlement — the retry/respawn tail. */
  readonly respawns: Measured<number>
  /** Labels spawned more than once (a literal retry of the same subtask). */
  readonly repeatedLabels: Measured<readonly string[]>
  /** Longest parent chain below the root, in worker hops. */
  readonly delegationDepth: Measured<number>
  readonly timeToFirstSpawnMs: Measured<number>
  readonly supervisorWallMs: Measured<number>
  /** Wall time inside the supervisor run with ZERO live workers. */
  readonly idleMs: Measured<number>
  readonly idlePct: Measured<number>
  /** sum(worker wall) / supervisor wall. >1 means real parallelism. */
  readonly workerUtilization: Measured<number>
}

export interface DecisionMetrics {
  readonly settledByStatus: Measured<Record<string, number>>
  readonly settledVerdicts: Measured<Record<string, number>>
  /** Worker verified its own work green AND produced a patch. */
  readonly accepted: Measured<number>
  /** Worker settled with a failing verify. */
  readonly rejected: Measured<number>
  /** Worker verified green but delivered no patch bytes — output with nothing to accept. */
  readonly emptyPass: Measured<number>
  /** Settlements the brain observed before issuing its next spawn (evidence→respawn). */
  readonly observeThenRespawn: Measured<number>
  /** Respawns with no settled evidence in front of them. */
  readonly respawnWithoutEvidence: Measured<number>
  /** Steer + question traffic on the live down/up legs — the only "review while running" signal. */
  readonly reviewActions: Measured<number>
  readonly workerEvidenceBytes: Measured<number>
}

export interface RoleSpend {
  readonly tokensIn: Measured<number>
  readonly tokensOut: Measured<number>
  readonly usd: Measured<number>
  readonly source: string
}

export interface EconomicsMetrics {
  /** Driver/brain inference — journal `metered` events. */
  readonly brain: RoleSpend
  /**
   * Brain completions that came back `finish_reason: "length"` — output TRUNCATED. Any value
   * above 0 means the supervisor planned into a wall and then acted on the half-written plan,
   * which is a defect and not a cost figure. The journal's `metered` rows carry token counts
   * but no finish reason, so this reads loops' per-call brain tap (`brain.jsonl`); a run whose
   * loops predates that tap reports `unavailable`, never 0.
   */
  readonly brainTruncations: Measured<number>
  /** Worker inference — journal `settled` spend plus the opencode session join. */
  readonly workers: RoleSpend
  readonly totalUsd: Measured<number>
  /**
   * Where `totalUsd` came from. CLI-backend workers never price their own inference into
   * the journal, so on those arms the total is BRAIN-ONLY and the worker row's token
   * counts (recovered from the opencode store) are the honest worker-side figure.
   */
  readonly totalUsdSource: string
  readonly costPerAcceptedPatchUsd: Measured<number>
  readonly workerWallMsDistribution: Measured<{
    n: number
    min: number
    p50: number
    p90: number
    max: number
    sum: number
  }>
  readonly perWorker: Measured<
    readonly {
      worker: string
      wallMs: number | null
      tokensIn: number
      tokensOut: number
      usd: number
      patchBytes: number | null
      passed: boolean | null
    }[]
  >
}

export interface PatchStats {
  readonly files: number
  readonly linesAdded: number
  readonly linesRemoved: number
  readonly testFilesTouched: readonly string[]
}

export interface OutcomeMetrics {
  readonly supStatus: Measured<string>
  readonly supVerdict: Measured<string>
  readonly delivered: Measured<boolean>
  readonly judgeResolved: Measured<boolean | null>
  readonly judgeScore: Measured<number | null>
  readonly judgePassed: Measured<number | null>
  readonly judgeTotal: Measured<number | null>
  readonly verifyPass: Measured<boolean>
  readonly verifyRc: Measured<number>
  readonly patch: Measured<PatchStats>
  /** Which file the judge fields came from (`judge.json`, a ledger row, or nothing). */
  readonly judgeSource: string | null
}

export interface RunReport {
  readonly schema: 'swe-arena/run-report@1'
  readonly cellDir: string
  readonly instanceId: string | null
  readonly arm: string | null
  readonly supervisorId: Measured<string>
  readonly generatedAt: string
  readonly orchestration: OrchestrationMetrics
  readonly decision: DecisionMetrics
  readonly economics: EconomicsMetrics
  readonly outcome: OutcomeMetrics
  /** Artifacts that were missing, in read order — the provenance of every `unavailable`. */
  readonly gaps: readonly string[]
  /** The `traces` CLI command that covers the harness-session layer for this cell. */
  readonly traceCommand: string
}

// ---------------------------------------------------------------------------
// Pure computation.
// ---------------------------------------------------------------------------

interface SpawnRow {
  id: string
  parent: string | null
  label: string
  at: number | null
}

interface CloseRow {
  id: string
  kind: 'settled' | 'cancelled'
  status: string | null
  verdict: string | null
  at: number | null
  spend: SpendLike
}

export function computeRunReport(src: RunReportSources, now: () => number = Date.now): RunReport {
  const gaps: string[] = []
  const gap = (what: string, reason: string): Unavailable => {
    gaps.push(`${what}: ${reason}`)
    return unavailable(reason)
  }

  const journalMissing = src.supRunDir === null ? 'no supervisor run dir under <ws>/.loops/supervisor' : 'journal.jsonl absent'
  const haveJournal = src.journal !== null
  const events = parseJsonl(src.journal)
  const state = parseJson(src.state)
  const result = parseJson(src.result)
  const judge = parseJson(src.judge)

  // ── journal structure ──────────────────────────────────────────────────
  const spawns: SpawnRow[] = []
  const closes: CloseRow[] = []
  let brainIn = 0
  let brainOut = 0
  let brainUsd = 0
  let meteredCount = 0
  let rootId: string | null = null
  for (const ev of events as JournalEvent[]) {
    const kind = typeof ev.kind === 'string' ? ev.kind : ''
    const id = typeof ev.id === 'string' ? ev.id : ''
    if (kind === 'spawned') {
      const parent = typeof ev.parent === 'string' ? ev.parent : null
      const label = typeof ev.label === 'string' ? ev.label : ''
      if (parent === null && rootId === null) rootId = id
      spawns.push({ id, parent, label, at: ms(ev.at) })
    } else if (kind === 'settled') {
      closes.push({
        id,
        kind: 'settled',
        status: typeof ev.status === 'string' ? ev.status : null,
        verdict: typeof ev.verdict === 'string' ? ev.verdict : null,
        at: ms(ev.at),
        spend: readSpend(ev.spent),
      })
    } else if (kind === 'cancelled') {
      closes.push({
        id,
        kind: 'cancelled',
        status: 'cancelled',
        verdict: typeof ev.reason === 'string' ? ev.reason : null,
        at: ms(ev.at),
        spend: { tokens: { input: 0, output: 0 }, usd: 0 },
      })
    } else if (kind === 'metered') {
      const s = readSpend(ev.spend)
      brainIn += s.tokens.input
      brainOut += s.tokens.output
      brainUsd += s.usd
      meteredCount += 1
    }
  }
  const workerSpawns = spawns.filter((s) => s.id !== rootId)
  const workerIds = new Set(workerSpawns.map((s) => s.id))
  const workerCloses = closes.filter((c) => workerIds.has(c.id))

  // ── wall clock ─────────────────────────────────────────────────────────
  const startedAt = ms(state?.startedAt) ?? spawns[0]?.at ?? null
  const completedAt =
    ms(state?.completedAt) ??
    [...spawns.map((s) => s.at), ...closes.map((c) => c.at)].reduce<number | null>(
      (acc, t) => (t === null ? acc : acc === null ? t : Math.max(acc, t)),
      null,
    )
  const supervisorWallMs: Measured<number> =
    startedAt !== null && completedAt !== null && completedAt >= startedAt
      ? completedAt - startedAt
      : !haveJournal
        ? gap('supervisorWallMs', journalMissing)
        : gap('supervisorWallMs', 'no parseable start/complete timestamps in state.json or journal')

  // ── steers (workers/*.inbox.ndjson + control events) ───────────────────
  const steerRows: SteerBreakdown[] = []
  let steerQueuedTotal = 0
  let steerDeliveredTotal = 0
  let upLegMessages = 0
  const workerFinished = new Map<
    string,
    { passed: boolean | null; patchBytes: number | null; evidenceBytes: number; at: number | null }
  >()
  const workerStarted = new Map<string, number | null>()
  if (src.workers !== null) {
    for (const w of src.workers) {
      let queued = 0
      let delivered = 0
      for (const req of parseJsonl(w.inbox)) {
        if (typeof req.message === 'string' && req.message.trim().length > 0) queued += 1
      }
      for (const ev of parseJsonl(w.events)) {
        const kind = ev.kind
        if (kind === 'message') {
          if (ev.direction === 'up') {
            upLegMessages += 1
            continue
          }
          // A down-leg message not backed by an inbox line (in-process steer) still counts.
          if (typeof ev.requestId !== 'string') queued += 1
          if (ev.delivered === true) delivered += 1
        } else if (kind === 'started') {
          workerStarted.set(w.label, ms(ev.at))
        } else if (kind === 'finished') {
          workerFinished.set(w.label, {
            passed: typeof ev.passed === 'boolean' ? ev.passed : null,
            patchBytes: typeof ev.patchBytes === 'number' ? ev.patchBytes : null,
            evidenceBytes: typeof ev.evidence === 'string' ? ev.evidence.length : 0,
            at: ms(ev.at),
          })
        }
      }
      steerRows.push({ worker: w.label, queued, delivered })
      steerQueuedTotal += queued
      steerDeliveredTotal += delivered
    }
  }
  const workersGapReason = src.workersMissingReason ?? 'workers/ directory absent'
  const steers: Measured<number> = src.workers === null ? gap('steers', workersGapReason) : steerQueuedTotal
  const steersDelivered: Measured<number> =
    src.workers === null ? unavailable(workersGapReason) : steerDeliveredTotal
  const steersByWorker: Measured<readonly SteerBreakdown[]> =
    src.workers === null ? unavailable(workersGapReason) : steerRows

  // The `[driver] registered tools: …supervisor_steer…` banner names the verb without
  // invoking it, so banner lines are subtracted from the raw mention count.
  const driverSteerCalls: Measured<number> =
    src.driverLog === null
      ? gap('driverSteerCalls', 'driver.log absent')
      : Math.max(0, (src.driverLog.match(/supervisor_steer/g) ?? []).length - registrationMentions(src.driverLog))

  // ── waves / concurrency / idle ─────────────────────────────────────────
  const timeline: { at: number; delta: 1 | -1 }[] = []
  for (const s of workerSpawns) if (s.at !== null) timeline.push({ at: s.at, delta: 1 })
  for (const c of workerCloses) if (c.at !== null) timeline.push({ at: c.at, delta: -1 })
  timeline.sort((a, b) => a.at - b.at || a.delta - b.delta)

  let waves = 0
  const waveSizes: number[] = []
  let closedSinceWaveStart = true
  for (const step of timeline) {
    if (step.delta === 1) {
      if (closedSinceWaveStart) {
        waves += 1
        waveSizes.push(0)
        closedSinceWaveStart = false
      }
      waveSizes[waveSizes.length - 1] = (waveSizes[waveSizes.length - 1] ?? 0) + 1
    } else {
      closedSinceWaveStart = true
    }
  }

  let live = 0
  let maxConcurrency = 0
  let idleMs = 0
  let sumWorkerWallMs = 0
  let prev = startedAt
  for (const step of timeline) {
    if (prev !== null && step.at >= prev) {
      const span = step.at - prev
      if (live === 0) idleMs += span
      sumWorkerWallMs += span * live
    }
    live += step.delta
    if (live > maxConcurrency) maxConcurrency = live
    prev = step.at
  }
  if (prev !== null && completedAt !== null && completedAt >= prev) {
    const span = completedAt - prev
    if (live === 0) idleMs += span
    sumWorkerWallMs += span * live
  }

  const firstWorkerSpawnAt = workerSpawns.reduce<number | null>(
    (acc, s) => (s.at === null ? acc : acc === null ? s.at : Math.min(acc, s.at)),
    null,
  )
  const firstSettleAt = workerCloses.reduce<number | null>(
    (acc, c) => (c.at === null ? acc : acc === null ? c.at : Math.min(acc, c.at)),
    null,
  )
  const respawns =
    firstSettleAt === null ? 0 : workerSpawns.filter((s) => s.at !== null && s.at > firstSettleAt).length

  const labelCounts = new Map<string, number>()
  for (const s of workerSpawns) labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1)
  const repeatedLabels = [...labelCounts.entries()].filter(([, n]) => n > 1).map(([l]) => l)

  const parentOf = new Map(spawns.map((s) => [s.id, s.parent]))
  let delegationDepth = 0
  for (const s of workerSpawns) {
    let d = 0
    let cur: string | null = s.id
    const seen = new Set<string>()
    while (cur !== null && cur !== rootId && !seen.has(cur)) {
      seen.add(cur)
      d += 1
      cur = parentOf.get(cur) ?? null
    }
    if (d > delegationDepth) delegationDepth = d
  }

  const orchestration: OrchestrationMetrics = {
    workersSpawned: haveJournal ? workerSpawns.length : gap('workersSpawned', journalMissing),
    workersSettled: haveJournal ? workerCloses.filter((c) => c.kind === 'settled').length : unavailable(journalMissing),
    workersCancelled: haveJournal ? workerCloses.filter((c) => c.kind === 'cancelled').length : unavailable(journalMissing),
    steers,
    steersDelivered,
    steersByWorker,
    driverSteerCalls,
    waves: haveJournal ? waves : unavailable(journalMissing),
    waveSizes: haveJournal ? waveSizes : unavailable(journalMissing),
    maxConcurrency: haveJournal ? maxConcurrency : unavailable(journalMissing),
    respawns: haveJournal ? respawns : unavailable(journalMissing),
    repeatedLabels: haveJournal ? repeatedLabels : unavailable(journalMissing),
    delegationDepth: haveJournal ? delegationDepth : unavailable(journalMissing),
    timeToFirstSpawnMs:
      startedAt !== null && firstWorkerSpawnAt !== null
        ? firstWorkerSpawnAt - startedAt
        : haveJournal
          ? unavailable('no worker spawn timestamps')
          : unavailable(journalMissing),
    supervisorWallMs,
    idleMs: isUnavailable(supervisorWallMs) ? unavailable(supervisorWallMs.unavailable) : idleMs,
    idlePct:
      isUnavailable(supervisorWallMs) || supervisorWallMs === 0
        ? isUnavailable(supervisorWallMs)
          ? unavailable(supervisorWallMs.unavailable)
          : unavailable('supervisor wall is 0ms')
        : round((idleMs / supervisorWallMs) * 100, 1),
    workerUtilization:
      isUnavailable(supervisorWallMs) || supervisorWallMs === 0
        ? isUnavailable(supervisorWallMs)
          ? unavailable(supervisorWallMs.unavailable)
          : unavailable('supervisor wall is 0ms')
        : round(sumWorkerWallMs / supervisorWallMs, 3),
  }

  // ── decision quality ───────────────────────────────────────────────────
  const settledByStatus: Record<string, number> = {}
  const settledVerdicts: Record<string, number> = {}
  for (const c of workerCloses) {
    const key = c.status ?? 'unknown'
    settledByStatus[key] = (settledByStatus[key] ?? 0) + 1
    if (c.verdict !== null) settledVerdicts[c.verdict] = (settledVerdicts[c.verdict] ?? 0) + 1
  }

  let accepted = 0
  let rejected = 0
  let emptyPass = 0
  let evidenceBytes = 0
  for (const [, f] of workerFinished) {
    evidenceBytes += f.evidenceBytes
    if (f.passed === true) {
      if ((f.patchBytes ?? 0) > 0) accepted += 1
      else emptyPass += 1
    } else if (f.passed === false) rejected += 1
  }

  // Evidence→respawn: for each worker spawn issued after some settlement, did a
  // settlement land strictly between the previous spawn and this one?
  let observeThenRespawn = 0
  let respawnWithoutEvidence = 0
  const spawnTimes = workerSpawns.map((s) => s.at).filter((t): t is number => t !== null).sort((a, b) => a - b)
  const closeTimes = workerCloses.map((c) => c.at).filter((t): t is number => t !== null).sort((a, b) => a - b)
  for (let i = 1; i < spawnTimes.length; i += 1) {
    const prevSpawn = spawnTimes[i - 1]!
    const thisSpawn = spawnTimes[i]!
    const sawEvidence = closeTimes.some((t) => t >= prevSpawn && t <= thisSpawn)
    if (firstSettleAt !== null && thisSpawn > firstSettleAt) {
      if (sawEvidence) observeThenRespawn += 1
      else respawnWithoutEvidence += 1
    }
  }

  const decision: DecisionMetrics = {
    settledByStatus: haveJournal ? settledByStatus : gap('settledByStatus', journalMissing),
    settledVerdicts: haveJournal ? settledVerdicts : unavailable(journalMissing),
    accepted: src.workers === null ? unavailable(workersGapReason) : accepted,
    rejected: src.workers === null ? unavailable(workersGapReason) : rejected,
    emptyPass: src.workers === null ? unavailable(workersGapReason) : emptyPass,
    observeThenRespawn: haveJournal ? observeThenRespawn : unavailable(journalMissing),
    respawnWithoutEvidence: haveJournal ? respawnWithoutEvidence : unavailable(journalMissing),
    reviewActions:
      src.workers === null ? unavailable(workersGapReason) : steerQueuedTotal + upLegMessages,
    workerEvidenceBytes: src.workers === null ? unavailable(workersGapReason) : evidenceBytes,
  }

  // ── economics ──────────────────────────────────────────────────────────
  const journalWorkerIn = workerCloses.reduce((a, c) => a + c.spend.tokens.input, 0)
  const journalWorkerOut = workerCloses.reduce((a, c) => a + c.spend.tokens.output, 0)
  const journalWorkerUsd = workerCloses.reduce((a, c) => a + c.spend.usd, 0)
  const sq = src.opencodeWorkerTokens
  const workerIn: Measured<number> =
    sq !== null
      ? journalWorkerIn + sq.input
      : journalWorkerIn > 0
        ? journalWorkerIn
        : gap('workers.tokensIn', src.opencodeMissingReason ?? 'opencode session store unavailable and journal settled spend is 0')
  const workerOut: Measured<number> =
    sq !== null
      ? journalWorkerOut + sq.output
      : journalWorkerOut > 0
        ? journalWorkerOut
        : unavailable(src.opencodeMissingReason ?? 'opencode session store unavailable and journal settled spend is 0')

  const stateResult = asRecord(state?.result)
  const stateUsd = typeof stateResult.spentUsd === 'number' ? stateResult.spentUsd : null
  const totalUsd: Measured<number> =
    stateUsd !== null ? round(stateUsd, 6) : haveJournal ? round(brainUsd + journalWorkerUsd, 6) : gap('totalUsd', journalMissing)

  const perWorker = (src.workers ?? []).map((w) => {
    const started = workerStarted.get(w.label) ?? null
    const fin = workerFinished.get(w.label) ?? null
    return {
      worker: w.label,
      wallMs: started !== null && fin?.at != null ? fin.at - started : null,
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      patchBytes: w.patchBytes ?? fin?.patchBytes ?? null,
      passed: fin?.passed ?? null,
    }
  })
  const walls = perWorker.map((w) => w.wallMs).filter((w): w is number => w !== null).sort((a, b) => a - b)

  const brainCalls = parseJsonl(src.brainLog)
  const economics: EconomicsMetrics = {
    brain: {
      tokensIn: haveJournal ? brainIn : gap('brain.tokensIn', journalMissing),
      tokensOut: haveJournal ? brainOut : unavailable(journalMissing),
      usd: haveJournal ? round(brainUsd, 6) : unavailable(journalMissing),
      source: haveJournal ? `journal metered events (n=${meteredCount})` : journalMissing,
    },
    brainTruncations:
      src.brainLog === null
        ? gap(
            'brain.brainTruncations',
            src.supRunDir === null
              ? 'no supervisor run dir under <ws>/.loops/supervisor'
              : 'brain.jsonl absent — loops predates the brain-call tap, so truncation cannot be ruled out',
          )
        : brainCalls.filter((c) => c.finish_reason === 'length').length,
    workers: {
      tokensIn: workerIn,
      tokensOut: workerOut,
      usd: haveJournal ? round(journalWorkerUsd, 6) : unavailable(journalMissing),
      source:
        sq !== null
          ? `journal settled spend + opencode sessions (n=${sq.sessions})`
          : `journal settled spend only — ${src.opencodeMissingReason ?? 'opencode store unavailable'}`,
    },
    totalUsd,
    totalUsdSource:
      stateUsd !== null
        ? `state.json result.spentUsd${journalWorkerUsd === 0 ? ' — brain-priced only; worker CLI inference is unpriced (see worker token counts)' : ''}`
        : haveJournal
          ? 'journal metered + settled usd'
          : journalMissing,
    costPerAcceptedPatchUsd: isUnavailable(totalUsd)
      ? unavailable(totalUsd.unavailable)
      : isUnavailable(decision.accepted)
        ? unavailable(decision.accepted.unavailable)
        : decision.accepted === 0
          ? unavailable('no accepted worker patch (cost has no denominator)')
          : round(totalUsd / decision.accepted, 6),
    workerWallMsDistribution:
      walls.length === 0
        ? unavailable(src.workers === null ? workersGapReason : 'no worker start/finish pairs captured')
        : {
            n: walls.length,
            min: walls[0]!,
            p50: quantile(walls, 0.5),
            p90: quantile(walls, 0.9),
            max: walls[walls.length - 1]!,
            sum: walls.reduce((a, b) => a + b, 0),
          },
    perWorker: src.workers === null ? unavailable(workersGapReason) : perWorker,
  }

  // ── outcome ────────────────────────────────────────────────────────────
  const patchStats: Measured<PatchStats> =
    src.patch === null ? gap('patch', 'delivered patch file absent') : parsePatch(src.patch)

  const outcome: OutcomeMetrics = {
    supStatus: pickString(state, 'status') ?? pickString(result, 'sup_status') ?? gap('supStatus', 'no state.json / result.json status'),
    supVerdict: pickString(state, 'verdict') ?? pickString(result, 'sup_verdict') ?? unavailable('no state.json / result.json verdict'),
    delivered:
      typeof stateResult.delivered === 'boolean'
        ? stateResult.delivered
        : typeof result?.delivered === 'boolean'
          ? result.delivered
          : unavailable('no delivered flag in state.json or result.json'),
    judgeResolved:
      judge === null
        ? gap('judge', 'judge.json absent')
        : typeof judge.resolved === 'boolean'
          ? judge.resolved
          : null,
    judgeScore: judge === null ? unavailable('judge.json absent') : typeof judge.score === 'number' ? judge.score : null,
    judgePassed: judge === null ? unavailable('judge.json absent') : typeof judge.passed === 'number' ? judge.passed : null,
    judgeTotal: judge === null ? unavailable('judge.json absent') : typeof judge.total === 'number' ? judge.total : null,
    verifyPass:
      typeof result?.verify_pass === 'boolean' ? result.verify_pass : gap('verifyPass', 'result.json absent or has no verify_pass'),
    verifyRc: typeof result?.verify_rc === 'number' ? result.verify_rc : unavailable('result.json absent or has no verify_rc'),
    patch: patchStats,
    judgeSource: src.judgeSource,
  }

  return {
    schema: 'swe-arena/run-report@1',
    cellDir: src.cellDir,
    instanceId: src.instanceId,
    arm: src.arm,
    supervisorId: rootId !== null ? rootId : unavailable(journalMissing),
    generatedAt: new Date(now()).toISOString(),
    orchestration,
    decision,
    economics,
    outcome,
    gaps,
    traceCommand:
      'npx --yes @tangle-network/traces@latest analyze --harness opencode --cwd <worker-clone-cwd>',
  }
}

/** `[driver] registered tools: …supervisor_steer…` is a banner, not an invocation. */
function registrationMentions(driverLog: string): number {
  let n = 0
  for (const line of driverLog.split('\n')) {
    if (line.includes('registered tools:') && line.includes('supervisor_steer')) n += 1
  }
  return n
}

function pickString(rec: Record<string, unknown> | null, key: string): string | null {
  const v = rec?.[key]
  return typeof v === 'string' ? v : null
}

function round(v: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[idx]!
}

/** Unified-diff stats. Counts `+++ b/<path>` targets, body +/- lines, and test-file touches. */
export function parsePatch(text: string): PatchStats {
  const files = new Set<string>()
  const testFiles = new Set<string>()
  let added = 0
  let removed = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim().replace(/^b\//, '')
      if (p !== '/dev/null') {
        files.add(p)
        if (isTestPath(p)) testFiles.add(p)
      }
      continue
    }
    if (line.startsWith('--- ') || line.startsWith('diff --git') || line.startsWith('index ')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { files: files.size, linesAdded: added, linesRemoved: removed, testFilesTouched: [...testFiles].sort() }
}

function isTestPath(p: string): boolean {
  const base = basename(p)
  return (
    /(^|\/)(tests?|__tests__|testing|spec)(\/|$)/.test(p) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(base) ||
    /^test_.*\.py$/.test(base) ||
    /_test\.py$/.test(base)
  )
}

// ---------------------------------------------------------------------------
// I/O layer.
// ---------------------------------------------------------------------------

const DEFAULT_OPENCODE_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

async function readMaybe(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

/** Locate the (single) supervisor run dir under `<ws>/.loops/supervisor`. */
export async function findSupervisorRunDirIn(ws: string): Promise<string | null> {
  const root = join(ws, '.loops', 'supervisor')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name))
  return dirs[0] ?? null
}

export interface CollectOptions {
  /** Override the workspace dir (default `<cellDir>/ws`). */
  readonly ws?: string
  /** Delivered patch path (default: `patchPath` from result.json). */
  readonly patchPath?: string
  /** opencode sqlite store; set to `null` to skip the join entirely. */
  readonly opencodeDb?: string | null
  /** Ledger to fall back to when the cell has no `judge.json` (matched on iid + arm + runDir). */
  readonly ledgerPath?: string
}

export async function collectRunReportSources(cellDir: string, opts: CollectOptions = {}): Promise<RunReportSources> {
  const ws = opts.ws ?? join(cellDir, 'ws')
  const supRunDir = await findSupervisorRunDirIn(ws)
  const result = await readMaybe(join(cellDir, 'result.json'))
  const resultObj = parseJson(result)

  let workers: WorkerLogSource[] | null = null
  let workersMissingReason: string | null = null
  const workerCwds: string[] = []
  if (supRunDir === null) {
    workersMissingReason = `no supervisor run dir under ${join(ws, '.loops', 'supervisor')}`
  } else {
    const workersDir = join(supRunDir, 'workers')
    const entries = await readdir(workersDir).catch(() => null)
    if (entries === null) {
      workersMissingReason = `workers/ directory absent under ${supRunDir}`
    } else {
      const labels = [
        ...new Set(
          entries
            .filter((f) => f.endsWith('.ndjson'))
            .map((f) => f.replace(/\.inbox\.ndjson$/, '').replace(/\.ndjson$/, '')),
        ),
      ].sort()
      workers = []
      for (const label of labels) {
        const events = await readMaybe(join(workersDir, `${label}.ndjson`))
        const inbox = await readMaybe(join(workersDir, `${label}.inbox.ndjson`))
        const patch = await readMaybe(join(workersDir, `${label}.patch`))
        workers.push({ label, events, inbox, patchBytes: patch === null ? null : Buffer.byteLength(patch) })
        for (const ev of parseJsonl(events)) {
          if (ev.kind === 'started' && typeof ev.cwd === 'string') workerCwds.push(ev.cwd)
        }
      }
    }
  }

  let opencodeWorkerTokens: RunReportSources['opencodeWorkerTokens'] = null
  let opencodeMissingReason: string | null = null
  if (opts.opencodeDb === null) {
    opencodeMissingReason = 'opencode join disabled'
  } else if (workerCwds.length === 0) {
    opencodeMissingReason = 'no worker clone cwds in workers/*.ndjson (nothing to join)'
  } else {
    try {
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(opts.opencodeDb ?? DEFAULT_OPENCODE_DB, { readOnly: true })
      try {
        const placeholders = workerCwds.map(() => '?').join(',')
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n,
                    COALESCE(SUM(tokens_input), 0) AS tin,
                    COALESCE(SUM(tokens_output + tokens_reasoning), 0) AS tout
             FROM session WHERE directory IN (${placeholders})`,
          )
          .get(...workerCwds) as { n: number | bigint; tin: number | bigint; tout: number | bigint }
        opencodeWorkerTokens = { sessions: Number(row.n), input: Number(row.tin), output: Number(row.tout) }
      } finally {
        db.close()
      }
    } catch (err) {
      opencodeMissingReason = `opencode session store unreadable (${err instanceof Error ? err.message : String(err)})`
    }
  }

  const patchPath =
    opts.patchPath ?? (typeof resultObj?.patchPath === 'string' ? resultObj.patchPath : null)

  let judge = await readMaybe(join(cellDir, 'judge.json'))
  let judgeSource = judge === null ? null : join(cellDir, 'judge.json')
  if (judge === null && opts.ledgerPath !== undefined) {
    const row = await findLedgerRow(opts.ledgerPath, cellDir)
    if (row !== null) {
      judge = JSON.stringify(row)
      judgeSource = `${opts.ledgerPath} (ledger row)`
    }
  }

  return {
    cellDir,
    instanceId: typeof resultObj?.iid === 'string' ? resultObj.iid : instanceIdFromPath(cellDir),
    arm: typeof resultObj?.arm === 'string' ? resultObj.arm : basename(cellDir),
    supRunDir,
    journal: supRunDir === null ? null : await readMaybe(join(supRunDir, 'journal.jsonl')),
    brainLog: supRunDir === null ? null : await readMaybe(join(supRunDir, 'brain.jsonl')),
    state: supRunDir === null ? null : await readMaybe(join(supRunDir, 'state.json')),
    progress: supRunDir === null ? null : await readMaybe(join(supRunDir, 'progress.ndjson')),
    workers,
    workersMissingReason,
    result,
    judge,
    judgeSource,
    patch: patchPath === null ? null : await readMaybe(patchPath),
    driverLog: await readMaybe(join(cellDir, 'driver.log')),
    opencodeWorkerTokens,
    opencodeMissingReason,
  }
}

/** The ledger row whose `runDir` is this cell (falling back to iid + arm match). */
async function findLedgerRow(ledgerPath: string, cellDir: string): Promise<Record<string, unknown> | null> {
  const rows = parseJsonl(await readMaybe(ledgerPath))
  const exact = rows.find((r) => r.runDir === cellDir)
  if (exact !== undefined) return exact
  const iid = instanceIdFromPath(cellDir)
  const arm = basename(cellDir)
  return rows.find((r) => r.iid === iid && r.arm === arm) ?? null
}

/** `<outDir>/runs/<iid>/<arm>` → `<iid>`. */
function instanceIdFromPath(cellDir: string): string | null {
  const parts = cellDir.split('/').filter(Boolean)
  const armIdx = parts.length - 1
  const iid = parts[armIdx - 1]
  return parts[armIdx - 2] === 'runs' && iid !== undefined ? iid : null
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

/**
 * The block appended to the run log after every cell — the answers the operator asks
 * for, in the log tail, with no extra command. Zero and unavailable read differently.
 */
export function renderRunReportHeadline(r: RunReport): string {
  const o = r.orchestration
  const steerNote = isUnavailable(o.steers)
    ? `unavailable — ${o.steers.unavailable}`
    : o.steers === 0
      ? '0 (spawn→wait→respawn only; no mid-task steering)'
      : `${o.steers} queued / ${showMeasured(o.steersDelivered)} delivered`
  return [
    `RUN-REPORT ${r.instanceId ?? '?'} [${r.arm ?? '?'}]`,
    `  steers=${steerNote}`,
    `  waves=${showMeasured(o.waves)} sizes=${isUnavailable(o.waveSizes) ? `unavailable — ${o.waveSizes.unavailable}` : `[${o.waveSizes.join(',')}]`}` +
      ` workers=${showMeasured(o.workersSpawned)} settled=${showMeasured(o.workersSettled)} cancelled=${showMeasured(o.workersCancelled)}`,
    `  concurrency max=${showMeasured(o.maxConcurrency)} utilization=${showMeasured(o.workerUtilization)}` +
      ` idle=${fmtMs(o.idleMs)} (${showMeasured(o.idlePct)}%) wall=${fmtMs(o.supervisorWallMs)}`,
    `  respawns=${showMeasured(o.respawns)} evidence→respawn=${showMeasured(r.decision.observeThenRespawn)}` +
      ` blind-respawn=${showMeasured(r.decision.respawnWithoutEvidence)} depth=${showMeasured(o.delegationDepth)}`,
    `  accepted=${showMeasured(r.decision.accepted)} rejected=${showMeasured(r.decision.rejected)} empty-pass=${showMeasured(r.decision.emptyPass)}`,
    `  brain=$${showMeasured(r.economics.brain.usd)} total=$${showMeasured(r.economics.totalUsd)}` +
      ` judge.resolved=${showMeasured(r.outcome.judgeResolved)} score=${showMeasured(r.outcome.judgeScore)}` +
      ` verify=${showMeasured(r.outcome.verifyPass)}`,
    r.gaps.length > 0 ? `  gaps(${r.gaps.length}): ${r.gaps.join('; ')}` : '  gaps: none',
  ].join('\n')
}

function fmtMs(v: Measured<number>): string {
  if (isUnavailable(v)) return `unavailable — ${v.unavailable}`
  if (v < 1000) return `${v}ms`
  const s = v / 1000
  if (s < 120) return `${round(s, 1)}s`
  return `${round(s / 60, 1)}min`
}

export function renderRunReportMarkdown(r: RunReport): string {
  const o = r.orchestration
  const d = r.decision
  const e = r.economics
  const out: string[] = []
  out.push(`# Run report — ${r.instanceId ?? 'unknown instance'} [${r.arm ?? 'unknown arm'}]`)
  out.push('')
  out.push('```')
  out.push(renderRunReportHeadline(r))
  out.push('```')
  out.push('')
  out.push(`- Cell dir: \`${r.cellDir}\``)
  out.push(`- Supervisor: \`${showMeasured(r.supervisorId)}\``)
  out.push(`- Generated: ${r.generatedAt}`)
  out.push('')

  out.push('## Orchestration')
  out.push('')
  out.push('| Metric | Value |')
  out.push('|---|---|')
  out.push(`| Workers spawned | ${showMeasured(o.workersSpawned)} |`)
  out.push(`| Workers settled | ${showMeasured(o.workersSettled)} |`)
  out.push(`| Workers cancelled | ${showMeasured(o.workersCancelled)} |`)
  out.push(`| **Steers (mid-task messages to live workers)** | **${showMeasured(o.steers)}** |`)
  out.push(`| Steers delivered | ${showMeasured(o.steersDelivered)} |`)
  out.push(`| Outer-driver \`supervisor_steer\` calls | ${showMeasured(o.driverSteerCalls)} |`)
  out.push(`| Spawn waves | ${showMeasured(o.waves)} |`)
  out.push(`| Wave sizes | ${isUnavailable(o.waveSizes) ? showMeasured(o.waveSizes) : `[${o.waveSizes.join(', ')}]`} |`)
  out.push(`| Max concurrency | ${showMeasured(o.maxConcurrency)} |`)
  out.push(`| Respawns (spawns after first settle) | ${showMeasured(o.respawns)} |`)
  out.push(
    `| Repeated labels | ${isUnavailable(o.repeatedLabels) ? showMeasured(o.repeatedLabels) : o.repeatedLabels.length === 0 ? 'none' : o.repeatedLabels.join(', ')} |`,
  )
  out.push(`| Delegation depth | ${showMeasured(o.delegationDepth)} |`)
  out.push(`| Time to first spawn | ${fmtMs(o.timeToFirstSpawnMs)} |`)
  out.push(`| Supervisor wall | ${fmtMs(o.supervisorWallMs)} |`)
  out.push(`| Idle (zero live workers) | ${fmtMs(o.idleMs)} (${showMeasured(o.idlePct)}%) |`)
  out.push(`| Worker utilization (Σ worker wall ÷ supervisor wall) | ${showMeasured(o.workerUtilization)} |`)
  out.push('')

  if (!isUnavailable(o.steersByWorker) && o.steersByWorker.length > 0) {
    out.push('### Steers per worker')
    out.push('')
    out.push('| Worker | Queued | Delivered |')
    out.push('|---|---:|---:|')
    for (const s of o.steersByWorker) out.push(`| \`${s.worker}\` | ${s.queued} | ${s.delivered} |`)
    out.push('')
  } else if (isUnavailable(o.steersByWorker)) {
    out.push(`### Steers per worker\n\nunavailable — ${o.steersByWorker.unavailable}\n`)
  }

  out.push('## Decision quality')
  out.push('')
  out.push('| Metric | Value |')
  out.push('|---|---|')
  out.push(`| Settled by status | ${fmtCounts(d.settledByStatus)} |`)
  out.push(`| Settled verdicts | ${fmtCounts(d.settledVerdicts)} |`)
  out.push(`| Accepted (verify green + patch bytes) | ${showMeasured(d.accepted)} |`)
  out.push(`| Rejected (verify red) | ${showMeasured(d.rejected)} |`)
  out.push(`| Empty pass (green, no patch) | ${showMeasured(d.emptyPass)} |`)
  out.push(`| Evidence → respawn sequences | ${showMeasured(d.observeThenRespawn)} |`)
  out.push(`| Respawn with no settled evidence in front | ${showMeasured(d.respawnWithoutEvidence)} |`)
  out.push(`| Review actions (steers + worker questions) | ${showMeasured(d.reviewActions)} |`)
  out.push(`| Worker evidence returned | ${isUnavailable(d.workerEvidenceBytes) ? showMeasured(d.workerEvidenceBytes) : `${d.workerEvidenceBytes} bytes`} |`)
  out.push('')

  out.push('## Economics')
  out.push('')
  out.push('| Role | Tokens in | Tokens out | USD | Source |')
  out.push('|---|---:|---:|---:|---|')
  out.push(
    `| brain | ${showMeasured(e.brain.tokensIn)} | ${showMeasured(e.brain.tokensOut)} | ${showMeasured(e.brain.usd)} | ${e.brain.source} |`,
  )
  out.push(
    `| workers | ${showMeasured(e.workers.tokensIn)} | ${showMeasured(e.workers.tokensOut)} | ${showMeasured(e.workers.usd)} | ${e.workers.source} |`,
  )
  out.push('')
  if (!isUnavailable(e.brainTruncations) && e.brainTruncations > 0) {
    out.push(
      `- **BRAIN OUTPUT TRUNCATED: ${e.brainTruncations} completion(s) hit \`finish_reason: "length"\`** — the supervisor ` +
        'acted on a half-written plan. Its output ceiling is too low; see `brain.jsonl` for the per-call `req_max_tokens`.',
    )
  } else {
    out.push(`- Brain completions truncated (finish_reason=length): ${showMeasured(e.brainTruncations)}`)
  }
  out.push(`- Total USD: ${showMeasured(e.totalUsd)} (source: ${e.totalUsdSource})`)
  out.push(`- Cost per accepted patch: ${showMeasured(e.costPerAcceptedPatchUsd)}`)
  if (isUnavailable(e.workerWallMsDistribution)) {
    out.push(`- Worker wall distribution: unavailable — ${e.workerWallMsDistribution.unavailable}`)
  } else {
    const w = e.workerWallMsDistribution
    out.push(
      `- Worker wall (n=${w.n}): min ${fmtMs(w.min)} / p50 ${fmtMs(w.p50)} / p90 ${fmtMs(w.p90)} / max ${fmtMs(w.max)} / Σ ${fmtMs(w.sum)}`,
    )
  }
  out.push('')
  if (!isUnavailable(e.perWorker) && e.perWorker.length > 0) {
    out.push('| Worker | Wall | Patch bytes | Verify passed |')
    out.push('|---|---:|---:|---|')
    for (const w of e.perWorker) {
      out.push(
        `| \`${w.worker}\` | ${w.wallMs === null ? 'unavailable — no start/finish pair' : fmtMs(w.wallMs)} | ${w.patchBytes ?? 'unavailable — no worker patch file'} | ${w.passed === null ? 'unavailable — no finished event' : String(w.passed)} |`,
      )
    }
    out.push('')
  }

  out.push('## Outcome')
  out.push('')
  out.push('| Metric | Value |')
  out.push('|---|---|')
  out.push(`| Supervisor status | ${showMeasured(r.outcome.supStatus)} |`)
  out.push(`| Supervisor verdict | ${showMeasured(r.outcome.supVerdict)} |`)
  out.push(`| Delivered | ${showMeasured(r.outcome.delivered)} |`)
  out.push(`| Judge resolved | ${showMeasured(r.outcome.judgeResolved)} |`)
  out.push(`| Judge score | ${showMeasured(r.outcome.judgeScore)} |`)
  out.push(`| Judge passed / total | ${showMeasured(r.outcome.judgePassed)} / ${showMeasured(r.outcome.judgeTotal)} |`)
  out.push(`| Judge source | ${r.outcome.judgeSource ?? 'unavailable — no judge.json and no ledger row'} |`)
  out.push(`| Verify gate | pass=${showMeasured(r.outcome.verifyPass)} rc=${showMeasured(r.outcome.verifyRc)} |`)
  if (isUnavailable(r.outcome.patch)) {
    out.push(`| Patch | unavailable — ${r.outcome.patch.unavailable} |`)
  } else {
    const p = r.outcome.patch
    out.push(
      `| Patch | ${p.files} file(s), +${p.linesAdded}/-${p.linesRemoved}, test files touched: ${p.testFilesTouched.length === 0 ? 'none' : p.testFilesTouched.join(', ')} |`,
    )
  }
  out.push('')
  out.push('## Gaps')
  out.push('')
  if (r.gaps.length === 0) out.push('None — every metric above is backed by a present artifact.')
  else for (const g of r.gaps) out.push(`- ${g}`)
  out.push('')
  out.push(`> Harness-session view of the same cell (model calls, stuck loops, tool errors): \`${r.traceCommand}\``)
  out.push('')
  return out.join('\n')
}

function fmtCounts(v: Measured<Record<string, number>>): string {
  if (isUnavailable(v)) return showMeasured(v as unknown as Measured<string>)
  const entries = Object.entries(v)
  return entries.length === 0 ? 'none' : entries.map(([k, n]) => `${k}=${n}`).join(', ')
}

// ---------------------------------------------------------------------------
// Write + wire.
// ---------------------------------------------------------------------------

export interface WriteRunReportOptions extends CollectOptions {
  /** Append the headline block here (the experiment's run log). */
  readonly appendHeadlineTo?: string
  /** Also console.log the headline (default true). */
  readonly echo?: boolean
  /**
   * Write `run-report.{json,md}` here instead of into the cell dir. Set when reporting
   * over a run directory that must stay READ-ONLY (a live run, an archived generation).
   */
  readonly reportDir?: string
}

/**
 * Read a completed cell, write `run-report.json` + `run-report.md` beside its artifacts,
 * and append the headline block to the run log. Never throws on a missing artifact —
 * a cell that produced nothing still yields a report whose every metric says why.
 */
export async function writeRunReport(cellDir: string, opts: WriteRunReportOptions = {}): Promise<RunReport> {
  const sources = await collectRunReportSources(cellDir, opts)
  const report = computeRunReport(sources)
  const md = renderRunReportMarkdown(report)
  const dest = opts.reportDir ?? cellDir
  const stem = opts.reportDir === undefined ? 'run-report' : reportStem(cellDir)
  if (opts.reportDir !== undefined) await mkdir(opts.reportDir, { recursive: true }).catch(() => {})
  await writeFile(join(dest, `${stem}.json`), JSON.stringify(report, null, 1)).catch(() => {})
  await writeFile(join(dest, `${stem}.md`), md).catch(() => {})
  const headline = renderRunReportHeadline(report)
  if (opts.appendHeadlineTo !== undefined) {
    await appendFile(opts.appendHeadlineTo, `${headline}\n`).catch(() => {})
  }
  if (opts.echo !== false) console.log(headline)
  return report
}

/**
 * File stem for out-of-tree reports. Built from the cell path's identifying segments —
 * candidate tag (the segment under `arm-runs/`), rep, instance, arm — so two cells of the
 * same instance from different candidates/reps never overwrite each other.
 */
export function reportStem(cellDir: string): string {
  const parts = cellDir.split('/').filter(Boolean)
  const arm = parts[parts.length - 1] ?? 'cell'
  const iid = parts[parts.length - 2] ?? 'instance'
  const rep = parts.find((p) => /^rep-\d+$/.test(p))
  const armRunsIdx = parts.indexOf('arm-runs')
  const tag = armRunsIdx >= 0 ? parts[armRunsIdx + 1] : undefined
  return [tag, rep, iid, arm]
    .filter((s): s is string => s !== undefined && s !== 'runs')
    .join('.')
    .replace(/[^A-Za-z0-9._-]/g, '_')
}

/**
 * Best-effort wrapper for the hot path: a reporting failure must never kill a cell that
 * already produced real work. Returns null and logs the reason instead.
 */
export async function writeRunReportSafe(
  cellDir: string,
  opts: WriteRunReportOptions = {},
): Promise<RunReport | null> {
  try {
    return await writeRunReport(cellDir, opts)
  } catch (err) {
    console.log(`RUN-REPORT failed for ${cellDir}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Round rollup.
// ---------------------------------------------------------------------------

export interface RoundRollup {
  readonly schema: 'swe-arena/run-report-rollup@1'
  readonly cells: number
  readonly steersTotal: Measured<number>
  readonly cellsWithSteers: Measured<number>
  readonly cellsWithUnavailableSteers: number
  readonly wavesMean: Measured<number>
  readonly maxConcurrencyMax: Measured<number>
  readonly utilizationMean: Measured<number>
  readonly idlePctMean: Measured<number>
  readonly workersSpawnedTotal: Measured<number>
  readonly acceptedTotal: Measured<number>
  readonly usdTotal: Measured<number>
  readonly resolvedCount: Measured<number>
  readonly perCell: readonly {
    instanceId: string | null
    arm: string | null
    steers: Measured<number>
    waves: Measured<number>
    utilization: Measured<number>
    idlePct: Measured<number>
    resolved: Measured<boolean | null>
    usd: Measured<number>
  }[]
}

export function rollupRunReports(reports: readonly RunReport[]): RoundRollup {
  const known = <T,>(vals: readonly Measured<T>[]): T[] => vals.filter((v): v is T => !isUnavailable(v))
  const steerVals = known(reports.map((r) => r.orchestration.steers))
  const waveVals = known(reports.map((r) => r.orchestration.waves))
  const concVals = known(reports.map((r) => r.orchestration.maxConcurrency))
  const utilVals = known(reports.map((r) => r.orchestration.workerUtilization))
  const idleVals = known(reports.map((r) => r.orchestration.idlePct))
  const spawnVals = known(reports.map((r) => r.orchestration.workersSpawned))
  const acceptVals = known(reports.map((r) => r.decision.accepted))
  const usdVals = known(reports.map((r) => r.economics.totalUsd))
  const resolvedVals = known(reports.map((r) => r.outcome.judgeResolved))
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)
  const mean = (xs: readonly number[]): Measured<number> =>
    xs.length === 0 ? unavailable('no cell reported this metric') : round(sum(xs) / xs.length, 3)

  return {
    schema: 'swe-arena/run-report-rollup@1',
    cells: reports.length,
    steersTotal: steerVals.length === 0 ? unavailable('no cell reported a steer count') : sum(steerVals),
    cellsWithSteers: steerVals.length === 0 ? unavailable('no cell reported a steer count') : steerVals.filter((n) => n > 0).length,
    cellsWithUnavailableSteers: reports.filter((r) => isUnavailable(r.orchestration.steers)).length,
    wavesMean: mean(waveVals),
    maxConcurrencyMax: concVals.length === 0 ? unavailable('no cell reported concurrency') : Math.max(...concVals),
    utilizationMean: mean(utilVals),
    idlePctMean: mean(idleVals),
    workersSpawnedTotal: spawnVals.length === 0 ? unavailable('no cell reported spawns') : sum(spawnVals),
    acceptedTotal: acceptVals.length === 0 ? unavailable('no cell reported acceptance') : sum(acceptVals),
    usdTotal: usdVals.length === 0 ? unavailable('no cell reported spend') : round(sum(usdVals), 6),
    resolvedCount:
      resolvedVals.length === 0
        ? unavailable('no cell reported a judge verdict')
        : resolvedVals.filter((v) => v === true).length,
    perCell: reports.map((r) => ({
      instanceId: r.instanceId,
      arm: r.arm,
      steers: r.orchestration.steers,
      waves: r.orchestration.waves,
      utilization: r.orchestration.workerUtilization,
      idlePct: r.orchestration.idlePct,
      resolved: r.outcome.judgeResolved,
      usd: r.economics.totalUsd,
    })),
  }
}

export function renderRollupMarkdown(rollup: RoundRollup, title = 'Round rollup'): string {
  const out: string[] = []
  out.push(`# ${title}`)
  out.push('')
  out.push(`- Cells: ${rollup.cells}`)
  out.push(`- **Steers across all cells: ${showMeasured(rollup.steersTotal)}** (cells with ≥1 steer: ${showMeasured(rollup.cellsWithSteers)}; cells where the steer count is unavailable: ${rollup.cellsWithUnavailableSteers})`)
  out.push(`- Waves per cell (mean): ${showMeasured(rollup.wavesMean)}`)
  out.push(`- Max concurrency observed: ${showMeasured(rollup.maxConcurrencyMax)}`)
  out.push(`- Worker utilization (mean): ${showMeasured(rollup.utilizationMean)}`)
  out.push(`- Idle share (mean): ${showMeasured(rollup.idlePctMean)}%`)
  out.push(`- Workers spawned: ${showMeasured(rollup.workersSpawnedTotal)} · accepted: ${showMeasured(rollup.acceptedTotal)}`)
  out.push(`- Spend: $${showMeasured(rollup.usdTotal)} · judged resolved: ${showMeasured(rollup.resolvedCount)}/${rollup.cells}`)
  out.push('')
  out.push('| Instance | Arm | Steers | Waves | Utilization | Idle % | Resolved | USD |')
  out.push('|---|---|---:|---:|---:|---:|---|---:|')
  for (const c of rollup.perCell) {
    out.push(
      `| ${c.instanceId ?? '?'} | ${c.arm ?? '?'} | ${showMeasured(c.steers)} | ${showMeasured(c.waves)} | ${showMeasured(c.utilization)} | ${showMeasured(c.idlePct)} | ${showMeasured(c.resolved)} | ${showMeasured(c.usd)} |`,
    )
  }
  out.push('')
  return out.join('\n')
}

/**
 * Report every cell under an experiment `outDir` (any depth of `runs/<iid>/<arm>`),
 * write each cell's report, and write the round rollup at `<outDir>/run-report-round.{json,md}`.
 */
export async function reportRound(
  outDir: string,
  opts: WriteRunReportOptions & { title?: string } = {},
): Promise<RoundRollup> {
  const cells = await findCellDirs(outDir)
  const reports: RunReport[] = []
  for (const cell of cells) {
    const r = await writeRunReportSafe(cell, { ...opts, echo: opts.echo ?? false })
    if (r !== null) reports.push(r)
  }
  const rollup = rollupRunReports(reports)
  const md = renderRollupMarkdown(rollup, opts.title ?? `Round rollup — ${basename(outDir)}`)
  const dest = opts.reportDir ?? outDir
  if (opts.reportDir !== undefined) await mkdir(opts.reportDir, { recursive: true }).catch(() => {})
  await writeFile(join(dest, 'run-report-round.json'), JSON.stringify(rollup, null, 1)).catch(() => {})
  await writeFile(join(dest, 'run-report-round.md'), md).catch(() => {})
  if (opts.appendHeadlineTo !== undefined) {
    await appendFile(opts.appendHeadlineTo, `${md}\n`).catch(() => {})
  }
  if (opts.echo !== false) console.log(md)
  return rollup
}

/** Every `<...>/runs/<iid>/<arm>` directory under `root`. */
export async function findCellDirs(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name === 'node_modules' || e.name === '.git') continue
      const full = join(dir, e.name)
      if (e.name === 'runs') {
        const iids = await readdir(full, { withFileTypes: true }).catch(() => [])
        for (const iid of iids) {
          if (!iid.isDirectory()) continue
          const arms = await readdir(join(full, iid.name), { withFileTypes: true }).catch(() => [])
          for (const arm of arms) if (arm.isDirectory()) found.push(join(full, iid.name, arm.name))
        }
        continue
      }
      await walk(full, depth + 1)
    }
  }
  await walk(root, 0)
  return found.sort()
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const args = process.argv.slice(2)
  const usage =
    'usage:\n' +
    '  tsx run-report.mts <cellDir> [--log <run.log>] [--patch <file>] [--ledger <ledger.jsonl>] [--report-dir <dir>] [--no-opencode]\n' +
    '  tsx run-report.mts --round <outDir> [--log <run.log>] [--ledger <ledger.jsonl>] [--report-dir <dir>] [--no-opencode]\n' +
    '\n--report-dir writes the reports outside the run directory (use it when the run dir is READ-ONLY).\n'
  const noOpencode = args.includes('--no-opencode')
  const flagValue = (flag: string): string | undefined => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const appendHeadlineTo = flagValue('--log')
  const patchPath = flagValue('--patch')
  const reportDir = flagValue('--report-dir')
  const ledgerPath = flagValue('--ledger')
  const flagValueIndices = new Set(
    ['--log', '--patch', '--report-dir', '--ledger', '--round']
      .map((f) => args.indexOf(f))
      .filter((i) => i >= 0)
      .map((i) => i + 1),
  )
  const positional = args.filter((a, i) => !a.startsWith('--') && !flagValueIndices.has(i))
  const roundIdx = args.indexOf('--round')
  const opts: WriteRunReportOptions = {
    ...(appendHeadlineTo !== undefined ? { appendHeadlineTo } : {}),
    ...(patchPath !== undefined ? { patchPath } : {}),
    ...(reportDir !== undefined ? { reportDir } : {}),
    ...(ledgerPath !== undefined ? { ledgerPath } : {}),
    ...(noOpencode ? { opencodeDb: null } : {}),
    echo: true,
  }
  if (roundIdx >= 0) {
    const outDir = args[roundIdx + 1]
    if (outDir === undefined) {
      console.error(usage)
      process.exit(2)
    }
    await reportRound(outDir, opts)
  } else {
    const cellDir = positional[0]
    if (cellDir === undefined) {
      console.error(usage)
      process.exit(2)
    }
    const report = await writeRunReport(cellDir, opts)
    console.log('')
    console.log(renderRunReportMarkdown(report))
  }
}
