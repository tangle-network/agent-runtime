/**
 * GEPA proposer seat using agent-eval's official
 * `gepaOptimizationMethod` as one author in the swe-arena fan-out.
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
 * OPTIONAL RUNTIME (fails at provenance time, before a candidate slot is used):
 *   - Python: `agent_eval_rpc.gepa_bridge` + a GEPA build with
 *     `optimize_anything`/`OptimizeAnythingConfig` must import —
 *     `probeGepaRuntime` throws with the pip install instruction otherwise.
 * The TypeScript adapter is a pinned package dependency and imported directly.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type DispatchContext,
  createRunCostLedger,
  fsCampaignStorage,
  type GepaOptimizationMethodConfig,
  type GepaOptimizationRecipe,
  gepaOptimizationMethod,
  type JudgeConfig,
  type MutableSurface,
  type OptimizationMethod,
  type OptimizationMethodInput,
  type OptimizationMethodProvenance,
  type Scenario,
} from '@tangle-network/agent-eval/campaign'
import { officialOptimizerModel } from '../official-optimizer-config.mts'
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
// Recipe.
// ---------------------------------------------------------------------------

export type GepaSeatRecipe = Extract<
  GepaOptimizationRecipe,
  { kind: 'engine' | 'omni' }
>

/** Build the bounded recipe for a seat. The TOTAL inner-evaluation budget is
 *  exactly `maxMetricCalls`. The adapter's local callback enforces the sum
 *  of per-run limits, and the seat's own dispatch wrapper re-enforces it. */
export function recipeForSeat(spec: GepaSeatSpec): GepaSeatRecipe {
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
    kind: 'omni',
    explore,
    continueWith: { engine: 'gepa', maxEvaluations: continueCalls, maxProposerCostUsd: perRunCost },
  }
}

export function recipeEvaluationBudget(recipe: GepaSeatRecipe): number {
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
    judgeVersion: 'gepa-inner-smoke',
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
// Optional Python runtime.
// ---------------------------------------------------------------------------

export const GEPA_PYTHON_INSTALL_HINT =
  'install `agent-eval-rpc==0.126.5`, then install ' +
  '`gepa[full] @ git+https://github.com/gepa-ai/gepa.git@f919db0a622e2e9f9204779b81fe00cc1b2d808f`'

export type GepaMethodFactory = (
  config: GepaOptimizationMethodConfig<GepaSeatScenario, SmokeVerdict>,
) => OptimizationMethod<GepaSeatScenario, SmokeVerdict>

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

type OptimizationPackageSource = OptimizationMethodProvenance['source']
type OptimizationModuleSource = NonNullable<OptimizationMethodProvenance['modules']>[number]
type OptimizationPythonRuntime = NonNullable<OptimizationMethodProvenance['python']>
type OptimizationTokenUsage = NonNullable<OptimizationMethodProvenance['tokenUsage']>

export interface GepaSeatInnerRun {
  seat: string
  engine: GepaEngineName
  surface: string
  generation: number
  budget: number
  innerCallCount: number
  innerScores: GepaInnerCall[]
  bestComposite: number | null
  source: OptimizationPackageSource & { revision: string; sourceSha256: string }
  bridge: OptimizationPackageSource & { sourceSha256: string }
  modules: OptimizationModuleSource[]
  python: OptimizationPythonRuntime
  runId: string
  compatibleRunId: string
  resumed: boolean
  evaluationCount: number
  tokenUsage: OptimizationTokenUsage
  artifactDir: string
  totalCostUsd: number
  accountingComplete: boolean
  incompleteReasons: string[]
  durationMs: number
}

export const PROPOSER_PROVENANCE_FILENAME = 'proposer-provenance.json'
export const GEPA_INNER_RUNS_DIRNAME = 'gepa-inner-runs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8')
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`gepa seat: malformed JSON in existing provenance file ${path}`, { cause: error })
  }
  if (!isRecord(value)) {
    throw new Error(`gepa seat: existing provenance file ${path} must contain a JSON object`)
  }
  return value
}

async function validateExistingRunRecords(outDir: string): Promise<void> {
  const launchRecordPath = join(outDir, PROPOSER_PROVENANCE_FILENAME)
  try {
    await readJsonObject(launchRecordPath)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }

  const recordsDir = join(outDir, GEPA_INNER_RUNS_DIRNAME)
  let entries
  try {
    entries = await readdir(recordsDir, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      await readJsonObject(join(recordsDir, entry.name))
    }
  }
}

/** Persist one immutable record without mutating the shared launch record. */
export async function recordGepaSeatInnerRun(outDir: string, run: GepaSeatInnerRun): Promise<string> {
  await validateExistingRunRecords(outDir)
  const recordsDir = join(outDir, GEPA_INNER_RUNS_DIRNAME)
  await mkdir(recordsDir, { recursive: true })
  const identity = createHash('sha256')
    .update(JSON.stringify({ seat: run.seat, generation: run.generation, runId: run.runId }))
    .digest('hex')
    .slice(0, 16)
  const nonce = randomUUID()
  const filename = `${identity}-${nonce}.json`
  const finalPath = join(recordsDir, filename)
  const temporaryPath = join(recordsDir, `.${filename}.tmp`)
  try {
    await writeFile(temporaryPath, JSON.stringify(run, null, 2), { flag: 'wx' })
    await rename(temporaryPath, finalPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return finalPath
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`gepa seat: optimizer result omitted ${label}`)
  }
  return value
}

function requiredSha256(value: unknown, label: string): string {
  const hash = requiredText(value, label)
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`gepa seat: optimizer result returned invalid ${label}`)
  }
  return hash
}

function requiredCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`gepa seat: optimizer result returned invalid ${label}`)
  }
  return value as number
}

function completeProvenance(
  provenance: OptimizationMethodProvenance | undefined,
  seatName: string,
): Pick<
  GepaSeatInnerRun,
  | 'source'
  | 'bridge'
  | 'modules'
  | 'python'
  | 'runId'
  | 'compatibleRunId'
  | 'resumed'
  | 'evaluationCount'
  | 'tokenUsage'
  | 'artifactDir'
> {
  const label = `gepa seat '${seatName}'`
  if (provenance === undefined) {
    throw new Error(`${label}: optimizer result omitted provenance`)
  }
  if (
    provenance.source.kind !== 'package' ||
    provenance.source.evidence !== 'observed' ||
    requiredText(provenance.source.package, 'source.package') !== 'gepa'
  ) {
    throw new Error(`${label}: optimizer result returned invalid source package`)
  }
  requiredText(provenance.source.version, 'source.version')
  const sourceRevision = requiredText(provenance.source.revision, 'source.revision')
  const sourceSha256 = requiredSha256(provenance.source.sourceSha256, 'source.sourceSha256')
  if (provenance.bridge === undefined) {
    throw new Error(`${label}: optimizer result omitted bridge provenance`)
  }
  if (
    provenance.bridge.kind !== 'package' ||
    provenance.bridge.evidence !== 'observed' ||
    requiredText(provenance.bridge.package, 'bridge.package') !== 'agent-eval-rpc'
  ) {
    throw new Error(`${label}: optimizer result returned invalid bridge package`)
  }
  requiredText(provenance.bridge.version, 'bridge.version')
  const bridgeSha256 = requiredSha256(provenance.bridge.sourceSha256, 'bridge.sourceSha256')
  if (provenance.modules === undefined) {
    throw new Error(`${label}: optimizer result omitted module provenance`)
  }
  const modules = provenance.modules.map((module, index) => ({
    module: requiredText(module.module, `modules[${index}].module`),
    sourceSha256: requiredSha256(module.sourceSha256, `modules[${index}].sourceSha256`),
  }))
  if (provenance.python === undefined) {
    throw new Error(`${label}: optimizer result omitted Python provenance`)
  }
  const python = {
    implementation: requiredText(provenance.python.implementation, 'python.implementation'),
    version: requiredText(provenance.python.version, 'python.version'),
  }
  if (provenance.compatibleRunId === undefined) {
    throw new Error(`${label}: optimizer result omitted compatibleRunId`)
  }
  if (provenance.tokenUsage === undefined) {
    throw new Error(`${label}: optimizer result omitted token usage`)
  }
  const tokenUsage = {
    inputTokens: requiredCount(provenance.tokenUsage.inputTokens, 'tokenUsage.inputTokens'),
    ...(provenance.tokenUsage.cachedInputTokens === undefined
      ? {}
      : {
          cachedInputTokens: requiredCount(
            provenance.tokenUsage.cachedInputTokens,
            'tokenUsage.cachedInputTokens',
          ),
        }),
    ...(provenance.tokenUsage.cacheWriteInputTokens === undefined
      ? {}
      : {
          cacheWriteInputTokens: requiredCount(
            provenance.tokenUsage.cacheWriteInputTokens,
            'tokenUsage.cacheWriteInputTokens',
          ),
        }),
    outputTokens: requiredCount(provenance.tokenUsage.outputTokens, 'tokenUsage.outputTokens'),
    ...(provenance.tokenUsage.reasoningTokens === undefined
      ? {}
      : {
          reasoningTokens: requiredCount(
            provenance.tokenUsage.reasoningTokens,
            'tokenUsage.reasoningTokens',
          ),
        }),
    totalTokens: requiredCount(provenance.tokenUsage.totalTokens, 'tokenUsage.totalTokens'),
    calls: requiredCount(provenance.tokenUsage.calls, 'tokenUsage.calls'),
  }
  if (tokenUsage.totalTokens !== tokenUsage.inputTokens + tokenUsage.outputTokens) {
    throw new Error(`${label}: optimizer result returned inconsistent token usage`)
  }
  return {
    source: { ...provenance.source, revision: sourceRevision, sourceSha256 },
    bridge: { ...provenance.bridge, sourceSha256: bridgeSha256 },
    modules,
    python,
    runId: requiredText(provenance.runId, 'runId'),
    compatibleRunId: requiredText(provenance.compatibleRunId, 'compatibleRunId'),
    resumed: provenance.resumed,
    evaluationCount: requiredCount(provenance.evaluationCount, 'evaluationCount'),
    tokenUsage,
    artifactDir: requiredText(provenance.artifactDir, 'artifactDir'),
  }
}

function assertCompleteCost(
  cost: { totalCostUsd: number; accountingComplete: boolean; incompleteReasons: string[] },
  seatName: string,
): void {
  if (!Number.isFinite(cost.totalCostUsd) || cost.totalCostUsd < 0) {
    throw new Error(`gepa seat '${seatName}': optimizer returned invalid total cost`)
  }
  if (
    !Array.isArray(cost.incompleteReasons) ||
    cost.incompleteReasons.some(
      (reason) => typeof reason !== 'string' || reason.length === 0 || reason !== reason.trim(),
    )
  ) {
    throw new Error(`gepa seat '${seatName}': optimizer returned invalid incomplete reasons`)
  }
  if (cost.accountingComplete !== (cost.incompleteReasons.length === 0)) {
    throw new Error(`gepa seat '${seatName}': optimizer returned inconsistent cost accounting`)
  }
  if (!cost.accountingComplete) {
    throw new Error(
      `gepa seat '${seatName}': cost accounting is incomplete: ${cost.incompleteReasons.join('; ') || 'no reason provided'}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Mechanical activation predicate.
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
  /** Test override. Default: agent-eval's official GEPA method. */
  methodFactory?: GepaMethodFactory
  /** Explicit model override. Production otherwise resolves the metered model from env. */
  optimizer?: NonNullable<
    GepaOptimizationMethodConfig<GepaSeatScenario, SmokeVerdict>['optimizer']
  >
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

    const storage = fsCampaignStorage()
    const costLedger =
      args.costLedger ??
      createRunCostLedger({
        storage,
        runDir: `${runDir}/cost`,
      })
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
        costLedger,
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

    const factory: GepaMethodFactory =
      deps.methodFactory ?? gepaOptimizationMethod<GepaSeatScenario, SmokeVerdict>
    const optimizer =
      deps.optimizer ??
      (deps.methodFactory
        ? undefined
        : officialOptimizerModel({
            env: process.env,
            envPrefix: 'GEPA_OPTIMIZER',
            model: process.env.GEPA_OPTIMIZER_MODEL ?? config.arm.driverModel,
            baseUrl:
              process.env.GEPA_OPTIMIZER_BASE_URL ??
              process.env.ROUTER_BASE ??
              'https://router.tangle.tools/v1',
            apiKey: process.env.GEPA_OPTIMIZER_API_KEY ?? process.env.TANGLE_API_KEY ?? '',
            maxCostUsd: spec.maxProposerCostUsd ?? DEFAULT_MAX_PROPOSER_COST_USD,
            maxOutputTokensPerRequest: Number(
              process.env.GEPA_OPTIMIZER_MAX_OUTPUT_TOKENS ?? 16_384,
            ),
          }))
    const method = factory({
      name: `gepa-seat:${spec.name}`,
      recipe,
      objective,
      evaluationId: [
        'swe-arena-gepa-seat',
        `smoke=${deps.smokeInstanceId}`,
        'judge=gepa-inner-smoke',
        `dispatchTimeoutMs=${config.dispatchTimeoutMs}`,
      ].join('|'),
      background,
      describeScenario: (scenario) => ({ id: scenario.id }),
      ...(optimizer ? { optimizer } : {}),
      // Upper bound, not expectation: every inner call is a real arm cell.
      timeoutMs: budget * config.dispatchTimeoutMs,
      resume: 'if-compatible',
      trustResumeState: true,
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
        storage,
        maxConcurrency: 1,
        dispatchTimeoutMs: config.dispatchTimeoutMs,
        labeledStore: 'off',
        tracing: 'off',
        expectUsage: 'off',
        resumable: false,
      },
      costLedger,
    }

    const started = Date.now()
    const result = await method.optimize(input)
    let innerRun: GepaSeatInnerRun
    try {
      innerRun = {
        seat: spec.name,
        engine: spec.engine,
        surface: spec.surface,
        generation,
        budget,
        innerCallCount: innerScores.length,
        innerScores,
        bestComposite: innerScores.length > 0 ? Math.max(...innerScores.map((s) => s.composite)) : null,
        ...completeProvenance(result.provenance, spec.name),
        totalCostUsd: result.cost.totalCostUsd,
        accountingComplete: result.cost.accountingComplete,
        incompleteReasons: [...result.cost.incompleteReasons],
        durationMs: Date.now() - started,
      }
      await writeFile(join(runDir, 'inner-provenance.json'), JSON.stringify(innerRun, null, 2))
      await recordGepaSeatInnerRun(config.outDir, innerRun)
      assertCompleteCost(result.cost, spec.name)
    } catch (error) {
      await writeFile(surfacePath, seed)
      throw error
    }

    const winner = result.winnerSurface
    if (typeof winner !== 'string' || winner.trim().length === 0) {
      await writeFile(surfacePath, seed)
      throw new Error(`gepa seat '${spec.name}': adapter returned a non-string winner surface`)
    }

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
