/**
 * `improve` runs one complete optimization method against an exact profile
 * surface. Runtime extracts and materializes the profile value; agent-eval owns
 * optimization, disjoint data partitions, final-test scoring, and uncertainty.
 *
 * Code is the sole exception. It uses Runtime's isolated git worktrees because
 * checkout ownership and cleanup cannot cross a generic optimizer boundary.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import { canonicalJson, makeFinding } from '@tangle-network/agent-eval'
import {
  type CompareOptimizationMethodsOptions,
  campaignSplitDigest,
  compareOptimizationMethods,
  gitWorktreeAdapter,
  type OptimizationMethod,
  type OptimizationMethodComparison,
  type Worktree,
  type WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
import {
  type CodeSurface,
  type MutableSurface,
  type Scenario,
  type SelfImproveBudget,
  type SelfImproveOptions,
  type SelfImproveResult,
  type SurfaceProposer,
  selfImprove,
} from '@tangle-network/agent-eval/contract'
import {
  type AgentProfile,
  type AgentProfileResourceRef,
  agentProfileSchema,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import type { LocalHarness } from '../mcp/local-harness'
import { agenticGenerator, type Verifier } from './agentic-generator'
import { rethrowAfterCleanup } from './cleanup'
import {
  type CandidateGenerator,
  improvementDriver,
  type ManagedImprovementDriver,
} from './improvement-driver'
import { rawTraceDistiller } from './raw-trace-distiller'
import {
  applyRolloutPolicyToProfile,
  normalizeRolloutPolicy,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './rollout-policy'

/** The executable agent lever `improve` optimizes. Profile fields remain
 *  portable AgentProfile coordinates; implementation and orchestration files
 *  use the code surface so a winner can be sealed into an exact candidate.
 *  `rollout-policy` is the inference-time structuralRollout dials
 *  (`profile.extensions['structural-rollout']`). */
export type ImproveSurface =
  | 'prompt'
  | 'skills'
  | 'tools'
  | 'mcp'
  | 'hooks'
  | 'subagents'
  | 'agent-profile'
  | 'memory'
  | 'code'
  | 'rollout-policy'

export type ImproveProfileSurface = Exclude<ImproveSurface, 'code'>

export interface ImproveMethodContext {
  /** Validated baseline profile. */
  readonly profile: Readonly<AgentProfile>
  /** Exact profile coordinate being optimized. */
  readonly surface: ImproveProfileSurface
  /** Exact bytes supplied to the optimization method. */
  readonly baselineSurface: MutableSurface
  /** Findings produced before this search, if any. */
  readonly findings: readonly unknown[]
}

/** Build a complete method after trace findings are available. */
export type ImproveMethodFactory<TScenario extends Scenario, TArtifact> = (
  context: ImproveMethodContext,
) => OptimizationMethod<TScenario, TArtifact>

export type ImproveMethodSource<TScenario extends Scenario, TArtifact> =
  | OptimizationMethod<TScenario, TArtifact>
  | ImproveMethodFactory<TScenario, TArtifact>

/** Complete-method configuration for every non-code profile surface. */
export type ImproveMethodOptions<TScenario extends Scenario, TArtifact> = Omit<
  CompareOptimizationMethodsOptions<TScenario, TArtifact>,
  'baselineSurface' | 'dispatchWithSurface' | 'methods' | 'optimizationConcurrency'
> & {
  /** Exact profile coordinate optimized by `method`. Default `'prompt'`. */
  surface?: ImproveProfileSurface
  /** A complete optimizer or a factory that can incorporate current findings. */
  method: ImproveMethodSource<TScenario, TArtifact>
  /** Runs one candidate surface on one scenario. */
  agent: (
    surface: MutableSurface,
    scenario: TScenario,
    ctx: Parameters<
      CompareOptimizationMethodsOptions<TScenario, TArtifact>['dispatchWithSurface']
    >[2],
  ) => Promise<TArtifact>
  /** Trace or analyst findings available to a method factory. */
  findings?: readonly unknown[]
  /** Select the exact inline skill document for `surface: 'skills'`. */
  skills?: ImproveSkillsOptions
  /**
   * Map a profile to named text components and apply the winning components.
   * Valid only with `surface: 'agent-profile'`.
   */
  profileComponents?: ImproveProfileComponents
  /** Ship only when the paired final-test interval is entirely above this lift. Default `0`. */
  minimumLift?: number
}

/** Runtime-owned code search in isolated git worktrees. */
export type ImproveCodeRunOptions<TScenario extends Scenario, TArtifact> = Omit<
  SelfImproveOptions<TScenario, TArtifact>,
  | 'analyzeGeneration'
  | 'baselineSurface'
  | 'budget'
  | 'findings'
  | 'gate'
  | 'llm'
  | 'method'
  | 'mutationPrimitives'
  | 'proposer'
  | 'proposerTarget'
  | 'selectionScenarios'
> & {
  surface: 'code'
  /** Local code-search budget. Method-only selection controls do not apply. */
  budget?: Omit<SelfImproveBudget, 'selectionFraction'>
  /** Findings supplied to Runtime's code candidate driver. */
  findings?: readonly unknown[]
  /** Gate mode. `'holdout'` (default) runs the held-out promotion gate;
   *  `'none'` is a baseline-only run (`budget.generations = 0`). */
  gate?: 'holdout' | 'none'
  /** Per-generation findings producer for Runtime's code search.
   * Pass your own producer to replace the code-trace distiller; pass `null`
   * to keep the static findings for every generation. */
  analyzeGeneration?: SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration'] | null
  /** Feed code candidates paths to prior raw traces instead of a failure digest.
   * Defaults to true for durable runs and false for in-memory runs. */
  rawTraceContext?: boolean
  /** Isolated repository and candidate generator settings. */
  code: ImproveCodeOptions
  /** Custom held-back-exam decision. The string `gate` above controls whether
   *  the exam runs; this callback controls how its evidence decides promotion. */
  promotionGate?: SelfImproveOptions<TScenario, TArtifact>['gate']
}

/** The canonical improvement API: complete methods for profiles, worktrees for code. */
export type ImproveOptions<TScenario extends Scenario, TArtifact> =
  | ImproveMethodOptions<TScenario, TArtifact>
  | ImproveCodeRunOptions<TScenario, TArtifact>

export interface ImproveSkillsOptions {
  /** `name` of one inline entry in `profile.resources.skills`. */
  resourceName: string
}

/** Caller-owned mapping for optimizing several profile fields as one candidate. */
export interface ImproveProfileComponents {
  /** Extract the exact named text components optimized together. */
  read(profile: Readonly<AgentProfile>): Readonly<Record<string, string>>
  /** Apply a complete winning component map to a detached profile. */
  apply(profile: Readonly<AgentProfile>, components: Readonly<Record<string, string>>): AgentProfile
}

export interface ImproveCodeOptions {
  /** Repo root candidate worktrees fork from. */
  repoRoot: string
  /** Base ref candidates fork from. Default `main`. */
  baseRef?: string
  /** Directory worktrees are created under. Default `<repoRoot>/.worktrees`. */
  worktreeDir?: string
  /** Git-compatible adapter override, primarily for tests. Candidate advancement
   *  still requires normal Git worktree and commit semantics. */
  worktree?: WorktreeAdapter
  /** Coding harness the agentic generator runs in each worktree. Default `claude`. */
  harness?: LocalHarness
  /** Verify a candidate worktree before it becomes a measurable surface; failures
   *  feed the next shot (see `agenticGenerator.verify` / `commandVerifier`). */
  verify?: Verifier
  /** Per-shot wall-clock timeout for the harness (ms). */
  timeoutMs?: number
  /** Byte-producer override — the test seam and the escape hatch for custom
   *  candidate production. When set, `harness`/`verify`/`timeoutMs` are unused. */
  generator?: CandidateGenerator
}

export interface ImprovementCandidate {
  /** Surface searched by this run. */
  surface: ImproveSurface
  /** Exact winning value returned by agent-eval. */
  value: MutableSurface
  /** Detached profile candidate when the surface maps directly to AgentProfile. */
  profile?: AgentProfile
}

/** Normalized spend reported for one Runtime improvement run. */
export interface ImproveCost {
  totalCostUsd: number
  accountingComplete: boolean
  incompleteReasons: string[]
}

/** Optimizer ancestry sealed into downstream candidate experiments. */
export interface ImproveLineage {
  /** Upstream optimizer run when reported, otherwise this Runtime optimization invocation. */
  runId: string
  /** Exact train-plus-selection scenario payloads exposed to candidate selection. */
  developmentSplitDigest: Sha256Digest
}

interface ImproveResultBase {
  /** Frozen candidate only. Live state is changed through an approved activation. */
  candidate: ImprovementCandidate
  /** Final-test decision for this search result. */
  decision: SelfImproveResult<Scenario, unknown>['gateDecision']
  /** Final-test lift when one was measured. */
  lift?: number
  /** Paired final-test confidence interval for method-based profile runs. */
  liftInterval?: { low: number; high: number }
  /** Full search and final-test spend. */
  cost: ImproveCost
  /** Full wall-clock duration. */
  durationMs: number
  /** Optimizer ancestry used when sealing a candidate experiment. */
  lineage: ImproveLineage
  /** Number of generations explored by Runtime's code path. */
  generationsExplored?: number
  /** Release resources owned by this result. Idempotent; currently disposes
   *  the returned code worktree and is a no-op for profile-only surfaces. */
  dispose(): Promise<void>
}

export interface ImproveMethodResult extends ImproveResultBase {
  mode: 'method'
  method: string
  /** External optimizer package and resumable run identity, when reported. */
  provenance?: OptimizationMethodComparison['best']['provenance']
  decision: 'ship' | 'hold'
  lift: number
  liftInterval: { low: number; high: number }
  raw: OptimizationMethodComparison
}

export interface ImproveCodeResult<TScenario extends Scenario, TArtifact>
  extends ImproveResultBase {
  mode: 'code'
  raw: SelfImproveResult<TScenario, TArtifact>
}

export type ImproveResult<TScenario extends Scenario, TArtifact> =
  | ImproveMethodResult
  | ImproveCodeResult<TScenario, TArtifact>

/** Extract the baseline optimized by a method. Prompt, skills, and memory are
 * text; config fields are JSON; a caller may map the full profile to named
 * components explicitly. */
function baselineSurfaceFor(
  profile: AgentProfile,
  surface: ImproveSurface,
  skills?: ImproveSkillsOptions,
  profileComponents?: ImproveProfileComponents,
): MutableSurface {
  switch (surface) {
    case 'prompt':
      return profile.prompt?.systemPrompt ?? ''
    case 'skills':
      return inlineSkill(profile, skills).content
    case 'tools':
      return canonicalJson(profile.tools ?? {})
    case 'mcp':
      return canonicalJson(profile.mcp ?? {})
    case 'hooks':
      return canonicalJson(profile.hooks ?? {})
    case 'subagents':
      return canonicalJson(profile.subagents ?? {})
    case 'agent-profile':
      return profileComponents
        ? componentSurface(profileComponents.read(profile), 'profileComponents.read')
        : canonicalJson(profile)
    case 'memory':
      return profileInstructions(profile)
    case 'rollout-policy': {
      const policy = structuralRolloutPolicyFromProfile(profile)
      if (!policy) {
        throw new ConfigError(
          "improve(): surface 'rollout-policy' requires an existing structural rollout policy",
        )
      }
      return serializeRolloutPolicy(policy)
    }
    case 'code':
      throw new ConfigError(
        'improve(): code requires the isolated baseline created from opts.code.repoRoot',
      )
  }
}

/** Slice bound for distilled judge notes: wide enough that a real traceback /
 *  failing-assertion note survives intact — clipping mid-traceback would leave
 *  the proposer trace-blind. Referenced by the `rawTraceContext` docs. */
const DISTILLED_NOTES_MAX_CHARS = 1500

/** Slice bound for a cell's error string — tighter than notes (errors are
 *  usually one line; the full text stays on the raw cell). Also bounds the
 *  error-derived `claim` fallback. */
const DISTILLED_ERROR_MAX_CHARS = 500

/** The in-memory-run `analyzeGeneration`: distill each generation's failing cells
 *  into TYPED `AnalystFinding`s for the next proposal round — the same envelope
 *  `rawTraceDistiller` and the analyst registry emit, so consumers never branch on
 *  a second ad-hoc digest shape. Judge notes and errors are already the domain's
 *  own diagnosis (executable gates put their reasons there); a trace-analyst can
 *  replace this wholesale via `opts.analyzeGeneration`. Falls back to the static
 *  seed findings when the generation had no failures, so a clean round never wipes
 *  the seed context. */
function generationFailureDistiller<TScenario extends Scenario, TArtifact>(
  staticFindings: unknown[],
): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']> {
  const CAP = 12
  return async (input) => {
    const failures: Array<{
      scenario: string
      composite: number
      notes: string
      claim?: string
      error?: string
    }> = []
    for (const candidate of input.candidates) {
      for (const rawCell of candidate.campaign.cells) {
        const cell = rawCell as unknown as Record<string, unknown>
        const scenario = String(cell.scenarioId ?? 'unknown')
        const error = typeof cell.error === 'string' ? cell.error : undefined
        const judgeScores =
          cell.judgeScores && typeof cell.judgeScores === 'object'
            ? Object.values(
                cell.judgeScores as Record<string, { composite?: number; notes?: string }>,
              )
            : []
        const composite =
          judgeScores.length === 0
            ? 0
            : judgeScores.reduce((sum, j) => sum + (j.composite ?? 0), 0) / judgeScores.length
        if (!error && composite >= 0.999) continue
        const notes = judgeScores
          .map((j) => j.notes)
          .filter((n): n is string => typeof n === 'string' && n.length > 0)
          .join('; ')
          .slice(0, DISTILLED_NOTES_MAX_CHARS)
        const claim =
          notes ||
          (error ? `Scenario ${scenario} failed: ${error.slice(0, DISTILLED_ERROR_MAX_CHARS)}` : '')
        failures.push({
          scenario,
          composite: Number(composite.toFixed(3)),
          notes,
          ...(claim ? { claim } : {}),
          ...(error ? { error: error.slice(0, DISTILLED_ERROR_MAX_CHARS) } : {}),
        })
      }
    }
    if (failures.length === 0) return staticFindings
    failures.sort((a, b) => a.composite - b.composite)
    return failures.slice(0, CAP).map((f) =>
      makeFinding({
        analyst_id: 'generation-failure-distiller',
        severity: f.error !== undefined || f.composite < 0.5 ? 'high' : 'medium',
        area: 'generation-failure',
        confidence: 1,
        subject: f.scenario,
        claim: `Scenario ${f.scenario} scored composite ${f.composite}${
          f.notes ? `: ${f.notes}` : ''
        }${f.error ? ` (error: ${f.error})` : ''}`,
        evidence_refs: [],
        metadata: {
          scenario: f.scenario,
          composite: f.composite,
          ...(f.notes ? { notes: f.notes } : {}),
          ...(f.error !== undefined ? { error: f.error } : {}),
        },
      }),
    )
  }
}

/** Default code-run analysis: raw trace paths for durable runs, otherwise a
 * bounded digest of failed cells. */
function defaultDistillerFor<TScenario extends Scenario, TArtifact>(
  opts: ImproveCodeRunOptions<TScenario, TArtifact>,
  findings: unknown[],
): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']> {
  const durableRun = opts.runDir !== undefined && !opts.runDir.startsWith('mem://')
  const useRawTraces = opts.rawTraceContext ?? durableRun
  if (useRawTraces) return rawTraceDistiller<TScenario, TArtifact>({ fallbackFindings: findings })
  return generationFailureDistiller<TScenario, TArtifact>(findings)
}

interface PreparedCodeRun {
  baseline: CodeSurface
  proposer: SurfaceProposer
  cleanup(retainedWinner?: MutableSurface): Promise<void>
}

async function discardPreparedBaseline(
  worktree: WorktreeAdapter,
  baselineWorktree: Worktree,
  cause: unknown,
): Promise<never> {
  return rethrowAfterCleanup(
    cause,
    () => worktree.discard(baselineWorktree),
    'improve(): code preparation failed',
  )
}

function isCodeSurface(surface: MutableSurface | undefined): surface is CodeSurface {
  return typeof surface === 'object' && surface !== null && surface.kind === 'code'
}

type ComponentSurface = Extract<MutableSurface, { readonly kind: 'components' }>

function isComponentSurface(surface: MutableSurface | undefined): surface is ComponentSurface {
  return typeof surface === 'object' && surface !== null && surface.kind === 'components'
}

function componentSurface(
  components: Readonly<Record<string, string>>,
  source: string,
): ComponentSurface {
  const entries = validateComponents(components, source)
  return immutableCandidateValue({
    kind: 'components',
    components: Object.fromEntries(entries),
  } as ComponentSurface)
}

function validateComponents(
  components: Readonly<Record<string, string>>,
  source: string,
): Array<[string, string]> {
  if (typeof components !== 'object' || components === null || Array.isArray(components)) {
    throw new ConfigError(`improve(): ${source} must return a component record`)
  }
  const entries = Object.entries(components)
  if (entries.length === 0) {
    throw new ConfigError(`improve(): ${source} must return at least one component`)
  }
  for (const [name, value] of entries) {
    if (!name || name.trim() !== name || typeof value !== 'string') {
      throw new ConfigError(
        `improve(): ${source} must return trimmed component names with string values`,
      )
    }
  }
  return entries
}

/** Create a clean incumbent checkout and the candidate producer for a code run. */
async function prepareCodeRun(code: ImproveCodeOptions): Promise<PreparedCodeRun> {
  const baseRef = code.baseRef ?? 'main'
  const worktree =
    code.worktree ??
    gitWorktreeAdapter({
      repoRoot: code.repoRoot,
      ...(code.worktreeDir ? { worktreeDir: code.worktreeDir } : {}),
    })
  const baselineWorktree = await worktree.create({ baseRef, label: 'incumbent-baseline' })
  try {
    const baseline = await worktree.finalize(baselineWorktree, 'Incumbent code checkout')
    let baselineDiscarded = false
    const generator =
      code.generator ??
      agenticGenerator({
        ...(code.harness ? { harness: code.harness } : {}),
        ...(code.verify ? { verify: code.verify } : {}),
        ...(code.timeoutMs ? { timeoutMs: code.timeoutMs } : {}),
      })
    const managed: ManagedImprovementDriver = improvementDriver({ worktree, generator, baseRef })

    return {
      baseline,
      proposer: managed,
      async cleanup(retainedWinner) {
        const errors: unknown[] = []
        const retainedWorktreeRef = isCodeSurface(retainedWinner)
          ? retainedWinner.worktreeRef
          : undefined
        try {
          await managed?.cleanup(retainedWorktreeRef ? [retainedWorktreeRef] : [])
        } catch (cause) {
          errors.push(cause)
        }
        if (!baselineDiscarded && retainedWorktreeRef !== baseline.worktreeRef) {
          try {
            await worktree.discard(baselineWorktree)
            baselineDiscarded = true
          } catch (cause) {
            errors.push(cause)
          }
        }
        if (errors.length > 0) {
          throw new AggregateError(errors, 'improve(): failed to clean code improvement worktrees')
        }
      },
    }
  } catch (cause) {
    return discardPreparedBaseline(worktree, baselineWorktree, cause)
  }
}

function idempotentDispose(dispose: () => Promise<void>): () => Promise<void> {
  let disposed = false
  let inFlight: Promise<void> | undefined
  return async () => {
    if (disposed) return
    if (inFlight) return inFlight
    inFlight = (async () => {
      await dispose()
      disposed = true
    })()
    try {
      await inFlight
    } finally {
      inFlight = undefined
    }
  }
}

/** Parse a JSON winner surface with a typed, contextual error. */
function parseWinnerJson<T>(winner: string, surface: ImproveSurface): T {
  try {
    return JSON.parse(winner) as T
  } catch (cause) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate is not valid JSON, so it cannot form a profile candidate: ${
        (cause as Error).message
      }`,
    )
  }
}

function assertCandidateSurfaceKind(
  surface: ImproveSurface,
  baseline: MutableSurface,
  winner: MutableSurface,
): asserts winner is MutableSurface {
  if (surface === 'code') {
    if (isCodeSurface(winner)) return
    throw new ConfigError(
      `improve(): the '${surface}' candidate returned an incompatible surface value`,
    )
  }
  if (typeof baseline === 'string') {
    if (typeof winner === 'string') return
    throw new ConfigError(
      `improve(): the '${surface}' candidate changed from a text surface to an incompatible surface value`,
    )
  }
  if (!isComponentSurface(baseline) || !isComponentSurface(winner)) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate returned an incompatible surface value`,
    )
  }
  validateComponents(winner.components, `the '${surface}' candidate`)
  const baselineNames = Object.keys(baseline.components).sort()
  const winnerNames = Object.keys(winner.components).sort()
  if (
    baselineNames.length !== winnerNames.length ||
    baselineNames.some((name, index) => name !== winnerNames[index])
  ) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate must preserve the exact component names`,
    )
  }
}

/** Materialize a detached profile candidate without changing the baseline. */
function materializeImprovementProfileCandidate(
  profile: AgentProfile,
  surface: ImproveSurface,
  winner: MutableSurface,
  skills?: ImproveSkillsOptions,
  profileComponents?: ImproveProfileComponents,
): AgentProfile | undefined {
  let candidate: AgentProfile
  if (isComponentSurface(winner)) {
    if (surface !== 'agent-profile' || !profileComponents) {
      throw new ConfigError(
        `improve(): the '${surface}' candidate has no profile component mapping`,
      )
    }
    const winnerComponents = immutableCandidateValue({ ...winner.components })
    candidate = profileComponents.apply(profile, winnerComponents)
    const validated = validateProfileCandidate(candidate, surface)
    const materializedComponents = Object.fromEntries(
      validateComponents(profileComponents.read(validated), 'profileComponents.read after apply'),
    )
    const names = Object.keys(winnerComponents)
    if (
      names.length !== Object.keys(materializedComponents).length ||
      names.some((name) => materializedComponents[name] !== winnerComponents[name])
    ) {
      throw new ConfigError(
        'improve(): profileComponents.apply must round-trip every winning component exactly',
      )
    }
    return validated
  }
  if (typeof winner !== 'string') return undefined
  switch (surface) {
    case 'prompt':
      candidate = { ...profile, prompt: { ...profile.prompt, systemPrompt: winner } }
      break
    case 'skills': {
      const selectedSkill = inlineSkill(profile, skills)
      candidate = {
        ...profile,
        resources: {
          ...profile.resources,
          skills: profile.resources?.skills?.map((resource) =>
            resource === selectedSkill ? { ...resource, content: winner } : resource,
          ),
        },
      }
      break
    }
    case 'tools':
      candidate = { ...profile, tools: parseWinnerJson(winner, surface) }
      break
    case 'mcp':
      candidate = { ...profile, mcp: parseWinnerJson(winner, surface) }
      break
    case 'hooks':
      candidate = { ...profile, hooks: parseWinnerJson(winner, surface) }
      break
    case 'subagents':
      candidate = { ...profile, subagents: parseWinnerJson(winner, surface) }
      break
    case 'agent-profile':
      candidate = parseWinnerJson(winner, surface)
      break
    case 'memory':
      candidate = {
        ...profile,
        resources: {
          ...profile.resources,
          instructions: replaceProfileInstructions(profile, winner),
        },
      }
      break
    case 'rollout-policy': {
      const policy = normalizeRolloutPolicy(parseWinnerJson(winner, surface))
      if (!policy) {
        throw new ConfigError(
          `improve(): the shipped 'rollout-policy' winner is not a valid StructuralRolloutPolicy ` +
            `(integer k >= 1, repairRounds >= 0, testgen >= 0), so it cannot be applied: ${winner}`,
        )
      }
      candidate = applyRolloutPolicyToProfile(profile, policy)
      break
    }
    case 'code':
      return undefined
  }
  return validateProfileCandidate(candidate, surface)
}

function validateProfileCandidate(candidate: AgentProfile, surface: ImproveSurface): AgentProfile {
  const parsed = agentProfileSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new ConfigError(
      `improve(): the '${surface}' candidate does not produce a valid AgentProfile: ${parsed.error.message}`,
    )
  }
  return immutableCandidateValue(parsed.data)
}

function inlineSkill(
  profile: AgentProfile,
  options: ImproveSkillsOptions | undefined,
): Extract<AgentProfileResourceRef, { kind: 'inline' }> {
  const resourceName = options?.resourceName.trim()
  if (!resourceName) {
    throw new ConfigError(
      "improve(): surface 'skills' requires opts.skills.resourceName for one inline profile skill",
    )
  }
  assertFailClosedResources(profile, 'skills')
  const matches = (profile.resources?.skills ?? []).filter(
    (resource) => resource.name === resourceName,
  )
  if (matches.length !== 1 || matches[0]?.kind !== 'inline') {
    throw new ConfigError(
      `improve(): skill '${resourceName}' must identify exactly one inline profile resource`,
    )
  }
  return matches[0]
}

function profileInstructions(profile: AgentProfile): string {
  assertFailClosedResources(profile, 'memory')
  const instructions = profile.resources?.instructions
  if (instructions === undefined) return ''
  if (typeof instructions === 'string') return instructions
  if (instructions.kind === 'inline') return instructions.content
  throw new ConfigError(
    "improve(): surface 'memory' requires inline profile instructions so candidate bytes are exact",
  )
}

function replaceProfileInstructions(
  profile: AgentProfile,
  content: string,
): string | AgentProfileResourceRef {
  const instructions = profile.resources?.instructions
  if (typeof instructions !== 'object') return content
  if (instructions.kind !== 'inline') {
    throw new ConfigError(
      "improve(): surface 'memory' requires inline profile instructions so candidate bytes are exact",
    )
  }
  return { ...instructions, content }
}

function assertFailClosedResources(profile: AgentProfile, surface: 'skills' | 'memory'): void {
  if (profile.resources?.failOnError !== true) {
    throw new ConfigError(
      `improve(): surface '${surface}' requires profile.resources.failOnError: true`,
    )
  }
}

function resolveOptimizationMethod<TScenario extends Scenario, TArtifact>(
  source: ImproveMethodSource<TScenario, TArtifact>,
  context: ImproveMethodContext,
): OptimizationMethod<TScenario, TArtifact> {
  const method = typeof source === 'function' ? source(context) : source
  if (
    !method ||
    typeof method !== 'object' ||
    typeof method.name !== 'string' ||
    method.name.trim() !== method.name ||
    method.name.length === 0 ||
    typeof method.optimize !== 'function'
  ) {
    throw new ConfigError(
      'improve(): method must be a complete OptimizationMethod with a trimmed name and optimize(input)',
    )
  }
  return method
}

function copyCost(cost: {
  totalCostUsd: number
  accountingComplete: boolean
  incompleteReasons: readonly string[]
}): ImproveCost {
  return {
    totalCostUsd: cost.totalCostUsd,
    accountingComplete: cost.accountingComplete,
    incompleteReasons: [...cost.incompleteReasons],
  }
}

function copyProvenance(
  provenance: NonNullable<OptimizationMethodComparison['best']['provenance']>,
): NonNullable<OptimizationMethodComparison['best']['provenance']> {
  return {
    ...provenance,
    source: { ...provenance.source },
    ...(provenance.tokenUsage ? { tokenUsage: { ...provenance.tokenUsage } } : {}),
  }
}

function developmentSplitDigest<TScenario extends Scenario>(
  trainScenarios: readonly TScenario[],
  selectionScenarios: readonly TScenario[],
  reps: number,
): Sha256Digest {
  return canonicalCandidateDigest({
    train: campaignSplitDigest(trainScenarios, reps),
    selection: campaignSplitDigest(selectionScenarios, reps),
  })
}

async function runMethodImprovement<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveMethodOptions<TScenario, TArtifact>,
): Promise<ImproveMethodResult> {
  const {
    surface = 'prompt',
    method: methodSource,
    agent,
    findings: inputFindings = [],
    skills,
    profileComponents,
    minimumLift = 0,
    ...comparisonOptions
  } = opts
  if (!Number.isFinite(minimumLift) || minimumLift < 0) {
    throw new ConfigError(
      'improve(): minimumLift must be a finite number greater than or equal to 0',
    )
  }
  if (profileComponents && surface !== 'agent-profile') {
    throw new ConfigError("improve(): profileComponents is valid only with surface 'agent-profile'")
  }
  const findings = [...inputFindings]
  const baselineSurface = baselineSurfaceFor(profile, surface, skills, profileComponents)
  const runtimeRunId = `runtime-optimization:${randomUUID()}`
  const splitDigest = developmentSplitDigest(
    comparisonOptions.trainScenarios,
    comparisonOptions.selectionScenarios,
    comparisonOptions.optimizationRunOptions?.reps ?? 1,
  )
  const method = resolveOptimizationMethod(methodSource, {
    profile,
    surface,
    baselineSurface,
    findings,
  })
  const startedAt = Date.now()
  const raw = await compareOptimizationMethods<TScenario, TArtifact>({
    ...comparisonOptions,
    methods: [method],
    baselineSurface,
    dispatchWithSurface: agent,
  })
  const score = raw.best
  const winnerSurface = score.winnerSurface
  assertCandidateSurfaceKind(surface, baselineSurface, winnerSurface)
  const candidateProfile = materializeImprovementProfileCandidate(
    profile,
    surface,
    winnerSurface,
    skills,
    profileComponents,
  )
  if (!candidateProfile) {
    throw new ConfigError(`improve(): the '${surface}' method produced no profile candidate`)
  }
  const candidate = immutableCandidateValue<ImprovementCandidate>({
    surface,
    value: winnerSurface,
    profile: candidateProfile,
  })

  return {
    mode: 'method',
    method: method.name,
    ...(score.provenance ? { provenance: copyProvenance(score.provenance) } : {}),
    candidate,
    decision: score.liftCi.low > minimumLift ? 'ship' : 'hold',
    lift: score.lift,
    liftInterval: { ...score.liftCi },
    cost: copyCost(raw.totalCost),
    durationMs: Date.now() - startedAt,
    lineage: Object.freeze({
      runId: score.provenance?.runId ?? runtimeRunId,
      developmentSplitDigest: splitDigest,
    }),
    raw,
    async dispose() {},
  }
}

async function runCodeImprovement<TScenario extends Scenario, TArtifact>(
  opts: ImproveCodeRunOptions<TScenario, TArtifact>,
): Promise<ImproveCodeResult<TScenario, TArtifact>> {
  const {
    gate = 'holdout',
    findings: inputFindings = [],
    rawTraceContext: _rawTraceContext,
    code,
    promotionGate,
    analyzeGeneration,
    surface: _surface,
    ...sharedOptions
  } = opts
  const findings = [...inputFindings]
  const preparedCode = await prepareCodeRun(code)

  const budget: SelfImproveBudget =
    gate === 'none' ? { ...sharedOptions.budget, generations: 0 } : { ...sharedOptions.budget }

  let raw: SelfImproveResult<TScenario, TArtifact>
  try {
    raw = await selfImprove<TScenario, TArtifact>({
      ...sharedOptions,
      baselineSurface: preparedCode.baseline,
      proposer: preparedCode.proposer,
      budget,
      findings,
      ...(promotionGate !== undefined ? { gate: promotionGate } : {}),
      ...(analyzeGeneration === null
        ? {}
        : {
            analyzeGeneration:
              analyzeGeneration ?? defaultDistillerFor<TScenario, TArtifact>(opts, findings),
          }),
    })
  } catch (cause) {
    return rethrowAfterCleanup(
      cause,
      () => preparedCode.cleanup(),
      'improve(): code improvement failed',
    )
  }

  const winnerSurface = raw.winner.surface
  assertCandidateSurfaceKind('code', preparedCode.baseline, winnerSurface)
  try {
    await preparedCode.cleanup(winnerSurface)
  } catch (cleanupCause) {
    try {
      await preparedCode.cleanup()
    } catch (finalCleanupCause) {
      throw new AggregateError(
        [cleanupCause, finalCleanupCause],
        'improve(): code result cleanup failed, including the final all-worktree retry',
      )
    }
    throw new AggregateError(
      [cleanupCause],
      'improve(): code result cleanup failed; the final all-worktree retry succeeded',
    )
  }
  const dispose = idempotentDispose(async () => preparedCode.cleanup())
  const candidate = immutableCandidateValue<ImprovementCandidate>({
    surface: 'code',
    value: winnerSurface,
  })

  return {
    mode: 'code',
    candidate,
    decision: raw.gateDecision,
    ...(raw.lift !== undefined ? { lift: raw.lift } : {}),
    cost: copyCost(raw.cost),
    durationMs: raw.durationMs,
    lineage: Object.freeze({
      runId: raw.provenance.runId,
      developmentSplitDigest: raw.provenance.evidence.search.splitDigest,
    }),
    generationsExplored: raw.generationsExplored,
    raw,
    dispose,
  }
}

/**
 * Optimize one exact profile surface with a complete method, or optimize code
 * through Runtime's isolated worktree path. The input profile is never changed.
 */
export function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveMethodOptions<TScenario, TArtifact>,
): Promise<ImproveMethodResult>
export function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveCodeRunOptions<TScenario, TArtifact>,
): Promise<ImproveCodeResult<TScenario, TArtifact>>
export function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveOptions<TScenario, TArtifact>,
): Promise<ImproveResult<TScenario, TArtifact>>
export async function improve<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveOptions<TScenario, TArtifact>,
): Promise<ImproveResult<TScenario, TArtifact>> {
  const parsedProfile = agentProfileSchema.safeParse(profile)
  if (!parsedProfile.success) {
    throw new ConfigError(
      `improve(): input is not a valid AgentProfile: ${parsedProfile.error.message}`,
    )
  }
  if (opts.surface === 'code') {
    return runCodeImprovement(opts)
  }
  return runMethodImprovement(immutableCandidateValue(parsedProfile.data), opts)
}
