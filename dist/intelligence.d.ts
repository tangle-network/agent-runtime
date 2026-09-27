import { $a as RuntimeStreamEvent, Rt as OtelExportStats, ma as LoopTraceEvent, nn as RuntimeTelemetryOptions } from "./types-D56jQad-.js";
import { d as RunAnalystLoopOpts, f as RunAnalystLoopResult } from "./types-zWfqDjeL.js";
import { Bn as ToolSpec, Mt as AgentEnvironmentProviderRegistry, _r as defaultRedactor, gr as Redactor, jt as AgentEnvironmentProviderRef, vr as resolveRedactor } from "./stream-agent-turn-Bk79CnTw.js";
import { D as AgentCandidateRunFinalization, O as AgentCandidateTaskExecution, a as AgentCandidateExecutionPorts, c as AgentCandidateExecutorPort, r as AgentCandidateBenchmarkGraderPort, y as AgentCandidateOutputArtifactPort } from "./types-CuXu5zuS.js";
import { T as AgentCandidateExecutionClaimStore, _ as PrepareAgentCandidateExecutionOptions, o as CreateProtectedAgentCandidateModelPortOptions, p as parseAgentCandidateProfileActivation, y as ExecutePreparedAgentCandidateOptions } from "./protected-model-port-BlLP8ja6.js";
import { B as ImproveMethodOptions, J as ImproveResult, V as ImproveMethodResult, W as ImproveOptions, X as ImproveScenarioPartitions, a as AgentImprovementActivationTransitionInput, c as CreateAgentImprovementActivationResultOptions, d as ProfileImprovementActivationTransitionInput, f as SealedCandidateActivationTransitionInput, h as verifyAgentImprovementActivationResult, i as AgentImprovementActivationTransition, l as ExecuteAgentImprovementActivationInput, m as executeAgentImprovementActivation, n as AgentImprovementActivationResultStore, o as AgentProfileImprovementActivationOperation, p as createAgentImprovementActivationResult, r as AgentImprovementActivationTargetPlan, s as AgentProfileImprovementActivationTargetPlan, t as AgentImprovementActivationReconciliation, u as ExecuteAgentImprovementActivationOptions } from "./activation-B5NExoOz.js";
import { AgentCandidateBenchmarkCellRef, AgentCandidateBundle, AgentCandidateEvaluationPolicy, AgentCandidateExperiment, AgentCandidateExperimentMaterial, AgentCandidateExperimentMeasurement, AgentCandidateLineage, AgentCandidateProfileActivation as CandidateProfileMaterialization, AgentImprovementActivation, AgentImprovementActivation as AgentImprovementActivation$1, AgentImprovementActivationIntent, AgentImprovementActivationIntent as AgentImprovementActivationIntent$1, AgentImprovementActivationOutcome, AgentImprovementActivationResult, AgentImprovementActivationTarget, AgentImprovementActivationTargetState, AgentImprovementActivationTargetTransition, AgentImprovementEvaluation, AgentImprovementEvaluation as AgentImprovementEvaluation$1, AgentImprovementMeasuredComparison, AgentImprovementMeasuredComparison as AgentImprovementMeasuredComparison$1, AgentImprovementProposal, AgentImprovementProposal as AgentImprovementProposal$1, AgentImprovementReview, AgentImprovementReview as AgentImprovementReview$1, AgentImprovementReviewDecision, AgentImprovementReviewDecision as AgentImprovementReviewDecision$1, AgentImprovementSource, AgentImprovementSurface, AgentProfile, AgentProfileDiff, AgentProfileImprovementChange, AgentProfileImprovementExecutionRef, AgentProfileImprovementExperiment, AgentProfileImprovementMeasuredComparison, AgentProfileImprovementMeasurement, AgentProfileImprovementRunReceipt, AgentProfileImprovementTaskMaterial, AgentProfileMcpServer, CandidateExecutionEvidence, CandidateExecutionEvidence as CandidateExecutionEvidence$1, Sha256Digest } from "@tangle-network/agent-interface";
import { CostLedgerHandle, TraceStore } from "@tangle-network/agent-eval";
import { ProposalFinding as ProposalFinding$1 } from "@tangle-network/agent-eval/analyst";
import { CampaignScenarioIdentity, OptimizationMethodComparison, OptimizationPackageSource, OptimizationTokenUsage } from "@tangle-network/agent-eval/campaign";
import { AgentProfileImprovementExperimentExecutionInput, CandidateExperimentExecutionInput, CompareCandidateExperimentOptions, Scenario as Scenario$1 } from "@tangle-network/agent-eval/contract";
import { AgentExactProcessResources } from "@tangle-network/agent-interface/environment-provider";
//#region src/intelligence/effort.d.ts
/**
 *
 * EffortPolicy — pure data, no execution. Resolves a named tier into a flat
 * settings object the Intelligence wrapper reads to decide WHICH intelligence
 * spawns are admitted. The composer never runs anything; it only describes the
 * shape of intelligence a tier permits.
 *
 * The billing boundary lives one layer above this (the wrapper tags trace usage
 * by class). What this module owns is the single law the OFF tier rests on:
 * `'off'` ⇒ every intelligence knob OFF (analysts:false, corpus:'off',
 * fanout:1, loops:false, intelligenceBudgetUsd:0). At OFF the wrapper runs the
 * agent as pure passthrough and only intelligence-class usage can prove to be
 * zero — there is nothing to spawn.
 *
 * @stable
 */
/** The named effort tiers, lowest to highest. `'off'` is the honest floor
 *  below `'eco'`: intelligence fully off, telemetry still best-effort. */
type EffortTier = 'off' | 'eco' | 'standard' | 'thorough' | 'max';
/** Corpus access an intelligence tier permits. `'off'` reads and writes
 *  nothing; `'read'` consults the cross-run corpus without contributing;
 *  `'read-write'` both consults and accumulates. */
type CorpusAccess = 'off' | 'read' | 'read-write';
/**
 * The flat, resolved settings a tier compiles to. Every field is individually
 * overridable through `resolveEffort`. Pure data — read by the wrapper, never
 * self-executing.
 */
interface EffortSettings {
  /** Whether trace-derived analyst diagnosis may spawn. `false` ⇒ no analyst. */
  analysts: boolean;
  /** Cross-run corpus access this tier permits. */
  corpus: CorpusAccess;
  /** Parallel candidate width. `1` ⇒ single-shot, no breadth. */
  fanout: number;
  /** Whether multi-step improvement loops (refine / fanout-vote) may run. */
  loops: boolean;
  /**
   * Ceiling, in USD, for INTELLIGENCE-class spawns only (analysts, corpus,
   * loops) — NOT base inference. `0` refuses every intelligence spawn; `null`
   * means uncapped (the spend lands on the Pareto receipt). Base-stream
   * inference is billed on its own channel and is never constrained here.
   */
  intelligenceBudgetUsd: number | null;
}
/** Per-field overrides applied on top of a tier preset. Any subset of the
 *  resolved settings; each provided field wins over the preset. */
type EffortOverrides = Partial<EffortSettings>;
/** The default tier when a client declares no effort. `'standard'` turns
 *  intelligence on with sensible knobs; opt down to `'off'`/`'eco'` or up to
 *  `'thorough'`/`'max'`. */
declare const defaultEffortTier: EffortTier;
/**
 * Compile a named tier (plus optional per-field overrides) into the flat
 * `EffortSettings` the wrapper reads. Pure: same inputs → same object, no I/O,
 * no execution. Fails loud on an unknown tier rather than silently defaulting —
 * a typo'd tier must not quietly grant or deny intelligence.
 *
 * Invariant preserved for the billing floor: `resolveEffort('off')` always
 * yields `intelligenceBudgetUsd: 0` with every intelligence knob off UNLESS the
 * caller explicitly overrides a field — overriding off is an opt-in the caller
 * owns, not a default the composer leaks.
 */
declare function resolveEffort(tier: EffortTier, overrides?: EffortOverrides): EffortSettings;
/**
 * True when these settings admit NO intelligence spawn — the passthrough
 * predicate the wrapper branches on. Every intelligence axis must be off:
 * analysts disabled, corpus off, no breadth, no loops, and a zero intelligence
 * budget. A caller who overrides any one of these back on is no longer at the
 * OFF floor and the wrapper treats them as an intelligence-enabled run.
 */
declare function isIntelligenceOff(settings: EffortSettings): boolean;
/**
 * The run-config overrides an `EffortSettings` compiles to — the bridge between the
 * pure effort policy and the orchestration entrypoints (`runPersonified` / the
 * improvement cycle). This is ONLY data: it never constructs an analyst or runs a
 * loop. The caller reads these flags to decide WHAT to pass:
 *
 *  - `withAnalyst: false` ⇒ DO NOT construct/pass a `ScopeAnalyst` to `runPersonified`
 *    (the dormant empty-findings path runs; the base agent still works). This is the
 *    PRODUCT fail-closed at `off`/`eco` — "don't construct the analyst" — distinct from
 *    the EXPERIMENT fail-closed inside `createScopeAnalyst` ("hard abort"), which stays
 *    untouched. Degrade, never throw.
 *  - `fanout` ⇒ the `ShapeBudget.fanout` width to pass (`1` at `off`, the tier's breadth
 *    otherwise). Overrides the personify default fanout.
 *  - `withLoops: false` ⇒ the improvement cycle is a no-op for this run (no refine /
 *    fanout-vote multi-step loop spawns).
 *  - `intelligenceBudgetUsd` ⇒ the intelligence-class spend ceiling carried through for
 *    the billing clamp (passed verbatim; `0` refuses every intelligence spawn).
 */
interface EffortOverridesCompiled {
  /** Construct + pass a `ScopeAnalyst`? `false` ⇒ omit it (degrade to the base agent). */
  withAnalyst: boolean;
  /** `ShapeBudget.fanout` width to pass to `runPersonified`. */
  fanout: number;
  /** Run the multi-step improvement cycle, or no-op it for this run? */
  withLoops: boolean;
  /** Intelligence-class spend ceiling. `0` refuses every intelligence spawn; `null` uncapped. */
  intelligenceBudgetUsd: number | null;
}
/**
 * Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same
 * input → same object, no I/O, no execution, no construction. It is the single place that
 * maps the effort axes onto the run-config knobs, so no `if (effort)` leaks into the
 * supervise kernel — the kernel stays effort-blind, the caller reads these flags once.
 *
 * `off`/`eco` (`analysts: false`) compile to `withAnalyst: false` ⇒ the caller omits the
 * analyst and the run degrades to the dormant base agent rather than throwing. `fanout: 1`
 * (no breadth) at `off`; `withLoops: false` no-ops the improvement cycle. `standard`+
 * compile to `withAnalyst: true`, the tier's `fanout`, and `withLoops: true`.
 */
declare function compileEffort(settings: EffortSettings): EffortOverridesCompiled;
//#endregion
//#region src/intelligence/improvement-surfaces.d.ts
/** Agent improvement surfaces delivered as exact `AgentProfileDiff` replacements. */
declare const AGENT_IMPROVEMENT_PROFILE_SURFACES: readonly ["prompt", "skills", "tools", "mcp", "hooks", "subagents"];
type AgentImprovementProfileSurface = (typeof AGENT_IMPROVEMENT_PROFILE_SURFACES)[number];
/**
 * Profile changes eligible for the product-owned measured comparison path.
 * The six directly deliverable profile surfaces retain their granular labels;
 * any residual profile axis also adds the complete `agent-profile` surface.
 */
declare const AGENT_PROFILE_MEASURED_SURFACES: readonly ["prompt", "skills", "tools", "mcp", "hooks", "subagents", "agent-profile"];
type AgentProfileMeasuredSurface = (typeof AGENT_PROFILE_MEASURED_SURFACES)[number];
interface AgentImprovementTargetProfileDiffOptions {
  id: string;
  source?: AgentProfileDiff['source'];
  metadata?: Record<string, unknown>;
}
type AgentImprovementActivationTargetIdentity = Pick<AgentImprovementActivationTarget, 'surface' | 'identity'>;
/** Bind caller-owned target identities to the exact source state Runtime measured. */
declare function buildAgentImprovementActivationTargets(surfaces: readonly AgentImprovementSurface[], experiment: AgentImprovementEvaluation$1['experiment'], intent: AgentImprovementActivationIntent$1, identities: readonly AgentImprovementActivationTargetIdentity[]): [AgentImprovementActivationTarget, ...AgentImprovementActivationTarget[]];
/** Return whether a measured surface can be delivered through an agent profile. */
declare function isAgentImprovementProfileSurface(surface: AgentImprovementSurface): surface is AgentImprovementProfileSurface;
/** Return whether a surface is eligible for shared profile measurement. */
declare function isAgentProfileMeasuredSurface(surface: string): surface is AgentProfileMeasuredSurface;
/**
 * Return the canonical current-state input for one profile-deliverable improvement target.
 * Missing slots become `null`; tools and subagents include both their direct and resource slots.
 * Unrelated profile fields are excluded. The result matches `agentImprovementTargetInput` for the
 * same profile inside a candidate bundle.
 */
declare function agentImprovementProfileSurfaceInput(profile: AgentProfile, surface: AgentImprovementProfileSurface): unknown;
/** Return the `Sha256Digest` of one profile surface using Runtime's canonical candidate digest. */
declare function agentImprovementProfileSurfaceDigest(profile: AgentProfile, surface: AgentImprovementProfileSurface): Sha256Digest;
/**
 * Replace one measured profile surface exactly, including array-valued resources.
 * Apply the returned diffs in order: a diff applies its set before its removal,
 * so exact replacement requires a reset record followed by a set record.
 */
declare function agentImprovementTargetProfileDiffs(target: {
  surface: AgentImprovementProfileSurface;
  desiredInput: unknown;
}, options: AgentImprovementTargetProfileDiffOptions): [AgentProfileDiff, ...AgentProfileDiff[]];
/**
 * Derive the ordered profile patch that changes one executable profile into
 * another, then prove the patch preserves the complete candidate state.
 */
declare function agentImprovementProfileDiffs(baselineInput: AgentProfile, candidateInput: AgentProfile, options: AgentImprovementTargetProfileDiffOptions): [AgentProfileDiff, ...AgentProfileDiff[]];
//#endregion
//#region src/intelligence/profile-activation.d.ts
type AgentImprovementProfileActivationTarget = Omit<AgentImprovementActivationTargetPlan, 'surface'> & {
  surface: AgentImprovementProfileSurface;
};
type AgentImprovementProfileTargetState = Omit<AgentImprovementActivationTargetState, 'surface'> & {
  surface: AgentProfileMeasuredSurface;
};
type AgentImprovementProfileTargetTransition = Omit<AgentImprovementActivationTargetTransition, 'surface'> & {
  surface: AgentProfileMeasuredSurface;
};
interface AgentImprovementProfileReplacement {
  identity: string;
  profile: AgentProfile;
}
interface AgentImprovementProfileStateDigestInput {
  identity: string;
  profile: AgentProfile;
}
/** Product-defined hash of the complete profile state that actually runs. */
type AgentImprovementProfileStateDigest = (input: AgentImprovementProfileStateDigestInput) => Sha256Digest;
interface AgentImprovementProfileStateResolverInput {
  identity: string;
  stateDigest: Sha256Digest;
}
/** Product-owned retained-state lookup used only for an explicit restore. */
type AgentImprovementProfileStateResolver = (input: AgentImprovementProfileStateResolverInput) => AgentProfile | undefined;
type AgentImprovementProfileActivationInput = {
  currentByIdentity: ReadonlyMap<string, AgentProfile>;
  targets: readonly [AgentImprovementProfileActivationTarget, ...AgentImprovementProfileActivationTarget[]];
} | {
  currentByIdentity: ReadonlyMap<string, AgentProfile>;
  profileTransition: ProfileImprovementActivationTransitionInput;
  stateDigest: AgentImprovementProfileStateDigest;
  resolveState?: AgentImprovementProfileStateResolver;
};
type AgentImprovementProfileActivationPreparation = {
  status: 'missing';
  identities: readonly string[];
} | {
  status: 'unavailable';
  code: 'PROFILE_STATE_UNAVAILABLE';
  identities: readonly string[];
  requiredStateDigest: Sha256Digest;
} | {
  status: 'already-applied' | 'conflict';
  targets: [AgentImprovementProfileTargetState, ...AgentImprovementProfileTargetState[]];
} | {
  status: 'apply';
  replacements: [AgentImprovementProfileReplacement, ...AgentImprovementProfileReplacement[]];
  targets: [AgentImprovementProfileTargetTransition, ...AgentImprovementProfileTargetTransition[]];
};
/**
 * Compare product-owned profiles with an exact measured transition and prepare
 * all-or-none replacements. The product owns locking, persistence, and retained
 * state; Runtime owns the profile diff semantics and digest checks.
 */
declare function prepareAgentImprovementProfileActivation(input: AgentImprovementProfileActivationInput): AgentImprovementProfileActivationPreparation;
//#endregion
//#region src/intelligence/improvement-cycle.d.ts
interface AgentCandidateExperimentCellPlacement {
  executionId: string;
  attempt?: number;
  executionRoots: AgentCandidateTaskExecution['executionRoots'];
  stagingRoots: AgentCandidateTaskExecution['stagingRoots'];
  ports: AgentCandidateExecutionPorts;
  preparation?: PrepareAgentCandidateExecutionOptions;
  execution: ExecutePreparedAgentCandidateOptions;
}
interface RunAgentCandidateExperimentOptions extends Omit<CompareCandidateExperimentOptions, 'experiment' | 'measurements' | 'measurement' | 'preparation'> {
  experiment: AgentCandidateExperiment;
  placeCell: (input: CandidateExperimentExecutionInput) => AgentCandidateExperimentCellPlacement | Promise<AgentCandidateExperimentCellPlacement>;
  maxConcurrency?: number;
  /** Work before this call. Omit when this function is only measuring a sealed experiment. */
  preparation?: CompareCandidateExperimentOptions['preparation'];
  /** Shared account when preparation and held-out work have one customer budget. */
  costLedger?: CostLedgerHandle;
  signal?: AbortSignal;
}
interface RunAgentCandidateExperimentResult {
  experiment: AgentCandidateExperiment;
  measurements: AgentCandidateExperimentMeasurement[];
  evaluation: AgentImprovementMeasuredComparison$1;
}
interface ExecuteAgentCandidateExperimentCellOptions extends CandidateExperimentExecutionInput, AgentCandidateExperimentCellPlacement {}
interface VerifyCandidateExecutionEvidenceOptions {
  experiment: AgentCandidateExperiment;
  arm: 'baseline' | 'candidate';
  benchmarkCell: AgentCandidateBenchmarkCellRef;
  seed: number;
  attempt?: number;
  resolvedResources?: ReadonlyMap<Sha256Digest, string>;
}
/** A failed baseline or candidate cell with its complete Runtime failure result. */
declare class AgentCandidateExperimentCellExecutionError extends Error {
  readonly finalization: Extract<AgentCandidateRunFinalization, {
    succeeded: false;
  }>;
  constructor(finalization: Extract<AgentCandidateRunFinalization, {
    succeeded: false;
  }>);
}
interface CreateAgentImprovementProposalOptions {
  runId: string;
  findings: readonly ProposalFinding$1[];
  evaluation: AgentImprovementEvaluation$1;
  now?: () => Date;
}
type CreateAgentImprovementMeasuredComparisonOptions = CompareCandidateExperimentOptions;
interface ReviewAgentImprovementInput {
  decision: AgentImprovementReviewDecision$1;
  reviewedBy: string;
  reason: string;
  feedback?: string;
  now?: () => Date;
}
interface CreateAgentImprovementActivationOptions {
  intent: AgentImprovementActivationIntent$1;
  /** Runtime derives each exact source digest; callers identify only the records to change. */
  targets: [AgentImprovementActivationTargetIdentity, ...AgentImprovementActivationTargetIdentity[]];
  fundingOwner: string;
  authorizedBy: string;
  expiresAt: string;
  /** Required only when an activation targets the complete `agent-profile` surface. */
  executionRef?: AgentProfileImprovementExecutionRef;
  now?: () => Date;
}
type AgentImprovementAnalysisOptions = Omit<RunAnalystLoopOpts, 'runId' | 'inputs' | 'improvementProposalSource' | 'knowledgeProposalSource' | 'onEvent' | 'log' | 'costLedger' | 'costPhase' | 'signal'> & {
  inputs: Omit<RunAnalystLoopOpts['inputs'], 'judgeInput'> & {
    judgeInput?: never;
  };
};
type WithProposalFindings<T> = T extends unknown ? Omit<T, 'findings'> & {
  findings?: readonly ProposalFinding$1[];
} : never;
interface ProposeAgentImprovementOptions<TScenario extends Scenario$1, TArtifact> {
  runId: string;
  profile: AgentProfile;
  analysis: AgentImprovementAnalysisOptions;
  improvement: WithProposalFindings<ImproveOptions<TScenario, TArtifact>>;
  buildExperiment: (input: {
    analysis: RunAnalystLoopResult;
    improvement: ImproveResult<TScenario, TArtifact>;
  }) => AgentImprovementExperimentMaterial | Promise<AgentImprovementExperimentMaterial>;
  placeCell: RunAgentCandidateExperimentOptions['placeCell'];
  maxConcurrency?: number;
  signal?: AbortSignal;
  candidate?: AgentImprovementMeasuredComparison$1['candidate'];
  metadata?: AgentImprovementMeasuredComparison$1['metadata'];
  now?: () => Date;
}
/** Product-supplied experiment material. Runtime supplies optimizer ancestry and the final digest. */
type AgentImprovementExperimentMaterial = Omit<AgentCandidateExperimentMaterial, 'candidateLineage'>;
interface ProposeAgentImprovementResult<TScenario extends Scenario$1, TArtifact> {
  analysis: RunAnalystLoopResult;
  improvement: ImproveResult<TScenario, TArtifact>;
  experiment: AgentCandidateExperiment;
  measurements: AgentCandidateExperimentMeasurement[];
  proposal: AgentImprovementProposal$1;
}
/** Product-owned task material that Runtime freezes before either profile state runs. */
interface AgentProfileImprovementBenchmark {
  tasks: [AgentProfileImprovementTaskMaterial, ...AgentProfileImprovementTaskMaterial[]];
  reps: number;
  seeds: [number, ...number[]];
  policy: AgentCandidateEvaluationPolicy;
}
/**
 * One product execution adapter shared by optimizer search and exact profile
 * measurement. `executionRef` must identify both operations and their closure.
 */
interface AgentProfileImprovementExecutor<TScenario extends Scenario$1, TArtifact> {
  executionRef: AgentProfileImprovementExecutionRef;
  optimize: ImproveMethodOptions<TScenario, TArtifact>['agent'];
  measure(input: AgentProfileImprovementExperimentExecutionInput & {
    profile: AgentProfile;
  }): Promise<AgentProfileImprovementRunReceipt>;
}
/** The portable profile changes that the measured-profile contract permits. */
type AgentProfileImprovementMethodOptions<TScenario extends Scenario$1, TArtifact> = Omit<ImproveMethodOptions<TScenario, TArtifact>, 'agent' | 'executionRef' | 'findings' | 'surface'> & {
  surface?: AgentProfileMeasuredSurface;
  findings?: readonly ProposalFinding$1[];
};
/**
 * Complete profile-improvement path for a product-owned source.
 * Runtime owns analysis, search ancestry, profile diffs, experiment sealing,
 * paired evaluation, and the reviewable proposal. The product keeps its
 * profile bytes, task executor, billing, trace capture, and persistence.
 */
interface ProposeAgentProfileImprovementOptions<TScenario extends Scenario$1, TArtifact> {
  runId: string;
  source: AgentImprovementSource;
  profile: AgentProfile;
  stateDigest: AgentImprovementProfileStateDigest;
  analysis: AgentImprovementAnalysisOptions;
  improvement: AgentProfileImprovementMethodOptions<TScenario, TArtifact>;
  benchmark: AgentProfileImprovementBenchmark;
  executor: AgentProfileImprovementExecutor<TScenario, TArtifact>;
  /** One customer-approved maximum for analysis, optimization, and measurement. */
  budgetUsd: number;
  maxConcurrency?: number;
  signal?: AbortSignal;
  candidate?: AgentProfileImprovementMeasuredComparison['candidate'];
  metadata?: AgentProfileImprovementMeasuredComparison['metadata'];
  now?: () => Date;
}
interface ProposeAgentProfileImprovementResult {
  analysis: RunAnalystLoopResult;
  improvement: ImproveMethodResult;
  experiment: AgentProfileImprovementExperiment;
  measurements: AgentProfileImprovementMeasurement[];
  proposal: AgentImprovementProposal$1;
}
/** Execute both arms of one immutable experiment and derive its paired result. */
declare function runAgentCandidateExperiment(options: RunAgentCandidateExperimentOptions): Promise<RunAgentCandidateExperimentResult>;
/** Execute one exact arm, task, repetition, seed, and attempt through Runtime. */
declare function executeAgentCandidateExperimentCell(options: ExecuteAgentCandidateExperimentCellOptions): Promise<CandidateExecutionEvidence$1>;
/** Delegate all statistics and promotion checks to agent-eval's receipt-based comparison. */
declare function createAgentImprovementMeasuredComparison(options: CreateAgentImprovementMeasuredComparisonOptions): AgentImprovementMeasuredComparison$1;
/**
 * Analyze a product-owned profile, search one profile surface, then run the
 * exact baseline and candidate through the product executor before proposing.
 */
declare function proposeAgentProfileImprovement<TScenario extends Scenario$1, TArtifact>(options: ProposeAgentProfileImprovementOptions<TScenario, TArtifact>): Promise<ProposeAgentProfileImprovementResult>;
/** Analyze, search, then remeasure the resulting exact candidate before proposing it. */
declare function proposeAgentImprovement<TScenario extends Scenario$1, TArtifact>(options: ProposeAgentImprovementOptions<TScenario, TArtifact>): Promise<ProposeAgentImprovementResult<TScenario, TArtifact>>;
/** Create the reviewable record only from a complete, recomputable experiment result. */
declare function createAgentImprovementProposal(options: CreateAgentImprovementProposalOptions): AgentImprovementProposal$1;
/** Persist a human or tenant-policy decision bound to one exact proposal. */
declare function reviewAgentImprovementProposal(inputProposal: AgentImprovementProposal$1, input: ReviewAgentImprovementInput): AgentImprovementReview$1;
/** Authorize product-owned writes only after the exact candidate was measured and approved. */
declare function createAgentImprovementActivation(inputProposal: AgentImprovementProposal$1, inputReview: AgentImprovementReview$1, options: CreateAgentImprovementActivationOptions): AgentImprovementActivation$1;
/** Validate a proposal and recompute every binding to its measured experiment. */
declare function verifyAgentImprovementProposal(input: unknown): AgentImprovementProposal$1;
/** Validate the canonical identity and wire shape of an improvement review. */
declare function verifyAgentImprovementReview(input: unknown): AgentImprovementReview$1;
/** Validate activation authority against the exact proposal, review, experiment, and base state. */
declare function verifyAgentImprovementActivation(input: {
  proposal: unknown;
  review: unknown;
  activation: unknown;
}): AgentImprovementActivation$1;
/** Recheck one Runtime receipt against its exact signed experiment cell. */
declare function verifyCandidateExecutionEvidence(input: unknown, options: VerifyCandidateExecutionEvidenceOptions): CandidateExecutionEvidence$1;
//#endregion
//#region src/intelligence/authored-profile-improvement.d.ts
/** Lineage accepted by the direct candidate path. Optimizer lineage belongs to `improve()`. */
type AuthoredAgentProfileCandidateLineage = Omit<AgentCandidateLineage, 'source' | 'profileDiffIds'> & {
  source: Exclude<AgentCandidateLineage['source'], 'optimizer'>;
  /** Runtime derives these from the exact profile change it seals. */
  profileDiffIds?: never;
};
/** Provenance attached while Runtime derives the exact profile diff. */
type AuthoredAgentProfileDiffOptions = NonNullable<Parameters<typeof agentImprovementProfileDiffs>[2]>;
/** Product-owned executor for exact baseline/candidate profile measurement. */
interface AgentProfileCandidateMeasurementExecutor {
  executionRef: AgentProfileImprovementExecutionRef;
  measure(input: AgentProfileImprovementExperimentExecutionInput & {
    profile: AgentProfile;
  }): Promise<AgentProfileImprovementRunReceipt>;
}
/**
 * Measure a complete human-authored, imported, or compound profile candidate.
 * No optimizer runs and no optimizer receipt is fabricated.
 */
interface ProposeAuthoredAgentProfileImprovementOptions {
  runId: string;
  source: AgentImprovementSource;
  profile: AgentProfile;
  stateDigest: AgentImprovementProfileStateDigest;
  candidateProfile: AgentProfile;
  candidateLineage: AuthoredAgentProfileCandidateLineage;
  /** Optional source/artifact metadata used on Runtime-derived profile diff steps. */
  diff?: AuthoredAgentProfileDiffOptions;
  findings?: readonly ProposalFinding$1[];
  benchmark: AgentProfileImprovementBenchmark;
  executor: AgentProfileCandidateMeasurementExecutor;
  /** One customer-approved maximum for the held-out paired measurement. */
  budgetUsd: number;
  /** Optional identities used to prove authored/imported development work is held out. */
  developmentScenarios?: readonly CampaignScenarioIdentity[];
  maxConcurrency?: number;
  signal?: AbortSignal;
  candidate?: AgentProfileImprovementMeasuredComparison['candidate'];
  metadata?: AgentProfileImprovementMeasuredComparison['metadata'];
  now?: () => Date;
}
interface ProposeAuthoredAgentProfileImprovementResult {
  candidateProfile: AgentProfile;
  candidateLineage: AgentCandidateLineage;
  experiment: AgentProfileImprovementExperiment;
  measurements: AgentProfileImprovementMeasurement[];
  proposal: AgentImprovementProposal$1;
}
/**
 * Put a complete authored/imported profile through the canonical profile
 * experiment and proposal path without invoking `improve()`.
 */
declare function proposeAuthoredAgentProfileImprovement(options: ProposeAuthoredAgentProfileImprovementOptions): Promise<ProposeAuthoredAgentProfileImprovementResult>;
//#endregion
//#region src/intelligence/delivery.d.ts
/** A promoted, certified artifact (one entry in the composed profile). */
interface CertifiedArtifact {
  path: string | null;
  content: string;
  contentHash: string;
  version: number | null;
  /** Held-out gate lift attached at certification, e.g. "+3.1pp" — never a
   *  within-run claim. `null` when the promotion carried no lift record. */
  lift: string | null;
  promotedAt: string;
}
/** The active promoted prompt surface for a target. */
interface CertifiedPromptSurface {
  surface: string;
  surfaceHash: string;
  version: number | null;
  lift: string | null;
}
/** The held-out provenance the plane's certify step stamps on a promoted diff.
 *  `lift` is the held-out gate lift (e.g. "+3.1pp"), never a within-run claim. */
interface DiffProvenance {
  version: number | null;
  lift: string | null;
  contentHash: string;
  promotedAt: string;
}
/**
 * A gate-certified profile diff the plane has already promoted, plus the
 * held-out provenance it carries. This is the previously-DROPPED typed diff the
 * composed endpoint returns; `withIntelligence` deserializes it and surfaces it
 * as a PROPOSAL — a human, or the gated local `improve()` loop, turns a proposal
 * into a shipped profile. It is NEVER auto-applied at runtime.
 */
interface ProposedProfileDiff {
  diff: AgentProfileDiff;
  provenance: DiffProvenance;
}
/** The composed endpoint's per-capability summary — the narrow shape on the
 *  wire (id + surface + path/content + provenance). Distinct from the richer
 *  `CertifiedCapability` the capability resolver lowers a manifest into. */
interface CertifiedCapabilitySummary {
  id: string;
  iface: {
    surface: string;
  };
  binding: {
    path: string | null;
    content: string;
  };
  provenance: DiffProvenance;
}
/** The composed certified profile — exactly the shape the plane's
 *  `GET /v1/profiles/:target/composed` returns. */
interface CertifiedProfile {
  target: string;
  generatedAt: string;
  promptSurface: CertifiedPromptSurface | null;
  artifacts: Record<string, CertifiedArtifact[]>;
  /** The typed profile diffs the plane has promoted, each with held-out
   *  provenance. Surfaced as proposals; never auto-applied. Empty when none. */
  agentProfileDiffs: ProposedProfileDiff[];
  /** The composed capability summaries the plane returns. Empty when none. */
  capabilities: CertifiedCapabilitySummary[];
  /** The composed profile the promoted diffs fold to, for inspection. `null`
   *  when no diffs are promoted. */
  agentProfile: AgentProfile | null;
}
/** Typed outcome for the pull — inspect `succeeded` before `value`. A 404
 *  (nothing promoted yet) is a normal, non-error `succeeded: false`. */
type PullOutcome = {
  succeeded: true;
  value: CertifiedProfile;
} | {
  succeeded: false;
  error: string;
  status?: number;
};
interface PullCertifiedOptions {
  /** The agent target certified artifacts are promoted under. */
  target: string;
  /** Bearer key. Defaults to `process.env.TANGLE_API_KEY`. */
  apiKey?: string;
  /** Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
   *  `https://intelligence.tangle.tools`. */
  baseUrl?: string;
  /** fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms. Default 10000. */
  timeoutMs?: number;
}
/** What Runtime knows about a failed proposal submission.
 * `not-sent` means no request began, `rejected` means Intelligence returned a
 * definitive 4xx response, and `unconfirmed` means the caller may safely retry
 * the same immutable proposal. */
type AgentImprovementProposalSubmissionState = 'not-sent' | 'rejected' | 'unconfirmed';
/** Submit a completed measured proposal for product-side review. */
interface SubmitAgentImprovementProposalOptions {
  proposal: AgentImprovementProposal$1;
  /** Bearer key. Defaults to `process.env.TANGLE_API_KEY`. */
  apiKey?: string;
  /** Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
   * `https://intelligence.tangle.tools`. */
  baseUrl?: string;
  /** fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort the request after this many ms. Default 10000. */
  timeoutMs?: number;
}
/** Typed result for proposal submission. A successful result contains the
 * exact immutable proposal Intelligence recorded. */
type SubmitAgentImprovementProposalOutcome = {
  succeeded: true;
  value: AgentImprovementProposal$1;
  status: number;
} | {
  succeeded: false;
  submission: AgentImprovementProposalSubmissionState;
  error: string;
  status?: number;
  code?: string;
};
/** Resolve the ONE Intelligence base URL — the single knob both the send and
 *  receive paths derive from. Env fallback: `TANGLE_INTELLIGENCE_URL`. */
declare function resolveIntelligenceBaseUrl(baseUrl: string | undefined): string;
/**
 * Deserialize the composed-endpoint response into a `CertifiedProfile`. The
 * previously-dropped `agentProfileDiffs`/`capabilities`/`agentProfile` are read
 * here so they round-trip to the consumer; a plane that has not yet promoted any
 * diffs simply yields empty arrays / a null profile (fail-closed, never a crash).
 */
declare function normalizeCertifiedProfile(raw: unknown): CertifiedProfile;
/**
 * Pull the certified composed profile for a target. Fail-closed: a network
 * error or a non-2xx returns a typed `succeeded: false` (never throws), so a
 * caller can run on its base surface when Intelligence is unreachable. A 404 is
 * the normal "nothing promoted yet" signal, carried as `status: 404`.
 */
declare function pullCertified(opts: PullCertifiedOptions): Promise<PullOutcome>;
/**
 * Submit a completed Runtime proposal to Intelligence for product-side review.
 * This never runs an experiment, approves a proposal, or applies a candidate.
 * A 4xx response is a confirmed `rejected` request. Network failures, timeouts,
 * 5xx responses, and invalid success responses are `unconfirmed`, so callers
 * can retry the same digest because Intelligence stores proposals idempotently.
 */
declare function submitAgentImprovementProposal(opts: SubmitAgentImprovementProposalOptions): Promise<SubmitAgentImprovementProposalOutcome>;
/**
 * Fold the certified prompt surface (and any certified prompt-folding artifacts:
 * `prompt-surface` / `skill` / `instructions`) into a base system prompt under a
 * marked section, so the deployed agent prompt == base + the gate-certified
 * additions. Order is stable (prompt surface first, then artifact buckets in
 * `promptFoldTypes` order, then by path within a bucket) so the same profile
 * renders byte-identically each call. Returns `base` unchanged when there is no
 * usable certified content. Reads only the prompt-folding slice of a profile.
 */
declare function composeCertifiedPrompt(base: string, certified: Pick<CertifiedProfile, 'promptSurface' | 'artifacts'> | null): string;
/** A cached, self-refreshing source of a target's certified prompt additions —
 *  the prompt-only delivery lane for callers that assemble their OWN system
 *  prompt (product chat routes) rather than wrapping an agent fn. Same
 *  fail-closed semantics as {@link pullCertified}: pulls at most every
 *  `refreshMs`, coalesces concurrent pulls, keeps the last-known profile on a
 *  failed/404 pull, never throws, never blocks past the pull timeout. */
interface CertifiedPromptSource {
  /** Refresh (window-respecting) then fold the certified additions into a
   *  base system prompt. Returns `base` unchanged when nothing is promoted. */
  compose(base: string): Promise<string>;
  /** The certified profile currently in effect (`null` = none pulled yet). */
  current(): CertifiedProfile | null;
  /** Pull after the refresh window, or force a pull now. Both join an in-flight pull. */
  refresh(options?: {
    force?: boolean;
  }): Promise<void>;
}
/** Options for {@link createCertifiedPromptSource} — the pull coordinates plus
 *  the refresh cadence. */
interface CertifiedPromptSourceOptions extends PullCertifiedOptions {
  /** Min interval between certified-profile pulls. Default 5m. */
  refreshMs?: number;
}
/**
 * Create the cached certified-prompt source — the ONE module-scope-cache +
 * coalesced-refresh + keep-last-known implementation. Product wiring uses this
 * rather than hand-rolling the same lines around `pullCertified`. The
 * `withIntelligence` hook rides this same source for its prompt delivery.
 */
declare function createCertifiedPromptSource(opts: CertifiedPromptSourceOptions): CertifiedPromptSource;
//#endregion
//#region src/intelligence/capability.d.ts
/** A structural JSON Schema object describing a tool's parameters. */
type JsonSchema = Record<string, unknown>;
/**
 * What the agent consumes. CLOSED — a new runtime kind NEVER extends this. Each
 * arm maps slot-for-slot onto `AgentProfile` + the host `RouterToolsSeam`.
 */
type CapabilityInterface = {
  surface: 'tool';
  name: string;
  description?: string;
  parameters: JsonSchema;
  returns?: JsonSchema;
} | {
  surface: 'mcp';
  serverName: string;
  toolset?: string[];
} | {
  surface: 'context';
  kind: 'prompt-surface' | 'skill' | 'instructions';
  name: string;
} | {
  surface: 'retrieval';
  name: string;
  description?: string;
  topK?: number;
} | {
  surface: 'hook';
  event: string;
  matcher?: string;
} | {
  surface: 'subagent';
  name: string;
  description?: string;
};
/** Every interface surface tag supported by the manifest schema. */
type CapabilitySurface = CapabilityInterface['surface'];
/**
 * Where a capability's bytes live. A leaked manifest carries no live secret and
 * no inlined blob: `github`/`blob` are pointers resolved at provision time.
 */
type ContentRef = {
  kind: 'inline';
  content: string;
} | {
  kind: 'github';
  repository?: string;
  path: string;
  ref?: string;
} | {
  kind: 'blob';
  uri: string;
  sha256: string;
  bytes?: number;
};
/** A named secret a binding requires — declared, never carried. */
interface CredentialRef {
  key: string;
}
/**
 * How a binding authenticates at resolve time. Declared as a REQUIREMENT in the
 * manifest; the consumer resolves the live secret per tenant,
 * never inlined here.
 */
type CapabilityAuth = {
  mode: 'none';
} | {
  mode: 'tangle-key';
} | {
  mode: 'hub-connection';
  providerId: string;
  scopes?: string[];
} | {
  mode: 'secret-ref';
  key: string;
};
/**
 * The host a `process-on-infra` binding provisions before its inner binding.
 * Reuses `createExecutor`'s backend-as-data vocabulary — no new runtime invented.
 * `image` is the sandbox image tag; `warm`/`idleTtlMs`/`costTag` meter standing
 * cost; `ports` are the inner server's listen ports the host must expose.
 */
interface HostSpec {
  backend: 'sandbox' | 'router' | 'cli';
  image?: string;
  ports?: number[];
  warm?: boolean;
  idleTtlMs?: number;
  costTag?: string;
}
/**
 * Describes how a capability is backed.
 * Consumers must admit a binding before executing it.
 */
type DeliveryBinding = {
  kind: 'inline';
  content: ContentRef;
} | {
  kind: 'file';
  path: string;
  content: ContentRef;
  executable?: boolean;
} | {
  kind: 'http';
  url: string;
  method?: string;
  auth?: CapabilityAuth;
} | {
  kind: 'sandbox-code';
  entry: string;
  code: ContentRef;
  runtime?: string;
  harness?: string;
} | {
  kind: 'mcp-stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
} | {
  kind: 'mcp-remote';
  url: string;
  transport: 'http' | 'sse';
  headers?: Record<string, string>;
} | {
  kind: 'process-on-infra';
  host: HostSpec;
  inner: DeliveryBinding;
} | {
  kind: 'rag-index';
  index: ContentRef;
  embedModel: string;
  topK?: number;
} | {
  kind: 'memory-store';
  provision: 'sqlite';
  seed?: ContentRef;
} | {
  kind: 'wasm';
  module: ContentRef;
  exports: string[];
} | {
  kind: 'a2a';
  endpoint: string;
  card: ContentRef;
  auth?: CapabilityAuth;
};
/** Every binding kind represented by the manifest schema. */
type DeliveryBindingKind = DeliveryBinding['kind'];
/**
 * The certify lane's held-out lift travelling WITH delivery. The shipped
 * `CertifiedArtifact` envelope minus its content (which moves into the binding
 * arm): `version`/`contentHash`/`lift` are stamped by the promote step, never
 * the author.
 *
 * `sourcePath` is the artifact's ORIGINAL path (including `null`). It is the
 * byte-stable fold sort key — consumers can fold context artifacts in
 * `composeCertifiedPrompt` order, which sorts by `path ?? ''`, so a `null` path
 * is load-bearing and MUST round-trip exactly. It is distinct from a context
 * `iface.name` (display only): collapsing the two flips the fold order for a
 * mix of null-path and non-null-path artifacts.
 */
interface CertProvenance {
  contentHash: string;
  version: number | null;
  lift: string | null;
  promotedAt: string;
  sourcePath: string | null;
}
/** One certified unit of agent power. */
interface CertifiedCapability {
  id: string;
  iface: CapabilityInterface;
  binding: DeliveryBinding;
  auth: CapabilityAuth;
  provenance: CertProvenance;
}
/**
 * The strict generalization of `CertifiedProfile`. `promptSurface` is kept
 * during the migration window (the shipped pull lane still emits it); new
 * capabilities live in `capabilities`.
 */
interface CapabilityManifest {
  target: string;
  generatedAt: string;
  promptSurface: CertifiedPromptSurface | null;
  capabilities: CertifiedCapability[];
}
/** One retrieval handle. The agent never learns vector vs graph vs index. */
interface ResolvedRetrieval {
  name: string;
  retrieve(query: string, k?: number): Promise<Array<{
    text: string;
    score?: number;
  }>>;
}
/** One resolved hook — event + the command/matcher the seam folds into
 *  `AgentProfile.hooks`. */
interface ResolvedHook {
  event: string;
  command: string;
  matcher?: string;
}
/** One resolved subagent — folded into `AgentProfile.subagents`. */
interface ResolvedSubagent {
  name: string;
  description?: string;
  prompt?: string;
}
/** Materialized capability surfaces supplied by a consumer-owned executor. */
interface ResolvedSurface {
  /** Host-side tool defs → `RouterToolsSeam.tools` / agent-app `extraTools`. */
  tools: ToolSpec[];
  /** Host-side dispatch for a resolved tool. Throws when `name` is unknown so a
   *  mis-dispatch is loud, never a silent empty string. */
  execute(name: string, args: Record<string, unknown>, task: unknown): Promise<string>;
  /** Sandbox-side tool delivery → `AgentProfile.mcp` / in-proc `createMcpEnvironment`. */
  mcpConnections: Record<string, AgentProfileMcpServer>;
  /** Prompt-context additions, byte-stable-ordered → folded system prompt. */
  promptAdditions: string[];
  /** Workspace files → `AgentProfile.resources.files`. */
  files: Array<{
    path: string;
    content: string;
    executable?: boolean;
  }>;
  /** Uniform retrieval handles. */
  retrieval: ResolvedRetrieval[];
  /** Hooks → `AgentProfile.hooks`. */
  hooks: ResolvedHook[];
  /** Subagents → `AgentProfile.subagents`. */
  subagents: ResolvedSubagent[];
  /** The folded system prompt — base + the byte-stable prompt additions, exactly
   *  as `composeCertifiedPrompt` renders the inline/context capabilities. */
  systemPrompt: string;
  /** Tear down provisioned hosts (reverse dependency order). */
  dispose(): Promise<void>;
}
/**
 * A consumer rejected a binding that its executor does not admit.
 */
declare class CapabilityNotAdmittedError extends Error {
  readonly kind: DeliveryBindingKind;
  readonly capabilityId: string;
  constructor(kind: DeliveryBindingKind, capabilityId: string, reason: string);
}
/**
 * Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`.
 * `prompt-surface`/`skill` artifacts → `context`/inline capabilities (the
 * shipped fold, generalized); any other artifact type → best-effort binding
 * inference. `promptSurface` is carried through so
 * `composeCertifiedPrompt` folds it before other prompt artifacts.
 * This delivers the spine against today's wire before the plane changes.
 */
declare function manifestFromProfile(profile: CertifiedProfile): CapabilityManifest;
//#endregion
//#region src/intelligence/exact-process-candidate.d.ts
/** Candidate surfaces implemented by the neutral exact-process executor. */
declare const exactProcessCandidateExperimentExecutionSupport: Readonly<{
  outcomes: readonly ["output"];
  outputMediaTypes: readonly ["text/*", "application/json", "*+json"];
  code: readonly ["disabled"];
  memory: readonly ["disabled"];
  knowledge: true;
  profile: Readonly<{
    mcpTransports: readonly ["stdio"];
    remoteMcp: false;
    tools: false;
    permissions: false;
    modes: false;
    confidential: false;
  }>;
  isolation: Readonly<{
    freshEnvironment: true;
    exactProcess: true;
    egress: readonly ["blocked", "strict"];
  }>;
}>;
interface CreateExactProcessCandidateExperimentExecutorOptions {
  provider: AgentEnvironmentProviderRef;
  providerRegistry?: AgentEnvironmentProviderRegistry;
  resources: AgentExactProcessResources;
  providerOptions?: Record<string, unknown>;
  provisionTimeoutMs?: number;
  recoveryRetentionMs?: number;
  ports: AgentCandidateExecutionPorts;
  grader: AgentCandidateBenchmarkGraderPort;
  outputArtifacts: AgentCandidateOutputArtifactPort;
  traceStore: TraceStore;
  claimStore: AgentCandidateExecutionClaimStore;
  cleanupTimeoutMs?: number;
  resultTimeoutMs?: number;
}
/** Product-owned candidate ports other than protected model access. */
type AgentCandidateExecutionHostPorts = Omit<AgentCandidateExecutionPorts, 'models'>;
/**
 * Builds the standard exact-process executor with model access that is scoped,
 * metered, and settled by the caller's grant service.
 */
interface CreateProtectedExactProcessCandidateExperimentExecutorOptions extends Omit<CreateExactProcessCandidateExperimentExecutorOptions, 'ports'> {
  hostPorts: AgentCandidateExecutionHostPorts;
  model: CreateProtectedAgentCandidateModelPortOptions;
}
interface ExactProcessCandidateExperimentExecution extends CandidateExperimentExecutionInput {
  executionId: string;
  attempt?: number;
  executionRoots: AgentCandidateExperimentCellPlacement['executionRoots'];
  stagingRoots: AgentCandidateExperimentCellPlacement['stagingRoots'];
  preparation?: PrepareAgentCandidateExecutionOptions;
}
interface ExactProcessCandidateExperimentExecutor {
  /** Runtime's expired-attempt path reuses this port only to stop and dispose. */
  readonly executor: AgentCandidateExecutorPort;
  execute(input: ExactProcessCandidateExperimentExecution): Promise<CandidateExecutionEvidence$1>;
}
/** Exact-process executor plus the ports required for durable recovery. */
interface ProtectedExactProcessCandidateExperimentExecutor extends ExactProcessCandidateExperimentExecutor {
  readonly recoveryPorts: Pick<AgentCandidateExecutionPorts, 'models' | 'memory'>;
}
/** Execute one signed experiment cell through any declared exact-process provider. */
declare function createExactProcessCandidateExperimentExecutor(options: CreateExactProcessCandidateExperimentExecutorOptions): ExactProcessCandidateExperimentExecutor;
/** Compose host-owned execution ports with protected model access for one exact-process run. */
declare function createProtectedExactProcessCandidateExperimentExecutor(options: CreateProtectedExactProcessCandidateExperimentExecutorOptions): ProtectedExactProcessCandidateExperimentExecutor;
//#endregion
//#region src/intelligence/optimization-receipt.d.ts
type OptimizationProvenance = NonNullable<OptimizationMethodComparison['best']['provenance']>;
interface OptimizationActivationReceipt {
  kind: 'optimization-activation-receipt';
  method: string;
  source: OptimizationPackageSource;
  bridge?: OptimizationPackageSource;
  modules?: OptimizationProvenance['modules'];
  python?: OptimizationProvenance['python'];
  models?: {
    candidate?: NonNullable<AgentProfile['model']>;
    optimizer?: string;
  };
  usage: {
    optimizerEvaluations: number;
    optimizerTokens?: OptimizationTokenUsage;
  };
  cost: {
    optimization: OptimizationReceiptCost;
    finalTest: OptimizationReceiptCost;
    total: OptimizationReceiptCost;
  };
  invocation: {
    runtimeInvocationId: string;
    optimizerRunId: string;
    compatibleOptimizerRunId?: string;
    resumed: boolean;
    artifactDir: string;
  };
  developmentDataDigest: Sha256Digest;
  finalTestDataDigest: Sha256Digest;
  scenarioPartitions: ImproveScenarioPartitions;
  digest: Sha256Digest;
}
interface OptimizationReceiptCost {
  totalUsd: number;
  accountingComplete: boolean;
  incompleteReasons: string[];
}
/** Build a detached receipt only for methods backed by an identified external optimizer. */
declare function createOptimizationActivationReceipt(improvement: ImproveMethodResult): OptimizationActivationReceipt | undefined;
/** Read and verify the optimizer evidence carried by a measured proposal. */
declare function optimizationActivationReceiptFromMetadata(metadata: AgentImprovementMeasuredComparison$1['metadata']): OptimizationActivationReceipt | undefined;
//#endregion
//#region src/intelligence/with-intelligence.d.ts
/** What the hook hands the agent each run. Additive over the prompt-only
 *  delivery: `composePrompt` folds the certified prompt surface (as before);
 *  `proposals`/`applyProfile` surface the promoted profile DIFFS — never
 *  auto-applied; `record` enriches the {@link RunRecord} that is sent. */
interface AppliedIntelligence {
  /** Stable ids shared by the run span and every nested runtime/loop span. */
  runId: string;
  traceId: string;
  /** The certified profile in effect (null when none promoted / pull failed —
   *  fail-closed: the agent runs on its base surface). */
  certified: CertifiedProfile | null;
  /** Fold the certified prompt surface into a base system prompt (the promoted
   *  prompt). The consumer opts in by calling it. */
  composePrompt(base: string): string;
  /** The promoted, gate-certified profile diffs — surfaced for a human or the
   *  gated `improve()` loop. NEVER auto-applied by this hook. Empty when none. */
  proposals: ProposedProfileDiff[];
  /** Fold every proposal into `base` via `applyAgentProfileDiff`, in promotion
   *  order, and return the result. The caller invokes this EXPLICITLY (it is the
   *  human/gated apply step) — the hook never calls it on the run path. */
  applyProfile(base: AgentProfile): AgentProfile;
  /** Enrich the {@link RunRecord} sent for this call — outcome, usage split,
   *  model/provider, and the loop event stream. Optional; an un-recorded run
   *  still sends input/output with unknown usage, except for the OFF billing guarantee. */
  record(report: RunReport): void;
}
/** An agent wrapped by {@link withIntelligence}: receives the input plus the
 *  intelligence delivered for this run. */
type IntelligenceAgent<I, O> = (input: I, applied: AppliedIntelligence) => Promise<O>;
/** `withIntelligence` config = the Observe config plus the pull target, refresh
 *  cadence, and a proposals callback. One base URL (`baseUrl` /
 *  `TANGLE_INTELLIGENCE_URL`) drives both the send and receive paths. */
interface IntelligenceHookConfig extends IntelligenceConfig {
  /** Pull target. Defaults to `project`. */
  target?: string;
  /** Min interval between certified-profile pulls. Default 5m. */
  refreshMs?: number;
  /** Per-pull timeout in ms (fail-closed on a hung plane). Default 10000. */
  timeoutMs?: number;
  /** fetch impl for the pull (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Notified when a refresh delivers a NEW set of promoted proposals (by
   *  provenance content hash). Surfaces diffs without auto-applying them. */
  onProposals?: (proposals: ProposedProfileDiff[]) => void;
}
/** The wrapped agent — same `(input) => Promise<output>` shape, plus a manual
 *  `refresh()` and a `proposals()` accessor for the currently-promoted diffs. */
type IntelligenceWrapped<I, O> = ((input: I) => Promise<O>) & {
  refresh(): Promise<void>;
  proposals(): ProposedProfileDiff[];
  /** Flush buffered trace spans before a short-lived process exits. */
  flush(): Promise<void>;
};
/**
 * Wrap an agent so it (a) RECEIVES the tenant's certified profile — the prompt
 * surface to fold and the promoted profile diffs as proposals — and (b) SENDS a
 * typed {@link RunRecord} per call to the plane. The pull is cached and refreshed
 * at most every `refreshMs`; a failed pull is fail-closed (the agent runs on its
 * base surface, never breaks because Intelligence is unreachable). The send is
 * best-effort — an export failure never fails the agent's turn — while an error
 * thrown by the agent itself propagates unchanged.
 */
declare function withIntelligence<I, O>(agent: IntelligenceAgent<I, O>, config: IntelligenceHookConfig): IntelligenceWrapped<I, O>;
//#endregion
//#region src/intelligence/index.d.ts
/**
 * The per-class cost split carried by every trace and outcome. `off` ⇒
 * `intelligenceUsd: 0` by construction — there is no intelligence spawn to
 * bill. This is a classification on the trace, NOT a budget-pool split.
 */
interface UsageSplit {
  /** Observed base-stream spend in USD; a subtotal when `inferenceUsdKnown` is false. */
  inferenceUsd: number;
  /** Intelligence-spawn spend in USD. Provably `0` at the OFF tier. */
  intelligenceUsd: number;
  /** False when inference cost is incomplete or unreported. */
  inferenceUsdKnown?: false;
  /** False when Intelligence cost is incomplete or unreported. */
  intelligenceUsdKnown?: false;
  /** Reported inference estimate, separate from observed spend and completeness. */
  estimatedInferenceUsd?: number;
}
/**
 * The typed record `withIntelligence` sends per call — serialized through the
 * shipped OTLP builders to the plane's `/v1/otlp` ingest. `input`/`output` are
 * redacted on export; the per-class `usage` split carries the billing proof;
 * `loopEvents`, when present, export as the nested loop→round→iteration span
 * tree under the same `traceId`.
 */
interface RunRecord {
  runId: string;
  traceId: string;
  project: string;
  target: string;
  input: unknown;
  output: unknown;
  outcome: {
    success?: boolean;
    score?: number;
    usage: UsageSplit;
  };
  model?: string;
  provider?: string;
  loopEvents?: LoopTraceEvent[];
  runtimeEvents?: RuntimeStreamEvent[];
  profile?: AgentProfile;
  sessionId?: string;
  harness?: string;
  repository?: string;
  commitSha?: string;
  timing?: {
    startedAt: number;
    completedAt: number;
    durationMs: number;
  };
  tokens?: {
    input: number;
    output: number;
    cachedInput?: number;
    reasoning?: number;
    /** False when the numeric token subtotals are incomplete. */
    tokensKnown?: false;
  };
  error?: {
    name: string;
    message: string;
    code?: string;
  };
  /** Exact proposal → review → execution → receipt linkage for candidate runs. */
  candidateExecution?: CandidateExecutionEvidence$1;
}
/**
 * What an agent reports (via `applied.record`) to enrich the {@link RunRecord}
 * sent for its call. All optional — an un-recorded run still sends input/output
 * with unknown usage, except for the OFF billing guarantee.
 * `costUsd` supplies inference spend when the split omits it.
 */
interface RunReport {
  success?: boolean;
  score?: number;
  usage?: Partial<UsageSplit>;
  costUsd?: number;
  model?: string;
  provider?: string;
  loopEvents?: LoopTraceEvent[];
  runtimeEvents?: RuntimeStreamEvent[];
  profile?: AgentProfile;
  sessionId?: string;
  harness?: string;
  commitSha?: string;
  tokens?: RunRecord['tokens'];
  error?: RunRecord['error'];
  candidateExecution?: CandidateExecutionEvidence$1;
}
/** Repo coordinates a product may declare for the (later) Gated-PR mode. The
 *  Observe slice only records their PRESENCE for `doctor()`; it never touches
 *  the repo. */
interface RepoConfig {
  owner: string;
  name: string;
  baseBranch: string;
}
/** Client configuration. `project` + `apiKey` are the Observe minimum; the
 *  rest tune effort, endpoint, redaction, and (for `doctor()` readiness)
 *  declare the surfaces/checks/repo a later PR mode would need. */
interface IntelligenceConfig {
  /** Stable project id — the tenant dimension every trace is tagged with. */
  project: string;
  /** Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted. */
  apiKey?: string;
  /** Effort tier (default `'standard'`) plus optional per-field overrides. */
  effort?: EffortTier | {
    tier: EffortTier;
    overrides?: EffortOverrides;
  };
  /**
   * The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
   * receive (`/v1/profiles/:target/composed`) paths derive from it. Reads
   * `TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
   * Send is best-effort and only ships when an `apiKey` is present (the tenant
   * key the ingest requires); absent a key, export is a no-op.
   */
  baseUrl?: string;
  /**
   * Redaction hook run over every exported input/output. A function replaces
   * the default scrubber; `false` opts out entirely (raw fidelity, caller has
   * sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.
   */
  redact?: Redactor | false;
  /** Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only. */
  surfaces?: string[];
  /** Verification checks a later PR mode would gate on. Recorded for `doctor()` only. */
  checks?: string[];
  /** Repo access a later PR mode would need. Recorded for `doctor()` only. */
  repo?: RepoConfig;
  /** Full canonical profile used for this agent. Exported redacted with a stable hash. */
  profile?: AgentProfile;
  /** Commit that produced the running agent, when known. */
  commitSha?: string;
  /** Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled. */
  runtimeTelemetry?: RuntimeTelemetryOptions;
  /**
   * Payloads are metadata-only by default: the run span carries a stable hash
   * and UTF-8 byte count, but not the redacted content. Set `full` only when
   * the configured OTLP destination is approved to receive complete redacted
   * inputs, outputs, and profiles.
   */
  payloadAttributes?: 'metadata' | 'full';
}
/** Metadata describing one traced run. `runId`/`traceId` default to fresh ids. */
interface TraceMeta {
  /** The run's input — exported through the redactor. */
  input?: unknown;
  /** Stable run id. Defaults to a fresh id. */
  runId?: string;
  /** 32-hex trace id. Defaults to a fresh id. */
  traceId?: string;
  /** Model id, when known — stamped on the span. */
  model?: string;
  /** Provider name, when known — stamped on the span. */
  provider?: string;
  /** Arbitrary extra labels (string/number/boolean) stamped on the span. */
  labels?: Record<string, string | number | boolean>;
}
/**
 * The trace handle a `traceRun` body records into. `recordOutput` captures the
 * agent's result (redacted on export); `recordOutcome` captures the scored
 * outcome + the `{ inferenceUsd, intelligenceUsd }` split. Both are optional —
 * an un-recorded run still exports a span with whatever was set.
 */
interface TraceHandle {
  /** Capture the run's output. Exported through the redactor. */
  recordOutput(output: unknown): void;
  /**
   * Capture the run's outcome. Unreported spend is unknown, except for Intelligence at OFF.
   * `costUsd` supplies inference spend when the split omits it.
   * Numeric usage updates replace subtotals; explicit incomplete flags remain sticky.
   */
  recordOutcome(outcome: {
    success?: boolean;
    score?: number;
    costUsd?: number;
    usage?: Partial<UsageSplit>;
  }): void;
}
/** Metadata for {@link IntelligenceClient.recordTrace}. */
interface RecordTraceMeta {
  /** 32-hex trace id to anchor every span to. Defaults to a fresh id. */
  traceId?: string;
  /** Span id of an enclosing span the loop root should parent under (e.g. a
   *  `traceRun` span). Omitted ⇒ the loop root is the trace root. */
  rootParentSpanId?: string;
}
/** The resolved outcome of one traced run, surfaced on the export span and
 *  available to the caller for downstream billing assertions. */
interface TraceOutcome {
  runId: string;
  traceId: string;
  project: string;
  /** The resolved effort settings this run executed under. */
  effort: EffortSettings;
  /** True when this run ran as pure passthrough (the OFF floor). */
  intelligenceOff: boolean;
  success?: boolean;
  score?: number;
  /** Per-class billing split. `intelligenceUsd` is `0` at the OFF tier. */
  usage: UsageSplit;
}
/** The Observe-mode Intelligence client. */
interface IntelligenceClient {
  /** The resolved project id. */
  readonly project: string;
  /** The resolved effort settings. */
  readonly effort: EffortSettings;
  /**
   * Run `fn` under a trace, export one span best-effort, and return whatever
   * `fn` returns. Telemetry-export failures are swallowed; an error THROWN by
   * `fn` propagates to the caller (the agent's own failures are not masked).
   */
  traceRun<T>(meta: TraceMeta, fn: (trace: TraceHandle) => Promise<T>): Promise<T>;
  /**
   * Export a run's full loop topology — the ordered `LoopTraceEvent` stream a
   * `runAgentRounds`/`Supervisor` run emits — as a nested OTLP span tree (loop → round →
   * iteration) into ONE trace. Reuses the shipped `buildLoopOtelSpans` builder
   * (NO second span builder), so the topology a viewer renders matches the
   * kernel's. `traceId` defaults to a fresh id; `rootParentSpanId` parents the
   * loop root under an enclosing span (e.g. a `traceRun` span) when given.
   * Best-effort: export failures are swallowed. Returns the resolved `traceId`.
   */
  recordTrace(events: ReadonlyArray<LoopTraceEvent>, meta?: RecordTraceMeta): string;
  /**
   * Send one typed {@link RunRecord} — the run's flat span (input/output/outcome/
   * usage/model/provider, redacted) plus, when `loopEvents` are present, the
   * nested loop topology under the same `traceId`. Reuses the shipped
   * `flatOtelSpan` + `buildLoopOtelSpans` builders (no second builder).
   * Best-effort: export failures are swallowed. Returns the record's `traceId`.
   */
  exportRunRecord(record: RunRecord): string;
  /** Mint a fresh run id (`run-<hex>`). */
  freshRunId(): string;
  /** Mint a fresh 32-hex trace id. */
  freshTraceId(): string;
  /**
   * Network-free readiness report: which adoption modes are reachable given
   * this config. Observe is always reachable; Recommend needs outcomes; PR
   * needs checks + surfaces + repo.
   */
  doctor(): DoctorReport;
  /** Flush any pending export spans. Best-effort; resolves even if export fails. */
  flush(): Promise<void>;
  /**
   * Delivery accounting for the spans this client sent: written, dropped, pending and the last
   * error. `undefined` when no exporter exists (no tenant key). `flush()` stays best-effort, so
   * this is where a caller checks that a run's telemetry actually reached Intelligence.
   */
  exportStats(): OtelExportStats | undefined;
}
/** One mode's readiness verdict. */
interface ModeReadiness {
  ready: boolean;
  /** Inputs this mode still needs, when not ready. Empty when ready. */
  missing: string[];
}
/** The `doctor()` readiness report — Mode-readiness without any network call. */
interface DoctorReport {
  project: string;
  effort: EffortSettings;
  /** True when an OTLP endpoint is configured (export will actually ship). */
  exportConfigured: boolean;
  modes: {
    observe: ModeReadiness;
    recommend: ModeReadiness;
    pr: ModeReadiness;
  };
}
/**
 * Create an Observe-mode Intelligence client. Resolves effort, the base URL, and
 * the redactor up front; the exporter is built lazily and is `undefined` when no
 * `apiKey` is present (send becomes a no-op — the ingest requires a tenant key,
 * and best-effort export must never spam an unauthenticated plane).
 */
declare function createIntelligenceClient(config: IntelligenceConfig): IntelligenceClient;
//#endregion
export { AGENT_IMPROVEMENT_PROFILE_SURFACES, AGENT_PROFILE_MEASURED_SURFACES, type AgentCandidateExecutionHostPorts, AgentCandidateExperimentCellExecutionError, type AgentCandidateExperimentCellPlacement, type AgentImprovementActivation, type AgentImprovementActivationIntent, type AgentImprovementActivationOutcome, type AgentImprovementActivationReconciliation, type AgentImprovementActivationResult, type AgentImprovementActivationResultStore, type AgentImprovementActivationTargetIdentity, type AgentImprovementActivationTargetPlan, type AgentImprovementActivationTransition, type AgentImprovementActivationTransitionInput, type AgentImprovementAnalysisOptions, type AgentImprovementEvaluation, type AgentImprovementExperimentMaterial, type AgentImprovementMeasuredComparison, type AgentImprovementProfileActivationInput, type AgentImprovementProfileActivationPreparation, type AgentImprovementProfileActivationTarget, type AgentImprovementProfileReplacement, type AgentImprovementProfileStateDigest, type AgentImprovementProfileStateDigestInput, type AgentImprovementProfileStateResolver, type AgentImprovementProfileStateResolverInput, type AgentImprovementProfileSurface, type AgentImprovementProfileTargetState, type AgentImprovementProfileTargetTransition, type AgentImprovementProposal, type AgentImprovementProposalSubmissionState, type AgentImprovementReview, type AgentImprovementReviewDecision, type AgentImprovementTargetProfileDiffOptions, type AgentProfileCandidateMeasurementExecutor, type AgentProfileImprovementActivationOperation, type AgentProfileImprovementActivationTargetPlan, type AgentProfileImprovementBenchmark, type AgentProfileImprovementExecutor, type AgentProfileImprovementMethodOptions, type AgentProfileMeasuredSurface, type AppliedIntelligence, type AuthoredAgentProfileCandidateLineage, type AuthoredAgentProfileDiffOptions, type CandidateExecutionEvidence, type CandidateProfileMaterialization, type CapabilityAuth, type CapabilityInterface, type CapabilityManifest, CapabilityNotAdmittedError, type CapabilitySurface, type CertProvenance, type CertifiedArtifact, type CertifiedCapability, type CertifiedCapabilitySummary, type CertifiedProfile, type CertifiedPromptSource, type CertifiedPromptSourceOptions, type CertifiedPromptSurface, type ContentRef, type CorpusAccess, type CreateAgentImprovementActivationOptions, type CreateAgentImprovementActivationResultOptions, type CreateAgentImprovementProposalOptions, type CreateExactProcessCandidateExperimentExecutorOptions, type CreateProtectedExactProcessCandidateExperimentExecutorOptions, type CredentialRef, type DeliveryBinding, type DeliveryBindingKind, type DiffProvenance, DoctorReport, type EffortOverrides, type EffortOverridesCompiled, type EffortSettings, type EffortTier, type ExactProcessCandidateExperimentExecution, type ExactProcessCandidateExperimentExecutor, type ExecuteAgentCandidateExperimentCellOptions, type ExecuteAgentImprovementActivationInput, type ExecuteAgentImprovementActivationOptions, type HostSpec, type IntelligenceAgent, IntelligenceClient, IntelligenceConfig, type IntelligenceHookConfig, type IntelligenceWrapped, type JsonSchema, ModeReadiness, type OptimizationActivationReceipt, type OptimizationReceiptCost, type ProfileImprovementActivationTransitionInput, type ProposeAgentImprovementOptions, type ProposeAgentImprovementResult, type ProposeAgentProfileImprovementOptions, type ProposeAgentProfileImprovementResult, type ProposeAuthoredAgentProfileImprovementOptions, type ProposeAuthoredAgentProfileImprovementResult, type ProposedProfileDiff, type ProtectedExactProcessCandidateExperimentExecutor, type PullCertifiedOptions, type PullOutcome, RecordTraceMeta, type Redactor, RepoConfig, type ResolvedHook, type ResolvedRetrieval, type ResolvedSubagent, type ResolvedSurface, type ReviewAgentImprovementInput, type RunAgentCandidateExperimentOptions, type RunAgentCandidateExperimentResult, RunRecord, RunReport, type SealedCandidateActivationTransitionInput, type SubmitAgentImprovementProposalOptions, type SubmitAgentImprovementProposalOutcome, TraceHandle, TraceMeta, TraceOutcome, UsageSplit, type VerifyCandidateExecutionEvidenceOptions, agentImprovementProfileDiffs, agentImprovementProfileSurfaceDigest, agentImprovementProfileSurfaceInput, agentImprovementTargetProfileDiffs, buildAgentImprovementActivationTargets, compileEffort, composeCertifiedPrompt, createAgentImprovementActivation, createAgentImprovementActivationResult, createAgentImprovementMeasuredComparison, createAgentImprovementProposal, createCertifiedPromptSource, createExactProcessCandidateExperimentExecutor, createIntelligenceClient, createOptimizationActivationReceipt, createProtectedExactProcessCandidateExperimentExecutor, defaultEffortTier, defaultRedactor, exactProcessCandidateExperimentExecutionSupport, executeAgentCandidateExperimentCell, executeAgentImprovementActivation, isAgentImprovementProfileSurface, isAgentProfileMeasuredSurface, isIntelligenceOff, manifestFromProfile, normalizeCertifiedProfile, optimizationActivationReceiptFromMetadata, parseAgentCandidateProfileActivation as parseCandidateProfileMaterialization, prepareAgentImprovementProfileActivation, proposeAgentImprovement, proposeAgentProfileImprovement, proposeAuthoredAgentProfileImprovement, pullCertified, resolveEffort, resolveIntelligenceBaseUrl, resolveRedactor, reviewAgentImprovementProposal, runAgentCandidateExperiment, submitAgentImprovementProposal, verifyAgentImprovementActivation, verifyAgentImprovementActivationResult, verifyAgentImprovementProposal, verifyAgentImprovementReview, verifyCandidateExecutionEvidence, withIntelligence };
//# sourceMappingURL=intelligence.d.ts.map