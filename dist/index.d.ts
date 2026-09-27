import { $a as RuntimeStreamEvent, $r as RetainedInteractiveBindingError, $t as RuntimeStreamEventCollector, Aa as RuntimeRunStatus, Ba as AgentTaskRunResult, Bt as OtelSpan, Da as RuntimeRunOptions, Ea as RuntimeRunHandle, Fa as AgentExecutionBackend, Ft as LoopSpanNode, Ga as OpenAIChatResponseFormat, Gr as AgentEvalError, Gt as createOpenInferenceFileExporter, Ha as AgentTaskStatus, Ht as buildLoopOtelSpans, Ia as AgentKnowledgeProvider, It as OtelAttribute, Ja as RunAgentTaskOptions, Jr as ConfigError, Jt as loopEventToOtelSpan, Ka as OpenAIChatTool, Kr as AgentEvalErrorCode, Kt as createOtelExporter, La as AgentRuntimeEvent, Lt as OtelExportConfig, Ma as AgentAdapter, Na as AgentBackendContext, Oa as RuntimeRunPersistenceAdapter, Pa as AgentBackendInput, Qa as RuntimeSessionStore, Qr as RetainedInteractiveAdmissionError, Qt as RuntimeEventCollector, Ra as AgentRuntimeEventSink, Rt as OtelExportStats, Ta as RuntimeRunCost, Ua as BackendErrorDetail, Ut as buildLoopSpanNodes, Va as AgentTaskSpec, Vt as RuntimeEventOtelOptions, Wa as KnowledgeReadinessDecision, Wt as buildRuntimeEventOtelSpans, Xa as RuntimeCanonicalStreamEvent, Xr as NotFoundError, Xt as padTraceId, Ya as RunAgentTaskStreamOptions, Yr as JudgeError, Yt as padSpanId, Za as RuntimeSession, Zr as PlannerError, Zt as toOtelAttributes, an as createRuntimeEventCollector, cn as sanitizeKnowledgeReadinessReport, ei as RetainedRunAdmissionError, en as RuntimeStreamEventSink, g as ExecutorFactory, i as Budget, in as SanitizedKnowledgeRequirement, ja as startRuntimeRun, ka as RuntimeRunRow, ln as sanitizeRuntimeStreamEvent, lt as SupervisedResult, ni as RuntimeRunStateError, nn as RuntimeTelemetryOptions, on as createRuntimeStreamEventCollector, qa as OpenAIChatToolChoice, qr as BackendTransportError, qt as generateSpanId, ri as ValidationError, rn as SanitizedKnowledgeReadinessReport, sn as sanitizeAgentRuntimeEvent, ti as RetainedRunDispatchBindingError, tn as RuntimeStreamEventSummary, wa as RuntimeRunCompleteInput, za as AgentTaskContext, zt as OtelExporter } from "./types-D56jQad-.js";
import { i as SurfaceImprovementEdit } from "./improvement-adapter-D5gwwoXQ.js";
import { o as ImprovementProposalSource } from "./types-zWfqDjeL.js";
import { Ch as TurnOrder, Dh as RetryableErrorPredicate, Eh as RetryBackoff, Pc as SuperviseOptions, Sh as RunConversationOptions, Th as CircuitBreakerConfig, _h as ConversationTurn, ah as d1ToSqlAdapter, bh as HaltReason, bl as SupervisorProfile, ch as FileConversationJournal, dh as Conversation, fh as ConversationDriveState, gh as ConversationStreamEvent, hh as ConversationResult, ih as SqlConversationJournal, lh as InMemoryConversationJournal, mh as ConversationPolicy, nh as D1StmtLike, nr as StructuralRolloutPolicy, oh as ConversationJournal, ph as ConversationParticipant, qm as DeliverableSpec, rh as SqlAdapter, sh as ConversationJournalEntry, th as D1DatabaseLike, uh as AuthSource, vh as HaltContext, wh as BackendCallPolicy, xh as HaltSignal, yh as HaltPredicate } from "./index-Dm8SHDGW.js";
import { a as RuntimeHookErrorContext, c as RuntimeHookTarget, d as defineRuntimeHooks, f as notifyRuntimeDecisionPoint, i as RuntimeHookContext, l as RuntimeHooks, n as RuntimeDecisionKind, o as RuntimeHookEvent, p as notifyRuntimeHookEvent, r as RuntimeDecisionPoint, s as RuntimeHookPhase, t as RuntimeDecisionEvidenceRef, u as composeRuntimeHooks } from "./runtime-hooks-Bj6wJHlH.js";
import { f as ExecutorConfig, gr as Redactor, mn as WorktreeCheckRunner } from "./stream-agent-turn-Bk79CnTw.js";
import { y as AgentCandidateOutputArtifactPort } from "./types-CuXu5zuS.js";
import { $ as ImproveSearchOptions, A as ImproveCodeBaseOptions, B as ImproveMethodOptions, C as ProfileTrainer, D as createCommandProfileTrainer, E as TrainingDatasetDocument, F as ImproveCustomCodeGeneratorOptions, G as ImproveProfileAgent, H as ImproveMethodSource, I as ImproveLineage, J as ImproveResult, K as ImproveProfileComponents, L as ImproveMethodContext, M as ImproveCodeResult, N as ImproveCodeRunOptions, O as ImproveCandidateValidationInput, P as ImproveCost, Q as ImproveSearchMethod, R as ImproveMethodFactory, S as ImproveTrainingResult, T as TrainingBoundaryResult, U as ImproveOptimizationRunOptions, V as ImproveMethodResult, W as ImproveOptions, X as ImproveScenarioPartitions, Y as ImproveRuntimeCodeGeneratorOptions, Z as ImproveSearchIdentity, _ as SearchMethodOptions, _t as defaultBuildPrompt, at as ImprovementProfileCandidate, b as ControlledTrainingCommand, ct as AgenticGeneratorExecutorForWorktree, dt as AgenticGeneratorShotExecution, et as ImproveSearchResult, ft as AgenticGeneratorShotReceipt, g as improve, gt as commandVerifier, ht as agenticGenerator, i as AgentImprovementActivationTransition, it as ImprovementCodeCandidate, j as ImproveCodeOptions, k as ImproveCandidateValidator, lt as AgenticGeneratorOptions, mt as VerifyResult, n as AgentImprovementActivationResultStore, nt as ImproveSurface, ot as DeepReadonly, pt as Verifier, q as ImproveProfileSurface, rt as ImprovementCandidate, st as ReadonlyAgentProfile, t as AgentImprovementActivationReconciliation, tt as ImproveSkillsOptions, ut as AgenticGeneratorShotDisposition, v as searchMethod, vt as CandidateGenerator, w as ProfileTrainerRequest, x as ImproveTrainingOptions, y as CheckpointServingPort, z as ImproveMethodLineage } from "./activation-B5NExoOz.js";
import { _ as researchLoopRunner, a as DELEGATED_LOOP_MODES, c as DelegatedLoopResult, d as ResearchLoopRunnerOptions, f as RunDelegatedLoopOptions, g as isDelegatedLoopMode, h as auditLoopRunner, i as runLoopRunnerCli, l as DelegatedLoopRunner, m as WorktreeLoopRunnerOptions, n as LoopRunnerCliResult, o as DelegatedLoopMode, p as VetoedFact, r as parseLoopRunnerArgv, s as DelegatedLoopRegistry, t as LoopRunnerCliArgs, u as ResearchLoopResult, v as runDelegatedLoop, y as worktreeLoopRunner } from "./loop-runner-bin-D6khQtoC.js";
import { n as mcpToolsForRuntimeMcpSubset, t as mcpToolsForRuntimeMcp } from "./openai-tools-H8QPhTVE.js";
import { AgentCandidateBundle, AgentCandidateCapturedArtifact, AgentCandidateKnowledge, AgentProfile, Sha256Digest } from "@tangle-network/agent-interface";
import { AgentProfile as AgentProfile$1, ControlBudget, ControlDecision, ControlEvalResult, ControlEvalResult as ControlEvalResult$1, ControlRunResult, ControlStep, DataAcquisitionPlan, KnowledgeReadinessReport, KnowledgeReadinessReport as KnowledgeReadinessReport$1, KnowledgeRequirement, MaximumCharge, ProposalFinding, RunRecord, RunRecord as RunRecord$1 } from "@tangle-network/agent-eval";
import { GepaOptimizationMethodConfig, ProfileDispatchFn, Scenario, SkillOptOptimizationMethodConfig } from "@tangle-network/agent-eval/campaign";
import { MutableSurface, Scenario as Scenario$1, SelfImproveOptions } from "@tangle-network/agent-eval/contract";
import { BuildEvalKnowledgeBundleOptions, KnowledgeBaseQualityOptions, KnowledgeImprovementOptions, KnowledgeImprovementResult, KnowledgeReadinessSpec, PromoteKnowledgeCandidateOptions, RagKnowledgeUpdateResult } from "@tangle-network/agent-knowledge";
//#region src/backends.d.ts
/** Wrap any custom async-iterable stream into a typed `AgentExecutionBackend`. @stable */
declare function createIterableBackend<TInput extends AgentBackendInput>(options: {
  kind: string;
  start?: AgentExecutionBackend<TInput>['start'];
  resume?: AgentExecutionBackend<TInput>['resume'];
  stream: AgentExecutionBackend<TInput>['stream'];
  stop?: AgentExecutionBackend<TInput>['stop'];
}): AgentExecutionBackend<TInput>;
/** Build an `AgentExecutionBackend` backed by a sandbox/sidecar `streamPrompt` call. @stable */
declare function createSandboxPromptBackend<TBox, TInput extends AgentBackendInput = AgentBackendInput>(options: {
  kind?: string;
  getBox(input: TInput, context: Omit<AgentBackendContext, 'session'>): Promise<TBox> | TBox;
  streamPrompt(box: TBox, message: string, context: AgentBackendContext): AsyncIterable<unknown>;
  mapEvent?: (event: unknown, context: AgentBackendContext) => RuntimeStreamEvent | undefined;
  getSessionId?: (box: TBox, input: TInput) => string | undefined;
}): AgentExecutionBackend<TInput>;
//#endregion
//#region src/runtime/profile-execution-backend.d.ts
/**
 * Bind one exact profile and Runtime executor to the stable `AgentExecutionBackend` contract used
 * by `runAgentTaskStream` and conversations.
 *
 * Runtime still owns the model call through `streamAgentTurn`.
 * The adapter only translates the two stream protocols and carries the caller's request headers
 * into `ExecutorContext` so an HTTP executor can preserve authorization, recursion depth, and
 * trace identity.
 *
 * @stable
 */
declare function createProfileExecutionBackend(options: {
  profile: AgentProfile;
  executor: ExecutorFactory<unknown>;
}): AgentExecutionBackend;
//#endregion
//#region src/conversation/conversation-backend.d.ts
/** Adapt a multi-participant conversation into the standard execution backend contract. */
declare function createConversationBackend(options: {
  conversation: Conversation;
  /** Optional backend kind label. Defaults to `'conversation'`. */
  kind?: string;
}): AgentExecutionBackend;
//#endregion
//#region src/conversation/define-conversation.d.ts
/** Validate and define a conversation before execution. */
declare function defineConversation(input: {
  participants: ConversationParticipant[];
  policy: ConversationPolicy;
}): Conversation;
//#endregion
//#region src/conversation/run-conversation.d.ts
/** Run a conversation to completion and return its terminal result. */
declare function runConversation(conversation: Conversation, options: RunConversationOptions): Promise<ConversationResult>;
/** Streaming conversation orchestrator: drives N participants in turn through their own backends, enforcing `maxTurns` / `maxCreditsCents` / `haltOn`, yielding per-event stream markers. */
declare function runConversationStream(conversation: Conversation, options: RunConversationOptions): AsyncIterable<ConversationStreamEvent>;
//#endregion
//#region src/conversation/run-persona.d.ts
/** A persona that drives the conversation: either a full driver `AgentProfile`
 *  (an LLM user-sim) or a deterministic script of user turns (the fast-path). */
type PersonaDriver = {
  kind: 'profile';
  profile: AgentProfile$1;
} | {
  kind: 'scripted';
  turns: string[];
};
interface RunPersonaConversationOptions {
  /** The agent under test. Metered; its rendered prompt leads its turns. */
  worker: AgentProfile$1;
  /** The simulated user driving the dialogue. */
  persona: PersonaDriver;
  /** Resolve transport/executable ports for the exact profile. Runtime still materializes the
   * profile and owns every model call. Applied to the worker and a profile-driven persona. */
  executorFor: (profile: AgentProfile$1, role: 'worker' | 'persona') => ExecutorFactory<unknown>;
  /** Speaker-turn cap. Default for a scripted persona = `2 * turns.length`
   *  (worker answers each user turn). REQUIRED for a `profile` persona. */
  maxTurns?: number;
  /** Kickoff message routed to the first speaker (the persona). Default 'Begin.' */
  seed?: string;
  /** Content-based "until satisfied" halt, called after every turn. `maxTurns` is the
   *  hard ceiling; this is the early stop (the persona declares the goal met / unreachable). */
  haltOn?: HaltPredicate;
  signal?: AbortSignal;
  /** Worker participant / transcript speaker label. Default 'agent'. */
  workerName?: string;
}
interface PersonaConversationResult {
  transcript: ConversationTurn[];
  turns: number;
  halted: HaltReason;
  /** Worker-only spend (the side under test). */
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  /** Absent means every worker call reported complete token usage. */
  tokensKnown?: false;
  /** Absent means every worker call reported provider-billed cost, including a known zero. */
  costUsdKnown?: false;
  /** Worker-only external estimate, kept separate from observed provider-billed spend. */
  estimatedCostUsd?: number;
}
/**
 * Run one worker profile against one persona as a multi-round conversation.
 * The persona leads (participant 0): it speaks, the worker answers, repeat,
 * until `maxTurns`. Returns the persistent transcript + worker-only usage.
 */
declare function runPersonaConversation(opts: RunPersonaConversationOptions): Promise<PersonaConversationResult>;
interface RunPersonaConfig<TScenario extends Scenario, TArtifact> {
  /** Resolve transport/executable ports for each exact profile. */
  executorFor: (profile: AgentProfile$1, role: 'worker' | 'persona') => ExecutorFactory<unknown>;
  /** The persona driving each scenario — a driver profile or scripted turns. */
  personaOf: (scenario: TScenario) => PersonaDriver;
  /** Build the scored artifact from the finished transcript. */
  artifactOf: (transcript: ConversationTurn[], scenario: TScenario) => TArtifact;
  /** Speaker-turn cap (required when a persona is profile-driven). */
  maxTurns?: (scenario: TScenario) => number;
  seed?: (scenario: TScenario) => string;
  workerName?: string;
  /** Provider- or executor-enforced maximum for the whole worker conversation.
   * Required before execution when the enclosing campaign is cost-capped. */
  maximumCharge?: MaximumCharge | ((worker: AgentProfile$1, scenario: TScenario) => MaximumCharge | undefined);
}
/**
 * Wrap {@link runPersonaConversation} as a `ProfileDispatchFn` for
 * `runProfileMatrix`: the profile axis is the worker-under-test, the scenario
 * axis is the persona, and the runner is the cell. Meters the worker through
 * `ctx.cost` so the matrix's backend-integrity guard sees real usage.
 */
declare function runPersonaDispatch<TScenario extends Scenario, TArtifact>(config: RunPersonaConfig<TScenario, TArtifact>): ProfileDispatchFn<TScenario, TArtifact>;
//#endregion
//#region src/improvement/build-prompts.d.ts
/** Evidence supplied to a generated tool or MCP build instruction. */
interface BuildPromptFindingsInput {
  findings: ReadonlyArray<ProposalFinding>;
}
/** Render findings as the ranked-evidence block every build prompt ends with. */
declare function findingLines(findings: ReadonlyArray<ProposalFinding>): string[];
/** Build the starting instruction for a coder agent tasked with implementing a new tool. */
declare function toolBuildPrompt(args: BuildPromptFindingsInput): string;
/** Build the starting instruction for a coder agent tasked with implementing a new MCP server. */
declare function mcpBuildPrompt(args: BuildPromptFindingsInput): string;
//#endregion
//#region src/improvement/mcp-serve-verifier.d.ts
interface McpServeSpec {
  /** Command that starts the built MCP server in the worktree (stdio transport). */
  command: string;
  args?: string[];
  /** Extra env for the server process (merged over `process.env`). */
  env?: Record<string, string>;
  /** Handshake timeout (ms). Default 30s. */
  timeoutMs?: number;
  /** Minimum tools the server must expose to pass. Default 1. */
  minTools?: number;
}
/** Build a `Verifier` that boots a generated MCP server over stdio and checks it exposes tools. */
declare function mcpServeVerifier(spec: McpServeSpec): Verifier;
//#endregion
//#region src/improvement/official-optimizers.d.ts
/** Runtime context appended to an official optimizer's own configuration. */
interface OfficialOptimizerContextOptions {
  /** Context supplied to the optimizer before Runtime appends the profile surface and findings. */
  background?: string;
  /** Include current trace or analyst findings in the optimizer background. Default true. */
  includeFindings?: boolean;
  /** Reject oversized serialized findings before starting Python. Default 50,000 characters. */
  maxFindingsChars?: number;
  /**
   * Redact caller-supplied context and descriptors before they leave Runtime.
   * The built-in redactor is the default. Pass `false` only for public data
   * that has already been reviewed.
   */
  redact?: Redactor | false;
  /** Authorize one exact candidate containing structurally sensitive fields.
   * The callback must return true for every accepted baseline and candidate. */
  authorizeSensitiveCandidate?: (input: OfficialSensitiveCandidateInput) => boolean;
}
interface OfficialSensitiveCandidateInput extends ImproveCandidateValidationInput {
  sensitivePaths: readonly string[];
}
/** Official GEPA configuration plus bounded Runtime findings context. */
type OfficialGepaOptions<TScenario extends {
  id: string;
  kind: string;
}, TArtifact = unknown> = Omit<GepaOptimizationMethodConfig<TScenario, TArtifact>, 'background' | 'evaluationId' | 'searchLedger'> & OfficialOptimizerContextOptions;
/** Official SkillOpt configuration plus bounded Runtime findings context. */
type OfficialSkillOptOptions<TScenario extends {
  id: string;
  kind: string;
}, TArtifact = unknown> = Omit<SkillOptOptimizationMethodConfig<TScenario, TArtifact>, 'background' | 'evaluationId' | 'searchLedger'> & OfficialOptimizerContextOptions;
/** Missing optional Python dependencies for an official optimizer. */
declare class OfficialOptimizerUnavailableError extends ConfigError {
  readonly optimizer: 'gepa' | 'skillopt';
  constructor(optimizer: 'gepa' | 'skillopt', cause: unknown);
}
/**
 * Build a complete method backed by GEPA's official Optimize Anything API.
 *
 * The recipe is passed through unchanged. Use `engine`, `sequential`,
 * `adaptive-sequential`, `best-of`, `vote`, or `omni` explicitly.
 */
declare function officialGepa<TScenario extends {
  id: string;
  kind: string;
}, TArtifact = unknown>(options: OfficialGepaOptions<TScenario, TArtifact>): ImproveMethodFactory<TScenario, TArtifact>;
/** Build a complete method backed by Microsoft's official SkillOpt trainer. */
declare function officialSkillOpt<TScenario extends {
  id: string;
  kind: string;
}, TArtifact = unknown>(options: OfficialSkillOptOptions<TScenario, TArtifact>): ImproveMethodFactory<TScenario, TArtifact>;
//#endregion
//#region src/improvement/optimizer-prompt.d.ts
/**
 * The senior scientific-method optimizer doctrine — the ONE substantial prompt
 * core shared by every builder/author surface (tool build, MCP build, codebase
 * improvement, and strategy authoring).
 *
 * Seeded from the proven senior prompts rather than invented: GEPA's
 * `REFLECTION_SYSTEM` (localize → diagnose → minimal generalizable fix →
 * preserve what works), the /evolve loop (one hypothesis with a mechanism and a
 * falsifiable prediction; attack the largest measured gap first), /pursue (one
 * coherent change set, no partial scaffolding), and the self-improving-loop /
 * supervisor doctrine (a keep is decided by a real check, never by the author;
 * observe → rate → decide). Generalized from "mutate a prompt string" to
 * "build a code surface a held-out measurement will grade".
 */
/**
 * The shared method block every build/author prompt embeds. Domain framing
 * (what a tool/MCP/codebase-edit deliverable looks like) wraps around it; this
 * is the process itself.
 */
declare const optimizerMethod: string;
/**
 * The senior authoring process for `authorStrategy` — the same method, shaped
 * to the strategy contract (author-blind, conserved budget, one module out).
 */
declare const strategyAuthorMethod: string;
//#endregion
//#region src/improvement/profile-improvement-harness.d.ts
type ProfileImprovementHarnessTrainOptions = Omit<ImproveTrainingOptions, 'mode'>;
interface CreateProfileImprovementHarnessOptions<TScenario extends Scenario$1, TArtifact> {
  /** Exact baseline profile. It is parsed, detached, and frozen at construction. */
  profile: ReadonlyAgentProfile;
  /**
   * Immutable identity of the bound executor, models, tools, component mapping,
   * and every closure or external setting that can change measured behavior.
   */
  executionRef: Sha256Digest;
  /** Execute one exact materialized profile on one scenario. */
  agent: ImproveProfileAgent<TScenario, TArtifact>;
  /** Optional validator shared by every run from this harness. */
  validateCandidate?: ImproveCandidateValidator;
}
type ProfileImprovementHarnessRunOptions<TScenario extends Scenario$1, TArtifact> = Omit<ImproveMethodOptions<TScenario, TArtifact>, 'executionRef' | 'agent' | 'validateCandidate'> & {
  /** Override the harness-level validator for this run. */
  validateCandidate?: ImproveCandidateValidator;
};
/**
 * A small, reusable front door over `improve(profile, options)`.
 *
 * The harness freezes the baseline and binds execution identity once, which
 * removes the two easiest sources of accidental experiment drift when a
 * developer runs several methods, surfaces, or held-out suites against the
 * same agent. It does not replace or narrow `improve`; callers retain every
 * method option and may still use the lower-level API directly.
 */
interface ProfileImprovementHarness<TScenario extends Scenario$1, TArtifact> {
  /** Detached immutable baseline actually used by every run. */
  readonly profile: ReadonlyAgentProfile;
  /** Canonical digest of the bound baseline profile. */
  readonly profileDigest: Sha256Digest;
  /** Exact execution identity bound at construction. */
  readonly executionRef: Sha256Digest;
  /** Train the bound profile with a separately pinned trainer and serving execution identity. */
  train(options: ProfileImprovementHarnessTrainOptions): Promise<ImproveTrainingResult>;
  run(options: ProfileImprovementHarnessRunOptions<TScenario, TArtifact>): Promise<ImproveMethodResult>;
}
/**
 * Bind one exact profile and executor into a repeatable self-improvement
 * harness. The returned `run` method remains generic over every existing
 * profile surface, optimization method, split, gate, and budget option.
 */
declare function createProfileImprovementHarness<TScenario extends Scenario$1, TArtifact>(options: CreateProfileImprovementHarnessOptions<TScenario, TArtifact>): ProfileImprovementHarness<TScenario, TArtifact>;
//#endregion
//#region src/improvement/prompt-instructions-profile-components.d.ts
/** Stable component-name prefix used for `profile.prompt.instructions`. */
declare const PROMPT_INSTRUCTION_COMPONENT_PREFIX = "prompt.instruction:";
/**
 * Canonical `ImproveProfileComponents` mapping for the ordered
 * `AgentProfile.prompt.instructions` list.
 *
 * Use it with `surface: 'agent-profile'` when an optimizer should rewrite the
 * exact instruction texts without being allowed to change their count, order,
 * labels, or any unrelated profile field:
 *
 * ```ts
 * await improve(profile, {
 *   surface: 'agent-profile',
 *   profileComponents: promptInstructionsProfileComponents,
 *   // method, scenarios, judge, executionRef, agent, ...
 * })
 * ```
 *
 * Component names are zero-padded and stable. Runtime's existing component
 * materializer requires every candidate to preserve the exact key set and
 * verifies that `apply(read(profile))` reproduces the baseline profile. A
 * profile with no prompt instructions is refused rather than inventing a
 * sentinel instruction that could accidentally ship.
 */
declare const promptInstructionsProfileComponents: ImproveProfileComponents;
//#endregion
//#region src/improvement/raw-trace-distiller.d.ts
interface RawTraceDistillerOptions {
  /** Anchor the emitted paths at this run root instead of the generation `runDir`
   *  the loop passes in. Normally unset — each call points at that generation's
   *  own directory (`input.runDir`). Pass an absolute path when you construct the
   *  producer ahead of the loop and want a fixed anchor (e.g. a test fixture). */
  runDir?: string;
  /** Max candidates to surface trace paths for, worst-scoring first. Default 12. */
  maxCandidates?: number;
  /** Max failing cells to enumerate per candidate before collapsing the rest into
   *  an "ls the candidate dir" pointer. Default 8. */
  maxCellsPerCandidate?: number;
  /** Max concrete file paths to list per cell (the agent can always `ls` the dir
   *  for the rest). Default 24. */
  maxFilesPerCell?: number;
  /** Findings to fall back to when the generation had NO failing cells, so a
   *  clean round never wipes the proposer's steering context. Mirrors the default
   *  distiller's static-seed fallback. Default: a single instruction finding. */
  fallbackFindings?: ReadonlyArray<ProposalFinding>;
}
/**
 * Build an `analyzeGeneration` producer that feeds the proposer RAW-TRACE
 * FILESYSTEM CONTEXT — paths into the prior generation's real run traces plus a
 * grep/cat-to-diagnose instruction — instead of a pre-summarized digest.
 *
 * Drop-in for `analyzeGeneration` on `improve({ surface: 'code' })`:
 *
 *   await improve({
 *     surface: 'code',
 *     findings: seedFindings,
 *     code: { repoRoot, profile, executorForWorktree, buildPrompt },
 *     runDir: '/abs/run',                 // MUST be a real path — the traces live here
 *     analyzeGeneration: rawTraceDistiller(),
 *     scenarios, judge, agent,
 *   })
 */
declare function rawTraceDistiller<TScenario extends Scenario$1 = Scenario$1, TArtifact = unknown>(options?: RawTraceDistillerOptions): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']>;
//#endregion
//#region src/improvement/reflective-generator.d.ts
interface ReflectiveGeneratorOptions {
  /** Bind proposal reads and paid calls to this candidate's worktree and account. */
  createImprovementProposalSource(context: Parameters<CandidateGenerator['generate']>[0]): ImprovementProposalSource<SurfaceImprovementEdit>;
}
/** Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate. */
declare function reflectiveGenerator(opts: ReflectiveGeneratorOptions): CandidateGenerator;
//#endregion
//#region src/improvement/rollout-policy.d.ts
/** The profile extensions namespace the policy persists under. */
declare const ROLLOUT_POLICY_EXTENSION = "structural-rollout";
/** Parse a serialized policy surface. Returns `undefined` for non-strings,
 * malformed JSON, or values outside the policy invariants. Unknown fields are
 * dropped; supported optional fields are preserved. */
declare function parseRolloutPolicy(surface: MutableSurface): StructuralRolloutPolicy | undefined;
/** Normalize an untyped policy bag (a parsed surface or a profile extension) into
 *  a full `StructuralRolloutPolicy`, defaults merged. Returns `undefined` when any
 *  present dial violates the policy invariants (mirrors `resolvePolicy`: integer
 *  k ≥ 1, repairRounds ≥ 0, testgen ≥ 0) — a corrupt config must read as "not
 *  configured", never as a fabricated recipe. */
declare function normalizeRolloutPolicy(raw: unknown): StructuralRolloutPolicy | undefined;
/** Stable serialization with fixed field order. */
declare function serializeRolloutPolicy(policy: StructuralRolloutPolicy): string;
/** Read the persisted policy off the profile. `undefined` when the profile does
 *  not opt into structural rollout. */
declare function structuralRolloutPolicyFromProfile(profile: ReadonlyAgentProfile): StructuralRolloutPolicy | undefined;
/** Persist a detached policy under the profile extension without mutating the input. */
declare function applyRolloutPolicyToProfile(profile: ReadonlyAgentProfile, policy: StructuralRolloutPolicy): AgentProfile;
//#endregion
//#region src/knowledge/activation.d.ts
interface CreateKnowledgeImprovementActivationExecutorOptions extends Omit<PromoteKnowledgeCandidateOptions, 'root' | 'candidate'> {
  root: string;
  identity: string;
  results: AgentImprovementActivationResultStore;
}
interface KnowledgeImprovementActivationExecutor {
  transition: AgentImprovementActivationTransition;
  reconcile: AgentImprovementActivationReconciliation;
}
/** Apply or restore one local knowledge candidate through the shared activation contract. */
declare function createKnowledgeImprovementActivationExecutor(options: CreateKnowledgeImprovementActivationExecutorOptions): KnowledgeImprovementActivationExecutor;
//#endregion
//#region src/knowledge/supervised-update.d.ts
/** Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers. */
declare const RESEARCH_SUPERVISOR_SYSTEM_PROMPT: string;
interface KnowledgeReadinessCheckInput {
  root: string;
  goal: string;
  readinessSpecs?: readonly unknown[];
  readinessTaskId?: string;
  readiness?: unknown;
}
type KnowledgeReadinessCheckResult = boolean | {
  ready: boolean;
  summary?: string;
  metadata?: Record<string, unknown>;
};
type KnowledgeReadinessCheck = (input: KnowledgeReadinessCheckInput) => Promise<KnowledgeReadinessCheckResult> | KnowledgeReadinessCheckResult;
interface SupervisedKnowledgeUpdateInput {
  goal?: string;
  root?: string;
  candidateRoot?: string;
  findings?: readonly unknown[];
  metadata?: Record<string, unknown>;
}
interface SupervisedKnowledgeUpdateResult {
  applied: boolean;
  summary: string;
  supervised: SupervisedResult<unknown>;
  metadata: NonNullable<RagKnowledgeUpdateResult['metadata']>;
}
interface SupervisedKnowledgeUpdateOptions {
  root: string;
  goal: string;
  readiness: KnowledgeReadinessCheck;
  readinessSpecs?: readonly unknown[];
  readinessTaskId?: string;
  readinessOptions?: unknown;
  findings?: readonly unknown[];
  metadata?: Record<string, unknown>;
  budget: Budget;
  backend?: ExecutorConfig;
  makeWorkerAgent?: SuperviseOptions['makeWorkerAgent'];
  /** Caller-owned exact supervisor harness/provider/model identity. */
  supervisorProfile: SupervisorProfile;
  superviseOptions?: Partial<Omit<SuperviseOptions, 'budget' | 'backend' | 'deliverable' | 'makeWorkerAgent' | 'allowedModels'>>;
  allowedModels?: readonly string[];
  runSupervised?: (profile: SupervisorProfile, task: unknown, opts: SuperviseOptions) => Promise<SupervisedResult<unknown>>;
}
type SupervisedKnowledgeUpdater = (input: SupervisedKnowledgeUpdateInput) => Promise<SupervisedKnowledgeUpdateResult>;
/** Build the completion check a supervised KB update uses to stop only when the KB is ready. */
declare function knowledgeReadinessDeliverable(options: Pick<SupervisedKnowledgeUpdateOptions, 'root' | 'goal' | 'readiness' | 'readinessSpecs' | 'readinessTaskId' | 'readinessOptions'>): DeliverableSpec<unknown>;
/** Create an `improveKnowledgeBase` update callback backed by runtime supervision. */
declare function createSupervisedKnowledgeUpdater(options: SupervisedKnowledgeUpdateOptions): SupervisedKnowledgeUpdater;
/** Run a runtime supervisor that updates one candidate knowledge base and stops on readiness. */
declare function runSupervisedKnowledgeUpdate(options: SupervisedKnowledgeUpdateOptions): Promise<SupervisedKnowledgeUpdateResult>;
/** Format the supervisor task with the KB root, readiness requirements, current findings, and metadata. */
declare function formatSupervisedKnowledgeTask(options: Pick<SupervisedKnowledgeUpdateOptions, 'root' | 'goal' | 'readinessSpecs' | 'readinessTaskId' | 'findings' | 'metadata'>): string;
//#endregion
//#region src/knowledge/improvement-job.d.ts
interface RunKnowledgeImprovementJobOptions extends Omit<KnowledgeImprovementOptions, 'updateKnowledge'> {
  budget: Budget;
  readinessCheck?: KnowledgeReadinessCheck;
  backend?: ExecutorConfig;
  makeWorkerAgent?: SuperviseOptions['makeWorkerAgent'];
  supervisorProfile: SupervisorProfile;
  superviseOptions?: Partial<Omit<SuperviseOptions, 'budget' | 'backend' | 'deliverable' | 'makeWorkerAgent' | 'allowedModels'>>;
  allowedModels?: readonly string[];
  runSupervised?: (profile: SupervisorProfile, task: unknown, opts: SuperviseOptions) => Promise<SupervisedResult<unknown>>;
  candidateArtifacts?: AgentCandidateOutputArtifactPort;
  onMeasurement?: (measurement: KnowledgeImprovementJobMeasurement) => Promise<void> | void;
}
interface KnowledgeImprovementJobMeasurement {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  updateCalls: number;
  updateDurationMs: number;
  supervisedSpent: {
    iterations: number;
    inputTokens: number;
    outputTokens: number;
    usdKnown: boolean;
    usd: number;
    ms: number;
  };
}
interface KnowledgeImprovementJobResult {
  improvement: KnowledgeImprovementResult;
  knowledge?: KnowledgeImprovementCandidatePair;
  measurement: KnowledgeImprovementJobMeasurement;
  blocked: boolean;
}
interface KnowledgeImprovementCandidatePair {
  reference: AgentCandidateKnowledge['candidate'];
  stateScope?: AgentCandidateKnowledge['stateScope'];
  evaluation: AgentCandidateCapturedArtifact;
  baseline: AgentCandidateKnowledge['snapshot'];
  candidate: AgentCandidateKnowledge['snapshot'];
}
interface KnowledgeImprovementExperimentBundles {
  baseline: AgentCandidateBundle;
  candidate: AgentCandidateBundle;
}
interface AgentKnowledgeReadinessCheckOptions {
  goal: string;
  readinessSpecs?: readonly KnowledgeReadinessSpec[];
  readinessTaskId?: string;
  readiness?: Omit<BuildEvalKnowledgeBundleOptions, 'taskId' | 'index' | 'specs'>;
  strict?: boolean;
  kbQuality?: KnowledgeBaseQualityOptions;
}
/** Build the default readiness check backed by `@tangle-network/agent-knowledge` validation and scoring. */
declare function createAgentKnowledgeReadinessCheck(options: AgentKnowledgeReadinessCheckOptions): KnowledgeReadinessCheck;
/** Produce a frozen KB candidate while leaving live knowledge content unchanged. */
declare function runKnowledgeImprovementJob(options: RunKnowledgeImprovementJobOptions): Promise<KnowledgeImprovementJobResult>;
/** Attach both frozen knowledge inputs to one otherwise-identical bundle pair. */
declare function buildKnowledgeImprovementExperimentBundles(bundle: AgentCandidateBundle, knowledge: KnowledgeImprovementCandidatePair): KnowledgeImprovementExperimentBundles;
//#endregion
//#region src/model-resolution.d.ts
/**
 *
 * Chat-model resolution + catalog validation — the shared primitive every
 * product chat handler needs and was, until now, hand-rolling. Lifts the
 * router `/v1/models` fetch, the fail-closed id validation, and the
 * precedence resolver out of four near-identical per-repo copies.
 *
 * Policy-free by design: callers pass their own precedence order
 * (`resolveChatModel`) and their own known-good `allowlist`
 * (`validateChatModelId`), so each product keeps its resolution policy while
 * sharing the catalog fetch, the malformed-id guard, and the fail-closed
 * admission rule. No React, no `process.env` assumption — `env` is an
 * explicit narrow record so this runs unchanged in Node and in Workers.
 *
 * @stable
 */
/**
 * A model entry as returned by the Tangle Router `/v1/models` endpoint.
 * Intentionally minimal — only the fields resolution + validation read.
 */
interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  /** Provider slug, when the router exposes it (`provider` or `_provider`). */
  provider?: string;
  _provider?: string;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
}
/** Env keys the router base URL is resolved from. */
interface RouterEnv {
  TANGLE_ROUTER_URL?: string;
  TANGLE_ROUTER_BASE_URL?: string;
}
/** Default Tangle Router base URL used when no env override is set. */
declare const DEFAULT_ROUTER_BASE_URL = "https://router.tangle.tools";
/** Resolve the router base URL from env, normalised — no trailing `/v1` or `/`. */
declare function resolveRouterBaseUrl(env?: RouterEnv): string;
/**
 * Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx
 * response — callers decide whether to fail open (empty catalog) or closed.
 */
declare function getModels(routerBaseUrl?: string): Promise<ModelInfo[]>;
/** Trim a candidate model id; `undefined` for non-strings and blanks. */
declare function cleanModelId(value: unknown): string | undefined;
interface ChatModelCandidate {
  /** Stable label for telemetry — e.g. `request`, `workspace`, `env`. */
  source: string;
  model: string | undefined;
}
interface ResolvedChatModel {
  source: string;
  model: string;
}
/**
 * Resolve a chat model by precedence: the first candidate carrying a
 * non-blank model wins, else `fallback`. The caller owns the precedence
 * order, so each product keeps its own policy (request → workspace → env,
 * etc.) while the first-non-blank logic and the telemetry shape stay shared.
 */
declare function resolveChatModel(candidates: ChatModelCandidate[], fallback: ResolvedChatModel): ResolvedChatModel;
type ChatModelValidation = {
  succeeded: true;
  value: string;
} | {
  succeeded: false;
  error: string;
};
/**
 * Validate a caller-supplied chat-model id. Rejects non-strings, malformed
 * ids, and ids absent from both the caller's `allowlist` and the live router
 * catalog. Fails closed: when the catalog cannot be fetched, an unverifiable
 * id is rejected rather than admitted — a bad model never reaches the agent.
 */
declare function validateChatModelId(modelId: unknown, options?: {
  /**
   * Known-good ids that skip the catalog round trip — e.g. the product's
   * default model plus any env-configured ids.
   */
  allowlist?: string[];
  routerBaseUrl?: string;
  /** Injectable catalog loader — overridden in tests. */
  loadModels?: (routerBaseUrl: string) => Promise<ModelInfo[]>;
}): Promise<ChatModelValidation>;
//#endregion
//#region src/readiness.d.ts
/**
 * Map a `KnowledgeReadinessReport` to a three-state branch (`ready` / `blocked` / `caveat`) the runtime, route handlers, and UI shells all switch on.
 *
 * @stable
 */
declare function decideKnowledgeReadiness(report: KnowledgeReadinessReport$1, options?: {
  minimumScore?: number;
}): KnowledgeReadinessDecision;
//#endregion
//#region src/run.d.ts
/** Stamp cross-cutting defaults onto adapter-projected RunRecords without
 *  overriding anything the adapter set explicitly:
 *   - `scenarioId` — the run's scenario, when the record omits one.
 *   - `failureClass` — the control layer's failure classification promoted
 *     onto the canonical cross-agent key, but ONLY when it's a real taxonomy
 *     class. This is what lets the substrate aggregate failures across every
 *     agent in one vocabulary instead of per-agent ad-hoc strings. */
declare function applyRunRecordDefaults(records: RunRecord$1[], scenarioId: string, controlFailureClass: string | undefined): RunRecord$1[];
/**
 * Single-shot task lifecycle for adapter-driven tasks: readiness-gated, emits the runtime lifecycle event vocabulary, session-store pluggable.
 *
 * @stable
 */
declare function runAgentTask<TState, TAction, TActionResult, TEval extends ControlEvalResult$1 = ControlEvalResult$1>(options: RunAgentTaskOptions<TState, TAction, TActionResult, TEval>): Promise<AgentTaskRunResult<TState, TAction, TActionResult, TEval>>;
/**
 * Streaming task lifecycle: delegates execution to an `AgentExecutionBackend` (model API, sandbox, or custom iterable) and yields lifecycle events as they happen.
 *
 * @stable
 */
declare function runAgentTaskStream<TInput extends AgentBackendInput = AgentBackendInput>(options: RunAgentTaskStreamOptions<TInput>): AsyncIterable<RuntimeStreamEvent>;
//#endregion
//#region src/sessions.d.ts
/** In-memory `RuntimeSessionStore` for single-process use and tests. @stable */
declare class InMemoryRuntimeSessionStore implements RuntimeSessionStore {
  private readonly sessions;
  private readonly events;
  get(sessionId: string): RuntimeSession | undefined;
  put(session: RuntimeSession): void;
  appendEvent(sessionId: string, event: RuntimeStreamEvent): void;
  listEvents(sessionId: string): RuntimeStreamEvent[];
}
//#endregion
//#region src/sse.d.ts
/** @stable */
interface ServerSentEventOptions {
  event?: string;
  id?: string;
  retry?: number;
}
/** Serialize a `KnowledgeReadinessReport` as a Server-Sent Event string. @stable */
declare function readinessServerSentEvent(report: KnowledgeReadinessReport$1, options?: RuntimeTelemetryOptions & ServerSentEventOptions): string;
/** Serialize a `RuntimeStreamEvent` as a Server-Sent Event string. @stable */
declare function runtimeStreamServerSentEvent(event: RuntimeStreamEvent, options?: RuntimeTelemetryOptions & ServerSentEventOptions): string;
//#endregion
export { type AgentAdapter, type AgentBackendContext, type AgentBackendInput, AgentEvalError, type AgentEvalErrorCode, type AgentExecutionBackend, type AgentKnowledgeProvider, type AgentKnowledgeReadinessCheckOptions, type AgentRuntimeEvent, type AgentRuntimeEventSink, type AgentTaskContext, type AgentTaskRunResult, type AgentTaskSpec, type AgentTaskStatus, type AgenticGeneratorExecutorForWorktree, type AgenticGeneratorOptions, type AgenticGeneratorShotDisposition, type AgenticGeneratorShotExecution, type AgenticGeneratorShotReceipt, type AuthSource, type BackendCallPolicy, type BackendErrorDetail, BackendTransportError, type BuildPromptFindingsInput, type CandidateGenerator, type ChatModelCandidate, type ChatModelValidation, type CheckpointServingPort, type CircuitBreakerConfig, ConfigError, type ControlBudget, type ControlDecision, type ControlEvalResult, type ControlRunResult, type ControlStep, type ControlledTrainingCommand, type Conversation, type ConversationDriveState, type ConversationJournal, type ConversationJournalEntry, type ConversationParticipant, type ConversationPolicy, type ConversationResult, type ConversationStreamEvent, type ConversationTurn, type CreateKnowledgeImprovementActivationExecutorOptions, type CreateProfileImprovementHarnessOptions, type D1DatabaseLike, type D1StmtLike, DEFAULT_ROUTER_BASE_URL, DELEGATED_LOOP_MODES, type DataAcquisitionPlan, type DeepReadonly, type DelegatedLoopMode, type DelegatedLoopRegistry, type DelegatedLoopResult, type DelegatedLoopRunner, FileConversationJournal, type HaltContext, type HaltPredicate, type HaltReason, type HaltSignal, type ImproveCandidateValidationInput, type ImproveCandidateValidator, type ImproveCodeBaseOptions, type ImproveCodeOptions, type ImproveCodeResult, type ImproveCodeRunOptions, type ImproveCost, type ImproveCustomCodeGeneratorOptions, type ImproveLineage, type ImproveMethodContext, type ImproveMethodFactory, type ImproveMethodLineage, type ImproveMethodOptions, type ImproveMethodResult, type ImproveMethodSource, type ImproveOptimizationRunOptions, type ImproveOptions, type ImproveProfileAgent, type ImproveProfileComponents, type ImproveProfileSurface, type ImproveResult, type ImproveRuntimeCodeGeneratorOptions, type ImproveScenarioPartitions, type ImproveSearchIdentity, type ImproveSearchMethod, type ImproveSearchOptions, type ImproveSearchResult, type ImproveSkillsOptions, type ImproveSurface, type ImproveTrainingOptions, type ImproveTrainingResult, type ImprovementCandidate, type ImprovementCodeCandidate, type ImprovementProfileCandidate, InMemoryConversationJournal, InMemoryRuntimeSessionStore, JudgeError, type KnowledgeImprovementActivationExecutor, type KnowledgeImprovementCandidatePair, type KnowledgeImprovementExperimentBundles, type KnowledgeImprovementJobMeasurement, type KnowledgeImprovementJobResult, type KnowledgeReadinessCheck, type KnowledgeReadinessCheckInput, type KnowledgeReadinessCheckResult, type KnowledgeReadinessDecision, type KnowledgeReadinessReport, type KnowledgeRequirement, type LoopRunnerCliArgs, type LoopRunnerCliResult, type LoopSpanNode, type McpServeSpec, type ModelInfo, NotFoundError, type OfficialGepaOptions, type OfficialOptimizerContextOptions, OfficialOptimizerUnavailableError, type OfficialSensitiveCandidateInput, type OfficialSkillOptOptions, type OpenAIChatResponseFormat, type OpenAIChatTool, type OpenAIChatToolChoice, type OtelAttribute, type OtelExportConfig, type OtelExportStats, type OtelExporter, type OtelSpan, PROMPT_INSTRUCTION_COMPONENT_PREFIX, type PersonaConversationResult, type PersonaDriver, PlannerError, type ProfileImprovementHarness, type ProfileImprovementHarnessRunOptions, type ProfileImprovementHarnessTrainOptions, type ProfileTrainer, type ProfileTrainerRequest, RESEARCH_SUPERVISOR_SYSTEM_PROMPT, ROLLOUT_POLICY_EXTENSION, type RawTraceDistillerOptions, type ReadonlyAgentProfile, type ReflectiveGeneratorOptions, type ResearchLoopResult, type ResearchLoopRunnerOptions, type ResolvedChatModel, RetainedInteractiveAdmissionError, RetainedInteractiveBindingError, RetainedRunAdmissionError, RetainedRunDispatchBindingError, type RetryBackoff, type RetryableErrorPredicate, type RouterEnv, type RunAgentTaskOptions, type RunAgentTaskStreamOptions, type RunConversationOptions, type RunDelegatedLoopOptions, type RunKnowledgeImprovementJobOptions, type RunPersonaConfig, type RunPersonaConversationOptions, type RunRecord, type RuntimeCanonicalStreamEvent, type RuntimeDecisionEvidenceRef, type RuntimeDecisionKind, type RuntimeDecisionPoint, type RuntimeEventCollector, type RuntimeEventOtelOptions, type RuntimeHookContext, type RuntimeHookErrorContext, type RuntimeHookEvent, type RuntimeHookPhase, type RuntimeHookTarget, type RuntimeHooks, type RuntimeRunCompleteInput, type RuntimeRunCost, type RuntimeRunHandle, type RuntimeRunOptions, type RuntimeRunPersistenceAdapter, type RuntimeRunRow, RuntimeRunStateError, type RuntimeRunStatus, type RuntimeSession, type RuntimeSessionStore, type RuntimeStreamEvent, type RuntimeStreamEventCollector, type RuntimeStreamEventSink, type RuntimeStreamEventSummary, type RuntimeTelemetryOptions, type SanitizedKnowledgeReadinessReport, type SanitizedKnowledgeRequirement, type SearchMethodOptions, type ServerSentEventOptions, type SqlAdapter, SqlConversationJournal, type SupervisedKnowledgeUpdateInput, type SupervisedKnowledgeUpdateOptions, type SupervisedKnowledgeUpdateResult, type SupervisedKnowledgeUpdater, type TrainingBoundaryResult, type TrainingDatasetDocument, type TurnOrder, ValidationError, type Verifier, type VerifyResult, type VetoedFact, type WorktreeCheckRunner, type WorktreeLoopRunnerOptions, agenticGenerator, applyRolloutPolicyToProfile, applyRunRecordDefaults, auditLoopRunner, buildKnowledgeImprovementExperimentBundles, buildLoopOtelSpans, buildLoopSpanNodes, buildRuntimeEventOtelSpans, cleanModelId, commandVerifier, composeRuntimeHooks, createAgentKnowledgeReadinessCheck, createCommandProfileTrainer, createConversationBackend, createIterableBackend, createKnowledgeImprovementActivationExecutor, createOpenInferenceFileExporter, createOtelExporter, createProfileExecutionBackend, createProfileImprovementHarness, createRuntimeEventCollector, createRuntimeStreamEventCollector, createSandboxPromptBackend, createSupervisedKnowledgeUpdater, d1ToSqlAdapter, decideKnowledgeReadiness, defaultBuildPrompt, defineConversation, defineRuntimeHooks, findingLines, formatSupervisedKnowledgeTask, generateSpanId, getModels, improve, isDelegatedLoopMode, knowledgeReadinessDeliverable, loopEventToOtelSpan, mcpBuildPrompt, mcpServeVerifier, mcpToolsForRuntimeMcp, mcpToolsForRuntimeMcpSubset, normalizeRolloutPolicy, notifyRuntimeDecisionPoint, notifyRuntimeHookEvent, officialGepa, officialSkillOpt, optimizerMethod, padSpanId, padTraceId, parseLoopRunnerArgv, parseRolloutPolicy, promptInstructionsProfileComponents, rawTraceDistiller, readinessServerSentEvent, reflectiveGenerator, researchLoopRunner, resolveChatModel, resolveRouterBaseUrl, runAgentTask, runAgentTaskStream, runConversation, runConversationStream, runDelegatedLoop, runKnowledgeImprovementJob, runLoopRunnerCli, runPersonaConversation, runPersonaDispatch, runSupervisedKnowledgeUpdate, runtimeStreamServerSentEvent, sanitizeAgentRuntimeEvent, sanitizeKnowledgeReadinessReport, sanitizeRuntimeStreamEvent, searchMethod, serializeRolloutPolicy, startRuntimeRun, strategyAuthorMethod, structuralRolloutPolicyFromProfile, toOtelAttributes, toolBuildPrompt, validateChatModelId, worktreeLoopRunner };
//# sourceMappingURL=index.d.ts.map