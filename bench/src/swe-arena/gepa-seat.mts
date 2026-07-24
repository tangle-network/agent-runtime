/**
 * GEN-6 GEPA proposer seat — agent-eval's external-GEPA adapter
 * (`gepaOptimizationMethod`, tangle-network/agent-eval PRs #408/#409,
 * main@58a28aa) wired as ONE seat in the swe-arena proposer fan-out.
 *
 * Two-tier evaluator, the critical shape:
 *
 *   INNER (what GEPA's own loop calls, many times, budget-capped): the
 *   candidate is ONE change-space file's content as a string. Each inner call
 *   materializes the candidate string into the seat's scratch loops worktree
 *   (the rest of the repo stays at the incumbent commit) and runs the EXISTING
 *   pre-filter smoke cell — one PUBLIC instance, the cheap path — through the
 *   injected `SmokeRunner`. Score = smoke resolve (1/0) + verify-pass fraction
 *   as a bounded tiebreak. Inner calls are capped by `maxMetricCalls`
 *   (default 10; each smoke costs minutes of arm time).
 *
 *   OUTER: GEPA's best candidate is written back to the surface file in the
 *   scratch worktree and the seat returns `applied: true` — from there the
 *   fan-out treats it EXACTLY like any other author's work: change-space
 *   check, activation-predicate gate, smoke pre-filter, then the full exam,
 *   with staircase label = the seat name (`gepa-author`).
 *
 * DATA BOUNDARIES (both fail-closed):
 *   - PUBLIC ONLY crosses the bridge: the only scenario ids serialized to the
 *     GEPA process name the public smoke instance; `assertNoPrivateLeak`
 *     re-checks every string headed to the bridge against the score split.
 *   - Holdout/final cases NEVER cross: the adapter's own API has no test-set
 *     field (`GepaBridgeInput` in agent-eval src/campaign/gepa-optimization-
 *     method.ts — "The final comparison cases are not accepted by this API and
 *     cannot be serialized here"), and its Python side hard-rejects one
 *     (`gepa_bridge.py` `_validate_input`: `if "testSet" in value ... raise`).
 *     This module never mentions holdout instances to begin with.
 *
 * RUNTIME SEAMS (both fail LOUD at provenance time, t=0, mirroring the codex
 * seat's auth check — a dead seat cannot be silently skipped mid-run):
 *   - Node: the installed @tangle-network/agent-eval must export
 *     `gepaOptimizationMethod` (0.123.x predates it) — `loadGepaMethodFactory`
 *     throws with the exact upgrade instruction otherwise.
 *   - Python: `agent_eval_rpc.gepa_bridge` + a GEPA build with
 *     `optimize_anything`/`OptimizeAnythingConfig` must import —
 *     `probeGepaRuntime` throws with the pip install instruction otherwise.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  DispatchContext,
  JudgeConfig,
  MutableSurface,
  OptimizationMethod,
  OptimizationMethodInput,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import { ACTIVATION_PREDICATE_RELPATH, type ActivationPredicate } from './activation.mts'
import { changeSpaceViolations, type OuterLoopConfig } from './outer-loop.mts'
import type { AuthorFn, ProposerSpec, SmokeRunner, SmokeVerdict } from './proposer-fanout.mts'
import type { ScoreSplit } from './score-split.mts'

// ---------------------------------------------------------------------------
// Spec.
// ---------------------------------------------------------------------------

export const GEPA_ENGINES = ['gepa', 'omni'] as const
export type GepaEngineName = (typeof GEPA_ENGINES)[number]

export const DEFAULT_MAX_METRIC_CALLS = 10
export const DEFAULT_MAX_PROPOSER_COST_USD = 10
/** Omni = 3 bounded explore runs + 1 continuation (GEPA's published shape). */
export const OMNI_RUN_COUNT = 4

/** A `ProposerSpec` whose `engine` marks it as a GEPA seat. */
export type GepaSeatSpec = ProposerSpec & { engine: GepaEngineName; surface: string }

export function isGepaSeat(spec: ProposerSpec): spec is GepaSeatSpec {
  return spec.engine !== undefined
}

/** Fail-closed spec validation, run at generator construction. A GEPA seat is
 *  an ENGINE invocation: harness/profile/model/merge belong to CLI-authored
 *  seats and are rejected here rather than silently ignored. */
export function validateGepaSeat(spec: ProposerSpec): asserts spec is GepaSeatSpec {
  const label = `gepa seat '${spec.name}'`
  if (spec.engine === undefined || !GEPA_ENGINES.includes(spec.engine)) {
    throw new Error(`${label}: engine must be one of ${GEPA_ENGINES.join('|')}, got ${JSON.stringify(spec.engine)}`)
  }
  if (typeof spec.surface !== 'string' || spec.surface.length === 0) {
    throw new Error(`${label}: surface is required — the ONE repo-relative file GEPA optimizes as a string`)
  }
  const violations = changeSpaceViolations([spec.surface])
  if (violations.length > 0) {
    throw new Error(`${label}: surface ${JSON.stringify(spec.surface)} is outside the declared change-space`)
  }
  for (const field of ['harness', 'profile', 'model', 'merge', 'lens', 'diagnosisSlice'] as const) {
    if (spec[field] !== undefined) {
      throw new Error(`${label}: field '${field}' belongs to harness-authored seats and must be unset on an engine seat`)
    }
  }
  const calls = spec.maxMetricCalls ?? DEFAULT_MAX_METRIC_CALLS
  if (!Number.isSafeInteger(calls) || calls <= 0) {
    throw new Error(`${label}: maxMetricCalls must be a positive integer, got ${JSON.stringify(spec.maxMetricCalls)}`)
  }
  if (spec.engine === 'omni' && calls < OMNI_RUN_COUNT) {
    throw new Error(`${label}: engine 'omni' runs ${OMNI_RUN_COUNT} bounded engine runs and needs maxMetricCalls >= ${OMNI_RUN_COUNT}, got ${calls}`)
  }
  const cost = spec.maxProposerCostUsd ?? DEFAULT_MAX_PROPOSER_COST_USD
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`${label}: maxProposerCostUsd must be a positive finite number, got ${JSON.stringify(spec.maxProposerCostUsd)}`)
  }
}

// ---------------------------------------------------------------------------
// Recipe — the adapter's own shape, mirrored structurally (the installed
// agent-eval may predate the export; see loadGepaMethodFactory).
// ---------------------------------------------------------------------------

export interface GepaEngineRun {
  engine: string
  maxEvaluations: number
  maxProposerCostUsd: number
  engineConfig?: Record<string, unknown>
}

export type GepaOptimizationRecipe =
  | { kind: 'engine'; run: GepaEngineRun }
  | { kind: 'best-of-then-continue'; explore: readonly GepaEngineRun[]; continueWith: GepaEngineRun }

/** Build the bounded recipe for a seat. The TOTAL inner-evaluation budget is
 *  exactly `maxMetricCalls` — the adapter's local callback enforces the sum
 *  of per-run limits, and the seat's own dispatch wrapper re-enforces it. */
export function recipeForSeat(spec: GepaSeatSpec): GepaOptimizationRecipe {
  const calls = spec.maxMetricCalls ?? DEFAULT_MAX_METRIC_CALLS
  const cost = spec.maxProposerCostUsd ?? DEFAULT_MAX_PROPOSER_COST_USD
  if (spec.engine === 'gepa') {
    return { kind: 'engine', run: { engine: 'gepa', maxEvaluations: calls, maxProposerCostUsd: cost } }
  }
  // Omni: explore {gepa, autoresearch, meta_harness} then continue with gepa,
  // splitting the call budget so the four bounded runs sum to `calls`.
  const perExplore = Math.max(1, Math.floor(calls / OMNI_RUN_COUNT))
  const continueCalls = calls - 3 * perExplore
  const perRunCost = cost / OMNI_RUN_COUNT
  const explore = ['gepa', 'autoresearch', 'meta_harness'].map((engine) => ({
    engine,
    maxEvaluations: perExplore,
    maxProposerCostUsd: perRunCost,
  }))
  return {
    kind: 'best-of-then-continue',
    explore,
    continueWith: { engine: 'gepa', maxEvaluations: continueCalls, maxProposerCostUsd: perRunCost },
  }
}

export function recipeEvaluationBudget(recipe: GepaOptimizationRecipe): number {
  const runs = recipe.kind === 'engine' ? [recipe.run] : [...recipe.explore, recipe.continueWith]
  return runs.reduce((sum, run) => sum + run.maxEvaluations, 0)
}

// ---------------------------------------------------------------------------
// Public-only bridge examples.
// ---------------------------------------------------------------------------

export interface GepaSeatScenario extends Scenario {
  /** The PUBLIC smoke instance this scenario dispatches to. */
  smokeIid: string
}

/** Throws when any private instance id appears in text headed to the bridge. */
export function assertNoPrivateLeak(
  text: string,
  split: Pick<ScoreSplit, 'privateInstances'> | null,
  what: string,
): void {
  if (split === null) return
  const leaked = split.privateInstances.filter((iid) => text.includes(iid))
  if (leaked.length > 0) {
    throw new Error(`gepa seat: ${what} would leak private instance id(s) [${leaked.join(', ')}] to the GEPA bridge`)
  }
}

/** The ONLY scenarios the bridge ever sees: the public smoke instance as the
 *  train example plus a distinct-id alias as the selection example (the
 *  adapter requires disjoint train/selection ids; both dispatch to the same
 *  smoke cell). Fails loud when the smoke instance is private. */
export function gepaBridgeScenarios(
  smokeIid: string,
  split: Pick<ScoreSplit, 'privateInstances'> | null,
): { train: GepaSeatScenario[]; selection: GepaSeatScenario[] } {
  if (split !== null && split.privateInstances.includes(smokeIid)) {
    throw new Error(
      `gepa seat: smoke instance ${smokeIid} is PRIVATE under the score split — private ids never cross the bridge`,
    )
  }
  assertNoPrivateLeak(smokeIid, split, `smoke instance id '${smokeIid}'`)
  return {
    train: [{ id: smokeIid, kind: 'swe-smoke', smokeIid }],
    selection: [{ id: `${smokeIid}::selection`, kind: 'swe-smoke', smokeIid }],
  }
}

// ---------------------------------------------------------------------------
// Inner score.
// ---------------------------------------------------------------------------

/** Resolve dominates; verify-pass is a bounded tiebreak that can never beat a
 *  resolve (0.25 < 1). Range {0, 0.25, 1, 1.25}. */
export function innerSmokeComposite(verdict: Pick<SmokeVerdict, 'resolved' | 'verifyPass'>): number {
  return (verdict.resolved === true ? 1 : 0) + (verdict.verifyPass === true ? 0.25 : 0)
}

export function innerSmokeJudge(): JudgeConfig<SmokeVerdict, GepaSeatScenario> {
  return {
    name: 'gepa-inner-smoke',
    judgeVersion: 'gepa-inner-smoke.v1',
    dimensions: [
      { key: 'resolved', description: 'Official SWE-bench judge verdict for the smoke cell (1 resolved / 0 not).' },
      { key: 'verifyPass', description: 'Committed verify fixture passed for the smoke cell (tiebreak).' },
    ],
    score: ({ artifact }) => ({
      dimensions: {
        resolved: artifact.resolved === true ? 1 : 0,
        verifyPass: artifact.verifyPass === true ? 1 : 0,
      },
      composite: innerSmokeComposite(artifact),
      notes: artifact.reason,
    }),
  }
}

// ---------------------------------------------------------------------------
// Runtime seams — Node adapter export + Python bridge, both loud.
// ---------------------------------------------------------------------------

export const GEPA_ADAPTER_UPGRADE_HINT =
  "the installed @tangle-network/agent-eval does not export gepaOptimizationMethod — " +
  'upgrade to a release containing tangle-network/agent-eval PRs #408/#409 (merged at main@58a28aa; ' +
  'first release after 0.123.5), then reinstall bench deps'

export const GEPA_PYTHON_INSTALL_HINT =
  "install the optional Python bridge: pip install 'agent-eval-rpc[gepa]' " +
  '(the extra pins the GEPA source commit providing optimize_anything/OptimizeAnythingConfig; ' +
  'published gepa<=0.1.4 does not contain the multi-engine API — see agent-eval docs/campaign-proposers.md)'

/** Adapter config, mirrored structurally from agent-eval's
 *  `GepaOptimizationMethodConfig` (src/campaign/gepa-optimization-method.ts). */
export interface GepaMethodConfig {
  name?: string
  recipe: GepaOptimizationRecipe
  objective: string
  background?: string
  maxCandidateChars?: number
  timeoutMs?: number
  describeScenario?: (scenario: GepaSeatScenario) => unknown
  runner?: { command?: string; args?: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv }
}

export type GepaMethodFactory = (
  config: GepaMethodConfig,
) => OptimizationMethod<GepaSeatScenario, SmokeVerdict>

export type CampaignModuleImport = () => Promise<Record<string, unknown>>

const defaultImportCampaign: CampaignModuleImport = () =>
  import('@tangle-network/agent-eval/campaign') as Promise<Record<string, unknown>>

/** Resolve the adapter factory from the installed agent-eval, or throw the
 *  exact upgrade instruction. Checked at provenance time (t=0) AND at author
 *  time, so a stale install can never silently skip the seat. */
export async function loadGepaMethodFactory(
  importCampaign: CampaignModuleImport = defaultImportCampaign,
): Promise<GepaMethodFactory> {
  const mod = await importCampaign()
  const factory = mod['gepaOptimizationMethod']
  if (typeof factory !== 'function') {
    throw new Error(`gepa seat: ${GEPA_ADAPTER_UPGRADE_HINT}`)
  }
  return factory as GepaMethodFactory
}

export type ProbeExec = (
  command: string,
  args: string[],
) => Promise<{ code: number | null; stdout: string; stderr: string }>

export interface GepaRuntimeProbe {
  pythonVersion: string
  gepaVersion: string
}

export const DEFAULT_GEPA_PYTHON = 'python3'

/** Prove the Python side of the bridge can run, or throw install
 *  instructions. Mirrors the codex seat's login-status gate: run at t=0 so a
 *  dead seat fails the launch, never a mid-run candidate slot. */
export async function probeGepaRuntime(python: string, exec: ProbeExec, seatName: string): Promise<GepaRuntimeProbe> {
  const version = await exec(python, ['--version'])
  if (version.code !== 0) {
    throw new Error(
      `gepa seat '${seatName}': '${python} --version' failed (rc=${version.code}) — ${GEPA_PYTHON_INSTALL_HINT}`,
    )
  }
  const bridge = await exec(python, ['-c', 'import agent_eval_rpc.gepa_bridge'])
  if (bridge.code !== 0) {
    throw new Error(
      `gepa seat '${seatName}': GEPA Python runtime is not installed ` +
        `(python=${python}; 'import agent_eval_rpc.gepa_bridge' failed: ${bridge.stderr.trim().slice(0, 300)}). ` +
        GEPA_PYTHON_INSTALL_HINT,
    )
  }
  const gepa = await exec(python, [
    '-c',
    "from gepa.optimize_anything import optimize_anything, OptimizeAnythingConfig; " +
      "import gepa; print(getattr(gepa, '__version__', 'source'))",
  ])
  if (gepa.code !== 0) {
    throw new Error(
      `gepa seat '${seatName}': installed gepa lacks the multi-engine optimize_anything API ` +
        `(${gepa.stderr.trim().slice(0, 300)}). ` +
        GEPA_PYTHON_INSTALL_HINT,
    )
  }
  return { pythonVersion: (version.stdout + version.stderr).trim(), gepaVersion: gepa.stdout.trim() }
}

// ---------------------------------------------------------------------------
// Inner-run provenance.
// ---------------------------------------------------------------------------

export interface GepaInnerCall {
  call: number
  scenarioId: string
  smokeIid: string
  candidateSha256: string
  composite: number
  resolved: boolean | null
  verifyPass: boolean | null
  pass: boolean
  wallS: number
}

export interface GepaSeatInnerRun {
  seat: string
  engine: GepaEngineName
  surface: string
  generation: number
  budget: number
  innerCallCount: number
  innerScores: GepaInnerCall[]
  bestComposite: number | null
  adapterReportedCostUsd: number | null
  adapterCostAccountingComplete: boolean
  durationMs: number
}

export const PROPOSER_PROVENANCE_FILENAME = 'proposer-provenance.json'

/** Merge one seat run's inner-call record into `proposer-provenance.json`
 *  under `gepaInnerRuns` (additive; the t=0 capture record is preserved). */
export async function recordGepaSeatInnerRun(outDir: string, run: GepaSeatInnerRun): Promise<void> {
  const path = join(outDir, PROPOSER_PROVENANCE_FILENAME)
  let record: Record<string, unknown> = {}
  try {
    record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    // No capture record yet (unit-test or crash-before-write): still persist.
  }
  const runs = Array.isArray(record.gepaInnerRuns) ? (record.gepaInnerRuns as unknown[]) : []
  runs.push(run)
  record.gepaInnerRuns = runs
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(record, null, 2))
}

// ---------------------------------------------------------------------------
// Mechanical activation predicate (gen-5 activation gate).
// ---------------------------------------------------------------------------

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const MIN_PREDICATE_LINE_CHARS = 12

/** Derive a machine-checkable predicate from the surface change: the longest
 *  ADDED line must render in the candidate's own run artifacts (for a prompt
 *  surface, the changed text appearing in composed prompts IS the mechanism
 *  firing). Returns null when no added line is distinctive enough — the
 *  caller fails the candidate loud instead of shipping an unverifiable one. */
export function mechanicalActivationPredicate(
  seed: string,
  winner: string,
  surface: string,
): ActivationPredicate | null {
  const seedLines = new Set(seed.split('\n').map((l) => l.trim()))
  const added = winner
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= MIN_PREDICATE_LINE_CHARS && !seedLines.has(l))
  if (added.length === 0) return null
  const line = added.reduce((a, b) => (b.length > a.length ? b : a))
  return {
    version: 'v1',
    description: `gepa-author surface change fired: candidate text from ${surface} appears in run artifacts`,
    kind: 'grep',
    pattern: escapeRegExp(line),
  }
}

// ---------------------------------------------------------------------------
// The seat author.
// ---------------------------------------------------------------------------

export interface GepaSeatDeps {
  smokeRunner: SmokeRunner
  /** Resolved PUBLIC smoke instance (outer-loop restricts the choice to the
   *  split's public set; re-asserted here fail-closed). */
  smokeInstanceId: string
  scoreSplit: Pick<ScoreSplit, 'privateInstances'> | null
  /** Test seam. Default: checked dynamic import of the installed adapter. */
  methodFactory?: GepaMethodFactory
  log?: (msg: string) => void
}

const sha256 = (s: string): string => `sha256:${createHash('sha256').update(s).digest('hex')}`

/** Build the seat's `AuthorFn`. The fan-out calls it with the seat's scratch
 *  worktree (checked out at the incumbent commit); everything this function
 *  leaves in that worktree becomes the candidate diff. */
export function gepaSeatAuthor(config: OuterLoopConfig, deps: GepaSeatDeps): AuthorFn {
  const log = deps.log ?? (() => {})
  return async (proposer, args) => {
    validateGepaSeat(proposer)
    const spec: GepaSeatSpec = proposer
    const generation = args.generation ?? 0
    const budget = spec.maxMetricCalls ?? DEFAULT_MAX_METRIC_CALLS
    const recipe = recipeForSeat(spec)
    const scenarios = gepaBridgeScenarios(deps.smokeInstanceId, deps.scoreSplit)
    const surfacePath = join(args.worktreePath, spec.surface)
    const seed = await readFile(surfacePath, 'utf8').catch(() => {
      throw new Error(`gepa seat '${spec.name}': surface ${spec.surface} does not exist at the incumbent commit`)
    })
    const runDir = join(config.outDir, 'gepa-seat', `gen${generation}-${spec.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`)
    await mkdir(runDir, { recursive: true })

    const objective =
      `Improve the supervisor-loop file '${spec.surface}' (returned as the COMPLETE new file content) so the ` +
      'SWE-bench smoke evaluation scores higher. Score = 1 for an officially resolved instance plus 0.25 when ' +
      'the verify fixture passes. Keep the file coherent and self-contained; only its content is applied.'
    const background =
      `The candidate string replaces ${spec.surface} in a checkout of the loops supervisor repo; every other ` +
      'file stays at the incumbent commit. Each evaluation runs one real SWE-bench instance end-to-end and ' +
      'takes minutes — spend evaluations deliberately.'
    assertNoPrivateLeak(objective + background + JSON.stringify([...scenarios.train, ...scenarios.selection]),
      deps.scoreSplit, 'bridge payload')

    const innerScores: GepaInnerCall[] = []
    const dispatchWithSurface = async (
      surface: MutableSurface,
      scenario: GepaSeatScenario,
      _ctx: DispatchContext,
    ): Promise<SmokeVerdict> => {
      if (typeof surface !== 'string') {
        throw new Error(`gepa seat '${spec.name}': candidate surface must be a string`)
      }
      if (innerScores.length >= budget) {
        // Defense-in-depth: the adapter's callback enforces the same cap.
        throw new Error(`gepa seat '${spec.name}': inner-call budget ${budget} exhausted`)
      }
      await writeFile(surfacePath, surface)
      const verdict = await deps.smokeRunner({
        scratchPath: args.worktreePath,
        generation,
        proposer: spec,
        ...(args.costLedger ? { costLedger: args.costLedger } : {}),
      })
      if (deps.scoreSplit !== null && deps.scoreSplit.privateInstances.includes(verdict.iid)) {
        throw new Error(
          `gepa seat '${spec.name}': smoke ran PRIVATE instance ${verdict.iid} — refusing to feed its score to the bridge`,
        )
      }
      innerScores.push({
        call: innerScores.length + 1,
        scenarioId: scenario.id,
        smokeIid: verdict.iid,
        candidateSha256: sha256(surface),
        composite: innerSmokeComposite(verdict),
        resolved: verdict.resolved,
        verifyPass: verdict.verifyPass ?? null,
        pass: verdict.pass,
        wallS: verdict.wallS,
      })
      log(
        `gepa seat ${spec.name} inner call ${innerScores.length}/${budget}: ` +
          `composite=${innerSmokeComposite(verdict)} (${verdict.reason})`,
      )
      return verdict
    }

    const factory = deps.methodFactory ?? (await loadGepaMethodFactory())
    const method = factory({
      name: `gepa-seat:${spec.name}`,
      recipe,
      objective,
      background,
      describeScenario: (scenario) => ({ id: scenario.id }),
      // Ceiling, not expectation: every inner call is a real arm cell.
      timeoutMs: budget * config.dispatchTimeoutMs,
      runner: { command: spec.python ?? DEFAULT_GEPA_PYTHON },
    })

    const input: OptimizationMethodInput<GepaSeatScenario, SmokeVerdict> = {
      baselineSurface: seed,
      trainScenarios: scenarios.train,
      selectionScenarios: scenarios.selection,
      dispatchWithSurface,
      judges: [innerSmokeJudge()],
      runDir,
      seed: config.round * 1000 + generation,
      runOptions: {
        maxConcurrency: 1,
        dispatchTimeoutMs: config.dispatchTimeoutMs,
        labeledStore: 'off',
        tracing: 'off',
        expectUsage: 'off',
        resumable: false,
      },
    }

    const started = Date.now()
    const result = await method.optimize(input)
    const winner = result.winnerSurface
    if (typeof winner !== 'string' || winner.trim().length === 0) {
      throw new Error(`gepa seat '${spec.name}': adapter returned a non-string winner surface`)
    }

    const innerRun: GepaSeatInnerRun = {
      seat: spec.name,
      engine: spec.engine,
      surface: spec.surface,
      generation,
      budget,
      innerCallCount: innerScores.length,
      innerScores,
      bestComposite: innerScores.length > 0 ? Math.max(...innerScores.map((s) => s.composite)) : null,
      adapterReportedCostUsd: result.cost.totalCostUsd,
      adapterCostAccountingComplete: result.cost.accountingComplete,
      durationMs: Date.now() - started,
    }
    await writeFile(join(runDir, 'inner-provenance.json'), JSON.stringify(innerRun, null, 2))
    await recordGepaSeatInnerRun(config.outDir, innerRun)

    if (winner === seed) {
      // Restore the seed (the last inner call may have left another candidate)
      // and decline the slot — an unchanged surface has no candidate diff.
      await writeFile(surfacePath, seed)
      return {
        applied: false,
        summary: `gepa ${spec.engine}: best candidate equals the seed after ${innerScores.length} inner call(s)`,
      }
    }

    await writeFile(surfacePath, winner)
    if (config.activationGate === true) {
      const predicate = mechanicalActivationPredicate(seed, winner, spec.surface)
      if (predicate === null) {
        await writeFile(surfacePath, seed)
        return {
          applied: false,
          summary:
            `gepa ${spec.engine}: winner adds no line of >=${MIN_PREDICATE_LINE_CHARS} chars — ` +
            'cannot derive a machine-checkable activation predicate; candidate declined',
        }
      }
      const predicatePath = join(args.worktreePath, ACTIVATION_PREDICATE_RELPATH)
      await mkdir(dirname(predicatePath), { recursive: true })
      await writeFile(predicatePath, JSON.stringify(predicate, null, 2))
    }
    return {
      applied: true,
      summary:
        `gepa ${spec.engine} optimized ${spec.surface} over ${innerScores.length}/${budget} inner smoke call(s); ` +
        `best inner composite ${innerRun.bestComposite}`,
    }
  }
}
