import { f as ExecutorConfig, i as CollectedAgentTurn, r as AgentTurnUsage } from "./stream-agent-turn-Bk79CnTw.js";
import { AgentCandidateBundle, AgentImprovementActivation, AgentImprovementActivationOutcome, AgentImprovementActivationResult, AgentImprovementActivationTarget, AgentImprovementProposal, AgentImprovementReview, AgentImprovementSurface, AgentProfile, AgentProfileImprovementChange, AgentProfileImprovementExperiment, AgentTrainingReceipt, AgentTrainingTask, HarnessType, ReasoningEffort, Sha256Digest } from "@tangle-network/agent-interface";
import { CostLedgerHandle, MaximumCharge, ProposalFinding } from "@tangle-network/agent-eval";
import { CampaignScenarioIdentity, CompareOptimizationMethodsOptions, OptimizationMethod, OptimizationMethodComparison, Scenario, SearchAllocator, SearchClaim, SearchClaimVerification, SearchHistoryReceipt, SearchModelIdentity, SearchPolicy, SearchSourceRef, SurfaceProposer, WorktreeAdapter } from "@tangle-network/agent-eval/campaign";
import { MutableSurface, Scenario as Scenario$1, SelfImproveBudget, SelfImproveOptions, SelfImproveProposerResult } from "@tangle-network/agent-eval/contract";
import { EvaluationClaim } from "@tangle-network/agent-eval/experiment";
//#region src/improvement/improvement-driver.d.ts
/** The byte-producing path that differs between the cheap
 *  reflective path and the full agentic path. A generator makes (uncommitted)
 *  changes inside `worktreePath`; the driver commits them via the worktree
 *  adapter's `finalize`. */
interface CandidateGenerator {
  kind: string;
  /** Whether this generator can produce a candidate from an empty findings set
   *  because it draws its change signal from the repo and raw traces on disk.
   *  An agentic coder (`agenticGenerator`) sets this so it still runs the full
   *  `populationSize` when the distiller yielded nothing. A patch-applier
   *  (`reflectiveGenerator`) leaves it unset — with no findings there is no
   *  patch to draft, so the driver short-circuits rather than spin up worktrees
   *  for a guaranteed no-op. Default `false`. */
  proposesWithoutFindings?: boolean;
  generate(args: {
    /** The candidate worktree — a clean checkout of the current incumbent. */
    worktreePath: string;
    /** Search or production findings explicitly admitted for proposal use. */
    findings: ReadonlyArray<ProposalFinding>;
    /** DEPTH: max iterations the generator may take (agentic uses this; the
     *  reflective generator ignores it). */
    maxShots: number;
    signal: AbortSignal;
    /** Generation coordinates supplied by Runtime's internal code candidate driver. */
    generation?: number;
    candidateIndex?: number;
    /** Shared run-wide paid-call account supplied by agent-eval 0.117+. */
    costLedger?: CostLedgerHandle;
    /** Receipt attribution phase supplied alongside `costLedger`. */
    costPhase?: string;
  }): Promise<{
    applied: boolean;
    summary: string;
    /** Short slug for the candidate. When present (with `rationale`), the
     *  driver returns a `ProposedCandidate` wrapper so the label survives to
     *  `GenerationRecord` and the emitted provenance. */
    label?: string;
    /** Why this change was proposed — bounded, derived from the findings the
     *  shot addressed. Paired with `label`. */
    rationale?: string;
  }>;
}
//#endregion
//#region src/improvement/agentic-generator.d.ts
/**
 * Outcome of verifying a candidate worktree.
 *
 * `ok` answers "is this tree shippable". `keepGoing` answers "should the budget
 * stop here", and `score` ranks this tree against the other trees the same
 * candidate produced — three separate questions, so a verifier can pass a tree
 * and still spend the shots it was given.
 *
 * `feedback` (compiler errors, failing test output, or the reason a passing
 * tree is being sent back) is fed into the next shot.
 */
interface VerifyResult {
  ok: boolean;
  feedback?: string;
  /**
   * Spend the remaining shots instead of returning this tree now.
   *
   * Read only when `ok` is true: a failed verification already spends the next
   * shot. Omitted means the first passing tree ends the candidate.
   */
  keepGoing?: boolean;
  /**
   * How good this tree is, for ranking it against the other passing trees of
   * this candidate. Higher wins; a tie keeps the LATER tree, which is the one
   * already on disk and the one the author refined last.
   *
   * Only a passing tree is ranked — a tree that failed verification is never a
   * candidate, whatever it scored. Score every passing tree or none of them: a
   * scored tree cannot be ranked against an unscored one, and mixing the two
   * fails the run rather than guessing an order.
   */
  score?: number;
}
/** Verifies the edited worktree. Sync or async; throws only on a setup fault
 *  (a candidate that fails verification returns `{ok:false}`, it does not
 *  throw). */
type Verifier = (worktreePath: string, signal?: AbortSignal) => Promise<VerifyResult> | VerifyResult;
interface AgenticGeneratorShotReceipt {
  readonly generation: number | null;
  readonly candidateIndex: number | null;
  /** One-based shot number within this candidate. */
  readonly shot: number;
  readonly maxShots: number;
  /** Exact profile identity admitted before the shot. */
  readonly profileDigest: string;
  readonly harness: HarnessType;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly promptSha256: `sha256:${string}`;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly status: CollectedAgentTurn['status'] | null;
  /** Runtime-normalized usage. Unknown token or dollar totals remain marked unknown. */
  readonly usage: Readonly<AgentTurnUsage> | null;
  readonly transportAttempts: number | null;
  /** Shared run-ledger call id for this exact shot. */
  readonly costCallId: string | null;
  /** Whether dollars came from the provider, the pricing table, or are unknown. */
  readonly costBasis: 'provider-reported' | 'estimated-pricing' | 'unknown';
  readonly costUsd: number | null;
  /** True only for a provider-reported amount, never for a pricing estimate. */
  readonly costUsdKnown: boolean;
  readonly error: {
    readonly name: string;
    readonly message: string;
  } | null;
}
/** Runtime's exact terminal turn plus its complete normalized event stream. */
type AgenticGeneratorShotExecution = Readonly<CollectedAgentTurn>;
/** Worktree decision emitted before a completed shot is retried, accepted, or
 *  discarded. The callback runs while `worktreePath` is still available, so
 *  callers can persist the exact diff. */
type AgenticGeneratorShotDisposition = {
  readonly kind: 'clean';
  readonly worktreePath: string;
} | {
  readonly kind: 'rejected';
  readonly worktreePath: string;
  readonly stage: 'raw-trace-evidence' | 'verification';
  readonly feedback: string | null;
} | {
  /** The tree passed verification and the verifier asked for another shot,
   *  so it was snapshotted and the budget continues. */
  readonly kind: 'kept';
  readonly worktreePath: string;
  /** The rank the verifier gave this tree, or null when it scored nothing. */
  readonly score: number | null;
  /** Whether this tree is now the best one this candidate has produced. */
  readonly best: boolean;
  readonly feedback: string | null;
} | {
  readonly kind: 'accepted';
  readonly worktreePath: string;
  readonly verified: boolean;
  /** One-based shot whose tree was put back into the worktree because it
   *  outranked the tree on disk; null when the tree on disk is the one that
   *  ships. Non-null is the record that best-of-n moved bytes rather than
   *  only ranking them. */
  readonly restoredFromShot: number | null;
} | {
  readonly kind: 'setup-error';
  readonly worktreePath: string;
  readonly stage: 'worktree-inspection' | 'raw-trace-evidence' | 'verification';
  readonly error: {
    readonly name: string;
    readonly message: string;
  };
};
type AgenticGeneratorExecutorForWorktree = (worktreePath: string) => ExecutorConfig;
interface AgenticGeneratorOptions {
  /** Complete author identity. Harness, provider, model, prompt, tools, and resources all come from here. */
  profile: AgentProfile;
  /** Place the exact profile on compute that can edit this existing worktree.
   * A local coding CLI returns `{ backend:'cli-in-place', workspacePath: worktreePath }`; a Pi
   * author over cli-bridge returns `{ backend:'bridge', cwd: worktreePath, ...transport }`. Both
   * are checked against the supplied path before the first shot spends. */
  executorForWorktree: AgenticGeneratorExecutorForWorktree;
  /** Awaited once for every attempted author shot, including execution failures.
   * The second argument is Runtime's exact terminal turn and event stream.
   * Throwing aborts the candidate so evidence persistence fails closed. */
  onShotCompleted?: (receipt: AgenticGeneratorShotReceipt, execution: AgenticGeneratorShotExecution | null) => void | Promise<void>;
  /** Awaited after worktree inspection and before the shot is accepted,
   *  retried, or discarded. Throwing aborts the candidate. */
  onShotDisposition?: (receipt: AgenticGeneratorShotReceipt, disposition: AgenticGeneratorShotDisposition) => void | Promise<void>;
  /** Optional hard upper bound passed to the run-wide CostLedger before each author shot. */
  maximumCharge?: MaximumCharge;
  /** Per-shot wall-clock timeout. Omit for no Runtime-imposed deadline. */
  timeoutMs?: number;
  /** Build the task prompt from proposal findings. Required: Runtime invents no authoring policy. */
  buildPrompt: (args: {
    findings: ReadonlyArray<ProposalFinding>;
  }) => string;
  /** Verify the worktree after each dirtying shot. When set, a candidate that
   *  fails verification is NOT returned — the failure feeds the next shot
   *  (verify-in-session), up to `maxShots`; a candidate that never verifies is
   *  discarded (`applied:false`), never shipped. A verifier that returns
   *  `keepGoing` passes a tree AND spends the remaining shots, and the
   *  best-scoring tree is the one that ships. Omitted means the first dirty
   *  shot is the candidate. See `commandVerifier` and `VerifyResult`. */
  verify?: Verifier;
  /** Test seam — inject the worktree-dirty check (defaults to `git status`). */
  isDirty?: (worktreePath: string) => boolean;
}
/** Full-agentic `CandidateGenerator`: run an exact profiled author inside the existing candidate worktree. */
declare function agenticGenerator(opts: AgenticGeneratorOptions): CandidateGenerator;
/** Turn proposal findings into a concrete coder task —
 *  the senior scientific-method framing shared with the tool/MCP build prompts. */
declare function defaultBuildPrompt(args: {
  findings: ReadonlyArray<ProposalFinding>;
}): string;
/** A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other
 *  exit ⇒ failed with stdout+stderr as feedback. The common case — verify by
 *  `tsc --noEmit`, `pnpm build`, or a test command. A timeout is treated as a
 *  FAILED candidate (a change that hangs the build is a bad change); a missing
 *  binary or spawn fault throws (a setup bug, not a failed candidate — no
 *  silent fallback). */
declare function commandVerifier(command: string, args?: string[], timeoutMs?: number): Verifier;
//#endregion
//#region src/improvement/profile-types.d.ts
type DeepReadonly<T> = T extends ((...args: never[]) => unknown) ? T : T extends readonly (infer TItem)[] ? readonly DeepReadonly<TItem>[] : T extends object ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]>; } : T;
/** Complete immutable profile value used during measured execution. */
type ReadonlyAgentProfile = DeepReadonly<AgentProfile>;
//#endregion
//#region src/improvement/improve-types.d.ts
/** The executable agent lever `improve` optimizes — every surface a proposal can name
 * (`AgentImprovementSurface`) except `knowledge`, which the corpus lane owns and `improve`
 * does not produce. Deriving it means every surface `improve` produces can also be reported, which
 * is the property that lets a result reach a review or a gate.
 *
 * Profile fields remain portable AgentProfile coordinates; implementation and orchestration files
 * use the code surface so a winner can be sealed into an exact candidate. `rollout-policy` is the
 * inference-time structuralRollout dials (`profile.extensions['structural-rollout']`). */
type ImproveSurface = Exclude<AgentImprovementSurface, 'knowledge'>;
type ImproveProfileSurface = Exclude<ImproveSurface, 'code'>;
interface ImproveMethodContext {
  /** Validated baseline profile. */
  readonly profile: ReadonlyAgentProfile;
  /** Runtime-derived identity for upstream optimizer resume state. */
  readonly evaluationRef: Sha256Digest;
  /** Exact profile coordinate being optimized. */
  readonly surface: ImproveProfileSurface;
  /** Exact bytes supplied to the optimization method. */
  readonly baselineSurface: MutableSurface;
  /** Structured value represented by `baselineSurface`, before serialization. */
  readonly baselineValue: unknown;
  /** Findings produced before this search, if any. */
  readonly findings: ReadonlyArray<ProposalFinding>;
  /** Identities the method's search ledger records. */
  readonly searchIdentity: ImproveSearchIdentity;
}
/** What a search ledger records about an improvement and cannot infer: what is
 * improved, the agent harness around the profile, the judges and the model. */
interface ImproveSearchIdentity {
  /** What the search improves, for example `vb/coder`. */
  readonly subject: string;
  /** `executionRef`: the agent callback, materializer, models, tools and closures. */
  readonly agent: SearchSourceRef;
  /** Digest of every judge's name, dimensions, declared version and code. */
  readonly judge: SearchSourceRef;
  /** The profile's model hint; each cell records the model it resolved. */
  readonly model: SearchModelIdentity;
}
/** Build a complete method after trace findings are available. */
type ImproveMethodFactory<TScenario extends Scenario$1, TArtifact> = (context: ImproveMethodContext) => OptimizationMethod<TScenario, TArtifact>;
type ImproveMethodSource<TScenario extends Scenario$1, TArtifact> = OptimizationMethod<TScenario, TArtifact> | ImproveMethodFactory<TScenario, TArtifact>;
/** Runs one exact materialized profile on one scenario. */
type ImproveProfileAgent<TScenario extends Scenario$1, TArtifact> = (profile: ReadonlyAgentProfile, scenario: TScenario, ctx: Parameters<CompareOptimizationMethodsOptions<TScenario, TArtifact>['dispatchWithSurface']>[2]) => Promise<TArtifact>;
/** Exact materialized profile presented for validation before any candidate run. */
interface ImproveCandidateValidationInput {
  profile: ReadonlyAgentProfile;
  surface: ImproveProfileSurface;
  candidateSurface: MutableSurface;
  value: unknown;
  isBaseline: boolean;
}
/** Accept by returning void synchronously; reject by throwing. Async callbacks are refused. */
type ImproveCandidateValidator = (input: ImproveCandidateValidationInput) => void;
type ImproveOptimizationRunOptions<TScenario extends Scenario$1, TArtifact> = Omit<NonNullable<CompareOptimizationMethodsOptions<TScenario, TArtifact>['optimizationRunOptions']>, 'dispatchRef'>;
/** Complete-method configuration for every non-code profile surface. */
type ImproveMethodOptions<TScenario extends Scenario$1, TArtifact> = Omit<CompareOptimizationMethodsOptions<TScenario, TArtifact>, 'baselineSurface' | 'dispatchRef' | 'dispatchWithSurface' | 'methods' | 'optimizationConcurrency' | 'optimizationRunOptions' | 'searchHistoryPolicy' | 'searchHistoryVerification'> & {
  /** Exact profile coordinate optimized by `method`. Default `'prompt'`. */
  surface?: ImproveProfileSurface;
  /**
   * Immutable digest of `agent`, profile component mapping, models, tools, and
   * every closure or external setting that can change measured behavior.
   */
  executionRef: Sha256Digest;
  /** A complete optimizer or a factory that can incorporate current findings. */
  method: ImproveMethodSource<TScenario, TArtifact>;
  /** Runs the exact complete profile materialized from one candidate surface. */
  agent: ImproveProfileAgent<TScenario, TArtifact>;
  /** Reject a materialized profile before it reaches the agent callback. */
  validateCandidate?: ImproveCandidateValidator;
  /** Trace or analyst findings available to a method factory. */
  findings?: ReadonlyArray<ProposalFinding>;
  /** Select the exact inline skill document for `surface: 'skills'`. */
  skills?: ImproveSkillsOptions;
  /**
   * Map a profile to named text components and apply the winning components.
   * Valid only with `surface: 'agent-profile'`.
   */
  profileComponents?: ImproveProfileComponents;
  /** Shared settings for method train and selection calls. */
  optimizationRunOptions?: ImproveOptimizationRunOptions<TScenario, TArtifact>;
  /** Additional lift floor on Eval's deciding interval. Eval must also permit promotion. Default `0`. */
  minimumLift?: number;
  /** What the search improves, recorded as the ledger's subject, for example
   * `vb/coder`. Default: the profile's name, else `agent-profile`. */
  subject?: string;
};
/** Runtime's native search: a policy, an allocator and a proposer on Eval's
 * search kernel, with no Python bridge. Build it with `searchMethod`. */
interface ImproveSearchMethod {
  readonly kind: 'search';
  /** Recorded as the ledger's process name and the result's method. */
  readonly name: string;
  readonly policy: SearchPolicy;
  readonly allocation: SearchAllocator;
  readonly proposer: SurfaceProposer<ProposalFinding>;
  /** Proposals the search may make. */
  readonly maxExpansions: number;
  /** Children one proposal asks for. */
  readonly childrenPerProposal: number;
  /** Cells that run at once, in process. */
  readonly concurrency: number;
  /** Prior cost of one cell, held as its estimate reservation until 20 cells settle. */
  readonly cellUsd: number;
  /** Dollars held from the start for the claim's test cells; at least the
   * root and 3 finalists on every test task at `cellUsd` a cell. */
  readonly claimReserveUsd: number | null;
  /** ISO time after which the search stops expanding and claims. */
  readonly deadline: string | null;
  /** Attempts per cell for retryable environment errors. */
  readonly maxAttempts: number;
}
/**
 * Improve a profile with `searchMethod`. The search runs on all three splits:
 * it expands and ranks on train and selection, then claims once on the sealed
 * test split, and the claim decides. Runtime ships a statistical `ship` only
 * with complete cost accounting and a test lower bound above `minimumLift`.
 */
type ImproveSearchOptions<TScenario extends Scenario$1, TArtifact> = Omit<ImproveMethodOptions<TScenario, TArtifact>, 'method' | 'claim' | 'confidence' | 'evidence' | 'finalEvidence' | 'resamples' | 'reps' | 'maxConcurrency' | 'optimizationRunOptions'> & {
  method: ImproveSearchMethod;
  /** The claim the sealed test split decides. `independentUnit` names each
   * scenario's unit and `minimumEffect` is the improvement the power check
   * must resolve; both are required. */
  claim: EvaluationClaim;
};
/** Runtime-owned code search in isolated git worktrees. */
type ImproveCodeRunOptions<TScenario extends Scenario$1, TArtifact> = Omit<SelfImproveOptions<TScenario, TArtifact>, 'analyzeGeneration' | 'baselineSurface' | 'budget' | 'findings' | 'gate' | 'llm' | 'method' | 'mutationPrimitives' | 'proposer' | 'proposerTarget' | 'selectionScenarios'> & {
  surface: 'code';
  /** Local code-search budget. Method-only selection controls do not apply. */
  budget?: Omit<SelfImproveBudget, 'selectionFraction'>;
  /** Findings supplied to Runtime's code candidate driver. */
  findings?: ReadonlyArray<ProposalFinding>;
  /** Gate mode. `'holdout'` (default) runs the held-out promotion gate;
   * `'none'` is a baseline-only run (`budget.generations = 0`). */
  gate?: 'holdout' | 'none';
  /** Per-generation findings producer for Runtime's code search.
   * Pass your own producer to replace the code-trace distiller; pass `null`
   * to keep the static findings for every generation. */
  analyzeGeneration?: SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration'] | null;
  /** Feed code candidates paths to prior raw traces instead of a failure digest.
   * Defaults to true for durable runs and false for in-memory runs. */
  rawTraceContext?: boolean;
  /** Isolated repository and candidate generator settings. */
  code: ImproveCodeOptions;
  /** Custom held-back-exam decision. The string `gate` above controls whether
   * the exam runs; this callback controls how its evidence decides promotion. */
  promotionGate?: SelfImproveOptions<TScenario, TArtifact>['gate'];
};
/** The canonical improvement API: complete methods for profiles, worktrees for code. */
type ImproveOptions<TScenario extends Scenario$1, TArtifact> = ImproveMethodOptions<TScenario, TArtifact> | ImproveSearchOptions<TScenario, TArtifact> | ImproveCodeRunOptions<TScenario, TArtifact>;
interface ImproveSkillsOptions {
  /** `name` of one inline entry in `profile.resources.skills`. */
  resourceName: string;
}
/** Caller-owned mapping for optimizing several profile fields as one candidate. */
interface ImproveProfileComponents {
  /** Encode the map as JSON text for engines that cannot search named components. Default `'components'`. */
  encoding?: 'components' | 'json';
  /** Extract the exact named text components optimized together. */
  read(profile: ReadonlyAgentProfile): Readonly<Record<string, string>>;
  /** Apply a complete winning component map to a detached profile. */
  apply(profile: ReadonlyAgentProfile, components: Readonly<Record<string, string>>): ReadonlyAgentProfile;
}
interface ImproveCodeBaseOptions {
  /** Repo root candidate worktrees fork from. */
  repoRoot: string;
  /** Base ref candidates fork from. Default `main`. */
  baseRef?: string;
  /** Directory worktrees are created under. Default `<repoRoot>/.worktrees`. */
  worktreeDir?: string;
  /** Git-compatible adapter override, primarily for tests. Candidate advancement
   * still requires normal Git worktree and commit semantics. */
  worktree?: WorktreeAdapter;
  /** Complete identity of the code author. No execution field may be filled from ambient defaults. */
  profile: AgentProfile;
}
interface ImproveRuntimeCodeGeneratorOptions {
  /** Place the exact author profile on compute that can edit the supplied worktree. */
  executorForWorktree: AgenticGeneratorExecutorForWorktree;
  /** Author the task from admitted findings. Required: Runtime invents no code-improvement prompt. */
  buildPrompt: (args: {
    findings: ReadonlyArray<ProposalFinding>;
  }) => string;
  /** Verify a candidate worktree before it becomes a measurable surface; failures
   * feed the next shot (see `agenticGenerator.verify` / `commandVerifier`). */
  verify?: Verifier;
  /** Per-shot wall-clock timeout. Omit for no Runtime-imposed deadline. */
  timeoutMs?: number;
  /** Optional provider-enforced maximum admitted by the run-wide cost ledger. */
  maximumCharge?: MaximumCharge;
  generator?: never;
}
interface ImproveCustomCodeGeneratorOptions {
  /** Complete byte-producer replacement. Runtime still validates `profile` before creating worktrees. */
  generator: CandidateGenerator;
  executorForWorktree?: never;
  buildPrompt?: never;
  verify?: never;
  timeoutMs?: never;
  maximumCharge?: never;
}
type ImproveCodeOptions = ImproveCodeBaseOptions & (ImproveRuntimeCodeGeneratorOptions | ImproveCustomCodeGeneratorOptions);
interface ImprovementProfileCandidate {
  /** Surface searched by this run. */
  surface: ImproveProfileSurface;
  /** Exact winning value returned by agent-eval. */
  value: MutableSurface;
  /** Exact complete profile instance measured on the final cases. */
  profile: ReadonlyAgentProfile;
}
interface ImprovementCodeCandidate {
  surface: 'code';
  value: MutableSurface;
  profile?: never;
}
type ImprovementCandidate = ImprovementProfileCandidate | ImprovementCodeCandidate;
/** Normalized spend reported for one Runtime improvement run. */
interface ImproveCost {
  totalCostUsd: number;
  accountingComplete: boolean;
  incompleteReasons: string[];
}
/** Redacted task evidence retained for every optimizer-visible partition. */
interface ImproveScenarioPartitions {
  train: readonly CampaignScenarioIdentity[];
  selection: readonly CampaignScenarioIdentity[];
  finalTest: readonly CampaignScenarioIdentity[];
  optimizationReps: number;
  finalTestReps: number;
}
/** Optimizer ancestry sealed into downstream candidate experiments. */
interface ImproveLineage {
  /** Unique Runtime invocation used to isolate this run's cost receipts. */
  invocationId: string;
  /** Upstream optimizer run when reported, otherwise this Runtime optimization invocation. */
  runId: string;
  /** Exact train-plus-selection scenario payloads exposed to candidate selection. */
  developmentSplitDigest: Sha256Digest;
  /** Exact final-test scenario payloads measured after candidate selection. */
  finalTestSplitDigest?: Sha256Digest;
  /** Redacted identities for all task partitions used by a method optimizer. */
  scenarioPartitions?: ImproveScenarioPartitions;
  /** Complete callback, materializer, model, tool, and closure identity for a profile run. */
  executionRef?: Sha256Digest;
  /** `canonicalAgentProfileDigest` of the baseline profile for a profile run. */
  baselineProfileDigest?: Sha256Digest;
}
interface ImproveResultBase<TCandidate extends ImprovementCandidate> {
  /** Frozen candidate only. Live state is changed through an approved activation. */
  candidate: TCandidate;
  /** Final-test decision for this search result. */
  decision: SelfImproveProposerResult<Scenario$1, unknown>['gateDecision'];
  /** Final-test lift when one was measured. */
  lift?: number;
  /** Paired final-test confidence interval for method-based profile runs. */
  liftInterval?: {
    low: number;
    high: number;
  };
  /** Full search and final-test spend. */
  cost: ImproveCost;
  /** Full wall-clock duration. */
  durationMs: number;
  /** Optimizer ancestry used when sealing a candidate experiment. */
  lineage: ImproveLineage;
  /** Number of generations explored by Runtime's code path. */
  generationsExplored?: number;
  /** Release resources owned by this result. Idempotent; currently disposes
   * the returned code worktree and is a no-op for profile-only surfaces. */
  dispose(): Promise<void>;
}
/** Method optimization always retains every identity needed to reject task reuse. */
interface ImproveMethodLineage extends ImproveLineage {
  finalTestSplitDigest: Sha256Digest;
  scenarioPartitions: ImproveScenarioPartitions;
  executionRef: Sha256Digest;
  baselineProfileDigest: Sha256Digest;
}
interface ImproveMethodResult extends ImproveResultBase<ImprovementProfileCandidate> {
  mode: 'method';
  method: string;
  lineage: ImproveMethodLineage;
  /** External optimizer package and resumable run identity, when reported. */
  provenance?: OptimizationMethodComparison['best']['provenance'];
  decision: 'ship' | 'hold';
  lift: number;
  liftInterval: {
    low: number;
    high: number;
  };
  /** The optimizer's search ledger, closed and verified from its bytes: every
   * candidate it measured as a node, its parents as edges where the optimizer
   * reports them, and every evaluation as a cell. `officialGepa` and
   * `officialSkillOpt` always record one; `null` means the method recorded
   * none, so its lineage is unknown. */
  searchHistory: SearchHistoryReceipt | null;
  raw: OptimizationMethodComparison;
}
interface ImproveSearchResult extends ImproveResultBase<ImprovementProfileCandidate> {
  mode: 'search';
  method: string;
  lineage: ImproveMethodLineage;
  /** `ship` only when the claim shipped, its verification re-derived it, the
   * cost accounting is complete, and the test lower bound exceeds `minimumLift`. */
  decision: 'ship' | 'hold';
  /** Why: the claim's reason, or the Runtime rule that held a statistical ship. */
  reason: string;
  /** The claim made once on the sealed test split. */
  claim: SearchClaim;
  /** The claim re-derived from the closed ledger alone. */
  claimVerification: SearchClaimVerification;
  /** The kept candidate's test delta against the baseline, when the claim tested it. */
  lift?: number;
  liftInterval?: {
    low: number;
    high: number;
  };
  /** The search ledger, closed and verified from its bytes. */
  searchHistory: SearchHistoryReceipt;
}
interface ImproveCodeResult<TScenario extends Scenario$1, TArtifact> extends ImproveResultBase<ImprovementCodeCandidate> {
  mode: 'code';
  raw: SelfImproveProposerResult<TScenario, TArtifact>;
}
type ImproveResult<TScenario extends Scenario$1, TArtifact> = ImproveMethodResult | ImproveSearchResult | ImproveCodeResult<TScenario, TArtifact>;
//#endregion
//#region src/improvement/training.d.ts
interface TrainingDatasetDocument {
  version: 1;
  format: 'sft' | 'dpo' | 'grpo';
  /** Existing Eval export rows, without rewriting their payloads. Include every exposed partition. */
  rows: Array<{
    task: AgentTrainingTask;
    partition: 'train' | 'validation';
    data: unknown;
  }>;
}
interface ProfileTrainerRequest {
  version: 1;
  invocationId: string;
  datasetPath: string;
  checkpointPath: string;
  parentProfilePath: string;
  parentProfileDigest: Sha256Digest;
  parameters: AgentTrainingReceipt['trainer']['parameters'];
  executionRef: Sha256Digest;
}
type TrainingBoundaryResult<T> = {
  succeeded: true;
  value: T;
} | {
  succeeded: false;
  reason: string;
};
/** Managed adapters use this same port: cancel the job on abort and download one exact checkpoint file. */
interface ProfileTrainer {
  identity: Omit<AgentTrainingReceipt['trainer'], 'parameters'>;
  execute(request: Readonly<ProfileTrainerRequest>, signal: AbortSignal): Promise<TrainingBoundaryResult<void>>;
}
interface CheckpointServingPort {
  /** Verify the immutable Router route independently of the trainer's output. */
  serve(input: {
    artifactPath: string;
    artifactDigest: Sha256Digest;
    artifactBytes: number;
    routerModelId: string;
    signal: AbortSignal;
  }): Promise<TrainingBoundaryResult<{
    routerModelId: string;
    artifactDigest: Sha256Digest;
    evidenceDigest: Sha256Digest;
  }>>;
}
interface ImproveTrainingOptions {
  mode: 'training';
  trainer: ProfileTrainer;
  dataset: {
    path: string;
    digest: Sha256Digest;
  };
  parameters: AgentTrainingReceipt['trainer']['parameters'];
  /** Pins trainer, serving adapter and their private dependencies, just like the bound profile harness. */
  executionRef: Sha256Digest;
  serving: CheckpointServingPort;
  outputDirectory: string;
  /** Optional overall deadline. Omit to rely on caller cancellation; long durations are supported. */
  timeoutMs?: number;
  maxCheckpointBytes: number;
  signal?: AbortSignal;
  validateCandidate?: ImproveCandidateValidator;
}
type ImproveTrainingResult = {
  mode: 'training';
  succeeded: true;
  profile: ReadonlyAgentProfile;
  profileDigest: Sha256Digest;
  receipt: AgentTrainingReceipt;
  artifactPath: string;
  receiptPath: string;
  profilePath: string;
} | {
  mode: 'training';
  succeeded: false;
  stage: 'admission' | 'dataset' | 'training' | 'checkpoint' | 'serving' | 'profile' | 'persistence';
  reason: string;
  /** Partial artifacts are retained for diagnosis; they are not a runnable profile. */
  outputDirectory?: string;
  /** A serving request began; an interrupted adapter may still own a deployment. */
  servingMayExist: boolean;
  /** A timed-out managed adapter may still own a remote training job. */
  trainingMayExist: boolean;
  cleanupError?: string;
};
interface ControlledTrainingCommand {
  id: string;
  executable: {
    path: string;
    digest: Sha256Digest;
  };
  args: string[];
  /** Script/config files used by the command, verified before and after execution. */
  inputs: Array<{
    path: string;
    digest: Sha256Digest;
  }>;
  /** Explicit public environment only. Ambient credentials are never inherited. */
  environment: Record<string, string>;
  /** Total stdout + stderr byte budget. Output is drained, not retained in memory. */
  maxOutputBytes: number;
}
/** Execute one pinned command without a shell, in the runtime-owned job directory. POSIX only. */
declare function createCommandProfileTrainer(input: ControlledTrainingCommand): ProfileTrainer;
//#endregion
//#region src/improvement/search-method.d.ts
interface SearchMethodOptions {
  /** Writes each child surface from the parents the policy chose. It reads the
   * train split only (`ProposeContext.train` and `summary`); `history` is empty. */
  proposer: SurfaceProposer<ProposalFinding>;
  /** Proposals the search may make. */
  maxExpansions: number;
  /** Which node each proposal extends, and which node the search keeps.
   * Default `incumbent()`: the hill climb. */
  policy?: SearchPolicy;
  /** Where cells go. Default `uniform()`: every node runs every train and
   * selection task, which the `incumbent()` hill climb needs to see each
   * result on the leader's units. `asha()` (successive halving over one
   * seeded permutation of the selection units) spends fewer cells and pairs
   * with policies that rank screened nodes. Its `reps` are every split's
   * repeats, the claim's included. */
  allocation?: SearchAllocator;
  /** Children one proposal asks for. Default 1. */
  childrenPerProposal?: number;
  /** Cells that run at once. Default 2. */
  concurrency?: number;
  /** Prior cost of one cell in dollars, held for each cell until 20 cells
   * settle and the lane's own costs set the hold. Default 0. */
  cellUsd?: number;
  /** Dollars held for the claim from the start. Default: the root and 3
   * finalists on every test task at `cellUsd` a cell. */
  claimReserveUsd?: number;
  /** ISO time after which the search stops expanding and claims. */
  deadline?: string;
  /** Attempts per cell for retryable environment errors. Default 3. */
  maxAttempts?: number;
  /** Recorded as the ledger's process name. Default `search`. */
  name?: string;
}
/** Build Runtime's native search for `improve(profile, { method })`. */
declare function searchMethod(options: SearchMethodOptions): ImproveSearchMethod;
//#endregion
//#region src/improvement/improve.d.ts
/** Train and serve a checkpoint without implying that it improved held-out quality. */
declare function improve(profile: ReadonlyAgentProfile, opts: ImproveTrainingOptions): Promise<ImproveTrainingResult>;
/**
 * Search one exact profile surface with Runtime's native search
 * (`method: searchMethod(...)`): the kernel expands, allocates and claims on
 * the sealed test split, and the claim decides.
 */
declare function improve<TScenario extends Scenario$1, TArtifact>(profile: ReadonlyAgentProfile, opts: ImproveSearchOptions<TScenario, TArtifact>): Promise<ImproveSearchResult>;
/**
 * Optimize one exact profile surface with a complete method.
 */
declare function improve<TScenario extends Scenario$1, TArtifact>(profile: ReadonlyAgentProfile, opts: ImproveMethodOptions<TScenario, TArtifact>): Promise<ImproveMethodResult>;
/** Optimize one exact profile surface with a complete method or a search. */
declare function improve<TScenario extends Scenario$1, TArtifact>(profile: ReadonlyAgentProfile, opts: ImproveMethodOptions<TScenario, TArtifact> | ImproveSearchOptions<TScenario, TArtifact>): Promise<ImproveMethodResult | ImproveSearchResult>;
/**
 * Optimize repository code through Runtime's isolated worktree path.
 */
declare function improve<TScenario extends Scenario$1, TArtifact>(opts: ImproveCodeRunOptions<TScenario, TArtifact>): Promise<ImproveCodeResult<TScenario, TArtifact>>;
//#endregion
//#region src/intelligence/activation.d.ts
interface CreateAgentImprovementActivationResultOptions {
  completedAt: string;
  outcome: AgentImprovementActivationOutcome;
}
interface AgentImprovementActivationTargetPlan extends AgentImprovementActivationTarget {
  desiredDigest: Sha256Digest;
  /**
   * Exact measured input the product must apply to reach `desiredDigest`.
   * Transition surfaces such as code and knowledge are applied operations, so
   * their resulting state digest is not the digest of this input document.
   */
  desiredInput: unknown;
}
type AgentProfileImprovementActivationOperation = {
  kind: 'apply-change';
  changes: AgentProfileImprovementChange;
} | {
  /** The product must load its own saved state at `desiredStateDigest`. */
  kind: 'restore-state';
};
interface AgentProfileImprovementActivationTargetPlan extends AgentImprovementActivationTarget {
  desiredDigest: Sha256Digest;
  desiredInput: AgentProfileImprovementActivationOperation;
}
interface SealedCandidateActivationTransitionInput {
  kind: 'sealed-candidate';
  activation: AgentImprovementActivation;
  candidateBundle: AgentCandidateBundle;
  bundle: AgentCandidateBundle;
  targets: [AgentImprovementActivationTargetPlan, ...AgentImprovementActivationTargetPlan[]];
  attemptedAt: string;
  expired: boolean;
}
/**
 * A measured profile change without raw profile bytes.
 * The product owns the private state lookup and atomic write.
 */
interface ProfileImprovementActivationTransitionInput {
  kind: 'profile-improvement';
  activation: AgentImprovementActivation;
  experiment: AgentProfileImprovementExperiment;
  sourceStateDigest: Sha256Digest;
  desiredStateDigest: Sha256Digest;
  operation: AgentProfileImprovementActivationOperation;
  targets: [AgentProfileImprovementActivationTargetPlan, ...AgentProfileImprovementActivationTargetPlan[]];
  attemptedAt: string;
  expired: boolean;
}
type AgentImprovementActivationTransitionInput = SealedCandidateActivationTransitionInput | ProfileImprovementActivationTransitionInput;
interface AgentImprovementActivationResultStore {
  load(idempotencyKey: Sha256Digest): Promise<unknown | undefined>;
  putIfAbsent(result: AgentImprovementActivationResult): Promise<unknown>;
}
/**
 * Product-owned or Runtime-composed transition.
 *
 * Implementations resolve a stored result for `activation.digest`, compare
 * every target, and make the write durably idempotent. Co-located targets store
 * the all-or-none write with its result. Other targets throw when result
 * storage fails so a retry can reconcile it. Runtime never invokes this write
 * function after authorization expires.
 */
type AgentImprovementActivationTransition = (input: AgentImprovementActivationTransitionInput) => Promise<unknown>;
/**
 * Target-read-only check for a prior exact write.
 * It may persist recovered result metadata, but must not change an activation target.
 * Return undefined only when no target write can have committed.
 */
type AgentImprovementActivationReconciliation = (input: AgentImprovementActivationTransitionInput) => Promise<unknown | undefined>;
interface ExecuteAgentImprovementActivationInput {
  proposal: AgentImprovementProposal;
  review: AgentImprovementReview;
  activation: AgentImprovementActivation;
}
interface ExecuteAgentImprovementActivationOptions {
  transition: AgentImprovementActivationTransition;
  reconcile?: AgentImprovementActivationReconciliation;
  now?: () => Date;
}
/** Create the exact result a product stores in the same transaction as its target write. */
declare function createAgentImprovementActivationResult(transition: AgentImprovementActivationTransitionInput, options: CreateAgentImprovementActivationResultOptions): AgentImprovementActivationResult;
/**
 * Recompute one historical activation result against the exact measured proposal and authority.
 * The result records that attempt; it is not a query of the target's current state.
 */
declare function verifyAgentImprovementActivationResult(input: {
  proposal: unknown;
  review: unknown;
  activation: unknown;
  result: unknown;
}): AgentImprovementActivationResult;
/** Validate and execute one product-owned activation transition. */
declare function executeAgentImprovementActivation(input: ExecuteAgentImprovementActivationInput, options: ExecuteAgentImprovementActivationOptions): Promise<AgentImprovementActivationResult>;
//#endregion
export { ImproveSearchOptions as $, ImproveCodeBaseOptions as A, ImproveMethodOptions as B, ProfileTrainer as C, createCommandProfileTrainer as D, TrainingDatasetDocument as E, ImproveCustomCodeGeneratorOptions as F, ImproveProfileAgent as G, ImproveMethodSource as H, ImproveLineage as I, ImproveResult as J, ImproveProfileComponents as K, ImproveMethodContext as L, ImproveCodeResult as M, ImproveCodeRunOptions as N, ImproveCandidateValidationInput as O, ImproveCost as P, ImproveSearchMethod as Q, ImproveMethodFactory as R, ImproveTrainingResult as S, TrainingBoundaryResult as T, ImproveOptimizationRunOptions as U, ImproveMethodResult as V, ImproveOptions as W, ImproveScenarioPartitions as X, ImproveRuntimeCodeGeneratorOptions as Y, ImproveSearchIdentity as Z, SearchMethodOptions as _, defaultBuildPrompt as _t, AgentImprovementActivationTransitionInput as a, ImprovementProfileCandidate as at, ControlledTrainingCommand as b, CreateAgentImprovementActivationResultOptions as c, AgenticGeneratorExecutorForWorktree as ct, ProfileImprovementActivationTransitionInput as d, AgenticGeneratorShotExecution as dt, ImproveSearchResult as et, SealedCandidateActivationTransitionInput as f, AgenticGeneratorShotReceipt as ft, improve as g, commandVerifier as gt, verifyAgentImprovementActivationResult as h, agenticGenerator as ht, AgentImprovementActivationTransition as i, ImprovementCodeCandidate as it, ImproveCodeOptions as j, ImproveCandidateValidator as k, ExecuteAgentImprovementActivationInput as l, AgenticGeneratorOptions as lt, executeAgentImprovementActivation as m, VerifyResult as mt, AgentImprovementActivationResultStore as n, ImproveSurface as nt, AgentProfileImprovementActivationOperation as o, DeepReadonly as ot, createAgentImprovementActivationResult as p, Verifier as pt, ImproveProfileSurface as q, AgentImprovementActivationTargetPlan as r, ImprovementCandidate as rt, AgentProfileImprovementActivationTargetPlan as s, ReadonlyAgentProfile as st, AgentImprovementActivationReconciliation as t, ImproveSkillsOptions as tt, ExecuteAgentImprovementActivationOptions as u, AgenticGeneratorShotDisposition as ut, searchMethod as v, CandidateGenerator as vt, ProfileTrainerRequest as w, ImproveTrainingOptions as x, CheckpointServingPort as y, ImproveMethodLineage as z };
//# sourceMappingURL=activation-B5NExoOz.d.ts.map