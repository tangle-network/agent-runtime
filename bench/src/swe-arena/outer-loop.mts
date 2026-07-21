/**
 * Round-4 outer loop — agent-runtime's `improve()` in the OPTIMIZER SEAT,
 * proposing code changes to the loops pi supervisor, evaluated by this typed
 * swe-arena harness. Replaces the human/Claude-driven rounds 1-3 recorded in
 * supervisor-lab `.evolve/state.json`.
 *
 *   tsx src/swe-arena/outer-loop.mts <config.json>            # SPENDS: fires arms + judges
 *   tsx src/swe-arena/outer-loop.mts --write-config <path>    # emit the default round-4 config
 *   tsx src/swe-arena/outer-loop.mts --calibration-smoke [supRunDir] [--analysts N] [--model M]
 *
 * One `runRound()` = one `improve()` call with `surface: 'code'`:
 *
 *  (a) DIAGNOSE — the `analyzeGeneration` seam runs the blind diagnosis
 *      ensemble (diagnosis-ensemble.ts) over the PREVIOUS round's failure
 *      artifacts (round-3 SUP4 run dirs seeded via config) plus every fresh
 *      arm run this round produced, and UNIONS the fused findings with
 *      `rawTraceDistiller` path-context so the coding agent also greps the raw
 *      traces itself (`rawTraceContext: true` names the mechanism; an explicit
 *      `analyzeGeneration` wins, so the distiller is composed in directly).
 *  (b) PROPOSE — `improvementDriver` + a change-space-constrained
 *      `agenticGenerator` edit an isolated git worktree of loops. The DECLARED
 *      CHANGE-SPACE is enforced twice: in the generator's verifier (feedback →
 *      next shot) and fail-closed in the dispatch below (an out-of-space
 *      candidate never reaches a model token).
 *  (c) EVALUATE — each candidate surface is a loops commit; the dispatch adds
 *      a detached eval worktree at that commit, points the supervisor arm's
 *      extension path at it (armProvenance records the commit), runs the
 *      3-instance improvement set through arms.ts + the serialized official
 *      judge. Score = resolved count; cost guard = wall ratio vs baseline.
 *  (d) ACCEPT/REJECT — keep-if-better per protocol_v2. The promotion gate
 *      NEVER ships: the pre-registered 6-instance holdout costs real money and
 *      runs only with explicit operator approval, so a would-be KEEP is
 *      reported as `hold` + instructions. Every candidate + verdict persists
 *      as staircase rows in `<roundsDir>/gen-<N>.jsonl`.
 *
 * SCORING SOURCE: gate evidence + staircase rows derive from the LIB's
 * campaign cells (`improve()` result campaigns in memory; the per-cell
 * `cached-result.json` caches on disk for the in-run gate) — see
 * cell-evidence.mts. The in-process RoundRecorder is dispatch-time only:
 * fail-closed change-space enforcement + candidate diff writing. It is NOT a
 * scoring source — that recorder role mislabeled a resumed run's baseline
 * (r4-mroh3rkt) because cached cells replay without dispatching.
 *
 * Immutable per protocol_v2 (enforced, not advisory): judge + verify scripts,
 * task prompts, model ids, budgets. `assertFrozenArm` pins the arm to the
 * round-3 values; the serialized judge enforces its own 1800s floor; the
 * change space keeps candidates inside extensions/pi/** and the three named
 * src files (plus the `.improve/` raw-trace diagnosis artifact the agentic
 * generator's evidence gate requires).
 */

import { appendFile, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  agenticGenerator,
  improve,
  rawTraceDistiller,
  type CandidateGenerator,
  type Verifier,
} from '@tangle-network/agent-runtime'
import { runLocalHarness } from '@tangle-network/agent-runtime/mcp'
import { makeFinding } from '@tangle-network/agent-eval'
import {
  FsLabeledScenarioStore,
  surfaceHash,
  type CampaignResult,
  type CodeSurface,
  type DispatchContext,
  type Gate,
  type GateResult,
  type JudgeConfig,
  type MutableSurface,
  type Scenario,
} from '@tangle-network/agent-eval/campaign'
import type { CostLedgerHandle } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { createSweBenchAdapter } from '../benchmarks/swe-bench.ts'
import {
  cellsFromCampaign,
  gateEvidenceFromCells,
  loadCampaignCells,
  loadCandidateCellGroups,
  perInstanceFromCells,
  pinnedBaselineResolvedCount,
  replicateCoverageComplete,
  replicateRunsFromCells,
  resolvedInstanceCount,
  sumWallSFromCells,
  decideVerdict,
  type EvidenceCell,
  type R4Artifact,
  type StaircasePerInstance,
  type StaircaseVerdict,
} from './cell-evidence.mts'
import { loadSubstrateCaps, type ImproveLoopPassthroughCaps } from './capabilities.mts'
import {
  loadExcludes,
  runSupervisorArm,
  type SecretsEnv,
  type SupervisorArmSpec,
  type SupervisorArmResult,
} from './arms.ts'
import { gatesForArmKind, waitForCapacity, ZAI_CODING_ENDPOINT } from './capacity.ts'
import {
  defaultAnalysts,
  fusedToAnalystFindings,
  runDiagnosisEnsemble,
  surfacesPlacementRegex,
  type AnalystSpec,
  type SupRunArtifacts,
} from './diagnosis-ensemble.ts'
import { run, runOk } from './proc.ts'
import { loadInstanceImages } from './run-experiment.mts'
import { createSerializedJudge, type SerializedJudge } from './serialized-judge.ts'

// ---------------------------------------------------------------------------
// The DECLARED CHANGE-SPACE (protocol_v2). Pure + unit-tested.
// ---------------------------------------------------------------------------

export interface ChangeSpace {
  /** Directory prefixes (repo-relative, trailing '/') where edits are allowed. */
  prefixes: string[]
  /** Exact repo-relative files where edits are allowed. */
  files: string[]
  /** Non-code artifact prefixes allowed to change (the agentic generator's
   *  raw-trace evidence gate REQUIRES `.improve/raw-trace-diagnosis.md`, which
   *  finalize commits — evidence metadata, not supervisor code). */
  metadataPrefixes: string[]
}

export const LOOPS_CHANGE_SPACE: ChangeSpace = {
  prefixes: ['extensions/pi/'],
  files: ['src/worker-evidence.ts', 'src/best-effort.ts', 'src/worker-clone.ts'],
  metadataPrefixes: ['.improve/'],
}

/** Normalize a repo-relative path; `null` = un-normalizable (always a violation). */
export function normalizeRepoPath(p: string): string | null {
  let s = p.trim().replace(/\\/g, '/')
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    // git quotes paths containing spaces/specials; minimal unquote.
    s = s.slice(1, -1).replace(/\\"/g, '"')
  }
  while (s.startsWith('./')) s = s.slice(2)
  if (s.length === 0) return null
  if (s.startsWith('/')) return null // absolute — never a repo-relative candidate path
  const segments = s.split('/')
  if (segments.some((seg) => seg === '..' || seg === '')) return null // traversal / '//' — fail closed
  return s
}

/** Paths that fall OUTSIDE the declared change-space (empty ⇒ compliant). */
export function changeSpaceViolations(paths: string[], space: ChangeSpace = LOOPS_CHANGE_SPACE): string[] {
  const violations: string[] = []
  for (const raw of paths) {
    const p = normalizeRepoPath(raw)
    if (p === null) {
      violations.push(raw)
      continue
    }
    const allowed =
      space.files.includes(p) ||
      space.prefixes.some((pre) => p.startsWith(pre)) ||
      space.metadataPrefixes.some((pre) => p.startsWith(pre))
    if (!allowed) violations.push(p)
  }
  return violations
}

/** Changed paths from `git status --porcelain=v1 --untracked-files=all`.
 *  Renames contribute BOTH sides (removing an out-of-space file is a change). */
export function porcelainChangedPaths(stdout: string): string[] {
  const paths: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim().length === 0) continue
    const entry = line.slice(3)
    const arrow = entry.indexOf(' -> ')
    if (arrow !== -1) {
      paths.push(entry.slice(0, arrow).trim(), entry.slice(arrow + 4).trim())
    } else {
      paths.push(entry.trim())
    }
  }
  return paths.filter((p) => p.length > 0)
}

// ---------------------------------------------------------------------------
// Dispatch clocks. The campaign's dispatchTimeoutMs races the ENTIRE dispatch
// — including the endpoint capacity-gate wait — so a legitimate multi-hour
// capacity hold was billed to the cell's work budget (measured: a 58-min gate
// hold pushed the astropy baseline cell over the 7200s clock and the whole
// candidate became 'rejected-incomplete'). Fix: the cell's REAL work clock
// (`runWithPostGateClock`) starts only after the gates clear, and the campaign
// clock is widened to cover worst-case gate holds so it can never fire during
// a legitimate wait. Both clocks still fail loud — a hung arm is bounded by
// dispatchTimeoutMs post-gate, and the widened campaign clock is the backstop.
// ---------------------------------------------------------------------------

/** Supervisor arms gate on BOTH endpoints (worker z.ai path + brain router path). */
export const SUPERVISOR_GATE_COUNT = 2

/** capacity.ts's default waitCeilingMs (orchestrate.sh: 300 min/gate). */
export const DEFAULT_GATE_WAIT_CEILING_MS = 300 * 60_000

/** The widened ceiling handed to the campaign: per-cell work budget PLUS the
 *  worst-case capacity-gate holds (gates run sequentially, each with its own
 *  ceiling). The campaign clock starts at dispatch entry — before the gates —
 *  so it must cover them; `waitForCapacity` itself fails the cell at each
 *  gate's own ceiling, so total cell time stays bounded. */
export function campaignDispatchCeilingMs(
  config: Pick<OuterLoopConfig, 'dispatchTimeoutMs' | 'gateWaitCeilingMs'>,
  gateCount = SUPERVISOR_GATE_COUNT,
): number {
  return config.dispatchTimeoutMs + gateCount * (config.gateWaitCeilingMs ?? DEFAULT_GATE_WAIT_CEILING_MS)
}

/** Run `work` under `timeoutMs`, with the clock started AFTER `awaitGates`
 *  resolves — a capacity hold is never billed to the cell's work budget.
 *  Gate failures (no capacity within a gate's own ceiling) still reject. */
export async function runWithPostGateClock<T>(opts: {
  awaitGates: () => Promise<void>
  work: () => Promise<T>
  timeoutMs: number
  label?: string
}): Promise<T> {
  await opts.awaitGates()
  if (!(opts.timeoutMs > 0)) return opts.work()
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      opts.work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `post-gate dispatch exceeded ${opts.timeoutMs}ms${opts.label ? ` (${opts.label})` : ''} — failed loud, gate wait unbilled`,
              ),
            ),
          opts.timeoutMs,
        )
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Scoring primitives — replicate semantics, the pinned baseline, and the
// protocol_v2 verdict — live in cell-evidence.mts (pure over lib campaign
// cells). Re-exported here so existing consumers/tests keep one import home.
// ---------------------------------------------------------------------------

export {
  baselineDriftWarnings,
  cellsFromCampaign,
  decideVerdict,
  gateEvidenceFromCells,
  loadCampaignCells,
  loadCandidateCellGroups,
  perInstanceFromCells,
  pinnedBaselineResolvedCount,
  replicateCoverageComplete,
  replicateRunsFromCells,
  resolvedInstanceCount,
  sumWallSFromCells,
  type EvidenceCell,
  type R4Artifact,
  type ReplicateRun,
  type StaircasePerInstance,
  type StaircaseVerdict,
} from './cell-evidence.mts'

// ---------------------------------------------------------------------------
// Launch guards. (a) The arms + judge + proposer all die confusingly hours in
// when the two API keys are absent (the launcher forgot dotenvx) — refuse at
// t=0 instead. (b) Two outer-loops sharing an outDir corrupt the campaign
// runDir and the arm-run caches — a pid-file lock with a staleness check makes
// the race impossible.
// ---------------------------------------------------------------------------

export const REQUIRED_LAUNCH_ENV = ['TANGLE_API_KEY', 'ZAI_API_KEY'] as const

export function assertLaunchEnv(env: Record<string, string | undefined> = process.env): void {
  const missing = REQUIRED_LAUNCH_ENV.filter((k) => !env[k] || env[k]!.trim().length === 0)
  if (missing.length > 0) {
    throw new Error(
      `outer-loop: ${missing.join(' + ')} absent from env — launch through dotenvx (dotenvx run -f agent-state.env -f tangle-router.env -- ...)`,
    )
  }
}

/** True when `pid` is a live process (EPERM = alive but not ours — still live). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export const INSTANCE_LOCK_FILENAME = 'outer-loop.pid'

export interface InstanceLock {
  path: string
  release: () => Promise<void>
}

/** Single-instance pid-file lock in `outDir`. `wx` creation is the atomic
 *  claim; an existing file is honored only while its pid is alive (a crashed
 *  loop's stale lock — dead pid or garbage — is reclaimed). Pid reuse can in
 *  principle false-positive a stale lock as live; that fails SAFE (refuses to
 *  start) and clears on the next reboot cycle. */
export async function acquireInstanceLock(outDir: string, pid: number = process.pid): Promise<InstanceLock> {
  await mkdir(outDir, { recursive: true })
  const lockPath = join(outDir, INSTANCE_LOCK_FILENAME)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(lockPath, `${pid}\n`, { flag: 'wx' })
      return {
        path: lockPath,
        release: async () => {
          const raw = (await readFile(lockPath, 'utf8').catch(() => '')).trim()
          if (raw === String(pid)) await unlink(lockPath).catch(() => {})
        },
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const raw = (await readFile(lockPath, 'utf8').catch(() => '')).trim()
      const holder = Number.parseInt(raw, 10)
      if (Number.isInteger(holder) && holder > 0 && holder !== pid && isPidAlive(holder)) {
        throw new Error(
          `outer-loop: another outer-loop (pid ${holder}) holds ${lockPath} — single-instance lock, refusing to race`,
        )
      }
      await unlink(lockPath).catch(() => {}) // stale: dead pid or garbage content
    }
  }
  throw new Error(`outer-loop: could not acquire ${lockPath} after clearing a stale lock`)
}

// ---------------------------------------------------------------------------
// Staircase rows — accepted successors + rejected dots, one JSONL row each.
// ---------------------------------------------------------------------------

export const STAIRCASE_SCHEMA = 'swe-arena.staircase.v1'

export interface StaircaseRow {
  schema: typeof STAIRCASE_SCHEMA
  round: number
  generation: number
  runId: string
  at: string
  /** Candidate surface hash (agent-eval surface identity). */
  candidate: string
  candidateCommit: string | null
  /** Incumbent surface hash the candidate mutated. */
  parent: string
  parentResolvedCount: number
  label?: string
  rationale?: string
  changedFiles: string[]
  changeSpaceViolations: string[]
  perInstance: StaircasePerInstance[]
  resolvedCount: number
  coverageComplete: boolean
  wallS: number
  baselineWallS: number
  costRatio: number | null
  costGuardRatio: number
  /** Whether runOptimization's internal keep-if-better advanced the incumbent
   *  to this candidate (composite-only rule; may diverge from `verdict` when
   *  the protocol cost guard rejects a gaining candidate — divergence is the
   *  signal, so both are recorded). */
  internallyPromoted: boolean
  verdict: StaircaseVerdict
  holdout: 'operator-approval-required' | 'not-run'
  armProvenance: { repo: string; commit: string } | null
  diffPath: string | null
  diffSha256: string | null
}

const STAIRCASE_VERDICTS: ReadonlySet<string> = new Set([
  'accepted',
  'rejected-no-gain',
  'rejected-cost',
  'rejected-out-of-space',
  'rejected-incomplete',
])

/** Parse + validate one staircase JSONL row. Throws on schema drift. */
export function parseStaircaseRow(line: string): StaircaseRow {
  const row = JSON.parse(line) as StaircaseRow
  if (row.schema !== STAIRCASE_SCHEMA) throw new Error(`staircase row: unknown schema ${JSON.stringify(row.schema)}`)
  for (const field of ['round', 'generation', 'resolvedCount', 'parentResolvedCount', 'wallS', 'baselineWallS', 'costGuardRatio'] as const) {
    if (typeof row[field] !== 'number') throw new Error(`staircase row: ${field} must be a number`)
  }
  for (const field of ['runId', 'at', 'candidate', 'parent'] as const) {
    if (typeof row[field] !== 'string' || row[field].length === 0) throw new Error(`staircase row: ${field} must be a non-empty string`)
  }
  if (!Array.isArray(row.perInstance)) throw new Error('staircase row: perInstance must be an array')
  if (!Array.isArray(row.changedFiles) || !Array.isArray(row.changeSpaceViolations)) {
    throw new Error('staircase row: changedFiles/changeSpaceViolations must be arrays')
  }
  if (!STAIRCASE_VERDICTS.has(row.verdict)) throw new Error(`staircase row: unknown verdict ${JSON.stringify(row.verdict)}`)
  if (typeof row.coverageComplete !== 'boolean' || typeof row.internallyPromoted !== 'boolean') {
    throw new Error('staircase row: coverageComplete/internallyPromoted must be booleans')
  }
  if (row.costRatio !== null && typeof row.costRatio !== 'number') throw new Error('staircase row: costRatio must be number|null')
  return row
}

// ---------------------------------------------------------------------------
// Config.
// ---------------------------------------------------------------------------

/** Round 1-3 artifact home (this session's scratchpad). Config-overridable —
 *  a future round supplies its own artifact roots. */
export const DEFAULT_HH_SCRATCHPAD =
  '/tmp/claude-1000/-home-drew-code-supervisor-lab/f06fd156-042a-4ef9-bd88-f2ec7f52b90c/scratchpad/hh'

export interface SeedArtifactRun {
  iid: string
  arm: string
  dir: string
  patchPath?: string
  /** Official-judge outcome for the seed run (round-3 values pinned in config). */
  resolved: boolean | null
}

export interface FrozenArmParams {
  workerModel: string
  driverModel: string
  budget: number
  maxSandboxes: number
  maxUsd: number
  maxDepth: number
  timeoutMs: number
  envKnobs?: Record<string, string>
}

/** The round-3 (SUP4) arm — protocol_v2 immutables. */
export const FROZEN_ARM: FrozenArmParams = {
  workerModel: 'zai-coding-plan/glm-5.2',
  driverModel: 'glm-5.2',
  budget: 40,
  maxSandboxes: 4,
  maxUsd: 8,
  maxDepth: 3,
  timeoutMs: 2_800_000,
}

export interface OuterLoopConfig {
  round: number
  /** Improvement set — the arena `improve()` trains on. */
  instances: string[]
  /** Pre-registered holdout. RECORDED here so the flag + operator instruction
   *  are self-contained; this driver NEVER runs them. */
  holdoutInstances: string[]
  loopsRepo: string
  loopsBaseRef: string
  armName: string
  arm: FrozenArmParams
  verifyDir: string
  outDir: string
  /** Staircase home, e.g. /home/drew/code/supervisor-lab/.evolve/rounds. */
  roundsDir: string
  secretsDir: string
  envFiles: string[]
  instanceImagesPath?: string
  judgeTimeoutMs?: number
  gateWaitCeilingMs?: number
  capacityModel?: string
  generations: number
  populationSize: number
  /** Replicate cells per (candidate × instance). Default 1. Instances count as
   *  resolved only when ALL replicates resolve (see resolvedInstanceCount) —
   *  single-rep scoring flips instance outcomes run-to-run. */
  repsPerInstance?: number
  /** MEASURED baseline verdicts (iid → reps-confirmed resolved bool) the
   *  accept/reject gate compares candidates against — never a per-run
   *  recomputation (see pinnedBaselineResolvedCount). When a run's own
   *  baseline cells contradict the pin, a loud BASELINE-DRIFT warning is
   *  logged with both values and the pin still wins. */
  pinnedBaseline?: Record<string, boolean>
  /** Stored `PremeasuredOptimizationBaseline` JSON ({surfaceHash, campaign})
   *  from a prior run's baseline campaign. Consumed ONLY when the substrate's
   *  premeasuredBaseline passthrough is present (capabilities.mts); otherwise
   *  ignored loudly and the pin fallback carries the gate. */
  premeasuredBaselinePath?: string
  /** DEPTH for the agentic generator. Passed as budget.maxImprovementShots
   *  when the substrate passthrough is present (capabilities.mts); until then
   *  the constrained generator applies it itself. */
  maxShots: number
  proposerHarness: 'claude' | 'codex' | 'opencode'
  proposerTimeoutMs: number
  /** Router model ids for the blind diagnosis ensemble (config, never a
   *  hardcoded unrouted model). */
  analystModels: string[]
  /** Previous round's failure artifacts, diagnosed before generation 0. */
  seedArtifactRuns: SeedArtifactRun[]
  costGuardRatio: number
  dispatchTimeoutMs: number
}

export function assertFrozenArm(arm: FrozenArmParams): void {
  const drift: string[] = []
  for (const key of ['workerModel', 'driverModel', 'budget', 'maxSandboxes', 'maxUsd', 'maxDepth'] as const) {
    if (arm[key] !== FROZEN_ARM[key]) drift.push(`${key}: ${JSON.stringify(arm[key])} != ${JSON.stringify(FROZEN_ARM[key])}`)
  }
  if (drift.length > 0) {
    throw new Error(
      `protocol_v2 violation: arm params are immutable (round-3 frozen values) — ${drift.join('; ')}`,
    )
  }
}

/** Committed per-instance verify scripts (fixtures/verify/<iid>.sh) — the
 *  durable home; the experiment's scratchpad copy did not survive a reboot. */
export const FIXTURES_VERIFY_DIR = fileURLToPath(new URL('./fixtures/verify', import.meta.url))

export function defaultRound4Config(
  hh = DEFAULT_HH_SCRATCHPAD,
  opts: { outDirName?: string } = {},
): OuterLoopConfig {
  const round3 = [
    { iid: 'astropy__astropy-13033', resolved: false },
    { iid: 'django__django-11532', resolved: false },
    { iid: 'matplotlib__matplotlib-20826', resolved: true },
  ]
  return {
    round: 4,
    instances: round3.map((r) => r.iid),
    holdoutInstances: [
      'astropy__astropy-14182',
      'django__django-12774',
      'django__django-14140',
      'scikit-learn__scikit-learn-14894',
      'sympy__sympy-20438',
      'pytest-dev__pytest-7236',
    ],
    loopsRepo: '/home/drew/code/loops',
    loopsBaseRef: 'feat/supervisor-evidence-flow',
    armName: 'R4',
    arm: { ...FROZEN_ARM },
    verifyDir: FIXTURES_VERIFY_DIR,
    outDir: join(hh, opts.outDirName ?? 'r4'),
    roundsDir: '/home/drew/code/supervisor-lab/.evolve/rounds',
    secretsDir: '/home/drew/company/devops/secrets',
    envFiles: ['agent-state.env', 'tangle-router.env'],
    generations: 1,
    populationSize: 2,
    repsPerInstance: 2,
    // Reps-confirmed gen-1 baseline (arm 1deb554c45, run r4-mrnts1n4):
    // astropy F/F, django T/F → F fail-closed, matplotlib T/T. 1/3.
    pinnedBaseline: {
      'astropy__astropy-13033': false,
      'django__django-11532': false,
      'matplotlib__matplotlib-20826': true,
    },
    maxShots: 3,
    proposerHarness: 'claude',
    // Per author SHOT (agenticGenerator timeoutMs). 20 min timed out 3× under
    // degraded capacity in gen-1 ("author shot timed out") — doubled to 40 min.
    proposerTimeoutMs: 2_400_000,
    analystModels: ['glm-5.2', 'glm-5.2', 'glm-5.2'],
    seedArtifactRuns: round3.map((r) => ({
      iid: r.iid,
      arm: 'SUP4',
      dir: join(hh, 'runs', r.iid, 'SUP4'),
      patchPath: join(hh, 'patches', `${r.iid}.sup4.patch`),
      resolved: r.resolved,
    })),
    costGuardRatio: 1.2,
    dispatchTimeoutMs: 7_200_000,
  }
}

// ---------------------------------------------------------------------------
// Round recorder — dispatch-time change-space fail-closed + diff writing ONLY.
// NOT a scoring source: scoring reads the lib's campaign cells
// (cell-evidence.mts). The prior recorder role — accumulating per-instance
// results keyed by dispatch order — mislabeled a resumed run's baseline
// (r4-mroh3rkt: cached cells replay without dispatching, so "first dispatched
// surface" was a CANDIDATE and the summary published its cells as
// "baseline 0/3" while the measured baseline was 1/3).
// ---------------------------------------------------------------------------

interface CandidateRecord {
  surfaceKey: string
  commit: string
  baseCommit: string
  tag: string
  changedFiles: string[]
  violations: string[]
  diffPath: string | null
  diffSha256: string | null
  /** Dispatch-time forensics: which loops checkout ran the arm. Null for a
   *  candidate whose cells were all replayed from cache (never dispatched
   *  in this process). */
  armProvenance: { repo: string; commit: string } | null
}

class RoundRecorder {
  readonly byKey = new Map<string, CandidateRecord>()
  constructor(
    private readonly loopsRepo: string,
    private readonly candidatesDir: string,
  ) {}

  byCommit(commit: string): CandidateRecord | undefined {
    for (const rec of this.byKey.values()) if (rec.commit === commit) return rec
    return undefined
  }

  /** Describe a candidate surface: changed files, change-space violations, and
   *  the written diff. Idempotent and callable POST-RUN too (candidate commits
   *  survive in the loops object store after worktree cleanup), so resumed
   *  candidates that never dispatched here still get full staircase rows. */
  async ensure(surface: CodeSurface): Promise<CandidateRecord> {
    const key = surfaceHash(surface)
    const existing = this.byKey.get(key)
    if (existing) return existing
    const names = await runOk('git', [
      '-C', this.loopsRepo,
      'diff', '--name-only', surface.baseCommit, surface.candidateCommit,
    ])
    const changedFiles = names.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    const violations = changeSpaceViolations(changedFiles)
    const tag = surface.candidateCommit.slice(0, 10)
    let diffPath: string | null = null
    if (surface.candidateCommit !== surface.baseCommit) {
      const diff = await runOk('git', ['-C', this.loopsRepo, 'diff', surface.baseCommit, surface.candidateCommit])
      await mkdir(this.candidatesDir, { recursive: true })
      diffPath = join(this.candidatesDir, `${tag}.patch`)
      await writeFile(diffPath, diff.stdout)
    }
    const rec: CandidateRecord = {
      surfaceKey: key,
      commit: surface.candidateCommit,
      baseCommit: surface.baseCommit,
      tag,
      changedFiles,
      violations,
      diffPath,
      diffSha256: surface.patch.sha256,
      armProvenance: null,
    }
    this.byKey.set(key, rec)
    return rec
  }
}

// ---------------------------------------------------------------------------
// Eval worktrees — a candidate commit gets its own loops checkout so the
// candidate worktree managed by the improvement driver stays PRISTINE (its
// finalize-time verification rejects any extra file, node_modules included).
// ---------------------------------------------------------------------------

export async function addEvalWorktree(loopsRepo: string, commit: string, dest: string): Promise<void> {
  await run('git', ['-C', loopsRepo, 'worktree', 'remove', '--force', '--', dest])
  await rm(dest, { recursive: true, force: true })
  await run('git', ['-C', loopsRepo, 'worktree', 'prune'])
  await runOk('git', ['-C', loopsRepo, 'worktree', 'add', '--detach', dest, commit])
  // The loops driver needs deps; a worktree has none. Shared install is safe:
  // arms never write into the loops checkout (state goes to ws/.loops + runDir).
  await symlink(join(loopsRepo, 'node_modules'), join(dest, 'node_modules'), 'dir')
}

export async function removeEvalWorktree(loopsRepo: string, dest: string): Promise<void> {
  await unlink(join(dest, 'node_modules')).catch(() => {})
  const res = await run('git', ['-C', loopsRepo, 'worktree', 'remove', '--force', '--', dest])
  if (res.code !== 0) {
    await rm(dest, { recursive: true, force: true })
    await run('git', ['-C', loopsRepo, 'worktree', 'prune'])
  }
}

// ---------------------------------------------------------------------------
// The constrained proposer: agenticGenerator + change-space verifier + the
// round-4 task prompt. `improve(surface:'code')` requires the generator via
// `code.generator` so the runtime owns candidate-worktree cleanup.
// ---------------------------------------------------------------------------

/** Mirrors the agentic generator's raw-trace evidence contract — the exact
 *  artifact path its gate checks for. */
export const RAW_TRACE_DIAGNOSIS_PATH = '.improve/raw-trace-diagnosis.md'

export function changeSpaceInstruction(space: ChangeSpace = LOOPS_CHANGE_SPACE): string {
  return [
    'DECLARED CHANGE-SPACE (hard constraint, enforced by an automated gate):',
    `- You may ONLY edit files under: ${space.prefixes.map((p) => `${p}**`).join(', ')}`,
    `- and these exact files: ${space.files.join(', ')}`,
    `- plus the diagnosis artifact ${RAW_TRACE_DIAGNOSIS_PATH}.`,
    '- Everything else is IMMUTABLE for this experiment: the official judge, the per-instance verify scripts,',
    '  task prompts, model ids, and budgets live outside your reach and candidates whose diff touches any',
    '  other path are REJECTED before they are ever evaluated.',
  ].join('\n')
}

export function round4BuildPrompt(args: { report: unknown; findings: Array<Record<string, unknown>> }): string {
  const lines: string[] = [
    'You are the optimizer of the "loops" pi SUPERVISOR — an agent that plans, spawns sandboxed coding',
    'workers, and settles a delivered patch for SWE-bench Verified instances (glm-5.2 in both seats, frozen).',
    'Round-3 state: the supervisor resolves 1/3 of its improvement set (matplotlib resolved; astropy + django',
    'deliver self-verify-passing patches the OFFICIAL maintainer test suite still rejects).',
    '',
    'GOAL: raise the official resolved count on the improvement set WITHOUT raising cost/arm by more than 20%.',
    'Make the smallest coherent change to the supervisor implementation that addresses the diagnosis below,',
    'then stop. Do not commit — leave changes in the working tree.',
    '',
    changeSpaceInstruction(),
    '',
    'Diagnosis findings (blind multi-analyst ensemble + raw-trace context):',
  ]
  for (const f of args.findings) {
    const severity = typeof f.severity === 'string' ? f.severity : 'info'
    const subject = typeof f.subject === 'string' ? ` [${f.subject}]` : ''
    const claim = typeof f.claim === 'string' ? f.claim : JSON.stringify(f)
    lines.push(`- (${severity})${subject} ${claim}`)
    if (typeof f.recommended_action === 'string') lines.push(`    → ${f.recommended_action}`)
  }
  const hasRawTrace = args.findings.some(
    (f) => f.analyst_id === 'raw-trace-distiller' || f.area === 'raw-trace-context',
  )
  if (hasRawTrace) {
    lines.push(
      '',
      'Raw trace evidence requirement:',
      '- Inspect at least one raw trace path named above before editing.',
      `- Write ${RAW_TRACE_DIAGNOSIS_PATH} in this worktree.`,
      '- Include the exact trace path(s) inspected, the failure mechanism, and the code change made.',
      '- A candidate without this file, or with only this file changed, is discarded.',
    )
  }
  return lines.join('\n')
}

/** Purge gitignored artifacts from a candidate worktree with `git clean -Xdff`.
 *
 *  The proposer agent may run a dependency install inside its worktree to
 *  verify its own change (measured: round-4 gen-0 cand-1 left a real pnpm
 *  `node_modules/` — 38k paths — after editing loops.ts). Ignored paths are
 *  invisible to the change-space check (`git status` honors .gitignore), but
 *  the improvement driver's finalize-time surface verification rejects ANY
 *  extra path, ignored included (`ls-files --others --ignored`), killing the
 *  whole run. `-X` deletes only ignored paths, so tracked edits and untracked
 *  non-ignored deliverables (e.g. .improve/raw-trace-diagnosis.md) survive;
 *  the doubled `-f` clears nested git dirs some packages ship. */
export async function purgeIgnoredArtifacts(worktreePath: string): Promise<void> {
  await runOk('git', ['-C', worktreePath, 'clean', '-Xdff'])
}

/** Verifier run after each generator shot: ignored-dirt purge first (the
 *  finalize precondition), then change-space compliance (cheap,
 *  feedback-rich), then `tsc --noEmit` with the main repo's
 *  node_modules linked in TEMPORARILY (the link must not survive — the
 *  driver's finalize-time surface verification rejects any extra path). */
export function loopsCandidateVerifier(loopsRepo: string): Verifier {
  return async (worktreePath: string) => {
    await purgeIgnoredArtifacts(worktreePath)
    const status = await runOk('git', ['-C', worktreePath, 'status', '--porcelain=v1', '--untracked-files=all'])
    const violations = changeSpaceViolations(porcelainChangedPaths(status.stdout))
    if (violations.length > 0) {
      return {
        ok: false,
        feedback:
          `CHANGE-SPACE VIOLATION — these paths are outside the declared change-space:\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          `\n${changeSpaceInstruction()}\nRevert or relocate those edits (git checkout -- <path> / rm for untracked).`,
      }
    }
    const nm = join(worktreePath, 'node_modules')
    let linked = false
    if (!existsSync(nm)) {
      await symlink(join(loopsRepo, 'node_modules'), nm, 'dir')
      linked = true
    }
    try {
      const tsc = join(loopsRepo, 'node_modules', '.bin', 'tsc')
      const res = await run(tsc, ['--noEmit'], { cwd: worktreePath, timeoutMs: 300_000 })
      if (res.code !== 0) {
        return {
          ok: false,
          feedback: `tsc --noEmit failed (rc=${res.code}${res.timedOut ? ', timeout' : ''}):\n${(res.stdout + res.stderr).slice(0, 4000)}`,
        }
      }
      return { ok: true }
    } finally {
      if (linked) await unlink(nm).catch(() => {})
    }
  }
}

/** Ambient auth vars that hijack the claude CLI away from its claude.ai login.
 *  The run is launched under dotenvx, and agent-state.env injects an
 *  ANTHROPIC_API_KEY meant for other tooling; the claude CLI prefers env-key
 *  auth over the logged-in account and exits 1 immediately when that key's org
 *  is over its usage cap (reproduced 2026-07-20: `claude -p` under the run env
 *  → rc=1, "API Error: 400 You have reached your specified API usage limits";
 *  same command with these vars unset → rc=0). The author shot must run on the
 *  CLI's own login, so the leaked auth is stripped for the shot subprocess
 *  only — the rest of the run keeps its env untouched. */
const CLAUDE_AMBIENT_AUTH_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'] as const

function proposerShotEnv(harness: OuterLoopConfig['proposerHarness']): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (harness === 'claude') {
    for (const name of CLAUDE_AMBIENT_AUTH_VARS) delete env[name]
  }
  return env
}

export function constrainedLoopsGenerator(
  config: OuterLoopConfig,
  caps: ImproveLoopPassthroughCaps = { premeasuredBaseline: false, maxImprovementShots: false },
): CandidateGenerator {
  const shotDir = join(config.outDir, 'proposer-shots')
  // The run-wide CostLedger the current generate() call rides — captured so
  // onShotCompleted can settle each shot's spend into it. maxConcurrency is 1
  // and shots run inside generate(), so a single slot cannot interleave.
  let activeLedger: CostLedgerHandle | undefined
  let activePhase: string | undefined
  const inner = agenticGenerator({
    harness: config.proposerHarness,
    timeoutMs: config.proposerTimeoutMs,
    buildPrompt: (args) =>
      round4BuildPrompt(args as unknown as { report: unknown; findings: Array<Record<string, unknown>> }),
    verify: loopsCandidateVerifier(config.loopsRepo),
    runHarness: (options) => runLocalHarness({ ...options, env: proposerShotEnv(config.proposerHarness) }),
    // Three runs died as "author shot exited with code 1" with the shot's
    // stderr lost (nothing wires receipt persistence by default). Persist every
    // attempted shot — receipt plus bounded stream tails — so the NEXT failure
    // names its cause from disk.
    onShotCompleted: async (receipt, execution) => {
      const tail = (s: string | undefined): string | null =>
        s === undefined ? null : s.length > 20_000 ? s.slice(-20_000) : s
      await mkdir(shotDir, { recursive: true })
      const name = `gen${receipt.generation ?? 'x'}-cand${receipt.candidateIndex ?? 'x'}-shot${receipt.shot}.json`
      await writeFile(
        join(shotDir, name),
        JSON.stringify({ receipt, stdoutTail: tail(execution?.stdout), stderrTail: tail(execution?.stderr) }, null, 2),
      )
      // Proposer-shot spend → the lib's run ledger. The generator only settles
      // its own receipts on the codexReproducible path (costCallId non-null);
      // the claude/opencode author path otherwise leaves every shot as $0 in
      // the run's spend summary. Import the shot receipt's measured usage.
      if (activeLedger && receipt.costCallId === null && (receipt.usage || receipt.costUsdKnown)) {
        const usage = receipt.usage
        const paid = await activeLedger.runPaidCall({
          channel: 'driver',
          phase: activePhase ?? 'search.proposal',
          actor: `proposer-shot:${config.proposerHarness}`,
          model: receipt.model ?? `${config.proposerHarness}-cli`,
          tags: {
            generation: String(receipt.generation ?? -1),
            candidateIndex: String(receipt.candidateIndex ?? -1),
            shot: String(receipt.shot),
          },
          execute: async () => receipt,
          receipt: () => ({
            model: receipt.model ?? `${config.proposerHarness}-cli`,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage ? usage.outputTokens + usage.reasoningOutputTokens : 0,
            ...(usage ? { cachedTokens: usage.cachedInputTokens } : { usageUnknown: true }),
            ...(receipt.costUsdKnown && receipt.costUsd !== null
              ? { actualCostUsd: receipt.costUsd }
              : {}),
          }),
        })
        if (!paid.succeeded) throw paid.error
      }
    },
  })
  return {
    kind: `round4-constrained:${inner.kind}`,
    proposesWithoutFindings: true,
    generate: (args) => {
      activeLedger = args.costLedger
      activePhase = args.costPhase
      // Until the substrate threads budget.maxImprovementShots (feature-
      // detected in capabilities.mts), selfImprove hands ctx.maxShots = 1 and
      // the DEPTH dial is applied here from config. With the passthrough
      // present, the lib owns the dial and this patch is a no-op guard.
      const maxShots = caps.maxImprovementShots ? args.maxShots : Math.max(args.maxShots, config.maxShots)
      return inner.generate({ ...args, maxShots })
    },
  }
}

// ---------------------------------------------------------------------------
// runRound. (The evaluated R4Artifact type lives in cell-evidence.mts with
// the scoring that consumes it.)
// ---------------------------------------------------------------------------

/** Ledger model id for the dockerized official judge's $0 receipts. */
export const OFFICIAL_JUDGE_MODEL = 'swe-bench-official-judge'

function asCodeSurface(surface: MutableSurface): CodeSurface {
  if (typeof surface !== 'object' || surface === null || surface.kind !== 'code') {
    throw new Error('outer-loop: expected a CodeSurface (improve surface:"code" contract)')
  }
  return surface
}

const log = (msg: string): void => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)

export async function runRound(config: OuterLoopConfig): Promise<void> {
  assertFrozenArm(config.arm)
  if (config.instances.length === 0) throw new Error('outer-loop: empty improvement set')
  const overlap = config.instances.filter((i) => config.holdoutInstances.includes(i))
  if (overlap.length > 0) {
    throw new Error(`outer-loop: improvement set leaks into the pre-registered holdout: ${overlap.join(', ')}`)
  }
  const reps = config.repsPerInstance ?? 1
  if (!Number.isInteger(reps) || reps < 1) {
    throw new Error(`outer-loop: repsPerInstance must be a positive integer, got ${JSON.stringify(config.repsPerInstance)}`)
  }
  // Validated up front so a malformed pin fails at t=0, not at gate time.
  const pinnedCount: number | null = config.pinnedBaseline
    ? pinnedBaselineResolvedCount(config.pinnedBaseline, config.instances)
    : null

  // Substrate passthrough capabilities (feature-detected; see capabilities.mts).
  const caps = loadSubstrateCaps(log)
  // A stored prior baseline campaign is consumable ONLY when selfImprove
  // forwards premeasuredBaseline — passing it to a pre-passthrough substrate
  // would be silently ignored and the baseline would re-run/re-spend. The pin
  // remains the gate's denominator either way.
  let premeasured: { surfaceHash: string; campaign: CampaignResult<R4Artifact, Scenario> } | undefined
  if (config.premeasuredBaselinePath) {
    if (caps.premeasuredBaseline) {
      premeasured = JSON.parse(await readFile(config.premeasuredBaselinePath, 'utf8')) as typeof premeasured
      if (!premeasured || typeof premeasured.surfaceHash !== 'string' || !premeasured.campaign) {
        throw new Error(`premeasuredBaselinePath: ${config.premeasuredBaselinePath} is not a {surfaceHash, campaign} record`)
      }
      log(`premeasured baseline: ${config.premeasuredBaselinePath} (surface ${premeasured.surfaceHash})`)
    } else {
      log(
        `premeasuredBaselinePath set but the installed substrate does not thread premeasuredBaseline — IGNORED, baseline campaign will run (cache-resumable); pin fallback carries the gate`,
      )
    }
  }

  const secrets: SecretsEnv = { secretsDir: config.secretsDir, envFiles: config.envFiles }
  const excludes = await loadExcludes()
  const images = await loadInstanceImages(config.instanceImagesPath)
  const adapter = createSweBenchAdapter()
  const tasks = await adapter.loadTasks({ ids: config.instances, split: 'test' })
  const problemById = new Map<string, string>()
  for (const iid of config.instances) {
    const task = tasks.find((t) => t.id === iid)
    if (!task) throw new Error(`outer-loop: ${iid} not found in SWE-bench_Verified`)
    const problem = String(task.metadata?.problem_statement ?? '')
    if (!problem) throw new Error(`outer-loop: ${iid} has an empty problem_statement`)
    if (!images[iid]) throw new Error(`outer-loop: ${iid} has no image mapping`)
    const verifyScript = join(config.verifyDir, `${iid}.sh`)
    if (!existsSync(verifyScript)) throw new Error(`outer-loop: missing verify script ${verifyScript}`)
    problemById.set(iid, problem)
  }

  const judge: SerializedJudge = createSerializedJudge(
    config.judgeTimeoutMs !== undefined ? { timeoutMs: config.judgeTimeoutMs } : {},
  )
  const runId = `r${config.round}-${Date.now().toString(36)}`
  await mkdir(config.outDir, { recursive: true })
  await mkdir(config.roundsDir, { recursive: true })
  const recorder = new RoundRecorder(config.loopsRepo, join(config.outDir, 'candidates'))
  const analysts: AnalystSpec[] = config.analystModels.map((model, i) => ({ id: `${model}#${i + 1}`, model }))

  const sweScenarios: Scenario[] = config.instances.map((iid) => ({ id: iid, kind: 'swe-instance' }))
  const staticScenario: Scenario = { id: 'static:loops-gates', kind: 'static-gate' }

  // ── dispatch: one (surface × scenario) cell ──────────────────────────
  const agent = async (surface: MutableSurface, scenario: Scenario, ctx: DispatchContext): Promise<R4Artifact> => {
    const cs = asCodeSurface(surface)
    const rec = await recorder.ensure(cs)

    if (scenario.kind === 'static-gate') {
      const dest = join(config.outDir, 'eval-wt', `static-${rec.tag}-r${ctx.rep}`)
      let typecheckOk = false
      let feedback: string | undefined
      await addEvalWorktree(config.loopsRepo, cs.candidateCommit, dest)
      try {
        const tsc = join(config.loopsRepo, 'node_modules', '.bin', 'tsc')
        const res = await run(tsc, ['--noEmit'], { cwd: dest, timeoutMs: 300_000 })
        typecheckOk = res.code === 0
        if (!typecheckOk) feedback = (res.stdout + res.stderr).slice(0, 4000)
      } finally {
        await removeEvalWorktree(config.loopsRepo, dest)
      }
      const artifact: R4Artifact = {
        kind: 'static-gate',
        commit: cs.candidateCommit,
        changedFiles: rec.changedFiles,
        violations: rec.violations,
        typecheckOk,
        ...(feedback ? { feedback } : {}),
      }
      await ctx.artifacts.writeJson('static-gate.json', artifact)
      return artifact
    }

    const iid = scenario.id
    // FAIL-CLOSED change-space enforcement: an out-of-space candidate must
    // never reach a model token or a docker container. The thrown cell is the
    // record (the lib stores it with `error` set — no side bookkeeping).
    if (rec.violations.length > 0) {
      throw new Error(`change-space violation (${rec.violations.length} path(s)): ${rec.violations.join(', ')}`)
    }

    // Capacity gates on BOTH paths the supervisor arm rides (worker + router).
    // The cell's WORK clock (config.dispatchTimeoutMs) starts only after these
    // clear — a capacity hold is never billed to the arm's dispatch budget.
    const awaitGates = async (): Promise<void> => {
      for (const gate of gatesForArmKind('supervisor', secrets, {
        ...(config.gateWaitCeilingMs !== undefined ? { waitCeilingMs: config.gateWaitCeilingMs } : {}),
        ...(config.capacityModel !== undefined ? { model: config.capacityModel } : {}),
        onStatus: log,
      })) {
        if (!(await waitForCapacity(gate))) throw new Error(`no capacity on ${gate.name} within ceiling`)
      }
    }

    const runCell = async (): Promise<R4Artifact> => {
      const entry = images[iid]!
      const evalWt = join(config.outDir, 'eval-wt', `${rec.tag}-${iid}-r${ctx.rep}`)
      const armOutDir = join(config.outDir, 'arm-runs', rec.tag, `rep-${ctx.rep}`)
      await addEvalWorktree(config.loopsRepo, cs.candidateCommit, evalWt)
      try {
        const spec: SupervisorArmSpec = {
          kind: 'supervisor',
          name: config.armName,
          workerModel: config.arm.workerModel,
          driverModel: config.arm.driverModel,
          budget: config.arm.budget,
          maxSandboxes: config.arm.maxSandboxes,
          maxUsd: config.arm.maxUsd,
          maxDepth: config.arm.maxDepth,
          ...(config.arm.envKnobs ? { envKnobs: config.arm.envKnobs } : {}),
          loopsRepo: evalWt,
          extensionPath: join(evalWt, 'extensions', 'pi', 'loops.ts'),
          timeoutMs: config.arm.timeoutMs,
        }
        log(`>>> ${config.armName} ${rec.tag} ${iid} rep=${ctx.rep}`)
        const armRes: SupervisorArmResult = await runSupervisorArm(spec, {
          instanceId: iid,
          image: entry.image,
          baseCommit: entry.base_commit,
          problemStatement: problemById.get(iid)!,
          verifyCmd: `bash ${join(config.verifyDir, `${iid}.sh`)}`,
          outDir: armOutDir,
          secrets,
          excludes,
        })
        const runDir = join(armOutDir, 'runs', iid, config.armName)
        const { ws: _ws, ...armSummary } = armRes
        await writeFile(join(runDir, 'result.json'), JSON.stringify(armSummary, null, 1))

        // The official judge is a docker test-suite run — real wall time, zero
        // LLM spend. Its OWN paid call (channel 'judge', $0 actual) keeps the
        // run's spend tree attributing judge work per cell without inventing a
        // token cost; the wall lands on the artifact + judge.json.
        const judgeT0 = Date.now()
        const judgePaid = await ctx.cost.runPaidCall({
          channel: 'judge',
          actor: `official-judge:${iid}#r${ctx.rep}`,
          model: OFFICIAL_JUDGE_MODEL,
          execute: () => judge.judge(iid, armRes.patchPath, `${config.armName}-${rec.tag}`),
          receipt: () => ({ model: OFFICIAL_JUDGE_MODEL, inputTokens: 0, outputTokens: 0, actualCostUsd: 0 }),
        })
        if (!judgePaid.succeeded) throw judgePaid.error
        const verdict = judgePaid.value
        const judgeWallS = Math.round((Date.now() - judgeT0) / 1000)
        await writeFile(join(runDir, 'judge.json'), JSON.stringify({ ...verdict, wallS: judgeWallS }, null, 1))
        log(`${config.armName} ${rec.tag} ${iid} judged: resolved=${verdict.resolved} (attempts=${verdict.attempts})`)

        const spend = armRes.recoveredSpend
        const recovered =
          armRes.spentTokens === null && (spend?.workerTokSqlite ?? null) === null
            ? null
            : (armRes.spentTokens ?? 0) + (spend?.workerTokSqlite ?? 0)
        rec.armProvenance = { repo: armRes.provenance.repo, commit: armRes.provenance.commit }
        await appendFile(
          join(config.outDir, 'progress.jsonl'),
          JSON.stringify({
            at: new Date().toISOString(),
            runId,
            candidate: rec.tag,
            iid,
            rep: ctx.rep,
            runDir,
            resolved: verdict.resolved,
            verify_pass: armRes.verify_pass,
            wall_s: armRes.wall_s,
            spentTokens: armRes.spentTokens,
            spentUsd: armRes.spentUsd,
            recoveredTokens: recovered,
          }) + '\n',
        )
        await ctx.artifacts.writeJson('arm-summary.json', { runDir, patchPath: armRes.patchPath, verdict })

        if (verdict.resolved === null) {
          // Inconclusive judge (double flake / infra) — the cell must FAIL, not
          // score a fabricated boolean; the candidate becomes coverage-incomplete.
          throw new Error(`inconclusive judge verdict for ${iid} (${verdict.error ?? 'unknown'})`)
        }
        return {
          kind: 'swe-arm',
          iid,
          commit: cs.candidateCommit,
          resolved: verdict.resolved,
          verifyPass: armRes.verify_pass,
          patchLines: armRes.patch_lines,
          wallS: armRes.wall_s,
          spentTokens: armRes.spentTokens,
          spentUsd: armRes.spentUsd,
          recoveredTokens: recovered,
          workerTokIn: spend?.workerTokIn ?? null,
          workerTokOut: spend?.workerTokOut ?? null,
          judgeAttempts: verdict.attempts ?? null,
          judgeWallS,
          runDir,
          patchPath: armRes.patchPath,
        }
      } finally {
        await removeEvalWorktree(config.loopsRepo, evalWt)
      }
    }

    // The arm's real spend reaches the LIB's CostLedger here: one agent-channel
    // paid call per cell whose receipt carries the recovered worker-session
    // token split (opencode sqlite join) and the runtime spend-tree dollars
    // (state.json spentUsd). run-campaign commits it into cell.costUsd /
    // cell.tokenUsage + durable cost-ledger.jsonl receipts — the stub/$0
    // rounds this replaces.
    const paid = await ctx.cost.runPaidCall<R4Artifact>({
      actor: `${config.armName}:${rec.tag}:${iid}#r${ctx.rep}`,
      model: config.arm.workerModel,
      execute: () =>
        runWithPostGateClock({
          awaitGates,
          work: runCell,
          timeoutMs: config.dispatchTimeoutMs,
          label: `${config.armName} ${rec.tag} ${iid} r${ctx.rep}`,
        }),
      receipt: (artifact) => {
        if (artifact.kind !== 'swe-arm') throw new Error('swe cell produced a non-arm artifact')
        const usageKnown = artifact.workerTokIn !== null || artifact.workerTokOut !== null
        return {
          model: config.arm.workerModel,
          inputTokens: artifact.workerTokIn ?? 0,
          outputTokens: artifact.workerTokOut ?? 0,
          ...(usageKnown ? {} : { usageUnknown: true }),
          // The runtime spend-tree usd is the measured bill; without it the
          // receipt stays honestly unpriced (costUnknown) rather than $0.
          ...(artifact.spentUsd !== null ? { actualCostUsd: artifact.spentUsd } : {}),
        }
      },
    })
    if (!paid.succeeded) throw paid.error
    return paid.value
  }

  // ── judge config: a deterministic READ of the official verdict the dispatch
  // already obtained under the serialized-judge lock. ───────────────────
  const judgeConfig: JudgeConfig<R4Artifact, Scenario> = {
    name: 'swe-arena-official-judge',
    dimensions: [
      { key: 'resolved', description: 'official SWE-bench judge verdict (swe cells); change-space + tsc gates (static cell)' },
    ],
    score: ({ artifact }) => {
      if (artifact.kind === 'swe-arm') {
        const v = artifact.resolved ? 1 : 0
        return {
          composite: v,
          dimensions: { resolved: v },
          notes: `official judge: ${artifact.iid} resolved=${artifact.resolved} (verify_pass=${artifact.verifyPass}, patch_lines=${artifact.patchLines}, wall_s=${artifact.wallS})`,
        }
      }
      const ok = artifact.violations.length === 0 && artifact.typecheckOk
      return {
        composite: ok ? 1 : 0,
        dimensions: { resolved: ok ? 1 : 0 },
        notes: `static gates: change-space violations=${artifact.violations.length}, tsc ok=${artifact.typecheckOk}`,
      }
    },
  }

  // ── diagnosis at the analyzeGeneration seam ──────────────────────────
  const rawTrace = rawTraceDistiller<Scenario, R4Artifact>({ fallbackFindings: [] })
  const steeringFinding = makeFinding({
    analyst_id: 'round4-protocol',
    severity: 'high',
    area: 'constraint',
    confidence: 1,
    claim:
      'Declared change-space: ONLY extensions/pi/** and src/{worker-evidence,best-effort,worker-clone}.ts may change ' +
      '(plus the .improve/ diagnosis artifact). Judge, verify scripts, task prompts, model ids and budgets are immutable.',
    recommended_action: 'Keep every edit inside the change-space; out-of-space candidate diffs are rejected before evaluation.',
    evidence_refs: [],
  })
  const analyzeGeneration = async (input: {
    generation: number
    runDir: string
    candidates: Array<{ surfaceHash: string; composite: number; campaign: unknown }>
    history: unknown[]
  }): Promise<unknown[]> => {
    const runs: SupRunArtifacts[] = []
    if (input.generation === -1) {
      for (const seed of config.seedArtifactRuns) {
        if (!existsSync(seed.dir)) {
          // A wiped scratchpad (host reboot) must not feed EMPTY bundles to the
          // analysts as if they were real artifacts — skip loudly.
          log(`seed artifact dir missing — skipped from diagnosis: ${seed.dir}`)
          continue
        }
        runs.push({
          iid: seed.iid,
          arm: seed.arm,
          dir: seed.dir,
          ...(seed.patchPath ? { patchPath: seed.patchPath } : {}),
          judge: { resolved: seed.resolved, note: 'previous round (seeded)' },
        })
      }
    }
    // Candidate failure artifacts come from the LIB's campaign cells (the
    // artifacts name their own runDir/patch) — resume-replayed cells included,
    // which the old recorder-based lookup silently dropped.
    const worstFirst = [...input.candidates].sort((a, b) => a.composite - b.composite).slice(0, 4)
    for (const cand of worstFirst) {
      const cells = cellsFromCampaign(cand.campaign as CampaignResult<R4Artifact, Scenario>)
      for (const cell of cells) {
        const a = cell.artifact
        if (a === null || a.kind !== 'swe-arm' || !a.runDir) continue
        runs.push({
          iid: a.iid,
          arm: config.armName,
          dir: a.runDir,
          ...(a.patchPath ? { patchPath: a.patchPath } : {}),
          judge: { resolved: cell.error ? null : a.resolved },
        })
      }
    }
    let ensembleFindings: unknown[] = []
    if (runs.length > 0) {
      try {
        const scratch = join(config.outDir, 'diagnosis', `gen-${input.generation}`)
        const ensemble = await runDiagnosisEnsemble({ analysts, runs, secrets, scratchDir: scratch, onStatus: log })
        await writeFile(
          join(config.outDir, 'diagnosis', `gen-${input.generation}.json`),
          JSON.stringify({ reports: ensemble.reports, fused: ensemble.fused }, null, 2),
        )
        ensembleFindings = fusedToAnalystFindings(ensemble.fused, {
          dirs: [...new Set(runs.map((r) => r.dir))],
          totalAnalysts: analysts.length,
        })
      } catch (cause) {
        // A dead router must not kill the round: the raw-trace context below
        // still grounds the proposer; the failure is logged, never silent.
        log(`diagnosis ensemble FAILED for gen ${input.generation}: ${(cause as Error).message}`)
      }
    }
    const rawFindings = (await rawTrace(input as Parameters<typeof rawTrace>[0])) as unknown[]
    return [steeringFinding, ...ensembleFindings, ...rawFindings]
  }

  // ── protocol_v2 gate: NEVER ships from inside the loop — the pre-registered
  // holdout run needs operator approval; a would-be KEEP is reported as hold +
  // instructions. ──────────────────────────────────────────────────────
  const holdoutInstruction =
    `holdout (${config.holdoutInstances.length} pre-registered instances: ${config.holdoutInstances.join(', ')}) ` +
    'was NOT run — operator approval required. To grade a would-be KEEP: apply the winner patch to a loops ' +
    'checkout and run the holdout instances through run-experiment.mts with the same frozen arm.'
  // The gate scores from the LIB's per-cell caches on disk (run-campaign
  // writes `<campaign>/<cellId>/cached-result.json` for every conclusive
  // cell, dispatched OR resume-replayed) — attribution is campaign DIRECTORY
  // (baseline/ vs gen-*/candidate-*) + artifact commit, never dispatch order.
  const improveRunDir = join(config.outDir, 'improve-run')
  const promotionGate: Gate<R4Artifact, Scenario> = {
    name: 'protocol-v2-operator-gate',
    decide: async (ctx): Promise<GateResult> => {
      const staticArt = [...ctx.candidateArtifacts.values()].find(
        (a): a is Extract<R4Artifact, { kind: 'static-gate' }> => a.kind === 'static-gate',
      )
      const reasons: string[] = []
      let delta = 0
      let wouldKeep = false
      if (staticArt) {
        // A corrupt/mixed cell cache must fail the GRADE loudly, not crash the
        // loop at its final step — the hold verdict + reason still lands.
        let groups: Awaited<ReturnType<typeof loadCandidateCellGroups>> = []
        let baselineCells: EvidenceCell[] = []
        try {
          groups = await loadCandidateCellGroups(improveRunDir)
          baselineCells = premeasured
            ? cellsFromCampaign(premeasured.campaign)
            : await loadCampaignCells(join(improveRunDir, 'baseline'))
        } catch (cause) {
          reasons.push(`cell-cache read failed — refusing to grade: ${(cause as Error).message}`)
        }
        // The winner's most recent measurement (a re-proposed identical commit
        // in a later generation supersedes earlier cells).
        const winnerGroup = [...groups].reverse().find((g) => g.commit === staticArt.commit)
        if (winnerGroup && (baselineCells.length > 0 || pinnedCount !== null)) {
          const ev = gateEvidenceFromCells({
            winnerCells: winnerGroup.cells,
            baselineCells,
            staticViolations: staticArt.violations,
            pin: config.pinnedBaseline,
            iids: config.instances,
            reps,
            costGuardRatio: config.costGuardRatio,
          })
          for (const w of ev.driftWarnings) log(`BASELINE-DRIFT: ${w}`)
          delta = (ev.candResolved - ev.baseResolved) / Math.max(1, config.instances.length)
          wouldKeep = ev.verdict === 'accepted' && staticArt.violations.length === 0 && staticArt.typecheckOk
          reasons.push(
            `improvement set: winner ${ev.candResolved}/${config.instances.length} vs baseline ${ev.baseResolved}/${config.instances.length}` +
              `${ev.baseFromPin ? ' (pinned)' : ''}; ` +
              `wall ${ev.candWallS}s vs ${ev.baseWallS}s (ratio ${ev.costRatio === null ? 'n/a' : ev.costRatio.toFixed(2)}, guard ${config.costGuardRatio}); ` +
              `protocol verdict: ${ev.verdict}${wouldKeep ? ' (WOULD-BE KEEP)' : ''}`,
          )
        } else {
          reasons.push('winner has no cached improvement-set cells — refusing to grade')
        }
      } else {
        reasons.push('no static-gate artifact on the holdout cell — refusing to grade')
      }
      reasons.push(holdoutInstruction)
      return {
        decision: 'hold',
        reasons,
        contributingGates: [{ name: 'operator-holdout-approval', passed: false, detail: { wouldKeep } }],
        delta,
      }
    },
  }

  // ── the improve() call: the optimizer seat ───────────────────────────
  const profile: AgentProfile = { name: 'loops-pi-supervisor' } as AgentProfile
  log(`round ${config.round} runId=${runId}: improve(surface:'code') over ${config.loopsRepo}@${config.loopsBaseRef}`)
  // budget.maxImprovementShots + premeasuredBaseline are typed on the
  // substrate only once feat/improve-loop-passthroughs merges; until then they
  // ride behind the capability probe as extra keys (harmless to the option
  // parser, and the probe guarantees they are consumed, never silently
  // dropped).
  const budget: Record<string, unknown> = {
    generations: config.generations,
    populationSize: config.populationSize,
    maxConcurrency: 1,
    reps,
    holdoutScenarios: [staticScenario],
    ...(caps.maxImprovementShots ? { maxImprovementShots: config.maxShots } : {}),
  }
  const result = await improve<Scenario, R4Artifact>(profile, [], {
    surface: 'code',
    // analyzeGeneration wins over this flag; the composite above embeds
    // rawTraceDistiller directly so the raw-trace mechanism stays active.
    rawTraceContext: true,
    analyzeGeneration,
    code: {
      repoRoot: config.loopsRepo,
      baseRef: config.loopsBaseRef,
      worktreeDir: join(config.outDir, 'loops-worktrees'),
      generator: constrainedLoopsGenerator(config, caps),
    },
    scenarios: sweScenarios,
    judge: judgeConfig,
    agent,
    budget: budget as Parameters<typeof improve<Scenario, R4Artifact>>[2]['budget'],
    promotionGate,
    // TRAINING RECORDER: every scored (artifact, judge score) lands in the
    // lib's labeled-scenario store as a JSONL corpus under outDir (growth is
    // outDir-scoped; a handful of cells per round). Records carry the default
    // 'unverified' trust — corpus-grade, NOT gold-eligible, which is right
    // until an operator-confirmed holdout verdict upgrades them.
    labeledStore: new FsLabeledScenarioStore({ root: join(config.outDir, 'labeled-store') }),
    captureSource: 'eval-run',
    // Arm/judge/proposer spend now reaches the campaign meter through real
    // paid calls (worker receipt per swe cell, $0 judge receipts, imported
    // proposer-shot receipts) — the stub-cell sanity check is back on. 'warn'
    // not 'assert': the static-gate holdout cell is genuinely zero-spend (a
    // local tsc run) and must not kill the round as a "stub".
    expectUsage: 'warn',
    // Widened: covers worst-case capacity-gate holds; the REAL per-cell work
    // clock (config.dispatchTimeoutMs) starts post-gate inside the dispatch.
    dispatchTimeoutMs: campaignDispatchCeilingMs(config),
    runDir: improveRunDir,
    ...(premeasured
      ? { premeasuredBaseline: premeasured }
      : {}),
  } as Parameters<typeof improve<Scenario, R4Artifact>>[2])

  // ── staircase rows + round summary — scored from the LIB's campaign cells
  // (baselineCampaign + per-generation candidate campaigns), which replay
  // correctly attributed on resume. The recorder only contributes the
  // dispatch-time diff/change-space description (recomputed post-run via
  // ensure() for candidates that were replayed, never dispatched here). ────
  try {
    const loop = result.raw.raw
    const baselineCells = cellsFromCampaign(loop.baselineCampaign)
    const baselineWallS = sumWallSFromCells(baselineCells)
    const measuredBaselineCount = resolvedInstanceCount(
      replicateRunsFromCells(baselineCells),
      config.instances,
      reps,
    )
    const campaignBySurface = new Map<string, CampaignResult<R4Artifact, Scenario>>()
    for (const gen of loop.generations) {
      for (const s of gen.surfaces) campaignBySurface.set(s.surfaceHash, s.campaign)
    }
    const resolvedCountOf = (campaign: CampaignResult<R4Artifact, Scenario>): number =>
      resolvedInstanceCount(replicateRunsFromCells(cellsFromCampaign(campaign)), config.instances, reps)

    for (let g = 0; g < loop.generations.length; g++) {
      const gen = loop.generations[g]!
      const rows: StaircaseRow[] = []
      for (const cand of gen.record.candidates) {
        const surface = gen.surfaces.find((s) => s.surfaceHash === cand.surfaceHash)?.surface
        const cs = surface && typeof surface === 'object' && surface.kind === 'code' ? surface : null
        const desc = cs ? await recorder.ensure(cs) : undefined
        const campaign = campaignBySurface.get(cand.surfaceHash)
        const cells = campaign ? cellsFromCampaign(campaign) : []
        const runs = replicateRunsFromCells(cells)
        const perInstance = perInstanceFromCells(cells)
        const candResolved = resolvedInstanceCount(runs, config.instances, reps)
        const wallS = sumWallSFromCells(cells)
        const coverageComplete =
          cand.eligibleForPromotion === true && replicateCoverageComplete(runs, config.instances, reps)
        const costRatio = baselineWallS > 0 ? wallS / baselineWallS : null
        // Parent's AND-resolved count. A parent hash with no candidate
        // campaign IS the baseline incumbent — pin first, measured baseline
        // cells otherwise (both survive resume; no dispatch-order guess).
        const parentCampaign = cand.parentSurfaceHash
          ? campaignBySurface.get(cand.parentSurfaceHash)
          : undefined
        const parentResolvedCount =
          parentCampaign !== undefined
            ? resolvedCountOf(parentCampaign)
            : (pinnedCount ?? measuredBaselineCount)
        const violations = desc?.violations ?? []
        rows.push({
          schema: STAIRCASE_SCHEMA,
          round: config.round,
          generation: g,
          runId,
          at: new Date().toISOString(),
          candidate: cand.surfaceHash,
          candidateCommit: cs?.candidateCommit ?? null,
          parent: cand.parentSurfaceHash ?? 'baseline',
          parentResolvedCount,
          ...(cand.label ? { label: cand.label } : {}),
          ...(cand.rationale ? { rationale: cand.rationale } : {}),
          changedFiles: desc?.changedFiles ?? [],
          changeSpaceViolations: violations,
          perInstance,
          resolvedCount: candResolved,
          coverageComplete,
          wallS,
          baselineWallS,
          costRatio,
          costGuardRatio: config.costGuardRatio,
          internallyPromoted: gen.record.promoted.includes(cand.surfaceHash),
          verdict: decideVerdict({
            violations,
            coverageComplete,
            resolvedCount: candResolved,
            parentResolvedCount,
            costRatio,
            costGuardRatio: config.costGuardRatio,
          }),
          holdout: 'operator-approval-required',
          armProvenance: desc?.armProvenance ?? null,
          diffPath: desc?.diffPath ?? null,
          diffSha256: desc?.diffSha256 ?? null,
        })
      }
      const genFile = join(config.roundsDir, `gen-${g}.jsonl`)
      for (const row of rows) await appendFile(genFile, JSON.stringify(row) + '\n')
      log(`staircase: ${rows.length} row(s) → ${genFile} (${rows.map((r) => r.verdict).join(', ')})`)
    }

    const winnerSurface = result.raw.winner.surface
    const winnerCs =
      typeof winnerSurface === 'object' && winnerSurface !== null && winnerSurface.kind === 'code'
        ? winnerSurface
        : null
    const winnerRec = winnerCs ? await recorder.ensure(winnerCs) : undefined
    let winnerPatch: string | null = null
    if (winnerRec?.diffPath) {
      winnerPatch = join(config.outDir, 'winner.patch')
      await writeFile(winnerPatch, await readFile(winnerRec.diffPath, 'utf8'))
    }
    const summary = {
      schema: 'swe-arena.round-summary.v1',
      round: config.round,
      runId,
      at: new Date().toISOString(),
      loops: { repo: config.loopsRepo, baseRef: config.loopsBaseRef },
      // The gate's denominator (pin when present); `baseline` below is this
      // run's MEASURED baseline campaign, kept for drift/cost forensics.
      pinnedBaseline: config.pinnedBaseline ?? null,
      pinnedBaselineResolvedCount: pinnedCount,
      baseline: {
        resolvedCount: measuredBaselineCount,
        wallS: baselineWallS,
        perInstance: perInstanceFromCells(baselineCells),
        premeasured: premeasured !== undefined,
      },
      winner: winnerCs
        ? {
            surfaceHash: surfaceHash(winnerCs),
            commit: winnerCs.candidateCommit,
            label: result.raw.winner.label ?? null,
            rationale: result.raw.winner.rationale ?? null,
            patch: winnerPatch,
          }
        : null,
      gateDecision: result.gateDecision,
      gateReasons: loop.gateResult.reasons,
      // Renamed from `lift`: this is the winner-vs-baseline delta on the FAKE
      // static holdout scenario (change-space + tsc gates), NOT a held-out
      // SWE-bench lift — as held-out evidence it is meaningless. The real
      // held-out verdict is the operator-approved 6-instance holdout run.
      // TODO(feat/improve-loop-passthroughs): when the substrate's deferred-
      // holdout mode lands, drop the fake static scenario and record the
      // provenance `holdout: 'deferred'` marker instead.
      staticCheckDelta: result.lift,
      // Honest run-wide spend from the lib's CostLedger: per-channel rollups
      // (agent = arm cells, judge = official-judge calls, driver = proposer
      // shots), token totals, and accounting-completeness flags.
      cost: {
        totalCostUsd: result.raw.totalCostUsd,
        inputTokens: result.raw.cost.inputTokens,
        outputTokens: result.raw.cost.outputTokens,
        byChannel: result.raw.cost.byChannel,
        fullyPriced: result.raw.cost.fullyPriced,
        usageComplete: result.raw.cost.usageComplete,
        accountingComplete: result.raw.cost.accountingComplete,
        incompleteReasons: result.raw.cost.incompleteReasons,
        receipts: result.raw.receipts.length,
      },
      holdout: { instances: config.holdoutInstances, status: 'operator-approval-required' },
    }
    const summaryPath = join(config.roundsDir, `round${config.round}-summary-${runId}.json`)
    await writeFile(summaryPath, JSON.stringify(summary, null, 2))
    log(`round summary → ${summaryPath}`)
    log(`gate: ${result.gateDecision} — ${loop.gateResult.reasons[0] ?? ''}`)
  } finally {
    await result.dispose()
  }
}

// ---------------------------------------------------------------------------
// Calibration smoke — the ensemble over the REAL round-2 django SUP2 run
// (known truth: the worker authored a LOCAL idna helper inside the mail module
// while the gold fix adds punycode() in django/utils/encoding.py — a fix
// PLACEMENT failure). Cheap (a few k tokens/analyst); grades whether each
// blind analyst independently surfaces placement.
// ---------------------------------------------------------------------------

export interface SmokeArgs {
  supRunDir?: string
  patchPath?: string
  analysts?: number
  model?: string
  /** 'router' (default) or 'zai' — the z.ai coding endpoint is the proven
   *  fallback when router.tangle.tools 524-storms (a measured infra class). */
  endpoint?: 'router' | 'zai'
  /** Transport retries per analyst. Default 4 in the smoke (storms pass). */
  retries?: number
  secrets?: SecretsEnv
  scratchDir?: string
}

export async function calibrationSmoke(args: SmokeArgs = {}): Promise<{
  perAnalyst: Array<{ analystId: string; ok: boolean; surfacesPlacement: boolean; findings: number; error?: string }>
  fusedTop: string[]
}> {
  const supRunDir = args.supRunDir ?? join(DEFAULT_HH_SCRATCHPAD, 'runs', 'django__django-11532', 'SUP2')
  const patchPath = args.patchPath ?? join(DEFAULT_HH_SCRATCHPAD, 'patches', 'django__django-11532.sup2.patch')
  const secrets: SecretsEnv = args.secrets ?? {
    secretsDir: '/home/drew/company/devops/secrets',
    envFiles: ['agent-state.env', 'tangle-router.env'],
  }
  const scratchDir = args.scratchDir ?? join(supRunDir, '..', '..', '..', 'r4', 'calibration-smoke')
  const analysts: AnalystSpec[] = defaultAnalysts(args.analysts ?? 3, args.model ?? 'glm-5.2').map((s) =>
    args.endpoint === 'zai' ? { ...s, url: ZAI_CODING_ENDPOINT, apiKeyEnv: 'ZAI_API_KEY' } : s,
  )
  const runs: SupRunArtifacts[] = [
    {
      iid: 'django__django-11532',
      arm: 'SUP2',
      dir: supRunDir,
      ...(existsSync(patchPath) ? { patchPath } : {}),
      judge: { resolved: false, note: 'round-2 official judge: unresolved while the self-verify passed' },
    },
  ]
  const ensemble = await runDiagnosisEnsemble({
    analysts,
    runs,
    secrets,
    scratchDir,
    retriesPerAnalyst: args.retries ?? 4,
    retryDelayMs: 15_000,
    onStatus: log,
  })
  const placement = surfacesPlacementRegex()
  const perAnalyst = ensemble.reports.map((r) => ({
    analystId: r.analystId,
    ok: r.ok,
    surfacesPlacement: r.findings.some((f) =>
      placement.test(`${f.failure_class} ${f.evidence_quote} ${f.proposed_direction}`),
    ),
    findings: r.findings.length,
    ...(r.error ? { error: r.error } : {}),
  }))
  console.log('\n=== CALIBRATION SMOKE (django__django-11532 SUP2, truth = fix placement) ===')
  console.log(`bundle: ${ensemble.bundleChars} chars; analysts: ${analysts.map((a) => a.model).join(', ')}`)
  for (const r of ensemble.reports) {
    const grade = perAnalyst.find((p) => p.analystId === r.analystId)!
    console.log(`\n--- ${r.analystId} ok=${r.ok} placement-surfaced=${grade.surfacesPlacement}${r.error ? ` error=${r.error}` : ''}` +
      (r.tokens ? ` tokens(in=${r.tokens.input},out=${r.tokens.output})` : ''))
    for (const f of r.findings) {
      console.log(`  [${f.confidence.toFixed(2)}] ${f.failure_class} → ${f.proposed_direction.slice(0, 160)}`)
      if (f.evidence_quote) console.log(`      evidence: ${f.evidence_quote.slice(0, 160)}`)
    }
  }
  console.log('\n--- fused (agreement-ranked) ---')
  for (const f of ensemble.fused) {
    console.log(
      `  agreement=${f.agreement}${f.competingHypothesis ? ' [competing hypothesis]' : ''} conf=${f.meanConfidence.toFixed(2)} — ${f.failure_class}`,
    )
  }
  const outPath = join(scratchDir, 'calibration-smoke.json')
  await mkdir(scratchDir, { recursive: true })
  await writeFile(outPath, JSON.stringify({ perAnalyst, ensemble }, null, 2))
  console.log(`\nfull output → ${outPath}`)
  return { perAnalyst, fusedTop: ensemble.fused.map((f) => f.failure_class) }
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i !== -1 ? argv[i + 1] : undefined
  }
  if (argv[0] === '--write-config') {
    const path = argv[1]
    if (!path || path.startsWith('--')) {
      console.error('usage: outer-loop.mts --write-config <path> [--out-name <dirname>]')
      process.exit(2)
    }
    const outDirName = flag('--out-name')
    await writeFile(
      path,
      JSON.stringify(defaultRound4Config(undefined, outDirName ? { outDirName } : {}), null, 2) + '\n',
    )
    console.log(`default round-4 config → ${path}`)
  } else if (argv[0] === '--calibration-smoke') {
    const dir = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    const n = flag('--analysts')
    const model = flag('--model')
    const endpoint = flag('--endpoint')
    const retries = flag('--retries')
    if (endpoint !== undefined && endpoint !== 'router' && endpoint !== 'zai') {
      console.error(`--endpoint must be 'router' or 'zai', got ${JSON.stringify(endpoint)}`)
      process.exit(2)
    }
    await calibrationSmoke({
      ...(dir ? { supRunDir: dir } : {}),
      ...(n ? { analysts: Number(n) } : {}),
      ...(model ? { model } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(retries ? { retries: Number(retries) } : {}),
    })
  } else if (argv[0] && !argv[0].startsWith('--')) {
    const config = JSON.parse(await readFile(argv[0], 'utf8')) as OuterLoopConfig
    // Launch guards BEFORE any spend: keys present (dotenvx forgotten = hours
    // of confusing downstream failures) and exactly one loop per outDir.
    assertLaunchEnv()
    const lock = await acquireInstanceLock(config.outDir)
    try {
      await runRound(config)
    } finally {
      await lock.release()
    }
  } else {
    console.error(
      'usage: tsx src/swe-arena/outer-loop.mts <config.json>            # SPENDS: arms + judges + proposer\n' +
        '       tsx src/swe-arena/outer-loop.mts --write-config <path> [--out-name <dirname>]\n' +
        '       tsx src/swe-arena/outer-loop.mts --calibration-smoke [supRunDir] [--analysts N] [--model M] [--endpoint router|zai] [--retries N]',
    )
    process.exit(2)
  }
}
