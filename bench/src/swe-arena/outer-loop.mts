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
 *  (d) ACCEPT/REJECT — keep-if-better per protocol_v2. The loop NEVER ships:
 *      `budget.holdout: 'deferred'` makes the lib dispatch zero holdout
 *      cells, force `hold`, and omit `lift` — the pre-registered 6-instance
 *      holdout costs real money and runs only in a separate, operator-
 *      approved run. The would-be-KEEP operator brief is computed post-run
 *      from campaign cells; every candidate + verdict persists as staircase
 *      rows in `<roundsDir>/gen-<N>.jsonl`.
 *
 * BASELINE: the gate's only denominator is the stored premeasured baseline
 * artifact ({surfaceHash, campaign}) that the lib validates (surface hash,
 * seed, reps, split digest, coverage) before skipping the baseline campaign.
 * A missing artifact = the bootstrap run: the baseline is measured
 * (cache-resumable) and the artifact written for every later run.
 * capabilities.mts fails loud on a stale substrate install that would
 * silently drop the passthrough.
 *
 * SCORING SOURCE: operator-brief evidence + staircase rows derive from the
 * LIB's campaign cells (`improve()` result campaigns in memory; the per-cell
 * `cached-result.json` caches on disk survive resume) — see cell-evidence.mts.
 * The in-process RoundRecorder is dispatch-time only: fail-closed
 * change-space enforcement + candidate diff writing. It is NOT a scoring
 * source — that recorder role mislabeled a resumed run's baseline
 * (r4-mroh3rkt) because cached cells replay without dispatching.
 *
 * Immutable per protocol_v2 (enforced, not advisory): judge + verify scripts,
 * task prompts, model ids, budgets. `assertFrozenArm` pins the arm to the
 * round-3 values; the serialized judge enforces its own 1800s floor; the
 * change space keeps candidates inside extensions/pi/** and the three named
 * src files (plus the `.improve/` raw-trace diagnosis artifact the agentic
 * generator's evidence gate requires).
 */

import { appendFile, mkdir, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
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
  type JudgeConfig,
  type MutableSurface,
  type PremeasuredOptimizationBaseline,
  type Scenario,
} from '@tangle-network/agent-eval/campaign'
import type { CostLedgerHandle } from '@tangle-network/agent-eval'
import { createSweBenchAdapter } from '../benchmarks/swe-bench.ts'
import {
  baselineDriftWarnings,
  cellsFromCampaign,
  gateEvidenceFromCells,
  instanceVerdictsFromCells,
  loadCampaignCells,
  perInstanceFromCells,
  replicateCoverageComplete,
  replicateRunsFromCells,
  resolvedInstanceCount,
  sumWallSFromCells,
  decideVerdict,
  type R4Artifact,
  type StaircasePerInstance,
  type StaircaseVerdict,
} from './cell-evidence.mts'
import { assertSubstratePassthroughs } from './capabilities.mts'
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
import {
  defaultProposers,
  fanOutLoopsGenerator,
  materializeParetoParents,
  proposerShotHooks,
  type ParetoParentContext,
  type ParetoParentSeed,
  type PrefilterConfig,
  type PrefilterKill,
  type ProposerSpec,
  type SmokeRunner,
  type SmokeVerdict,
} from './proposer-fanout.mts'
import { captureProposerProvenance } from './proposer-provenance.mts'
import { CRASH_ORPHAN_REASON, reconcileCrashOrphansOnDisk } from './ledger-orphans.mts'
import {
  AUTHOR_BRIEFING_VERSION,
  resolveAuthorBriefing,
  writeEvidenceIndex,
  type BriefingContext,
} from './briefing.mts'
import {
  readCommittedPredicate,
  runActivationPredicate,
  ACTIVATION_PREDICATE_RELPATH,
  type ActivationRecord,
} from './activation.mts'
import {
  loadOrCreateScoreSplit,
  subScores,
  type ScoreSplit,
  type ScoreSplitConfig,
} from './score-split.mts'
import { recordLineageGeneration, type LineageCandidateInput } from './lineage-record.mts'
import {
  campaignCoordsFromCellPath,
  createSettleCapture,
  type SettleCapture,
} from '../rollout-ledger/settle-capture.mts'
import { findSupervisorRunDir } from './arms.ts'
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
  instanceVerdictsFromCells,
  loadCampaignCells,
  loadCandidateCellGroups,
  perInstanceFromCells,
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
  /** Present only on `rejected-prefilter` dots: which pre-filter stage killed
   *  the candidate and why (e.g. `smoke: pallets__flask-5014 unresolved`). */
  killReason?: string
  holdout: 'operator-approval-required' | 'not-run'
  armProvenance: { repo: string; commit: string } | null
  diffPath: string | null
  diffSha256: string | null
  /** GEN-5 public/private sub-scores (selection stays on the combined count;
   *  the private sub-score is never surfaced to proposers). */
  split?: {
    publicInstances: string[]
    privateInstances: string[]
    publicResolvedCount: number
    privateResolvedCount: number
  }
  /** GEN-5 activation-gate outcome for this candidate. */
  activation?: ActivationRecord
}

const STAIRCASE_VERDICTS: ReadonlySet<string> = new Set([
  'accepted',
  'rejected-no-gain',
  'rejected-cost',
  'rejected-out-of-space',
  'rejected-incomplete',
  'rejected-prefilter',
  'quarantined-inactive',
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
  /** Stored `PremeasuredOptimizationBaseline` JSON ({surfaceHash, campaign})
   *  from a prior run's baseline campaign — REQUIRED, the gate's only
   *  denominator. The LIB validates the artifact (surface hash, seed, reps,
   *  split digest, coverage) before skipping the baseline campaign, so a
   *  wrong artifact fails loud at t≈0. BOOTSTRAP: when the file does not
   *  exist yet, this run MEASURES the baseline (cache-resumable) and WRITES
   *  the artifact here for every later run to consume. */
  premeasuredBaselinePath: string
  /** DEPTH for the agentic generator — forwarded as
   *  budget.maxImprovementShots; the LIB owns the dial (capabilities.mts
   *  fails loud on a substrate that would drop it). */
  maxShots: number
  proposerHarness: 'claude' | 'codex' | 'opencode'
  proposerTimeoutMs: number
  /** GEN-3 proposer fan-out: N proposers author candidates CONCURRENTLY, each
   *  an AgentProfile-pinned harness invocation (see proposer-fanout.mts).
   *  When set, `populationSize` MUST equal `proposers.length` (one candidate
   *  slot per proposer — enforced at launch). Unset = the legacy
   *  single-author generator (`proposerHarness` + bare invocation).
   *  GEN-6: a spec with `engine` set is a GEPA seat (gepa-seat.mts) — the
   *  agent-eval external-GEPA adapter optimizes ONE change-space file as a
   *  string against the pre-filter smoke cell; requires `prefilter.enabled`. */
  proposers?: ProposerSpec[]
  /** GEN-3 cheap pre-filter: per candidate, change-space + tsc (the authoring
   *  verifier) plus ONE smoke arm cell before any full-evaluation spend.
   *  Killed candidates become `rejected-prefilter` staircase dots. */
  prefilter?: PrefilterConfig
  /** GEN-4 Pareto parents: prior-run frontier candidates (loops commits +
   *  measured per-instance results) seeded into every author's prompt and
   *  the merge seat's explicit input. Seeded at OUR buildPrompt seam, not the
   *  lib's `ctx.paretoParents` — the lib frontier is within-run only and a
   *  prior campaign cannot be injected without its runDir + ledger receipts
   *  (see proposer-fanout.mts). */
  paretoParents?: ParetoParentSeed[]
  /** Replicates per holdout instance in the operator-approved certification
   *  run (holdout-certify.mts). Default 2 — the gen-2 winner failed 3/6 vs
   *  4/6 on a 1-rep holdout with exactly one discordant cell, a known
   *  single-rep noise class. */
  holdoutRepsPerInstance?: number
  /** SAME-PROTOCOL parent measurement the certification bar compares against:
   *  an explicit {iid -> AND-verdict} map measured under the identical
   *  reps/fail-closed protocol, or 'measure' — the incumbent runs the same
   *  2-rep holdout first in the certification run. */
  holdoutBaseline?: Record<string, boolean> | 'measure'
  /** GEN-5 public/private score split (score-split.mts): proposers + the
   *  pre-filter see only PUBLIC instances' scores/evidence; selection stays
   *  on the combined set. Unset = everything public (pre-gen-5 behavior). */
  scoreSplit?: ScoreSplitConfig
  /** GEN-5 MAP+TOOLBOX briefing (briefing.mts): write the per-run evidence
   *  index and append the toolbox/permission briefing (change-space
   *  overridable) to every author prompt. */
  briefing?: typeof AUTHOR_BRIEFING_VERSION
  /** GEN-5 activation gate (activation.mts): require a machine-checkable
   *  activation predicate per candidate (prefilter-enforced) and quarantine
   *  candidates whose mechanism never fired in their own campaign traces. */
  activationGate?: boolean
  /** GEN-5 settle-time rollout-ledger capture (rollout-ledger/settle-capture.mts):
   *  emit tangle.rollout.v1 lines live after each cell judges, with label-v2
   *  rewards. Default path: <outDir>/rollout-ledger.jsonl. */
  rolloutLedger?: { enabled: boolean; path?: string; opencodeDb?: string }
  /** GEN-5 lineage DAG (lineage-record.mts): record every candidate as a
   *  LineageNode at <outDir>/.evolve/lineage.jsonl and put the governor's
   *  continuation decision in the round summary. */
  lineage?: boolean
  /** GEN-5 evidence map: prior run outDirs whose arm-runs/judge/candidate
   *  evidence the authors may mine (rendered into the evidence index). */
  priorEvidenceDirs?: string[]
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
    // The reps-confirmed baseline artifact (gen-1 measured: astropy F/F,
    // django T/F → F fail-closed, matplotlib T/T = 1/3) lives here once the
    // bootstrap run writes it; the lib validates it on every consumption.
    premeasuredBaselinePath: join(hh, 'r4', 'premeasured-baseline.json'),
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
// GEN-3 configuration — proposer fan-out + pre-filter + the widened
// improvement set + the 2-rep holdout protocol.
// ---------------------------------------------------------------------------

/** The gen-3 improvement set: the round-3 trio plus the three BOTH-FAIL
 *  instances from the original head-to-head (solo glm-5.2 ALSO failed them —
 *  any resolution beats solo, not just the parent). All six carry committed,
 *  dual-calibrated verify fixtures (repro base-fail/gold-pass + gold
 *  official-resolved). */
export const GEN3_IMPROVEMENT_SET = [
  'astropy__astropy-13033',
  'django__django-11532',
  'matplotlib__matplotlib-20826',
  'pydata__xarray-4687',
  'pytest-dev__pytest-6197',
  'sphinx-doc__sphinx-9658',
] as const

/** Never-registered spare pool, pre-named in case a gen-3 instance has to be
 *  replaced (calibration regression, image loss). */
export const GEN3_SPARE_POOL = [
  'sympy__sympy-17318',
  'scikit-learn__scikit-learn-14087',
  'astropy__astropy-14508',
] as const

/** Resolve the pre-filter smoke instance. 'cheapest-of-set' picks the
 *  improvement-set instance with the smallest summed baseline wall seconds
 *  (from the premeasured artifact's cells); with no baseline measurement yet
 *  it falls back to the first instance. An explicit iid passes through. */
export function resolveSmokeInstance(
  smokeInstance: string,
  instances: readonly string[],
  baselineCells: import('./cell-evidence.mts').EvidenceCell[] | null,
): string {
  if (smokeInstance !== 'cheapest-of-set') return smokeInstance
  if (instances.length === 0) throw new Error('resolveSmokeInstance: empty improvement set')
  if (baselineCells === null || baselineCells.length === 0) return instances[0]!
  const wall = new Map<string, number>()
  for (const cell of baselineCells) {
    if (cell.artifact === null || cell.artifact.kind !== 'swe-arm') continue
    wall.set(cell.scenarioId, (wall.get(cell.scenarioId) ?? 0) + cell.artifact.wallS)
  }
  let best: string | null = null
  let bestWall = Number.POSITIVE_INFINITY
  for (const iid of instances) {
    const w = wall.get(iid)
    if (w !== undefined && w < bestWall) {
      best = iid
      bestWall = w
    }
  }
  return best ?? instances[0]!
}

/**
 * The gen-3 config: protocol round 4 continues (frozen arm, same holdout
 * registry, same roundsDir staircase) with the gen-3 machinery on:
 *
 *  - THREE parallel proposers (all claude, bare default-author profile) that
 *    differ by diagnosis slice/lens — fan-out diversity without unproven
 *    harness seats; `populationSize` = `proposers.length`.
 *  - Pre-filter enabled at the mechanism bar on the cheapest-of-set smoke
 *    instance ('pallets__flask-5014' becomes the designated smoke once its
 *    verify fixture is authored + calibrated; it has none committed yet).
 *  - The 6-instance improvement set. The premeasured-baseline artifact path
 *    is NEW (gen3/): the lib validates a premeasured campaign against the
 *    FULL scenario split digest, so the 3-instance round-4 artifact cannot
 *    seed a 6-instance split — the first gen-3 run is the bootstrap that
 *    measures all six (cache-resumable) and writes the artifact; the three
 *    new instances are thereby measured on the first round.
 *  - Holdout protocol pinned at 2 reps, parent measured under the SAME
 *    protocol ('measure'), operator valve unchanged (holdout: 'deferred').
 */
export function defaultGen3Config(
  hh = DEFAULT_HH_SCRATCHPAD,
  opts: { outDirName?: string } = {},
): OuterLoopConfig {
  const base = defaultRound4Config(hh, opts)
  const outDirName = opts.outDirName ?? 'gen3'
  const proposers: ProposerSpec[] = [
    { name: 'default-author', profile: 'default-author.profile.json', harness: 'claude' },
    {
      name: 'mechanics-author',
      profile: 'default-author.profile.json',
      harness: 'claude',
      diagnosisSlice: 'mechanics',
      lens: 'Focus on MECHANICS: worker lifecycle, sandbox/clone contracts, settlement and delivery paths. Prefer code-path fixes over prompt wording.',
    },
    {
      name: 'prompts-author',
      profile: 'default-author.profile.json',
      harness: 'claude',
      diagnosisSlice: 'prompts',
      lens: 'Focus on PROMPTS: worker/brain instruction wording, placement guidance, self-check discipline. Prefer prompt/instruction changes over code-path rewrites.',
    },
  ]
  return {
    ...base,
    instances: [...GEN3_IMPROVEMENT_SET],
    outDir: join(hh, outDirName),
    premeasuredBaselinePath: join(hh, outDirName, 'premeasured-baseline.json'),
    populationSize: proposers.length,
    proposers,
    prefilter: { enabled: true, smokeInstance: 'cheapest-of-set', requireResolved: false },
    holdoutRepsPerInstance: 2,
    holdoutBaseline: 'measure',
  }
}

// ---------------------------------------------------------------------------
// GEN-4 configuration — pinned per-proposer models (recorded in provenance),
// Pareto-parent seeding from the gen-3 frontier, and a dedicated merge seat.
// ---------------------------------------------------------------------------

/** The gen-3 frontier (run r4-mrwc0awe): winner + runner-up, both 2/6 vs the
 *  1/6 baseline on DIFFERENT instances — complementary lessons, the merge
 *  seat's input. Per-instance verdicts are the fail-closed all-reps values
 *  from `.evolve/rounds/gen-0.jsonl`. */
export const GEN3_PARETO_PARENTS: ParetoParentSeed[] = [
  {
    commit: 'cc0d95584c7ea14324cd57c21fe946c7c0f53827',
    label: 'default-author',
    resolvedInstances: ['pydata__xarray-4687', 'sphinx-doc__sphinx-9658'],
    note:
      'mechanical patch-risk scan (patchRiskWarnings in src/worker-evidence.ts, threaded through ' +
      'extensions/pi/loops.ts) + never-reword / test-seam / run-the-neighbors worker rules + 3-check ' +
      'reviewer; pytest-dev__pytest-6197 split 0/1 across reps (near-miss)',
  },
  {
    commit: 'a7a2a982e51551de3a8e796ee2efc448ed405e6a',
    label: 'prompts-author',
    resolvedInstances: ['django__django-11532', 'pydata__xarray-4687'],
    note:
      'prompt-only: hidden-suite bullet in the supervisor GOAL-authoring section (the django seam), ' +
      'frozen-behavior worker section + run-the-repo-tests discipline, 2-check reviewer; ' +
      'sphinx-doc__sphinx-9658 split 0/1 across reps (near-miss)',
  },
]

/**
 * The gen-4 config: protocol round 4 continues (frozen arm, same holdout
 * registry, same roundsDir staircase) with three changes as a unit:
 *
 *  1. PINNED PER-PROPOSER MODELS — four seats: claude-author (claude CLI on
 *     its own login; the resolved model + CLI version are captured into
 *     `<outDir>/proposer-provenance.json` at t=0), glm-author (opencode
 *     pinned to zai-coding-plan/glm-5.2 via `-m`), codex-author (codex CLI on
 *     its ChatGPT login, auth provenance-gated at launch; drop the seat via
 *     `includeCodex: false` when the CLI is absent), and merge-author (claude,
 *     merge seat).
 *  2. PARETO PARENTS — the gen-3 winner + runner-up diffs and their measured
 *     per-instance results seed every author's prompt; the merge seat's task
 *     is their coherent union. Seeded at the buildPrompt seam (our seam): the
 *     lib's `ctx.paretoParents` frontier is within-run only, and a prior
 *     campaign cannot cross runs without its runDir + ledger receipts.
 *  3. PINNED BASELINE — the premeasured artifact at `hh/gen4/` is BUILT from
 *     gen-3's measured baseline cells (premeasured-from-cells.mts; gen-3
 *     measured astropy F, django F, matplotlib F, xarray F, pytest F,
 *     sphinx T — matplotlib/django false under current weather), so gen-4
 *     spends nothing re-measuring and fails loud if the loops tip moved.
 */
export function defaultGen4Config(
  hh = DEFAULT_HH_SCRATCHPAD,
  opts: { outDirName?: string; includeCodex?: boolean } = {},
): OuterLoopConfig {
  const base = defaultGen3Config(hh, { outDirName: opts.outDirName ?? 'gen4' })
  const proposers: ProposerSpec[] = [
    { name: 'claude-author', profile: 'default-author.profile.json', harness: 'claude' },
    { name: 'glm-author', harness: 'opencode', model: 'zai-coding-plan/glm-5.2' },
    ...(opts.includeCodex === false ? [] : [{ name: 'codex-author', harness: 'codex' } satisfies ProposerSpec]),
    { name: 'merge-author', profile: 'default-author.profile.json', harness: 'claude', merge: true },
  ]
  return {
    ...base,
    populationSize: proposers.length,
    proposers,
    paretoParents: [...GEN3_PARETO_PARENTS],
  }
}

// ---------------------------------------------------------------------------
// GEN-5 configuration — gen-4's shape (4 proposers incl. the merge seat,
// Pareto parents, premeasured baseline carried forward per the same
// cell-derivation, 2 reps, deferred holdout) PLUS the gen-5 integration
// bundle as a unit:
//
//  1. MAP+TOOLBOX briefing — per-run evidence index + toolbox/permission
//     briefing (change-space overridable at extensions/pi/author-briefing.md);
//     the 3-analyst diagnosis stays as ONE input among the named tools.
//  2. PUBLIC/PRIVATE SPLIT — 4 public / 2 private of the 6 instances,
//     deterministically seeded by runId and persisted per outDir; proposers +
//     prefilter see public only, selection stays combined. Small-n caveat
//     documented in score-split.mts.
//  3. ACTIVATION GATE — required machine-checkable predicate per candidate;
//     never-fired mechanisms are quarantined even on an improved score.
//  4. SETTLE-TIME ROLLOUT LEDGER — tangle.rollout.v1 lines live per cell,
//     label v2 (contribution-aware workers, baseline-relative proposers).
//  5. LINEAGE DAG — agent-eval Lineage at <outDir>/.evolve/lineage.jsonl +
//     governor continuation decision in the round summary; staircase rows
//     unchanged (observatory contract).
// ---------------------------------------------------------------------------

export function defaultGen5Config(
  hh = DEFAULT_HH_SCRATCHPAD,
  opts: { outDirName?: string; includeCodex?: boolean } = {},
): OuterLoopConfig {
  const base = defaultGen4Config(hh, {
    outDirName: opts.outDirName ?? 'gen5',
    ...(opts.includeCodex !== undefined ? { includeCodex: opts.includeCodex } : {}),
  })
  return {
    ...base,
    scoreSplit: { publicCount: 4 },
    briefing: AUTHOR_BRIEFING_VERSION,
    activationGate: true,
    rolloutLedger: { enabled: true },
    lineage: true,
    priorEvidenceDirs: [join(hh, 'gen4'), join(hh, 'gen3')],
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

/** Same failure class for the gen-4 codex seat: agent-state.env injects an
 *  OPENAI_API_KEY meant for other tooling, and the codex CLI prefers env-key
 *  auth over its ChatGPT login. The codex author shot must run on the CLI's
 *  own login (`codex login status` is provenance-gated at launch), so the
 *  leaked auth is stripped for the shot subprocess only. */
const CODEX_AMBIENT_AUTH_VARS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'] as const

export function proposerShotEnv(harness: OuterLoopConfig['proposerHarness']): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (harness === 'claude') {
    for (const name of CLAUDE_AMBIENT_AUTH_VARS) delete env[name]
  }
  if (harness === 'codex') {
    for (const name of CODEX_AMBIENT_AUTH_VARS) delete env[name]
  }
  return env
}

export function constrainedLoopsGenerator(config: OuterLoopConfig): CandidateGenerator {
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
    // names its cause from disk. Shared implementation with the gen-3 fan-out
    // authors (proposer-fanout.mts): receipt persistence + spend settlement
    // into the run ledger for the claude/opencode paths whose shots would
    // otherwise read $0.
    onShotCompleted: proposerShotHooks({
      shotDir,
      harness: config.proposerHarness,
      ledger: () => activeLedger,
      phase: () => activePhase,
    }),
  })
  return {
    kind: `round4-constrained:${inner.kind}`,
    proposesWithoutFindings: true,
    generate: (args) => {
      activeLedger = args.costLedger
      activePhase = args.costPhase
      // args.maxShots is the LIB's dial (budget.maxImprovementShots → the
      // improvement driver); capabilities.mts guarantees it is threaded.
      return inner.generate(args)
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
  if (config.proposers !== undefined) {
    if (config.proposers.length === 0) throw new Error('outer-loop: config.proposers must not be empty when set')
    if (config.proposers.length !== config.populationSize) {
      throw new Error(
        `outer-loop: populationSize ${config.populationSize} != proposers.length ${config.proposers.length} — ` +
          'the fan-out assigns exactly one candidate slot per proposer',
      )
    }
  }
  // Stale-install guard: the resolved substrate must thread the passthroughs
  // this run depends on. Fails loud — a silent drop would re-spend the
  // premeasured baseline and pin the depth dial (see capabilities.mts).
  assertSubstratePassthroughs(log)

  // GEN-4 model-identity provenance at t=0: harness CLI versions, the claude
  // seat's resolved settings model, codex auth, and every explicit model pin.
  // Fails loud on a missing/unauthed harness binary — populationSize equals
  // proposers.length, so a dead seat cannot be skipped mid-run.
  if (config.proposers !== undefined) {
    const provenance = await captureProposerProvenance(config.proposers)
    await mkdir(config.outDir, { recursive: true })
    await writeFile(join(config.outDir, 'proposer-provenance.json'), JSON.stringify(provenance, null, 2))
    for (const p of provenance.proposers) {
      log(
        `proposer ${p.name} (${p.harness}${p.merge ? ', merge seat' : ''}): ` +
          `model=${p.pinnedModel ?? `cli-default${p.settingsModel ? `:${p.settingsModel}` : ''}`} ` +
          `version=${p.harnessVersion.split('\n')[0]}`,
      )
    }
  }

  // GEN-4 Pareto parents: materialize the configured prior-run frontier
  // (commit existence + full diffs) before any authoring.
  const paretoParents: ParetoParentContext[] =
    config.paretoParents !== undefined && config.paretoParents.length > 0
      ? await materializeParetoParents(config.loopsRepo, config.paretoParents)
      : []
  if (paretoParents.length > 0) {
    log(`pareto parents: ${paretoParents.map((p) => `${p.label}@${p.commit.slice(0, 10)}`).join(', ')}`)
  }

  // The gate's only denominator: a stored prior baseline campaign the LIB
  // validates (surface hash, seed, reps, split digest, coverage) before
  // skipping the baseline campaign. A missing artifact = the BOOTSTRAP run —
  // the baseline is measured (cache-resumable) and the artifact written at
  // the end of this run.
  if (typeof config.premeasuredBaselinePath !== 'string' || config.premeasuredBaselinePath.length === 0) {
    throw new Error('outer-loop: config.premeasuredBaselinePath is required (the bootstrap run writes the artifact there)')
  }
  let premeasured: PremeasuredOptimizationBaseline<R4Artifact, Scenario> | undefined
  if (existsSync(config.premeasuredBaselinePath)) {
    premeasured = JSON.parse(
      await readFile(config.premeasuredBaselinePath, 'utf8'),
    ) as PremeasuredOptimizationBaseline<R4Artifact, Scenario>
    if (!premeasured || typeof premeasured.surfaceHash !== 'string' || !premeasured.campaign) {
      throw new Error(`premeasuredBaselinePath: ${config.premeasuredBaselinePath} is not a {surfaceHash, campaign} record`)
    }
    log(`premeasured baseline: ${config.premeasuredBaselinePath} (surface ${premeasured.surfaceHash})`)
  } else {
    log(
      `premeasured baseline artifact missing at ${config.premeasuredBaselinePath} — BOOTSTRAP run: ` +
        'the baseline campaign will be measured (cache-resumable) and the artifact written there for later runs',
    )
  }

  const secrets: SecretsEnv = { secretsDir: config.secretsDir, envFiles: config.envFiles }
  const excludes = await loadExcludes()
  const images = await loadInstanceImages(config.instanceImagesPath)
  const adapter = createSweBenchAdapter()
  const runId = `r${config.round}-${Date.now().toString(36)}`
  await mkdir(config.outDir, { recursive: true })

  // GEN-5 public/private split — deterministic (seeded by runId), PERSISTED
  // per outDir so a resume can never rotate private instances into view.
  // Scored identically; selection stays combined; proposers + prefilter see
  // public only.
  const split: ScoreSplit | null =
    config.scoreSplit !== undefined
      ? await loadOrCreateScoreSplit({
          outDir: config.outDir,
          runId,
          instances: config.instances,
          publicCount: config.scoreSplit.publicCount,
        })
      : null
  const privateIids = new Set(split?.privateInstances ?? [])
  if (split !== null) {
    log(
      `score split (seeded by ${split.seededBy}): public [${split.publicInstances.join(', ')}] + ` +
        `${split.privateInstances.length} private instance(s) (identities withheld from proposers; ` +
        `selection uses public+private combined; small-n caveat: 2 private of 6 is a direction check, not certification)`,
    )
  }

  // The pre-filter's smoke instance may sit outside the improvement set (e.g.
  // a designated cheap instance) — it needs the same problem/image/verify
  // validation and rides the same loaded-task map. Under the gen-5 split the
  // smoke choice is restricted to PUBLIC instances (the prefilter surfaces
  // its verdict to the kill log the authors can mine).
  const smokeIid =
    config.proposers !== undefined && config.prefilter?.enabled
      ? resolveSmokeInstance(
          config.prefilter.smokeInstance,
          split !== null ? split.publicInstances : config.instances,
          premeasured ? cellsFromCampaign(premeasured.campaign) : null,
        )
      : null
  const taskIds = [...new Set([...config.instances, ...(smokeIid !== null ? [smokeIid] : [])])]
  const tasks = await adapter.loadTasks({ ids: taskIds, split: 'test' })
  const problemById = new Map<string, string>()
  for (const iid of taskIds) {
    const task = tasks.find((t) => t.id === iid)
    if (!task) throw new Error(`outer-loop: ${iid} not found in SWE-bench_Verified`)
    const problem = String(task.metadata?.problem_statement ?? '')
    if (!problem) throw new Error(`outer-loop: ${iid} has an empty problem_statement`)
    if (!images[iid]) throw new Error(`outer-loop: ${iid} has no image mapping`)
    const verifyScript = join(config.verifyDir, `${iid}.sh`)
    if (!existsSync(verifyScript)) throw new Error(`outer-loop: missing verify script ${verifyScript}`)
    problemById.set(iid, problem)
  }
  if (smokeIid !== null) log(`prefilter smoke instance: ${smokeIid}`)

  const judge: SerializedJudge = createSerializedJudge(
    config.judgeTimeoutMs !== undefined ? { timeoutMs: config.judgeTimeoutMs } : {},
  )
  await mkdir(config.roundsDir, { recursive: true })
  const recorder = new RoundRecorder(config.loopsRepo, join(config.outDir, 'candidates'))
  const analysts: AnalystSpec[] = config.analystModels.map((model, i) => ({ id: `${model}#${i + 1}`, model }))

  // GEN-5 MAP+TOOLBOX briefing: persist the Pareto parent diffs, write the
  // per-run evidence index (a map — one line per evidence path, private
  // instances excluded), and resolve the briefing text (the change-space
  // override at extensions/pi/author-briefing.md wins over the default).
  let briefingCtx: BriefingContext | undefined
  if (config.briefing === AUTHOR_BRIEFING_VERSION) {
    const parentPatches: Array<{ label: string; path: string }> = []
    if (paretoParents.length > 0) {
      const parentsDir = join(config.outDir, 'pareto-parents')
      await mkdir(parentsDir, { recursive: true })
      for (const parent of paretoParents) {
        const patchPath = join(parentsDir, `${parent.label}.patch`)
        await writeFile(patchPath, parent.diff)
        parentPatches.push({ label: parent.label, path: patchPath })
      }
    }
    const index = await writeEvidenceIndex({
      outDir: config.outDir,
      roundsDir: config.roundsDir,
      seedArtifactRuns: config.seedArtifactRuns,
      ...(config.priorEvidenceDirs !== undefined ? { priorEvidenceDirs: config.priorEvidenceDirs } : {}),
      paretoParentPatches: parentPatches,
      split,
    })
    const briefing = await resolveAuthorBriefing(config.loopsRepo, config.loopsBaseRef)
    briefingCtx = { indexPath: index.path, briefingText: briefing.text, briefingSource: briefing.source }
    log(
      `briefing ${AUTHOR_BRIEFING_VERSION}: evidence index → ${index.path} (${index.rows.length} row(s)); ` +
        `briefing text source: ${briefing.source}`,
    )
  }

  // GEN-5 settle-time rollout ledger — tangle.rollout.v1 lines appended live
  // after each cell judges (label v2); capture failure logs loud but never
  // kills a cell.
  const settleCapture: SettleCapture | null =
    config.rolloutLedger?.enabled === true
      ? createSettleCapture({
          ledgerPath: config.rolloutLedger.path ?? join(config.outDir, 'rollout-ledger.jsonl'),
          runId,
          instanceCount: config.instances.length,
          ...(config.rolloutLedger.opencodeDb !== undefined ? { opencodeDb: config.rolloutLedger.opencodeDb } : {}),
          log,
        })
      : null
  if (settleCapture !== null) log(`rollout-ledger: settle-time capture ON → ${settleCapture.path}`)

  const sweScenarios: Scenario[] = config.instances.map((iid) => ({ id: iid, kind: 'swe-instance' }))

  // Capacity gates on BOTH paths the supervisor arm rides (worker + router).
  // Shared by every arm dispatch — the improvement cells AND the pre-filter
  // smoke cell. A cell's WORK clock (config.dispatchTimeoutMs) starts only
  // after these clear — a capacity hold is never billed to the work budget.
  const awaitGates = async (): Promise<void> => {
    for (const gate of gatesForArmKind('supervisor', secrets, {
      ...(config.gateWaitCeilingMs !== undefined ? { waitCeilingMs: config.gateWaitCeilingMs } : {}),
      ...(config.capacityModel !== undefined ? { model: config.capacityModel } : {}),
      onStatus: log,
    })) {
      if (!(await waitForCapacity(gate))) throw new Error(`no capacity on ${gate.name} within ceiling`)
    }
  }

  // ── the pre-filter smoke runner: ONE supervisor arm cell + official judge
  // on the smoke instance, run against the proposer's scratch worktree BEFORE
  // any full-evaluation spend. A crashed smoke KILLS the candidate (recorded
  // in the kill reason) rather than the round — the pre-filter is allowed to
  // be strict; a survivor still faces the full gate. ────────────────────
  const smokeRunner: SmokeRunner | undefined =
    smokeIid === null
      ? undefined
      : async ({ scratchPath, generation, proposer, costLedger }): Promise<SmokeVerdict> => {
          const iid = smokeIid
          const requireResolved = config.prefilter?.requireResolved === true
          const entry = images[iid]!
          const armOutDir = join(config.outDir, 'prefilter-smoke', `gen${generation}-${proposer.name}`)
          const nm = join(scratchPath, 'node_modules')
          let linked = false
          const t0 = Date.now()
          try {
            if (!existsSync(nm)) {
              await symlink(join(config.loopsRepo, 'node_modules'), nm, 'dir')
              linked = true
            }
            const work = async (): Promise<{ armRes: SupervisorArmResult; resolved: boolean | null }> => {
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
                loopsRepo: scratchPath,
                extensionPath: join(scratchPath, 'extensions', 'pi', 'loops.ts'),
                timeoutMs: config.arm.timeoutMs,
              }
              log(`>>> prefilter smoke ${proposer.name} ${iid} gen=${generation}`)
              const armRes = await runSupervisorArm(spec, {
                instanceId: iid,
                image: entry.image,
                baseCommit: entry.base_commit,
                problemStatement: problemById.get(iid)!,
                verifyCmd: `bash ${join(config.verifyDir, `${iid}.sh`)}`,
                outDir: armOutDir,
                secrets,
                excludes,
              })
              const verdict = await judge.judge(iid, armRes.patchPath, `prefilter-g${generation}-${proposer.name}`)
              return { armRes, resolved: verdict.resolved }
            }
            const runWork = (): Promise<{ armRes: SupervisorArmResult; resolved: boolean | null }> =>
              runWithPostGateClock({
                awaitGates,
                work,
                timeoutMs: config.dispatchTimeoutMs,
                label: `prefilter smoke ${proposer.name} ${iid}`,
              })
            let outcome: { armRes: SupervisorArmResult; resolved: boolean | null }
            if (costLedger) {
              // The smoke's real arm spend reaches the run ledger like any cell.
              const paid = await costLedger.runPaidCall({
                channel: 'agent',
                phase: 'search.prefilter',
                actor: `prefilter-smoke:${iid}:g${generation}:${proposer.name}`,
                model: config.arm.workerModel,
                execute: runWork,
                receipt: ({ armRes }) => {
                  const spend = armRes.recoveredSpend
                  const usageKnown = (spend?.workerTokIn ?? null) !== null || (spend?.workerTokOut ?? null) !== null
                  return {
                    model: config.arm.workerModel,
                    inputTokens: spend?.workerTokIn ?? 0,
                    outputTokens: spend?.workerTokOut ?? 0,
                    ...(usageKnown ? {} : { usageUnknown: true }),
                    ...(armRes.spentUsd !== null ? { actualCostUsd: armRes.spentUsd } : {}),
                  }
                },
              })
              if (!paid.succeeded) throw paid.error
              outcome = paid.value
            } else {
              outcome = await runWork()
            }
            const wallS = Math.round((Date.now() - t0) / 1000)
            const patchDelivered = outcome.armRes.patch_lines > 0
            const conclusive = outcome.resolved !== null
            const pass = requireResolved ? outcome.resolved === true : patchDelivered && conclusive
            const verdictLine =
              `smoke ${iid}: resolved=${outcome.resolved} patch_lines=${outcome.armRes.patch_lines} ` +
              `verify_pass=${outcome.armRes.verify_pass} wall_s=${outcome.armRes.wall_s}`
            const result: SmokeVerdict = {
              iid,
              pass,
              reason: pass
                ? verdictLine
                : `${verdictLine} — below the ${requireResolved ? 'resolved' : 'mechanism (patch + conclusive judge)'} bar`,
              resolved: outcome.resolved,
              patchLines: outcome.armRes.patch_lines,
              wallS,
              // GEN-6: the GEPA seat's inner-score tiebreak.
              verifyPass: outcome.armRes.verify_pass,
            }
            await mkdir(armOutDir, { recursive: true })
            await writeFile(join(armOutDir, 'smoke.json'), JSON.stringify(result, null, 2))
            return result
          } catch (cause) {
            const wallS = Math.round((Date.now() - t0) / 1000)
            const result: SmokeVerdict = {
              iid,
              pass: false,
              reason: `smoke errored: ${(cause as Error).message}`,
              resolved: null,
              patchLines: 0,
              wallS,
            }
            await mkdir(armOutDir, { recursive: true })
            await writeFile(join(armOutDir, 'smoke.json'), JSON.stringify(result, null, 2)).catch(() => {})
            return result
          } finally {
            if (linked) await unlink(nm).catch(() => {})
          }
        }

  // ── dispatch: one (surface × scenario) cell ──────────────────────────
  const agent = async (surface: MutableSurface, scenario: Scenario, ctx: DispatchContext): Promise<R4Artifact> => {
    const cs = asCodeSurface(surface)
    const rec = await recorder.ensure(cs)

    const iid = scenario.id
    // FAIL-CLOSED change-space enforcement: an out-of-space candidate must
    // never reach a model token or a docker container. The thrown cell is the
    // record (the lib stores it with `error` set — no side bookkeeping).
    if (rec.violations.length > 0) {
      throw new Error(`change-space violation (${rec.violations.length} path(s)): ${rec.violations.join(', ')}`)
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
        const summaryPath = await ctx.artifacts.writeJson('arm-summary.json', {
          runDir,
          patchPath: armRes.patchPath,
          verdict,
        })

        // GEN-5 settle-time rollout capture: emit supervisor + worker lines
        // NOW, while the opencode store still holds the worker transcripts.
        // Attribution comes from the campaign cell path (never dispatch
        // order); a capture failure logs loud but never kills the cell.
        if (settleCapture !== null) {
          try {
            const coords = campaignCoordsFromCellPath(summaryPath)
            if (coords === null) {
              log(`rollout-ledger: cannot derive campaign coords from ${summaryPath} — cell ${iid} r${ctx.rep} skipped`)
            } else {
              const supRunDir = await findSupervisorRunDir(armRes.ws)
              const deliveredPatch = await readFile(armRes.patchPath, 'utf8').catch(() => '')
              await settleCapture.captureCell({
                generation: coords.generation,
                candidateIndex: coords.candidateIndex,
                iid,
                rep: ctx.rep,
                seed: ctx.seed,
                splitVisibility: split === null ? null : privateIids.has(iid) ? 'private' : 'public',
                commit: cs.candidateCommit,
                resolved: verdict.resolved,
                judgeVerdict: { ...verdict, wallS: judgeWallS },
                runDir,
                patchPath: armRes.patchPath,
                supRunDir,
                deliveredPatch,
                workerModel: config.arm.workerModel,
                metrics: {
                  resolved: verdict.resolved,
                  verify_pass: armRes.verify_pass,
                  patch_lines: armRes.patch_lines,
                  judge_attempts: verdict.attempts ?? null,
                  judge_wall_s: judgeWallS,
                  spent_tokens: armRes.spentTokens,
                  spent_usd: armRes.spentUsd,
                  recovered_tokens: recovered,
                  sup_status: armRes.sup_status,
                  sup_verdict: armRes.sup_verdict,
                  spawned: armRes.spawned,
                  workers: armRes.workers,
                  settled: armRes.settled,
                },
                cost: { usd: armRes.spentUsd, wallS: armRes.wall_s, spentTokens: armRes.spentTokens },
              })
            }
          } catch (cause) {
            log(`rollout-ledger: settle-time capture FAILED for ${iid} r${ctx.rep}: ${(cause as Error).message}`)
          }
        }

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
    dimensions: [{ key: 'resolved', description: 'official SWE-bench judge verdict' }],
    score: ({ artifact }) => {
      const v = artifact.resolved ? 1 : 0
      return {
        composite: v,
        dimensions: { resolved: v },
        notes: `official judge: ${artifact.iid} resolved=${artifact.resolved} (verify_pass=${artifact.verifyPass}, patch_lines=${artifact.patchLines}, wall_s=${artifact.wallS})`,
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
        if (privateIids.has(seed.iid)) continue // gen-5 split: never surfaced to proposers
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
        if (privateIids.has(a.iid)) continue // gen-5 split: never surfaced to proposers
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
    // GEN-5 split: the raw-trace distiller must not hand private-instance
    // cells' path context to the authors either — censor them out of the
    // candidates' campaigns before distillation.
    const censoredInput =
      split === null
        ? input
        : {
            ...input,
            candidates: input.candidates.map((cand) => {
              const campaign = cand.campaign as { cells?: Array<{ scenarioId: string }> } | null
              if (campaign === null || typeof campaign !== 'object' || !Array.isArray(campaign.cells)) return cand
              return {
                ...cand,
                campaign: { ...campaign, cells: campaign.cells.filter((c) => !privateIids.has(c.scenarioId)) },
              }
            }),
          }
    const rawFindings = (await rawTrace(censoredInput as Parameters<typeof rawTrace>[0])) as unknown[]
    return [steeringFinding, ...ensembleFindings, ...rawFindings]
  }

  // ── protocol_v2: NEVER ships from inside the loop. `budget.holdout:
  // 'deferred'` makes the LIB dispatch zero holdout cells, force `hold`, omit
  // `lift`, and record `holdout: 'deferred'` in the provenance record; the
  // pre-registered holdout run happens later, with operator approval. The
  // would-be-KEEP operator brief is computed post-run from campaign cells
  // (see the summary below). ───────────────────────────────────────────
  const holdoutReps = config.holdoutRepsPerInstance ?? 2
  const holdoutInstruction =
    `holdout (${config.holdoutInstances.length} pre-registered instances: ${config.holdoutInstances.join(', ')}) ` +
    `was NOT run — operator approval required. To certify a would-be KEEP under the ${holdoutReps}-rep ` +
    'fail-closed protocol (same-protocol parent comparison): ' +
    'tsx src/swe-arena/holdout-certify.mts <config.json> --candidate <winner-loops-commit>'
  const improveRunDir = join(config.outDir, 'improve-run')

  // ── crash recovery: a killed run leaves its in-flight paid call 'pending'
  // in the durable cost ledger, and the ledger's fail-closed guard then
  // refuses ALL new paid work on resume. Under the outDir instance lock
  // (sole runner), every pending call restored from disk is provably from a
  // dead process — settle each as a $0 failure receipt (reason
  // 'process-crash-orphan') so the guard passes without erasing the crash
  // from the durable record. ───────────────────────────────────────────
  for (const receipt of reconcileCrashOrphansOnDisk(improveRunDir)) {
    log(
      `cost-ledger: reconciled crash-orphaned call '${receipt.callId}' ` +
        `(${receipt.actor}, ${receipt.phase}) as ${CRASH_ORPHAN_REASON}`,
    )
  }

  // ── generator: the gen-3 proposer fan-out (parallel AgentProfile-pinned
  // authors + pre-filter) when `proposers` is configured; the legacy
  // single-author generator otherwise. ─────────────────────────────────
  const fanout =
    config.proposers !== undefined
      ? fanOutLoopsGenerator(config, {
          ...(smokeRunner ? { smokeRunner } : {}),
          ...(paretoParents.length > 0 ? { parents: paretoParents } : {}),
          ...(briefingCtx !== undefined ? { briefing: briefingCtx } : {}),
          // GEN-6: the GEPA seat's inner evaluator rides the SAME public-only
          // smoke instance; the split guards the never-surfaced invariant at
          // the bridge boundary too.
          ...(smokeIid !== null ? { smokeInstanceId: smokeIid } : {}),
          scoreSplit: split,
          log,
        })
      : null

  // ── the improve() call: the optimizer seat ───────────────────────────
  // Typed from improve()'s own parameter: the monorepo hoists two
  // agent-interface majors, so a nominal import can resolve to the wrong one.
  const profile = { name: 'loops-pi-supervisor' } as Parameters<typeof improve>[0]
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
      generator: fanout ?? constrainedLoopsGenerator(config),
    },
    scenarios: sweScenarios,
    judge: judgeConfig,
    agent,
    budget: {
      generations: config.generations,
      populationSize: config.populationSize,
      maxConcurrency: 1,
      reps,
      maxImprovementShots: config.maxShots,
      // Deferred with no reserved set: ALL improvement-set scenarios train;
      // the held-out comparison lives in the separate operator-approved run.
      holdout: 'deferred',
    },
    // TRAINING RECORDER: every scored (artifact, judge score) lands in the
    // lib's labeled-scenario store as a JSONL corpus under outDir (growth is
    // outDir-scoped; a handful of cells per round). Records carry the default
    // 'unverified' trust — corpus-grade, NOT gold-eligible, which is right
    // until an operator-confirmed holdout verdict upgrades them.
    labeledStore: new FsLabeledScenarioStore({ root: join(config.outDir, 'labeled-store') }),
    captureSource: 'eval-run',
    // Arm/judge/proposer spend reaches the campaign meter through real paid
    // calls (worker receipt per swe cell, $0 judge receipts, imported
    // proposer-shot receipts). 'warn' not 'assert': the official judge's $0
    // receipts are correct-by-design and must not kill the round as "stubs".
    expectUsage: 'warn',
    // Widened: covers worst-case capacity-gate holds; the REAL per-cell work
    // clock (config.dispatchTimeoutMs) starts post-gate inside the dispatch.
    dispatchTimeoutMs: campaignDispatchCeilingMs(config),
    runDir: improveRunDir,
    ...(premeasured ? { premeasuredBaseline: premeasured } : {}),
  })

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

    // BASELINE-DRIFT: a resumed runDir can still hold baseline cells cached by
    // an OLDER (pre-artifact) run. When they contradict the lib-validated
    // premeasured artifact, log loud — the artifact rules, never silently.
    if (premeasured) {
      const cachedBaseline = await loadCampaignCells(join(improveRunDir, 'baseline'))
      if (cachedBaseline.length > 0) {
        const expected = instanceVerdictsFromCells(baselineCells, config.instances, reps)
        for (const w of baselineDriftWarnings(
          expected,
          replicateRunsFromCells(cachedBaseline),
          config.instances,
          reps,
        )) {
          log(`BASELINE-DRIFT: ${w}`)
        }
      }
    }

    // Collected per-candidate facts for the gen-5 machinery (activation by
    // surface hash for the winner brief, lineage nodes, proposer v2 rewards).
    const activationBySurface = new Map<string, ActivationRecord>()
    const lineageCandidates: LineageCandidateInput[] = []
    interface ProposerOutcomeFact {
      generation: number
      candidateIndex: number
      label: string
      commit: string | null
      resolvedCount: number
      diffPath: string | null
    }
    const proposerFacts: ProposerOutcomeFact[] = []

    for (let g = 0; g < loop.generations.length; g++) {
      const gen = loop.generations[g]!
      const rows: StaircaseRow[] = []
      for (let candIndex = 0; candIndex < gen.record.candidates.length; candIndex++) {
        const cand = gen.record.candidates[candIndex]!
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
        // campaign IS the baseline incumbent — its count comes from the
        // baseline campaign (the lib-validated premeasured artifact, or the
        // bootstrap run's measurement; both survive resume, no dispatch-order
        // guess).
        const parentCampaign = cand.parentSurfaceHash
          ? campaignBySurface.get(cand.parentSurfaceHash)
          : undefined
        const parentResolvedCount =
          parentCampaign !== undefined ? resolvedCountOf(parentCampaign) : measuredBaselineCount
        const violations = desc?.violations ?? []

        // GEN-5 activation gate: run the candidate's own committed predicate
        // over its own cell run dirs. Fail-closed — a missing/unparseable
        // predicate (the prefilter should have killed it) quarantines.
        let activation: ActivationRecord | undefined
        if (config.activationGate === true && cs !== null) {
          const committed = await readCommittedPredicate(config.loopsRepo, cs.candidateCommit)
          if (committed === null || !committed.parsed.ok) {
            const why =
              committed === null
                ? `no ${ACTIVATION_PREDICATE_RELPATH} at ${cs.candidateCommit.slice(0, 10)}`
                : `unparseable activation predicate: ${committed.parsed.ok ? '' : committed.parsed.error}`
            activation = {
              present: false,
              description: null,
              fired: false,
              evidence: [],
              warnings: [`${why} — fail-closed quarantine`],
            }
          } else {
            const runDirs = [
              ...new Set(
                cells
                  .map((c) => (c.artifact !== null && c.artifact.kind === 'swe-arm' ? c.artifact.runDir : null))
                  .filter((d): d is string => typeof d === 'string' && d.length > 0),
              ),
            ]
            const res = await runActivationPredicate(committed.parsed.predicate, runDirs)
            activation = {
              present: true,
              description: committed.parsed.predicate.description,
              fired: res.fired,
              evidence: res.evidence,
              warnings: res.warnings,
            }
          }
          activationBySurface.set(cand.surfaceHash, activation)
          log(
            `activation ${cand.label ?? cand.surfaceHash.slice(0, 10)}: present=${activation.present} ` +
              `fired=${activation.fired}${activation.fired ? ` — ${activation.evidence[0] ?? ''}` : ''}` +
              `${activation.warnings.length > 0 ? ` (warnings: ${activation.warnings.join('; ')})` : ''}`,
          )
        }

        // GEN-5 split sub-scores: both halves logged per candidate; the
        // selection rule stays combined (candResolved over ALL instances).
        const verdicts = instanceVerdictsFromCells(cells, config.instances, reps)
        const splitScores = split !== null ? subScores(verdicts, split) : null
        if (split !== null && splitScores !== null) {
          log(
            `split scores ${cand.label ?? cand.surfaceHash.slice(0, 10)}: ` +
              `public ${splitScores.publicResolvedCount}/${split.publicInstances.length}, ` +
              `private ${splitScores.privateResolvedCount}/${split.privateInstances.length} (combined ${candResolved}/${config.instances.length})`,
          )
        }

        const verdict = decideVerdict({
          violations,
          coverageComplete,
          resolvedCount: candResolved,
          parentResolvedCount,
          costRatio,
          costGuardRatio: config.costGuardRatio,
          ...(activation !== undefined ? { activationFired: activation.fired } : {}),
        })
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
          verdict,
          holdout: 'operator-approval-required',
          armProvenance: desc?.armProvenance ?? null,
          diffPath: desc?.diffPath ?? null,
          diffSha256: desc?.diffSha256 ?? null,
          ...(split !== null && splitScores !== null
            ? {
                split: {
                  publicInstances: split.publicInstances,
                  privateInstances: split.privateInstances,
                  ...splitScores,
                },
              }
            : {}),
          ...(activation !== undefined ? { activation } : {}),
        })

        const label = cand.label ?? cs?.candidateCommit?.slice(0, 10) ?? cand.surfaceHash.slice(0, 10)
        lineageCandidates.push({
          label,
          commit: cs?.candidateCommit ?? null,
          resolvedCount: candResolved,
          verdicts,
          merge: config.proposers?.find((p) => p.name === cand.label)?.merge === true,
          verdict,
        })
        proposerFacts.push({
          generation: g,
          candidateIndex: candIndex,
          label,
          commit: cs?.candidateCommit ?? null,
          resolvedCount: candResolved,
          diffPath: desc?.diffPath ?? null,
        })
      }
      const genFile = join(config.roundsDir, `gen-${g}.jsonl`)
      for (const row of rows) await appendFile(genFile, JSON.stringify(row) + '\n')
      log(`staircase: ${rows.length} row(s) → ${genFile} (${rows.map((r) => r.verdict).join(', ')})`)
    }

    // Pre-filter kills: candidates the fan-out killed BEFORE evaluation never
    // became surfaces (zero arm cells), so the loop has no row for them —
    // each becomes an explicit `rejected-prefilter` staircase dot with its
    // kill reason and forensics patch.
    if (fanout) {
      const kills = fanout.drainPrefilterKills()
      for (const kill of kills) {
        const row: StaircaseRow = {
          schema: STAIRCASE_SCHEMA,
          round: config.round,
          generation: kill.generation,
          runId,
          at: new Date().toISOString(),
          candidate: `prefilter-kill:${kill.diffSha256?.slice('sha256:'.length, 'sha256:'.length + 12) ?? kill.proposer}`,
          candidateCommit: null,
          parent: premeasured?.surfaceHash ?? 'baseline',
          parentResolvedCount: measuredBaselineCount,
          label: kill.proposer,
          rationale: `prefilter kill at stage '${kill.stage}' (${kill.harness ?? 'engine'})`,
          changedFiles: [],
          changeSpaceViolations: kill.stage === 'change-space' ? [kill.reason] : [],
          perInstance: [],
          resolvedCount: 0,
          coverageComplete: false,
          wallS: kill.smoke?.wallS ?? 0,
          baselineWallS,
          costRatio: null,
          costGuardRatio: config.costGuardRatio,
          internallyPromoted: false,
          verdict: 'rejected-prefilter',
          killReason: `${kill.stage}: ${kill.reason}`,
          holdout: 'operator-approval-required',
          armProvenance: null,
          diffPath: kill.patchPath,
          diffSha256: kill.diffSha256,
        }
        const genFile = join(config.roundsDir, `gen-${kill.generation}.jsonl`)
        await appendFile(genFile, JSON.stringify(row) + '\n')
        log(`staircase: prefilter kill dot (${kill.proposer}, ${kill.stage}) → ${genFile}`)
      }
    }

    // GEN-5 label-v2 proposer rewards: baseline-relative (candidate − baseline
    // resolved fraction, improvement positive), one settle-time ledger line
    // per evaluated candidate now that the round's scores are final.
    if (settleCapture !== null) {
      const sanitizeName = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_')
      for (const fact of proposerFacts) {
        try {
          const flatDir = join(config.outDir, 'proposer-shots')
          const pattern = new RegExp(`^gen${fact.generation}-cand${fact.candidateIndex}-shot\\d+\\.json$`)
          const receiptPaths: string[] = []
          for (const dir of [flatDir, join(flatDir, sanitizeName(fact.label))]) {
            for (const name of (await readdir(dir).catch(() => [])).sort()) {
              if (pattern.test(name)) receiptPaths.push(join(dir, name))
            }
          }
          await settleCapture.captureProposer({
            generation: fact.generation,
            candidateIndex: fact.candidateIndex,
            proposer: fact.label,
            harness: config.proposers?.find((p) => p.name === fact.label)?.harness ?? null,
            commit: fact.commit,
            candResolved: fact.resolvedCount,
            baselineResolved: measuredBaselineCount,
            shotReceiptPaths: receiptPaths,
            diffPath: fact.diffPath,
          })
        } catch (cause) {
          log(`rollout-ledger: proposer capture FAILED for ${fact.label}: ${(cause as Error).message}`)
        }
      }
    }

    // GEN-5 lineage DAG: record baseline root + pareto parents + every
    // evaluated candidate (multi-parent for the merge seat) at the
    // .evolve-compatible store, and ask the governor for the continuation
    // decision (recorded below — never acted on inside this run).
    let lineageResult: Awaited<ReturnType<typeof recordLineageGeneration>> | null = null
    if (config.lineage === true) {
      try {
        const baselineCommit =
          baselineCells.find((c) => c.artifact !== null && c.artifact.kind === 'swe-arm')?.artifact?.commit ??
          config.loopsBaseRef
        lineageResult = await recordLineageGeneration({
          outDir: config.outDir,
          runId,
          instances: config.instances,
          baseline: {
            commit: baselineCommit,
            resolvedCount: measuredBaselineCount,
            verdicts: instanceVerdictsFromCells(baselineCells, config.instances, reps),
          },
          paretoParents: (config.paretoParents ?? []).map((p) => ({
            label: p.label,
            commit: p.commit,
            resolvedInstances: p.resolvedInstances,
          })),
          candidates: lineageCandidates,
        })
        log(
          `lineage: ${lineageResult.appended.length} node(s) appended (total ${lineageResult.nodesTotal}) → ` +
            `${lineageResult.path}; governor decision: ${JSON.stringify(lineageResult.governor)}` +
            `${lineageResult.skipped.length > 0 ? `; skipped (no commit): ${lineageResult.skipped.join(', ')}` : ''}`,
        )
      } catch (cause) {
        log(`lineage: recording FAILED: ${(cause as Error).message}`)
      }
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

    // BOOTSTRAP: persist this run's measured baseline campaign as the
    // premeasured artifact every later run consumes (and the lib re-validates
    // by surface hash / seed / reps / split digest). The baseline surface
    // hash comes from the Pareto frontier's generation −1 entry — the lib's
    // own record of the baseline measurement.
    if (!premeasured) {
      const baselineHash = loop.paretoFrontier.find((p) => p.generation === -1)?.surfaceHash
      if (baselineHash === undefined) {
        log('bootstrap: no generation −1 Pareto entry — premeasured baseline artifact NOT written')
      } else {
        const artifact: PremeasuredOptimizationBaseline<R4Artifact, Scenario> = {
          surfaceHash: baselineHash,
          campaign: loop.baselineCampaign,
        }
        await writeFile(config.premeasuredBaselinePath, JSON.stringify(artifact, null, 1))
        log(`bootstrap: premeasured baseline artifact → ${config.premeasuredBaselinePath} (surface ${baselineHash})`)
      }
    }

    // The would-be-KEEP operator brief: winner vs baseline on the improvement
    // set, from campaign cells. The lib's deferred-holdout gate always holds;
    // this evidence tells the operator whether the pre-registered holdout run
    // is worth approving.
    const winnerHash = winnerCs ? surfaceHash(winnerCs) : null
    const winnerCampaign = winnerHash !== null ? campaignBySurface.get(winnerHash) : undefined
    const winnerActivation = winnerHash !== null ? activationBySurface.get(winnerHash) : undefined
    const improvementSet =
      winnerCampaign !== undefined && winnerRec !== undefined
        ? gateEvidenceFromCells({
            winnerCells: cellsFromCampaign(winnerCampaign),
            baselineCells,
            violations: winnerRec.violations,
            iids: config.instances,
            reps,
            costGuardRatio: config.costGuardRatio,
            ...(winnerActivation !== undefined ? { activationFired: winnerActivation.fired } : {}),
          })
        : null
    const wouldKeep = improvementSet !== null && improvementSet.verdict === 'accepted'
    if (improvementSet) {
      log(
        `improvement set: winner ${improvementSet.candResolved}/${config.instances.length} vs baseline ` +
          `${improvementSet.baseResolved}/${config.instances.length}; wall ${improvementSet.candWallS}s vs ` +
          `${improvementSet.baseWallS}s (ratio ${improvementSet.costRatio === null ? 'n/a' : improvementSet.costRatio.toFixed(2)}, ` +
          `guard ${config.costGuardRatio}); protocol verdict: ${improvementSet.verdict}${wouldKeep ? ' (WOULD-BE KEEP)' : ''}`,
      )
    } else {
      log('improvement set: winner == baseline (no candidate campaign) — nothing to promote')
    }

    const summary = {
      schema: 'swe-arena.round-summary.v2',
      round: config.round,
      runId,
      at: new Date().toISOString(),
      loops: { repo: config.loopsRepo, baseRef: config.loopsBaseRef },
      // The gate's denominator: the lib-validated premeasured artifact, or
      // this bootstrap run's freshly measured (and persisted) campaign.
      baseline: {
        resolvedCount: measuredBaselineCount,
        wallS: baselineWallS,
        perInstance: perInstanceFromCells(baselineCells),
        premeasured: premeasured !== undefined,
        artifactPath: config.premeasuredBaselinePath,
        ...(premeasured ? { surfaceHash: premeasured.surfaceHash } : {}),
      },
      winner: winnerCs
        ? {
            surfaceHash: winnerHash,
            commit: winnerCs.candidateCommit,
            label: result.raw.winner.label ?? null,
            rationale: result.raw.winner.rationale ?? null,
            patch: winnerPatch,
          }
        : null,
      // The lib's verdict + reasons: deferred holdout forces `hold` with zero
      // holdout cells dispatched and no fabricated lift.
      gateDecision: result.decision,
      gateReasons: loop.gateResult.reasons,
      // Improvement-set (search-split) evidence — NOT a held-out measurement.
      improvementSet: improvementSet === null ? null : { ...improvementSet, wouldKeep },
      // GEN-5: the public/private split (sub-scores live per candidate in the
      // staircase rows; selection stays combined; private never surfaced to
      // proposers — the 2-of-6 private half is a direction check, not a
      // certification).
      scoreSplit:
        split === null
          ? null
          : {
              seededBy: split.seededBy,
              publicInstances: split.publicInstances,
              privateInstances: split.privateInstances,
            },
      // GEN-5: activation-gate outcomes per candidate surface.
      activationGate:
        config.activationGate === true
          ? {
              enabled: true,
              byCandidate: [...activationBySurface.entries()].map(([surface, a]) => ({
                surface,
                present: a.present,
                fired: a.fired,
                description: a.description,
              })),
            }
          : { enabled: false },
      // GEN-5: MAP+TOOLBOX briefing provenance.
      briefing:
        briefingCtx === undefined
          ? null
          : { version: AUTHOR_BRIEFING_VERSION, indexPath: briefingCtx.indexPath, textSource: briefingCtx.briefingSource },
      // GEN-5: settle-time rollout ledger location (tangle.rollout.v1, label v2).
      rolloutLedger: settleCapture === null ? null : { path: settleCapture.path, capture: 'settle-time', labels: 'v2' },
      // GEN-5: lineage DAG + the governor's recorded continuation decision.
      lineage:
        lineageResult === null
          ? null
          : {
              path: lineageResult.path,
              nodesTotal: lineageResult.nodesTotal,
              appended: lineageResult.appended.length,
              skipped: lineageResult.skipped,
              governor: lineageResult.governor,
            },
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
      holdout: {
        instances: config.holdoutInstances,
        mode: 'deferred',
        status: 'operator-approval-required',
        // The certification protocol the operator run must use — 2-rep
        // fail-closed with a same-protocol parent (gen-2 postmortem).
        protocol: {
          repsPerInstance: holdoutReps,
          resolvedRule: 'all-reps',
          parentBaseline: config.holdoutBaseline ?? 'measure',
        },
        instruction: holdoutInstruction,
      },
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
      console.error('usage: outer-loop.mts --write-config <path> [--out-name <dirname>] [--gen3|--gen4|--gen5]')
      process.exit(2)
    }
    const outDirName = flag('--out-name')
    const gen3 = argv.includes('--gen3')
    const gen4 = argv.includes('--gen4')
    const gen5 = argv.includes('--gen5')
    let config: OuterLoopConfig
    let flavor: string
    if (gen4 || gen5) {
      // The codex seat rides only when the CLI is actually present — a config
      // naming a missing harness would fail the whole launch at t=0.
      const codexProbe = await run('codex', ['--version'])
      const includeCodex = codexProbe.code === 0
      if (!includeCodex) {
        console.log(
          `codex CLI unavailable (rc=${codexProbe.code}) — ${gen5 ? 'gen-5' : 'gen-4'} config written WITHOUT the codex-author seat`,
        )
      }
      const make = gen5 ? defaultGen5Config : defaultGen4Config
      config = make(undefined, { ...(outDirName ? { outDirName } : {}), includeCodex })
      flavor = gen5 ? 'gen-5' : 'gen-4'
    } else {
      const make = gen3 ? defaultGen3Config : defaultRound4Config
      config = make(undefined, outDirName ? { outDirName } : {})
      flavor = gen3 ? 'gen-3' : 'round-4'
    }
    await writeFile(path, JSON.stringify(config, null, 2) + '\n')
    console.log(`default ${flavor} config → ${path}`)
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
        '       tsx src/swe-arena/outer-loop.mts --write-config <path> [--out-name <dirname>] [--gen3|--gen4|--gen5]\n' +
        '       tsx src/swe-arena/outer-loop.mts --calibration-smoke [supRunDir] [--analysts N] [--model M] [--endpoint router|zai] [--retries N]',
    )
    process.exit(2)
  }
}
