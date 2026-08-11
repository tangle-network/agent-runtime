import type { MaximumCharge, ProposalFinding } from '@tangle-network/agent-eval'
import type {
  CampaignScenarioIdentity,
  CompareOptimizationMethodsOptions,
  OptimizationMethod,
  OptimizationMethodComparison,
  WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
import type {
  MutableSurface,
  Scenario,
  SelfImproveBudget,
  SelfImproveOptions,
  SelfImproveResult,
} from '@tangle-network/agent-eval/contract'
import type { AgentProfile, AgentProfileDiff, Sha256Digest } from '@tangle-network/agent-interface'
import type { AgenticGeneratorExecutorForWorktree, Verifier } from './agentic-generator'
import type { CandidateGenerator } from './improvement-driver'
import type { ReadonlyAgentProfile } from './profile-types'

/** The executable agent lever `improve` optimizes. Profile fields remain
 * portable AgentProfile coordinates; implementation and orchestration files
 * use the code surface so a winner can be sealed into an exact candidate.
 * `rollout-policy` is the inference-time structuralRollout dials
 * (`profile.extensions['structural-rollout']`). */
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
  readonly profile: ReadonlyAgentProfile
  /** Runtime-derived identity for upstream optimizer resume state. */
  readonly evaluationRef: Sha256Digest
  /** Exact profile coordinate being optimized. */
  readonly surface: ImproveProfileSurface
  /** Exact bytes supplied to the optimization method. */
  readonly baselineSurface: MutableSurface
  /** Structured value represented by `baselineSurface`, before serialization. */
  readonly baselineValue: unknown
  /** Findings produced before this search, if any. */
  readonly findings: ReadonlyArray<ProposalFinding>
}

/** Build a complete method after trace findings are available. */
export type ImproveMethodFactory<TScenario extends Scenario, TArtifact> = (
  context: ImproveMethodContext,
) => OptimizationMethod<TScenario, TArtifact>

export type ImproveMethodSource<TScenario extends Scenario, TArtifact> =
  | OptimizationMethod<TScenario, TArtifact>
  | ImproveMethodFactory<TScenario, TArtifact>

/** Runs one exact materialized profile on one scenario. */
export type ImproveProfileAgent<TScenario extends Scenario, TArtifact> = (
  profile: ReadonlyAgentProfile,
  scenario: TScenario,
  ctx: Parameters<
    CompareOptimizationMethodsOptions<TScenario, TArtifact>['dispatchWithSurface']
  >[2],
) => Promise<TArtifact>

/** Exact materialized profile presented for validation before any candidate run. */
export interface ImproveCandidateValidationInput {
  profile: ReadonlyAgentProfile
  surface: ImproveProfileSurface
  candidateSurface: MutableSurface
  value: unknown
  isBaseline: boolean
}

export type ImproveCandidateValidator = (input: ImproveCandidateValidationInput) => void

export type ImproveOptimizationRunOptions<TScenario extends Scenario, TArtifact> = Omit<
  NonNullable<CompareOptimizationMethodsOptions<TScenario, TArtifact>['optimizationRunOptions']>,
  'dispatchRef'
>

/** Complete-method configuration for every non-code profile surface. */
export type ImproveMethodOptions<TScenario extends Scenario, TArtifact> = Omit<
  CompareOptimizationMethodsOptions<TScenario, TArtifact>,
  | 'baselineSurface'
  | 'dispatchRef'
  | 'dispatchWithSurface'
  | 'methods'
  | 'optimizationConcurrency'
  | 'optimizationRunOptions'
> & {
  /** Exact profile coordinate optimized by `method`. Default `'prompt'`. */
  surface?: ImproveProfileSurface
  /**
   * Immutable digest of `agent`, profile component mapping, models, tools, and
   * every closure or external setting that can change measured behavior.
   */
  executionRef: Sha256Digest
  /** A complete optimizer or a factory that can incorporate current findings. */
  method: ImproveMethodSource<TScenario, TArtifact>
  /** Runs the exact complete profile materialized from one candidate surface. */
  agent: ImproveProfileAgent<TScenario, TArtifact>
  /** Reject a materialized profile before it reaches the agent callback. */
  validateCandidate?: ImproveCandidateValidator
  /** Trace or analyst findings available to a method factory. */
  findings?: ReadonlyArray<ProposalFinding>
  /** Select the exact inline skill document for `surface: 'skills'`. */
  skills?: ImproveSkillsOptions
  /**
   * Map a profile to named text components and apply the winning components.
   * Valid only with `surface: 'agent-profile'`.
   */
  profileComponents?: ImproveProfileComponents
  /** Shared settings for method train and selection calls. */
  optimizationRunOptions?: ImproveOptimizationRunOptions<TScenario, TArtifact>
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
  findings?: ReadonlyArray<ProposalFinding>
  /** Gate mode. `'holdout'` (default) runs the held-out promotion gate;
   * `'none'` is a baseline-only run (`budget.generations = 0`). */
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
   * the exam runs; this callback controls how its evidence decides promotion. */
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
  read(profile: ReadonlyAgentProfile): Readonly<Record<string, string>>
  /** Apply a complete winning component map to a detached profile. */
  apply(
    profile: ReadonlyAgentProfile,
    components: Readonly<Record<string, string>>,
  ): ReadonlyAgentProfile
}

export interface ImproveCodeBaseOptions {
  /** Repo root candidate worktrees fork from. */
  repoRoot: string
  /** Base ref candidates fork from. Default `main`. */
  baseRef?: string
  /** Directory worktrees are created under. Default `<repoRoot>/.worktrees`. */
  worktreeDir?: string
  /** Git-compatible adapter override, primarily for tests. Candidate advancement
   * still requires normal Git worktree and commit semantics. */
  worktree?: WorktreeAdapter
  /** Complete identity of the code author. No execution field may be filled from ambient defaults. */
  profile: AgentProfile
}

export interface ImproveRuntimeCodeGeneratorOptions {
  /** Place the exact author profile on compute that can edit the supplied worktree. */
  executorForWorktree: AgenticGeneratorExecutorForWorktree
  /** Author the task from admitted findings. Required: Runtime invents no code-improvement prompt. */
  buildPrompt: (args: { findings: ReadonlyArray<ProposalFinding> }) => string
  /** Verify a candidate worktree before it becomes a measurable surface; failures
   * feed the next shot (see `agenticGenerator.verify` / `commandVerifier`). */
  verify?: Verifier
  /** Per-shot wall-clock timeout. Omit for no Runtime-imposed deadline. */
  timeoutMs?: number
  /** Optional provider-enforced maximum admitted by the run-wide cost ledger. */
  maximumCharge?: MaximumCharge
  generator?: never
}

export interface ImproveCustomCodeGeneratorOptions {
  /** Complete byte-producer replacement. Runtime still validates `profile` before creating worktrees. */
  generator: CandidateGenerator
  executorForWorktree?: never
  buildPrompt?: never
  verify?: never
  timeoutMs?: never
  maximumCharge?: never
}

export type ImproveCodeOptions = ImproveCodeBaseOptions &
  (ImproveRuntimeCodeGeneratorOptions | ImproveCustomCodeGeneratorOptions)

export interface ImprovementProfileCandidate {
  /** Surface searched by this run. */
  surface: ImproveProfileSurface
  /** Exact winning value returned by agent-eval. */
  value: MutableSurface
  /** Exact complete profile instance measured on the final cases. */
  profile: ReadonlyAgentProfile
}

/** Digest-addressed Eval artifact. */
export interface ImprovementProfilePopulationArtifactSource {
  path: string
  sha256: Sha256Digest
}

/** Exact callback observation that introduced one optimizer candidate. */
export interface ImprovementProfilePopulationObservationSource {
  /** One-based JSONL line sequence in the verified observation artifact. */
  proposalSequence: number
  artifact: ImprovementProfilePopulationArtifactSource
}

/** One exact node from GEPA's accepted candidate graph. */
export interface ImprovementProfilePopulationLineageNode {
  index: number
  parentIndices: readonly (number | null)[]
  aggregateScore: number | null
  selectionScores: readonly {
    scenarioId: string
    score: number
  }[]
  discoveryEvaluationCount: number
}

export type ImprovementProfilePopulationLineage =
  | {
      status: 'available'
      artifact: ImprovementProfilePopulationArtifactSource
      nodes: readonly ImprovementProfilePopulationLineageNode[]
    }
  | {
      status: 'unavailable'
      reason: 'optimizer-did-not-report-candidate-lineage'
    }

/** Every verified source associated with one unique optimizer candidate. */
export interface ImprovementProfilePopulationCandidateSource {
  /** Eval identity of the external text or component candidate. */
  candidateDigest: Sha256Digest
  /** Present when the candidate crossed the evaluation callback. */
  observation?: ImprovementProfilePopulationObservationSource
  /** Exact GEPA parents and scores, or an explicit statement that none were reported. */
  lineage: ImprovementProfilePopulationLineage
}

/** A verified optimizer candidate that Runtime can express as an exact profile. */
export interface ImprovementMaterializedProfilePopulationCandidate {
  status: 'materialized'
  source: ImprovementProfilePopulationCandidateSource
  /** Exact optimizer surface decoded by Eval. */
  value: MutableSurface
  /** Interface identity of `value`. */
  surfaceDigest: Sha256Digest
  /** Exact complete profile produced by Runtime's configured materializer. */
  profile: ReadonlyAgentProfile
  /** Interface identity of `profile`. */
  profileDigest: Sha256Digest
  /** Ordered Interface diffs that reproduce `profile` from the baseline. */
  diffs: readonly AgentProfileDiff[]
  /** Interface identity of each entry in `diffs`. */
  diffDigests: readonly Sha256Digest[]
}

/** A verified optimizer candidate that Runtime refused to materialize. */
export interface ImprovementRefusedProfilePopulationCandidate {
  status: 'refused'
  source: ImprovementProfilePopulationCandidateSource
  /** Exact optimizer surface decoded by Eval. */
  value: MutableSurface
  /** Interface identity of `value`. */
  surfaceDigest: Sha256Digest
  error: {
    name: string
    message: string
  }
}

export type ImprovementProfilePopulationCandidate =
  | ImprovementMaterializedProfilePopulationCandidate
  | ImprovementRefusedProfilePopulationCandidate

/** Complete verified population reported by one optimizer run. */
export interface ImprovementProfileCandidatePopulationAvailable {
  status: 'available'
  source: {
    observations?: ImprovementProfilePopulationArtifactSource
    gepaCandidateGraph?: ImprovementProfilePopulationArtifactSource & {
      bestIndex: number
    }
  }
  /** Distinct candidate surfaces across all verified source artifacts. */
  uniqueCandidates: number
  /** Distinct candidate surfaces submitted through the evaluation callback. */
  observedCandidates: number
  /** Exact GEPA graph nodes. Multiple nodes can have the same candidate surface. */
  gepaCandidateNodes: number
  materializedCandidates: number
  refusedCandidates: number
  candidates: readonly ImprovementProfilePopulationCandidate[]
}

/** Explicit absence for methods that do not report candidate population evidence. */
export interface ImprovementProfileCandidatePopulationUnavailable {
  status: 'unavailable'
  reason: 'method-did-not-report-candidate-population'
}

export type ImprovementProfileCandidatePopulation =
  | ImprovementProfileCandidatePopulationAvailable
  | ImprovementProfileCandidatePopulationUnavailable

export interface ImprovementCodeCandidate {
  surface: 'code'
  value: MutableSurface
  profile?: never
}

export type ImprovementCandidate = ImprovementProfileCandidate | ImprovementCodeCandidate

/** Normalized spend reported for one Runtime improvement run. */
export interface ImproveCost {
  totalCostUsd: number
  accountingComplete: boolean
  incompleteReasons: string[]
}

/** Redacted task evidence retained for every optimizer-visible partition. */
export interface ImproveScenarioPartitions {
  train: readonly CampaignScenarioIdentity[]
  selection: readonly CampaignScenarioIdentity[]
  finalTest: readonly CampaignScenarioIdentity[]
  optimizationReps: number
  finalTestReps: number
}

/** Optimizer ancestry sealed into downstream candidate experiments. */
export interface ImproveLineage {
  /** Unique Runtime invocation used to isolate this run's cost receipts. */
  invocationId: string
  /** Upstream optimizer run when reported, otherwise this Runtime optimization invocation. */
  runId: string
  /** Exact train-plus-selection scenario payloads exposed to candidate selection. */
  developmentSplitDigest: Sha256Digest
  /** Exact final-test scenario payloads measured after candidate selection. */
  finalTestSplitDigest?: Sha256Digest
  /** Redacted identities for all task partitions used by a method optimizer. */
  scenarioPartitions?: ImproveScenarioPartitions
  /** Complete callback, materializer, model, tool, and closure identity for a profile run. */
  executionRef?: Sha256Digest
  /** Complete baseline profile identity for a profile run. */
  baselineProfileDigest?: Sha256Digest
}

interface ImproveResultBase<TCandidate extends ImprovementCandidate> {
  /** Frozen candidate only. Live state is changed through an approved activation. */
  candidate: TCandidate
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
   * the returned code worktree and is a no-op for profile-only surfaces. */
  dispose(): Promise<void>
}

/** Method optimization always retains every identity needed to reject task reuse. */
export interface ImproveMethodLineage extends ImproveLineage {
  finalTestSplitDigest: Sha256Digest
  scenarioPartitions: ImproveScenarioPartitions
  executionRef: Sha256Digest
  baselineProfileDigest: Sha256Digest
}

export interface ImproveMethodResult extends ImproveResultBase<ImprovementProfileCandidate> {
  mode: 'method'
  method: string
  lineage: ImproveMethodLineage
  /** External optimizer package and resumable run identity, when reported. */
  provenance?: OptimizationMethodComparison['best']['provenance']
  decision: 'ship' | 'hold'
  lift: number
  liftInterval: { low: number; high: number }
  /** Every distinct verified candidate, including explicit materialization refusals. */
  candidatePopulation: ImprovementProfileCandidatePopulation
  raw: OptimizationMethodComparison
}

export interface ImproveCodeResult<TScenario extends Scenario, TArtifact>
  extends ImproveResultBase<ImprovementCodeCandidate> {
  mode: 'code'
  raw: SelfImproveResult<TScenario, TArtifact>
}

export type ImproveResult<TScenario extends Scenario, TArtifact> =
  | ImproveMethodResult
  | ImproveCodeResult<TScenario, TArtifact>
