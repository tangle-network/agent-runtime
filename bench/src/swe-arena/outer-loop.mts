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
  surfaceHash,
  type CodeSurface,
  type DispatchContext,
  type Gate,
  type GateResult,
  type JudgeConfig,
  type MutableSurface,
  type Scenario,
} from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { createSweBenchAdapter } from '../benchmarks/swe-bench.ts'
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
// Replicate semantics — repsPerInstance. Single-rep scoring provably flips
// instance outcomes run-to-run (judge flake + capacity noise both observed),
// so an instance counts RESOLVED only when EVERY replicate cell resolved (AND
// — fail-closed for keep-if-better), and coverage requires every replicate of
// every instance to hold a real boolean verdict.
// ---------------------------------------------------------------------------

export interface ReplicateRun {
  iid: string
  resolved: boolean | null
}

/** Instances where ALL `reps` replicates resolved (missing replicates never count). */
export function resolvedInstanceCount(runs: ReplicateRun[], iids: string[], reps: number): number {
  let count = 0
  for (const iid of iids) {
    const mine = runs.filter((r) => r.iid === iid)
    if (mine.length === reps && mine.every((r) => r.resolved === true)) count += 1
  }
  return count
}

/** Every instance has exactly `reps` replicates, each with a conclusive verdict. */
export function replicateCoverageComplete(runs: ReplicateRun[], iids: string[], reps: number): boolean {
  return iids.every((iid) => {
    const mine = runs.filter((r) => r.iid === iid)
    return mine.length === reps && mine.every((r) => r.resolved !== null)
  })
}

// ---------------------------------------------------------------------------
// Pinned baseline. The accept/reject gate compares candidates against a
// MEASURED, reps-confirmed baseline pinned in config — never a per-run
// recomputation. Root cause (r4-mroh3rkt): improve() resumes its campaign from
// runDir, replaying cached baseline cells WITHOUT dispatching them, so the
// in-process recorder saw a candidate first, mislabeled it as the baseline,
// and graded "winner 0/3 vs baseline 0/3" while the measured baseline was 1/3.
// The pin makes the gate's denominator immune to that whole failure class.
// ---------------------------------------------------------------------------

/** Fail-loud pinned resolved-count: every improvement-set instance must carry a
 *  pinned boolean, and every pinned iid must be in the improvement set. */
export function pinnedBaselineResolvedCount(pin: Record<string, boolean>, iids: string[]): number {
  const missing = iids.filter((iid) => typeof pin[iid] !== 'boolean')
  if (missing.length > 0) {
    throw new Error(`pinnedBaseline: missing boolean verdict for ${missing.join(', ')}`)
  }
  const unknown = Object.keys(pin).filter((iid) => !iids.includes(iid))
  if (unknown.length > 0) {
    throw new Error(`pinnedBaseline: unknown instance(s) not in the improvement set: ${unknown.join(', ')}`)
  }
  return iids.filter((iid) => pin[iid] === true).length
}

/** Per-instance contradictions between the pin and a run's OWN baseline cells.
 *  Only instances with full-reps, conclusive coverage in the run are compared —
 *  a partial baseline record has no AND-verdict to contradict the pin with.
 *  The caller logs these loud and STILL uses the pin. */
export function baselineDriftWarnings(
  pin: Record<string, boolean>,
  runs: ReplicateRun[],
  iids: string[],
  reps: number,
): string[] {
  const warnings: string[] = []
  for (const iid of iids) {
    const pinned = pin[iid]
    if (typeof pinned !== 'boolean') continue
    const mine = runs.filter((r) => r.iid === iid)
    if (mine.length !== reps || mine.some((r) => r.resolved === null)) continue
    const measured = mine.every((r) => r.resolved === true)
    if (measured !== pinned) {
      warnings.push(
        `${iid}: pinned=${pinned} but this run's baseline cells measured ${measured} ` +
          `(reps: ${mine.map((r) => String(r.resolved)).join('/')}) — gate uses the PIN`,
      )
    }
  }
  return warnings
}

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

export type StaircaseVerdict =
  | 'accepted'
  | 'rejected-no-gain'
  | 'rejected-cost'
  | 'rejected-out-of-space'
  | 'rejected-incomplete'

export interface StaircasePerInstance {
  iid: string
  /** Replicate index (0-based) — repsPerInstance cells per instance. */
  rep: number
  resolved: boolean | null
  verify_pass: boolean | null
  patch_lines: number | null
  wall_s: number | null
  spentTokens: number | null
  recoveredTokens: number | null
  judgeAttempts: number | null
  error?: string
}

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

/** protocol_v2 keep-if-better: improvement-set resolved-count must RISE and
 *  cost must stay within the guard. Fail-closed on unprovable cost. */
export function decideVerdict(input: {
  violations: string[]
  coverageComplete: boolean
  resolvedCount: number
  parentResolvedCount: number
  costRatio: number | null
  costGuardRatio: number
}): StaircaseVerdict {
  if (input.violations.length > 0) return 'rejected-out-of-space'
  if (!input.coverageComplete) return 'rejected-incomplete'
  if (input.resolvedCount <= input.parentResolvedCount) return 'rejected-no-gain'
  if (input.costRatio === null || input.costRatio > input.costGuardRatio) return 'rejected-cost'
  return 'accepted'
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
  /** DEPTH for the agentic generator (selfImprove does not thread
   *  maxImprovementShots, so the constrained generator applies this itself). */
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
// Round recorder — per-candidate ground truth the gate + staircase read.
// ---------------------------------------------------------------------------

interface InstanceRun {
  iid: string
  /** Replicate index (0-based, from the campaign's ctx.rep). */
  rep: number
  runDir: string
  resolved: boolean | null
  verify_pass: boolean | null
  patch_lines: number | null
  wall_s: number | null
  spentTokens: number | null
  recoveredTokens: number | null
  judgeAttempts: number | null
  patchPath?: string
  error?: string
}

interface CandidateRecord {
  surfaceKey: string
  commit: string
  baseCommit: string
  tag: string
  changedFiles: string[]
  violations: string[]
  diffPath: string | null
  diffSha256: string | null
  /** Keyed `${iid}#r${rep}` — one entry per replicate cell. */
  instances: Map<string, InstanceRun>
  armProvenance: { repo: string; commit: string } | null
}

/** Replicate-cell key inside a CandidateRecord. */
export const instanceRunKey = (iid: string, rep: number): string => `${iid}#r${rep}`

class RoundRecorder {
  readonly byKey = new Map<string, CandidateRecord>()
  baselineKey: string | undefined
  constructor(
    private readonly loopsRepo: string,
    private readonly candidatesDir: string,
  ) {}

  byCommit(commit: string): CandidateRecord | undefined {
    for (const rec of this.byKey.values()) if (rec.commit === commit) return rec
    return undefined
  }

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
      instances: new Map(),
      armProvenance: null,
    }
    this.byKey.set(key, rec)
    // The baseline incumbent is the surface with NO diff (candidateCommit ==
    // baseCommit — worktree.finalize of an untouched baseRef checkout).
    // Identifying it positionally ("first dispatched") mislabeled a CANDIDATE
    // as the baseline when a resumed campaign replayed the cached baseline
    // cells without dispatching them (measured: r4-mroh3rkt's round summary
    // published candidate b08d31c910's cells as "baseline 0/3" while the
    // measured baseline was 1/3).
    if (surface.candidateCommit === surface.baseCommit) this.baselineKey ??= key
    return rec
  }
}

const sumWall = (rec: CandidateRecord): number =>
  [...rec.instances.values()].reduce((s, r) => s + (r.wall_s ?? 0), 0)

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

export function constrainedLoopsGenerator(config: OuterLoopConfig): CandidateGenerator {
  const shotDir = join(config.outDir, 'proposer-shots')
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
    },
  })
  return {
    kind: `round4-constrained:${inner.kind}`,
    proposesWithoutFindings: true,
    // selfImprove never sets maxImprovementShots, so ctx.maxShots arrives as 1;
    // the DEPTH dial is applied here from config.
    generate: (args) => inner.generate({ ...args, maxShots: Math.max(args.maxShots, config.maxShots) }),
  }
}

// ---------------------------------------------------------------------------
// The evaluated artifact + runRound.
// ---------------------------------------------------------------------------

export type R4Artifact =
  | {
      kind: 'swe-arm'
      iid: string
      commit: string
      resolved: boolean
      verifyPass: boolean
      patchLines: number
      wallS: number
      spentTokens: number | null
      recoveredTokens: number | null
      judgeAttempts: number | null
      runDir: string
      patchPath: string
    }
  | {
      kind: 'static-gate'
      commit: string
      changedFiles: string[]
      violations: string[]
      typecheckOk: boolean
      feedback?: string
    }

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
  const resolvedCount = (rec: CandidateRecord): number =>
    resolvedInstanceCount([...rec.instances.values()], config.instances, reps)
  const coverageOf = (rec: CandidateRecord): boolean =>
    replicateCoverageComplete([...rec.instances.values()], config.instances, reps)

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
    // never reach a model token or a docker container.
    if (rec.violations.length > 0) {
      const err = `change-space violation (${rec.violations.length} path(s)): ${rec.violations.join(', ')}`
      rec.instances.set(instanceRunKey(iid, ctx.rep), {
        iid, rep: ctx.rep, runDir: '', resolved: null, verify_pass: null, patch_lines: null,
        wall_s: null, spentTokens: null, recoveredTokens: null, judgeAttempts: null, error: err,
      })
      throw new Error(err)
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

        const verdict = await judge.judge(iid, armRes.patchPath, `${config.armName}-${rec.tag}`)
        await writeFile(join(runDir, 'judge.json'), JSON.stringify(verdict, null, 1))
        log(`${config.armName} ${rec.tag} ${iid} judged: resolved=${verdict.resolved} (attempts=${verdict.attempts})`)

        const recovered = armRes.recoveredSpend
          ? armRes.recoveredSpend.brainTotal + (armRes.recoveredSpend.workerTokSqlite ?? 0)
          : null
        const instanceRun: InstanceRun = {
          iid,
          rep: ctx.rep,
          runDir,
          resolved: verdict.resolved,
          verify_pass: armRes.verify_pass,
          patch_lines: armRes.patch_lines,
          wall_s: armRes.wall_s,
          spentTokens: armRes.spentTokens,
          recoveredTokens: recovered,
          judgeAttempts: verdict.attempts ?? null,
          patchPath: armRes.patchPath,
        }
        rec.instances.set(instanceRunKey(iid, ctx.rep), instanceRun)
        rec.armProvenance = { repo: armRes.provenance.repo, commit: armRes.provenance.commit }
        await appendFile(
          join(config.outDir, 'progress.jsonl'),
          JSON.stringify({ at: new Date().toISOString(), runId, candidate: rec.tag, ...instanceRun }) + '\n',
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
          recoveredTokens: recovered,
          judgeAttempts: verdict.attempts ?? null,
          runDir,
          patchPath: armRes.patchPath,
        }
      } finally {
        await removeEvalWorktree(config.loopsRepo, evalWt)
      }
    }

    return runWithPostGateClock({
      awaitGates,
      work: runCell,
      timeoutMs: config.dispatchTimeoutMs,
      label: `${config.armName} ${rec.tag} ${iid} r${ctx.rep}`,
    })
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
    const worstFirst = [...input.candidates].sort((a, b) => a.composite - b.composite).slice(0, 4)
    for (const cand of worstFirst) {
      const rec = recorder.byKey.get(cand.surfaceHash)
      if (!rec) continue
      for (const ir of rec.instances.values()) {
        if (!ir.runDir) continue
        runs.push({
          iid: ir.iid,
          arm: config.armName,
          dir: ir.runDir,
          ...(ir.patchPath ? { patchPath: ir.patchPath } : {}),
          judge: { resolved: ir.resolved },
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
        const rec = recorder.byCommit(staticArt.commit)
        const baseRec = recorder.baselineKey ? recorder.byKey.get(recorder.baselineKey) : undefined
        if (rec && (baseRec || pinnedCount !== null)) {
          const cand = resolvedCount(rec)
          // The PIN is the gate's denominator; a per-run baseline record is
          // only a drift detector + the cost-ratio denominator.
          const base = pinnedCount ?? resolvedCount(baseRec!)
          if (pinnedCount !== null && baseRec) {
            for (const w of baselineDriftWarnings(
              config.pinnedBaseline!,
              [...baseRec.instances.values()],
              config.instances,
              reps,
            )) {
              log(`BASELINE-DRIFT: ${w}`)
            }
          }
          const candWall = sumWall(rec)
          const baseWall = baseRec ? sumWall(baseRec) : 0
          const ratio = baseWall > 0 ? candWall / baseWall : null
          delta = (cand - base) / Math.max(1, config.instances.length)
          const verdict = decideVerdict({
            violations: rec.violations,
            coverageComplete: coverageOf(rec),
            resolvedCount: cand,
            parentResolvedCount: base,
            costRatio: ratio,
            costGuardRatio: config.costGuardRatio,
          })
          wouldKeep = verdict === 'accepted' && staticArt.violations.length === 0 && staticArt.typecheckOk
          reasons.push(
            `improvement set: winner ${cand}/${config.instances.length} vs baseline ${base}/${config.instances.length}` +
              `${pinnedCount !== null ? ' (pinned)' : ''}; ` +
              `wall ${candWall}s vs ${baseWall}s (ratio ${ratio === null ? 'n/a' : ratio.toFixed(2)}, guard ${config.costGuardRatio}); ` +
              `protocol verdict: ${verdict}${wouldKeep ? ' (WOULD-BE KEEP)' : ''}`,
          )
        } else {
          reasons.push('winner has no recorded improvement-set evidence — refusing to grade')
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
      generator: constrainedLoopsGenerator(config),
    },
    scenarios: sweScenarios,
    judge: judgeConfig,
    agent,
    budget: {
      generations: config.generations,
      populationSize: config.populationSize,
      maxConcurrency: 1,
      reps,
      holdoutScenarios: [staticScenario],
    },
    promotionGate,
    // Spend happens in child processes (opencode / loops driver / docker
    // judge), invisible to the campaign cost meter — the guard would misfire.
    expectUsage: 'off',
    // Widened: covers worst-case capacity-gate holds; the REAL per-cell work
    // clock (config.dispatchTimeoutMs) starts post-gate inside the dispatch.
    dispatchTimeoutMs: campaignDispatchCeilingMs(config),
    runDir: join(config.outDir, 'improve-run'),
  })

  // ── staircase rows + round summary ───────────────────────────────────
  try {
    const loop = result.raw.raw
    const n = config.instances.length
    const baseRec = recorder.baselineKey ? recorder.byKey.get(recorder.baselineKey) : undefined
    const baselineWallS = baseRec ? sumWall(baseRec) : 0
    for (let g = 0; g < loop.generations.length; g++) {
      const gen = loop.generations[g]!
      const rows: StaircaseRow[] = []
      for (let i = 0; i < gen.record.candidates.length; i++) {
        const cand = gen.record.candidates[i]!
        const surface = gen.surfaces[i]?.surface
        const cs = surface && typeof surface === 'object' && surface.kind === 'code' ? surface : null
        const rec = recorder.byKey.get(cand.surfaceHash)
        const perInstance: StaircasePerInstance[] = rec
          ? [...rec.instances.values()].map((r) => ({
              iid: r.iid,
              rep: r.rep,
              resolved: r.resolved,
              verify_pass: r.verify_pass,
              patch_lines: r.patch_lines,
              wall_s: r.wall_s,
              spentTokens: r.spentTokens,
              recoveredTokens: r.recoveredTokens,
              judgeAttempts: r.judgeAttempts,
              ...(r.error ? { error: r.error } : {}),
            }))
          : []
        const candResolved = rec ? resolvedCount(rec) : 0
        const wallS = rec ? sumWall(rec) : 0
        const coverageComplete =
          cand.eligibleForPromotion === true && rec !== undefined && coverageOf(rec)
        const costRatio = baselineWallS > 0 ? wallS / baselineWallS : null
        // Parent's AND-resolved count. When the parent is the baseline
        // incumbent (or was never dispatched in this process — the campaign
        // resume replay), the PIN wins; a non-baseline parent uses its own
        // record; the composite-mean fallback (fractional under reps) only
        // fires with no pin and no record.
        const parentRec = cand.parentSurfaceHash
          ? recorder.byKey.get(cand.parentSurfaceHash)
          : recorder.baselineKey
            ? recorder.byKey.get(recorder.baselineKey)
            : undefined
        const parentIsBaseline =
          parentRec === undefined ||
          (recorder.baselineKey !== undefined && parentRec.surfaceKey === recorder.baselineKey)
        const parentResolvedCount =
          pinnedCount !== null && parentIsBaseline
            ? pinnedCount
            : parentRec
              ? resolvedCount(parentRec)
              : Math.round((cand.parentComposite ?? 0) * n)
        const violations = rec?.violations ?? []
        rows.push({
          schema: STAIRCASE_SCHEMA,
          round: config.round,
          generation: g,
          runId,
          at: new Date().toISOString(),
          candidate: cand.surfaceHash,
          candidateCommit: cs?.candidateCommit ?? null,
          parent: cand.parentSurfaceHash ?? recorder.baselineKey ?? 'unknown',
          parentResolvedCount,
          ...(cand.label ? { label: cand.label } : {}),
          ...(cand.rationale ? { rationale: cand.rationale } : {}),
          changedFiles: rec?.changedFiles ?? [],
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
          armProvenance: rec?.armProvenance ?? null,
          diffPath: rec?.diffPath ?? null,
          diffSha256: rec?.diffSha256 ?? null,
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
    const winnerRec = winnerCs ? recorder.byCommit(winnerCs.candidateCommit) : undefined
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
      // run's MEASURED baseline record, kept for drift/cost forensics.
      pinnedBaseline: config.pinnedBaseline ?? null,
      pinnedBaselineResolvedCount: pinnedCount,
      baseline: baseRec
        ? { resolvedCount: resolvedCount(baseRec), wallS: sumWall(baseRec), perInstance: [...baseRec.instances.values()] }
        : null,
      winner: winnerCs
        ? {
            surfaceHash: surfaceHash(winnerCs),
            commit: winnerCs.candidateCommit,
            label: result.raw.winner.label ?? null,
            rationale: result.raw.winner.rationale ?? null,
            patch: winnerPatch,
          }
        : null,
      gateDecision: result.decision,
      gateReasons: loop.gateResult.reasons,
      lift: result.lift,
      proposerCostUsd: result.raw.totalCostUsd,
      holdout: { instances: config.holdoutInstances, status: 'operator-approval-required' },
    }
    const summaryPath = join(config.roundsDir, `round${config.round}-summary-${runId}.json`)
    await writeFile(summaryPath, JSON.stringify(summary, null, 2))
    log(`round summary → ${summaryPath}`)
    log(`gate: ${result.decision} — ${loop.gateResult.reasons[0] ?? ''}`)
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
