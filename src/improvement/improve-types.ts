import type {
  MaximumCharge,
  PairedPromotionDecision,
  ProposalFinding,
  RunRecord,
} from '@tangle-network/agent-eval'
import type {
  CampaignCellResult,
  CampaignScenarioIdentity,
  CompareOptimizationMethodsOptions,
  OptimizationMethod,
  OptimizationMethodComparison,
  SearchAllocator,
  SearchCellResult,
  SearchClaim,
  SearchClaimVerification,
  SearchHistoryReceipt,
  SearchModelIdentity,
  SearchPolicy,
  SearchSourceRef,
  SurfaceProposer,
  WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
import type {
  DispatchContext,
  MutableSurface,
  Scenario,
  SelfImproveBudget,
  SelfImproveOptions,
  SelfImproveProposerResult,
} from '@tangle-network/agent-eval/contract'
import type { EvaluationClaim, SealedExperiment } from '@tangle-network/agent-eval/experiment'
import type {
  AgentImprovementSurface,
  AgentProfile,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import type { BudgetPool } from '../runtime/supervise/budget'
import type { WorkerSlots } from '../runtime/supervise/worker-slots'
import type { AgenticGeneratorExecutorForWorktree, Verifier } from './agentic-generator'
import type { CandidateGenerator } from './improvement-driver'
import type { ReadonlyAgentProfile } from './profile-types'
import type { SearchCellContext, SearchLane, SearchTraceOptions } from './search-executor'

/** The executable agent lever `improve` optimizes — every surface a proposal can name
 * (`AgentImprovementSurface`) except `knowledge`, which the corpus lane owns and `improve`
 * does not produce. Deriving it means every surface `improve` produces can also be reported, which
 * is the property that lets a result reach a review or a gate.
 *
 * Profile fields remain portable AgentProfile coordinates; implementation and orchestration files
 * use the code surface so a winner can be sealed into an exact candidate. `rollout-policy` is the
 * inference-time structuralRollout dials (`profile.extensions['structural-rollout']`). */
export type ImproveSurface = Exclude<AgentImprovementSurface, 'knowledge'>

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
  /** Identities the method's search ledger records. */
  readonly searchIdentity: ImproveSearchIdentity
}

/** What a search ledger records about an improvement and cannot infer: what is
 * improved, the agent harness around the profile, the judges and the model. */
export interface ImproveSearchIdentity {
  /** What the search improves, for example `vb/coder`. */
  readonly subject: string
  /** `executionRef`: the agent callback, materializer, models, tools and closures. */
  readonly agent: SearchSourceRef
  /** Digest of every judge's name, dimensions, declared version and code. */
  readonly judge: SearchSourceRef
  /** The profile's model hint; each cell records the model it resolved. */
  readonly model: SearchModelIdentity
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

/** Accept by returning void synchronously; reject by throwing. Async callbacks are refused. */
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
  | 'searchHistoryPolicy'
  | 'searchHistoryVerification'
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
  /** Additional lift floor on Eval's deciding interval. Eval must also permit promotion. Default `0`. */
  minimumLift?: number
  /** What the search improves, recorded as the ledger's subject, for example
   * `vb/coder`. Default: the profile's name, else `agent-profile`. */
  subject?: string
}

/** Runtime's native search: a policy, an allocator and a proposer on Eval's
 * search kernel, with no Python bridge. Build it with `searchMethod`. */
export interface ImproveSearchMethod {
  readonly kind: 'search'
  /** Recorded as the ledger's process name and the result's method. */
  readonly name: string
  readonly policy: SearchPolicy
  readonly allocation: SearchAllocator
  readonly proposer: SurfaceProposer<ProposalFinding>
  /** Proposals the search may make. */
  readonly maxExpansions: number
  /** Children one proposal asks for. */
  readonly childrenPerProposal: number
  /** Where cells run, with each lane's capacity and cost rule. */
  readonly lanes: readonly SearchLane[]
  /** Dollars held from the start for the claim's test cells; at least the
   * root and 3 finalists on every test task at the largest lane `cellUsd`. */
  readonly claimReserveUsd: number | null
  /** ISO time after which the search stops expanding and claims. */
  readonly deadline: string | null
  /** Attempts per cell for retryable environment errors. */
  readonly maxAttempts: number
}

/**
 * Improve a profile with `searchMethod`. The search runs on all three splits:
 * it expands and ranks on train and selection, then claims once on the sealed
 * test split, and the claim decides. Runtime ships a statistical `ship` only
 * with complete cost accounting and a test lower bound above `minimumLift`.
 */
export type ImproveSearchOptions<TScenario extends Scenario, TArtifact> = Omit<
  ImproveMethodOptions<TScenario, TArtifact>,
  | 'method'
  | 'claim'
  | 'confidence'
  | 'evidence'
  | 'finalEvidence'
  | 'resamples'
  | 'reps'
  | 'maxConcurrency'
  | 'optimizationRunOptions'
  | 'agent'
> & {
  method: ImproveSearchMethod
  /** The claim the sealed test split decides. `independentUnit` names each
   * scenario's unit and `minimumEffect` is the improvement the power check
   * must resolve; both are required. */
  claim: EvaluationClaim
  /** Runs the exact node profile on one scenario. `ctx.search` names the attempt: its lane,
   * its run id (key remote work by it) and its trace. Throw `SearchEnvironmentFault` when the
   * environment, not the profile, ended the run; the kernel then runs a fresh attempt. */
  agent: ImproveSearchAgent<TScenario, TArtifact>
  /** Nested execution tree a finished cell's artifact recorded, if it ran an AgentGraph. */
  executionRunId?: (artifact: TArtifact) => string | null
  /**
   * Build the authoritative RunRecord for a scored passed or failed cell after judging and cost reconciliation,
   * before the attempt is persisted or its `cell-settled` event is appended.
   * Eval binds the returned record to the same ledger event. A throw stops the
   * search; resume reuses the campaign's cached cell before trying again.
   */
  recordCell?: (input: {
    cell: CampaignCellResult<TArtifact>
    search: SearchCellContext
    result: SearchCellResult
  }) => RunRecord | Promise<RunRecord>
  /** Bounds working cells across every search that shares this allocator. */
  workerSlots?: WorkerSlots
  /** Fleet dollars shared across searches: a cell on a hard lane holds its lane's `cellUsd`
   * here before it starts, and waits while open cells could return enough. */
  budgetPool?: BudgetPool
  /** Where cell spans go. Default: `<search dir>/spans.otlp.jsonl` on filesystem storage. */
  trace?: SearchTraceOptions
}

/** A campaign dispatch context with the search attempt it runs. */
export type SearchDispatchContext = DispatchContext & { readonly search: SearchCellContext }

/** The agent of a native search: the exact node profile on one scenario. */
export type ImproveSearchAgent<TScenario extends Scenario, TArtifact> = (
  profile: ReadonlyAgentProfile,
  scenario: TScenario,
  ctx: SearchDispatchContext,
) => Promise<TArtifact>

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
  | ImproveSearchOptions<TScenario, TArtifact>
  | ImproveCodeRunOptions<TScenario, TArtifact>

export interface ImproveSkillsOptions {
  /** `name` of one inline entry in `profile.resources.skills`. */
  resourceName: string
}

/** Caller-owned mapping for optimizing several profile fields as one candidate. */
export interface ImproveProfileComponents {
  /** Encode the map as JSON text for engines that cannot search named components. Default `'components'`. */
  encoding?: 'components' | 'json'
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

export interface ImprovementCodeCandidate {
  surface: 'code'
  value: MutableSurface
  profile?: never
}

export type ImprovementCandidate = ImprovementProfileCandidate | ImprovementCodeCandidate

/** Normalized spend reported for one Runtime improvement run. */
export interface ImproveCost {
  /** Dollars every settled call reported or priced. */
  totalCostUsd: number
  /** Every call's cost and usage is known. */
  accountingComplete: boolean
  incompleteReasons: string[]
  /**
   * A search's accounting when it is incomplete only because some calls' cost is
   * unknown under a maximum each declared before it ran, such as a call that
   * failed with no receipt. Each counts at that maximum, so the work cost at
   * most `totalMaximumUsd`. Absent when the accounting is complete or has any
   * other gap.
   */
  costBound?: {
    unknownCalls: number
    unknownMaximumUsd: number
    totalMaximumUsd: number
  }
}

/**
 * A search's claim as a `SuperviseRegistry.profiles` promotion: list it beside the
 * shipped profile, `{ profile: result.candidate.profile, promotion }`. The sealed
 * experiment names the root as control and every finalist the claim tested as a
 * treatment, by exact profile digest; the decision is Eval's paired decision the
 * claim made for the shipped finalist.
 */
export interface SearchPromotion {
  readonly experiment: SealedExperiment
  readonly decision: PairedPromotionDecision
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
  /** `canonicalAgentProfileDigest` of the baseline profile for a profile run. */
  baselineProfileDigest?: Sha256Digest
}

interface ImproveResultBase<TCandidate extends ImprovementCandidate> {
  /** Frozen candidate only. Live state is changed through an approved activation. */
  candidate: TCandidate
  /** Final-test decision for this search result. */
  decision: SelfImproveProposerResult<Scenario, unknown>['gateDecision']
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
  /** The optimizer's search ledger, closed and verified from its bytes: every
   * candidate it measured as a node, its parents as edges where the optimizer
   * reports them, and every evaluation as a cell. `officialGepa` and
   * `officialSkillOpt` always record one; `null` means the method recorded
   * none, so its lineage is unknown. */
  searchHistory: SearchHistoryReceipt | null
  raw: OptimizationMethodComparison
}

export interface ImproveSearchResult extends ImproveResultBase<ImprovementProfileCandidate> {
  mode: 'search'
  method: string
  lineage: ImproveMethodLineage
  /** `ship` only when the claim shipped, its verification re-derived it, the
   * cost accounting is complete or bounded within `costCeiling` (see
   * `ImproveCost.costBound`), and the test lower bound exceeds `minimumLift`. */
  decision: 'ship' | 'hold'
  /** Why: the claim's reason, or the Runtime rule that held a statistical ship. */
  reason: string
  /** The claim made once on the sealed test split. */
  claim: SearchClaim
  /** The claim re-derived from the closed ledger alone. */
  claimVerification: SearchClaimVerification
  /** The kept candidate's test delta against the baseline, when the claim tested it. */
  lift?: number
  liftInterval?: { low: number; high: number }
  /** The search ledger, closed and verified from its bytes. */
  searchHistory: SearchHistoryReceipt
  /** Present exactly when `decision` is `ship`. */
  promotion?: SearchPromotion
}

export interface ImproveCodeResult<TScenario extends Scenario, TArtifact>
  extends ImproveResultBase<ImprovementCodeCandidate> {
  mode: 'code'
  raw: SelfImproveProposerResult<TScenario, TArtifact>
}

export type ImproveResult<TScenario extends Scenario, TArtifact> =
  | ImproveMethodResult
  | ImproveSearchResult
  | ImproveCodeResult<TScenario, TArtifact>
