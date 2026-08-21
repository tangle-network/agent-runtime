/**
 *
 * Driven-loop substrate. `runAgentRounds` orchestrates around the sandbox SDK; it
 * does not invent its own notion of "what an agent is". Each iteration is
 * a `sandboxClient.create({ backend: { profile } })` + `box.streamPrompt`
 * call. The driver owns topology; the validator owns scoring; the output
 * adapter owns event-stream decode; the kernel owns iteration accounting,
 * concurrency, abort, cost aggregation, and trace emission.
 *
 * @module
 */

// The analyst-finding factory + id helper from the substrate, re-surfaced here so a host that builds
// findings on the coordination bus (the profile-richness gate, an online detector) does not need a
// separate agent-eval import. The taxonomy + firewall provenance live in agent-eval.
export { type AnalystFinding, computeFindingId, makeFinding } from '@tangle-network/agent-eval'
// One-stop import: portable profile plus Sandbox execution types Runtime consumers need.
export type { AgentProfile } from '@tangle-network/agent-interface'
export type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
// Two substrates for the same "recursive agent decision" atom, both exported here (per
// docs/architecture.md): canonical = the reactive `Scope`/`Supervisor` + the personify
// combinators (budget-conserving, equal-k by construction — prefer for new recursive work);
// the round-synchronous `runAgentRounds` kernel = the path most benches still drive, with a
// caller-supplied `Driver` (fixed-shape or scripted) authoring the per-round topology.
// Recursive execution atom (the keystone): the open `Executor` runtime, the
// budget-conserving reactive `Scope`, the event-sourced `Supervisor`, and the spawn
// journal. Substrate types come from `./supervise/types`; the journal + blob store
// impls live in `../durable/spawn-journal`.
//
// Both pairs are exported: the in-memory stores (tests / scratch / a run that need not
// outlive its process) AND the file-backed stores that make a run RESUMABLE. Without the
// durable pair on the public surface a consumer cannot resume at all — and the one that
// tried wrote its own half-working copy, whose `loadTree` never read the file back. The
// replay readers ship with them, because a durable journal you cannot fold back into a
// tree is only a log.
export {
  contentAddress,
  FileResultBlobStore,
  FileSpawnJournal,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  loadSpawnForest,
  materializeTreeView,
  // The waits a journaled tree shows as armed but never woken — what a resumed run re-arms with
  // the ORIGINAL deadline. Exported for the same reason the replay readers are: a durable wait a
  // consumer cannot read back is only a log line.
  pendingWaits,
  replaySpawnTree,
  type SpawnForest,
  type SpawnForestEvent,
  type SpawnForestInDoubtNode,
  type SpawnForestMissingTree,
  type SpawnForestNode,
  type SpawnForestTree,
} from '../durable/spawn-journal'
// The typed coordination-bus event (up: settled/question/finding; authorized instruction receipt;
// down: steer/answer delivery outcome) — surfaced here so a host folding the bus onto its own timeline can
// type its `onEvent` subscriber without reaching into the `/mcp` subpath. `MakeWorkerAgent` rides
// alongside it: the worker-seam type `supervise`/`workerFromBackend` traffic in, so a host authoring
// its own seam types it from the loop layer rather than the `/mcp` subpath.
export type {
  AnalystFindingEvent,
  AnalystLensOutput,
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  AuthorizeDownMessage,
  AuthorizedDownMessage,
  ContinuationInstruction,
  ContinuityMode,
  CoordinationEvent,
  CoordinationStats,
  DownMessageAuthorizationInput,
  DownMessageDeliveryAttempt,
  DownMessageDeliveryOutcome,
  DownMessageEvent,
  MakeWorkerAgent,
  SpawnPreflight,
  SpawnPreflightContext,
  SpawnRefusal,
  SpawnRefusalCause,
  WorkerResumeContext,
  WorkerSpawnContext,
  WorkerWatchOptions,
} from './../mcp/tools/coordination'
export {
  canonicalFindingEvent,
  DEFAULT_AWAIT_EVENT_TIMEOUT_MS,
  normalizeAnalyzeOnSettle,
} from './../mcp/tools/coordination'
export type { WorktreeCheckRunner, WorktreeHarnessResult } from './../mcp/worktree-harness'
// Re-exported on the KERNEL entry, not only the package root: a `supervise` caller imports
// `@tangle-network/agent-runtime/kernel`, so an exporter reachable only from the root is an
// exporter that caller cannot pass to `SupervisorOpts.otel` — the recorder above would have had
// nowhere to write without standing up an OTLP collector first.
export { createOpenInferenceFileExporter, createOtelExporter } from '../otel-export'
export {
  type AnytimeReport,
  type AnytimeStrategySummary,
  type AnytimeTaskCurve,
  anytimeReport,
  // The best-so-far / AUC / plateau math, extracted so the LIVE progress-based stop rules
  // (`supervise/stop-rules`) decide from the SAME numbers the post-run report grades them by.
  areaUnderCurve,
  bestSoFar,
  plateauLength,
  renderAnytimeTable,
} from './anytime'
export {
  type AuditIntentInput,
  type AuditIntentOptions,
  auditIntent,
  defaultAuditorInstruction,
  type IntentAudit,
} from './audit-intent'
// The domain-agnostic benchmark report engine: a fleet of `RunRecord`s → a ranked leaderboard, the full
// profile×axis score matrix, and embeddable SVG/HTML charts (the hosted-leaderboard surface). Reads only
// the universal `RunRecord` currency, so it reports ANY benchmark in ANY domain.
export {
  type AxisScoresOf,
  type GroupOf,
  type Interval,
  type Leaderboard,
  type LeaderboardOptions,
  type LeaderboardRow,
  leaderboard,
  type PairwiseOptions,
  type PairwiseVerdict,
  type ProfileKeyOf,
  pairwiseSignificance,
  renderLeaderboardHtml,
  renderLeaderboardMarkdown,
  renderLeaderboardSvg,
  renderPairwiseMarkdown,
  type ScoreOf,
} from './benchmark-report'
export {
  type CompletionAnalyst,
  type CompletionEvidence,
  type CompletionPolicy,
  type CompletionVerdict,
  completionAuthorizes,
  deterministicCompletion,
  sentinelCompletion,
  stopSentinel,
} from './completion'
// The declarative eval-leaderboard facade: cases + prompt + score → one
// runProfileMatrix call (expandProfileAxes × loopDispatch × the naive retry driver),
// with a structural BenchmarkAdapter view via toBenchmarkAdapter().
export {
  type DefinedLeaderboard,
  defineLeaderboard,
  type LeaderboardBenchmarkAdapter,
  type LeaderboardBenchScore,
  type LeaderboardBenchTask,
  type LeaderboardFlagSpec,
  type LeaderboardIterationInfo,
  type LeaderboardRunContext,
  type LeaderboardScenario,
  type LeaderboardScore,
  type LeaderboardSpec,
} from './define-leaderboard'
export {
  type AgentEnvironment,
  type AgentEnvironmentCapabilities,
  type AgentEnvironmentEvent,
  type AgentEnvironmentProvider,
  type AgentEnvironmentProviderRef,
  type AgentEnvironmentProviderRegistry,
  type AgentEnvironmentQuery,
  type AgentEnvironmentStatus,
  type AgentEnvironmentSummary,
  type AgentProfileRef,
  type AgentSession,
  type AgentSessionRef,
  type AgentSessionStatus,
  type AgentTurnResult,
  type CheckpointRef,
  type CheckpointRequest,
  type CreateAgentEnvironmentInput,
  type CreateTangleSandboxExactProcessProviderOptions,
  createAgentEnvironmentProviderRegistry,
  createTangleSandboxExactProcessProvider,
  type ExecRequest,
  type ExecResult,
  type ForkRequest,
  type PlacementInfo,
  type ProviderAsSandboxClientOptions,
  type ProviderExecutorOptions,
  providerAsExecutor,
  providerAsSandboxClient,
  type ResourceRequest,
  resolveAgentEnvironmentProvider,
  type SandboxClientProviderOptions,
  sandboxClientAsProvider,
  type WorkspaceRequest,
} from './environment-provider'
export {
  type HarvestCorpusOptions,
  type HarvestFailure,
  type HarvestReport,
  harvestCorpus,
} from './harvest-corpus'
// The in-process pseudo-box: a user `onPrompt` callback → a SandboxClient for
// runAgentRounds / openSandboxRun (the typed offline seam, no SandboxInstance cast).
export {
  type InProcessOnPrompt,
  type InProcessPromptCtx,
  type InProcessSandboxClientOptions,
  inProcessSandboxClient,
} from './in-process-sandbox-client'
// The one pseudo-box adapter: any non-box Executor → a SandboxClient for runAgentRounds.
export { inlineSandboxClient } from './inline-sandbox-client'
// API-key provisioning for adopted external MCP servers: secrets ride the
// profile by NAME only; a KeyProvider resolves values at materialize time.
export {
  envKeyProvider,
  type KeyProvider,
  mcpSecretEnvMetadataKey,
  type ResolvedMcpServerLaunch,
  resolveMcpServerLaunch,
  resolveSecretEnv,
  secretEnvOfMcpServer,
} from './key-provider'
// The same-host pseudo-box: a router-brain tool loop with the profile's stdio
// MCP servers spawned as LOCAL children — the one client that can reach an MCP
// server built into a host worktree.
export { type LocalSandboxClientOptions, localSandboxClient } from './local-sandbox-client'
export {
  type LoopCampaignDispatchOptions,
  type LoopDispatchOptions,
  type LoopOptionsForDispatch,
  loopCampaignDispatch,
  loopDispatch,
  type SuperviseDispatchOptions,
  type SuperviseOptionsForDispatch,
  superviseDispatch,
} from './loop-dispatch'
export {
  createMcpEnvironment,
  type McpEndpoint,
  type McpEnvironmentOptions,
  sanitizeMcpToolSchema,
} from './mcp-environment'
// The third-person observer: a worker's trace → trace-grounded findings, an
// operator report, and durable corpus facts for the next run (the closed loop).
export {
  defaultAnalystInstruction,
  type Observation,
  type ObserveInput,
  type ObserveOptions,
  observe,
  renderReport,
} from './observe'
// The personify layer + the RSI wave built on the recursive keystone: the persona content seam
// (`definePersona`/`runPersonified`), the open shape registry, the content-free generic
// combinators, the cross-run corpus, the analyst-on-scope steer firewall, and the trajectory +
// equal-k-on-cost ledger. The wave's type contracts live in `./personify/wave-types`.
export {
  assertTraceDerivedFindings,
  buildSteerContext,
  type CreateScopeAnalystOptions,
  createScopeAnalyst,
  type RegistryAnalyzeProjection,
  registryScopeAnalyst,
} from './personify/analyst'
export {
  fanout,
  flatWidenGate,
  loopUntil,
  panel,
  pipeline,
  selectValidWinner,
  verify,
  widen,
} from './personify/combinators'
export {
  FileCorpus,
  InMemoryCorpus,
  renderCorpusToInstructions,
} from './personify/corpus'
export { definePersona, runPersonified } from './personify/persona'
export { builtinShapes, createShapeRegistry, registerShape } from './personify/registry'
export { equalKOnCost, trajectoryReport } from './personify/trajectory'
export type {
  DefinePersona,
  DefinePersonaInput,
  LoopShape,
  Outcome,
  Persona,
  PersonaContext,
  PersonaExecutors,
  RunPersonified,
  RunPersonifiedOptions,
  ShapeBudget,
  ShapeContext,
  ShapeRegistry,
} from './personify/types'
export type {
  AssertTraceDerivedFindings,
  CombinatorShape,
  Corpus,
  CorpusFilter,
  CorpusRecord,
  EqualKArm,
  EqualKOnCost,
  EqualKOnCostOptions,
  EqualKVerdict,
  Fanout,
  FanoutOptions,
  FanoutSynthesis,
  FanoutWinnerSelector,
  FlatWidenGate,
  LoopUntil,
  LoopUntilSpec,
  LoopUntilState,
  Panel,
  PanelJudge,
  PanelSpec,
  PanelVerdict,
  Pipeline,
  PipelineStage,
  RenderCorpusToInstructions,
  RenderCorpusToInstructionsOptions,
  ScopeAnalyst,
  ScopeAnalyzeInput,
  ScopeWidenGate,
  SteerContext,
  TrajectoryNode,
  TrajectoryReport,
  TrajectoryReportFn,
  TrajectoryReportOptions,
  Verify,
  VerifySpec,
  Widen,
  WidenDecision,
  WidenLineage,
  WidenSpec,
  WinnerStrategy,
} from './personify/wave-types'
// Agent-eval integrations (judges, optimizers) use this exact-profile adapter instead of opening
// a second provider path. It lowers one AgentProfile through createExecutor + streamAgentTurn.
export { profileChatClient, profileOptimizerModelCall } from './profile-chat-client'
export {
  type PromotionGateOptions,
  type PromotionVerdict,
  promotionGate,
} from './promotion-gate'
// The product-facing backend selector: one call picks sandbox/bridge/router transport.
export {
  type ResolveSandboxClientOptions,
  resolveSandboxClient,
} from './resolve-sandbox-client'
export {
  type ClaimRetainedInteractiveControlOptions,
  claimRetainedInteractiveControl,
  type NativeContextContinuationExecution,
  type NativeContextContinuationInput,
  type ReconnectRetainedInteractiveRunOptions,
  type ReconnectRetainedRunOptions,
  type RecoverRetainedInteractiveRunOptions,
  type RecoverRetainedRunIntentOptions,
  type RecoverRetainedRunOptions,
  type RecoverRetainedRunResult,
  type RetainedInteractiveAdmission,
  type RetainedInteractiveAdmissionHook,
  type RetainedInteractiveEnvironmentAdmission,
  type RetainedInteractiveEnvironmentInput,
  type RetainedInteractiveIntentAdmission,
  type RetainedInteractiveRunHandle,
  type RetainedInteractiveStartedAdmission,
  type RetainedInteractiveStartMaterial,
  type RetainedRunAdmission,
  type RetainedRunAdmissionHook,
  type RetainedRunCancellation,
  type RetainedRunCancelOptions,
  type RetainedRunDispatchedAdmission,
  type RetainedRunEffect,
  type RetainedRunEnvironmentAdmission,
  type RetainedRunEventOptions,
  type RetainedRunHandle,
  type RetainedRunIntentAdmission,
  type RetainedRunReplayPoint,
  type RetainedRunSnapshot,
  type RetainedRunStartMaterial,
  reconnectRetainedInteractiveRun,
  reconnectRetainedRun,
  recoverRetainedInteractiveRun,
  recoverRetainedRun,
  type StartRetainedInteractiveRunOptions,
  type StartRetainedRunInEnvironmentOptions,
  type StartRetainedRunOptions,
  startRetainedInteractiveRun,
  startRetainedRun,
  startRetainedRunInEnvironment,
} from './retained-run'
// Router requests are an internal transport adapter. Public execution always enters through an
// exact AgentProfile (`createExecutor` + `streamAgentTurn`); callers may configure only the
// endpoint/auth transport used by that path.
export type { RouterTransportConfig } from './router-client'
export {
  type BenchmarkCell,
  type BenchmarkConfig,
  type BenchmarkLift,
  type BenchmarkReport,
  type BenchmarkStrategySummary,
  type BenchmarkTaskRow,
  type Environment,
  printBenchmarkReport,
  runBenchmark,
} from './run-benchmark'
// `runAgentRounds` is the multi-agent fanout/vote/refine kernel over many sandbox sessions.
// It is distinct from `runToolLoop`/`streamToolLoop`, which execute one chat turn and fold
// tool results back into that same conversation.
export {
  defaultSelectWinner,
  isTerminalDecision,
  type RunAgentRoundsOptions,
  runAgentRounds,
  TERMINAL_DECISIONS,
  type TerminalDecision,
} from './run-loop'
export { type AcquireOptions, acquireSandbox } from './sandbox-acquire'
export {
  type CriuCapableClient,
  probeSandboxCapabilities,
  type SandboxCapabilities,
} from './sandbox-capabilities'
export {
  assertSandboxServedModel,
  createSandboxToolPartState,
  extractLlmCallEvent,
  mapSandboxEvent,
  mapSandboxToolEvent,
  type SandboxServedBackend,
  type SandboxToolPartState,
  sandboxEventServedBackend,
  sandboxProgressEvents,
  sumSandboxUsage,
} from './sandbox-events'
export {
  type BranchCapableBox,
  type CheckpointCapableBox,
  createSandboxLineage,
  type ForkCapableBox,
  type SandboxLineage,
  type SandboxLineageHandle,
  type SessionCapableBox,
} from './sandbox-lineage'
export {
  type Deliverable,
  type OpenSandboxRunBeforeStartContext,
  type OpenSandboxRunOptions,
  type OpenSandboxRunPromptOptions,
  openSandboxRun,
  type SandboxRun,
  SandboxRunAbortError,
  type TurnResult,
} from './sandbox-run'
// Same-host stdio MCP: the ONE spawn+handshake connection (shared by the serve
// verifier and the live consumers) + the profile.mcp materializer.
export {
  connectStdioMcp,
  type LocalMcpMaterialization,
  type MaterializeLocalMcpOptions,
  McpSpawnFault,
  type McpToolDescriptor,
  materializeLocalMcp,
  type StdioMcpConnection,
  type StdioMcpServerSpec,
} from './stdio-mcp-client'
// The optimization suite: a domain = an Environment (5 hooks); a Strategy = how the
// budget is spent to beat its check. Built-ins `sample`/`refine`; author your own with
// `defineStrategy` (compose shot() + critique(), zero Supervisor ceremony); compare
// with runBenchmark. The depth/breadth drivers are the reference implementations.
export {
  type AgenticOptions,
  type AgenticRunResult,
  type AgenticSurface,
  type AgenticTask,
  type AgenticTool,
  type ArtifactHandle,
  adaptiveRefine,
  breadthStrategy,
  type CorpusReadbackOptions,
  defineStrategy,
  depthStrategy,
  type RunAgenticOptions,
  refine,
  runAgentic,
  type ShotSpec,
  type Strategy,
  type StrategyArtifacts,
  type StrategyCtx,
  type StrategyMessage,
  type StrategyResult,
  type StrategyShotResult,
  type SurfaceScore,
  sample,
  sampleThenRefine,
} from './strategy'
export {
  type AuthoredStrategy,
  type AuthorStrategyOptions,
  assertStrategyContract,
  authorStrategy,
  strategyAuthorContract,
  strategyAuthorSystemPrompt,
} from './strategy-author'
export {
  type ChampionPick,
  type ChampionPolicy,
  discriminatingMeans,
  type EvolutionArchiveNode,
  type EvolutionAuthor,
  type EvolutionBandInfo,
  type EvolutionCandidate,
  type EvolutionGeneration,
  type EvolutionReport,
  pickChampion,
  type ReproductionCheck,
  runStrategyEvolution,
  type StrategyEvolutionConfig,
  selectChampion,
} from './strategy-evolution'
export {
  type AgentTurnBackend,
  type AgentTurnInput,
  type AgentTurnUsage,
  type CollectedAgentTurn,
  collectAgentTurn,
  type StreamAgentTurnOptions,
  streamAgentTurn,
} from './stream-agent-turn'
// The structural lever as a strategy-family member: k samples → select by task-visible checks
// (official above authored, crash lowest) → guarded repair steered by the checks' failure output.
// Measured +8..+21pp hidden-test lift (docs/design/structural-rollout-integration.md).
export {
  type CheckExecChannel,
  type CheckOutcome,
  type CheckRunContext,
  type CheckRunner,
  type CheckSource,
  type CheckSourceCtx,
  canDisplace,
  compareCheckOutcomes,
  composeCheckSources,
  defaultExtractCandidate,
  defaultStructuralRolloutPolicy,
  filterAuthoredAsserts,
  modelAuthoredChecks,
  officialChecksFromMeta,
  type RepairStop,
  resolveEntrySymbol,
  type StructuralRolloutConfig,
  type StructuralRolloutMessage,
  type StructuralRolloutPolicy,
  type StructuralRolloutResult,
  sandboxCheckRunner,
  selectBestIndex,
  structuralRollout,
  type VisibleCheck,
  visibleCheckScore,
} from './structural-rollout'
// The supervisor's intelligence: it AUTHORS each worker's profile (instructions + model) from a
// SKILL (its own system prompt) — the optimizable self-improvement surface, not the plumbing.
export {
  type AuthoredProfile,
  asAuthoredProfile,
  assessAuthoredProfile,
  defaultProfileRichnessThresholds,
  type ProfileRichness,
  type ProfileRichnessThresholds,
  profileRichnessFinding,
  supervisorInstructions,
} from './supervise/authoring'
export {
  type BudgetPool,
  type BudgetPoolRestore,
  type BudgetReadout,
  createBudgetPool,
  type ReservationRejection,
  type ReservationTicket,
  spendFromUsageEvents,
} from './supervise/budget'
// The chat-transport leaf (#721): a worker that IS a model conversation on a bare
// OpenAI-compatible /v1/chat/completions endpoint — no sandbox. Ships with its session store and
// the continuity-honoring `makeWorkerAgent` seam. `workerFromBackend` resumes only bridge-backed
// workers; this leaf resumes its own sessions, so conversation graphs and chat-shot loops
// compose from data on any transport.
export {
  type ChatCompletionsTransport,
  type ChatSessionStore,
  type ChatTransportExecutorOptions,
  type ChatTransportTool,
  type ChatWorkerSeamOptions,
  chatTransportExecutor,
  chatWorkerSeam,
  createChatSessionStore,
} from './supervise/chat-transport-executor'
// The completion-oracle: settled ⟺ DELIVERED. `gateOnDeliverable` wraps an executor so its
// settlement `valid` reflects a deployable deliverable check (a test/judge), never self-report.
export {
  type DeliverableSpec,
  type ExecutorResultMapping,
  gateOnDeliverable,
  mapExecutorResult,
} from './supervise/completion-gate'
export { finalizeBestDelivered } from './supervise/coordination-driver'
// The durable coordination side-log a file-backed `RunContext` carries: questions, findings, answer
// decisions, and authorized continuation receipts the spawn journal does not own. Receipts persist
// as evidence and are never auto-delivered to a replacement worker.
export {
  type CoordinationDeliveryEvidence,
  type CoordinationLog,
  type CoordinationOwnerId,
  FileCoordinationLog,
  type PriorCoordination,
} from './supervise/coordination-log'
// Supervisor-as-MCP: serve the coordination verbs as a real HTTP MCP over a live Scope, so any
// harness (claude-code / codex / opencode) BECOMES the supervisor by mounting one MCP server.
export { type CoordinationMcpHandle, serveCoordinationMcp } from './supervise/coordination-mcp'
// The one generic delegation verb: hand it an INTENT, it routes to `supervise()` with a default
// authoring supervisor (no hardcoded worker profile) and returns the `SupervisedResult` unchanged —
// so `spentTotal` (what the delegation cost) rides straight back.
export {
  type DelegateOptions,
  defaultDelegateBudget,
  delegate,
} from './supervise/delegate'
// The ONLINE analyst: watch a TraceSource and raise a `finding` the moment a worker loops/error-storms.
export {
  defaultToolDetectors,
  type WatchTraceOptions,
  watchTrace,
} from './supervise/detector-monitor'
// REFILLING dispatch: hold N children in flight and admit the next queued unit the moment one
// settles, instead of draining a whole round (`fanout`) or opening one worker per driver turn.
// `freeSlots` is the reading the driver sees; `effectiveConcurrency` collapses the supervisor and
// fleet caps into the ONE number a host should pass to both `maxLiveWorkers` and `width`.
export {
  type ConcurrencyCaps,
  type DispatchReport,
  type DispatchStopReason,
  type DispatchUnit,
  effectiveConcurrency,
  freeSlots,
  queueOf,
  type RollingDispatchOptions,
  rollingDispatch,
} from './supervise/dispatch'
// Root-driver retry: the second chance a transiently-failed EXTERNAL driver gets before a run ends
// `driver-failed`, plus the per-attempt record that makes the failure diagnosable.
export {
  classifyDriverFailure,
  type DriverAttemptRecord,
  type DriverAttemptStop,
  DriverAttemptsExhaustedError,
  type DriverProgressMark,
  type DriverRetryPolicy,
} from './supervise/driver-retry'
// The child→parent message bus: the one typed pipe carrying settled outputs, questions, and
// analyst findings up to the driver (pass-through + queued lanes, transport-agnostic).
export {
  type BusEvent,
  type BusRecord,
  type BusStats,
  createEventBus,
  type EventBus,
  type PublishOptions,
} from './supervise/event-bus'
// FINALIZATION: how a driver's settled-worker ledger becomes the run's output. `bestDelivered` is
// the default and the unchanged keep-best; `collectDelivered` returns every verified distinct
// output with provenance (competing hypotheses, a Pareto set, a recorded evaluator split). Any
// finalizer runs under the delivered-only invariant — an undelivered or invalid child's output is
// unreachable, whatever the finalizer wants.
// `runTree` is deliberately absent: it merges a resumed run's committed nodes into the live view,
// and the supervisor applies it before returning, so `SupervisedResult.tree` already carries the
// merged tree. Exporting it added a `run*` name that read as a second graph runtime.
export {
  bestDelivered,
  collectDelivered,
  type DeliveredOutput,
  type FinalizeContext,
  type FinalizerSettled,
  pickBestDelivered,
  runFinalizer,
  type SupervisorFinalizer,
} from './supervise/finalizer'
// Agent graphs: profiles as nodes, registry-backed prompt directives as typed edges, every
// traversal ledgered. An interpretation layer over `supervise()` (the execution core), never a
// second scheduler — driver↔worker is the 2-node cyclic instance.
export {
  type AgentGraph,
  defaultEdgeTraversalCap,
  type EdgeDeliveryOutcome,
  type EdgeTraversal,
  type GraphEdge,
  GraphEdgeCapError,
  type GraphNode,
  type GraphResult,
  type RunGraphOptions,
  runGraph,
  type TraversalContinuity,
} from './supervise/graph'
// The down-leg receive end: a per-worker inbox an executor exposes as `Executor.deliver`; the loop
// drains it at the step boundary + before settle (queued) or aborts the turn (forceful interrupt).
export {
  type AuthorityInboxMessage,
  createInbox,
  type Inbox,
  type InboxMessage,
  type PeerInboxMessage,
} from './supervise/inbox'
// The fail-loud model-subset guard the front doors call: restrict a run to a chosen set of models.
export { assertModelAllowed, assertProfileModelsAllowed } from './supervise/model-policy'
// OPT-IN OTLP tracing for a supervised tree: a pure `RuntimeHooks` observer that turns the
// lifecycle events `Scope` already emits into one span per node (opened at spawn, closed at settle,
// parented to its parent node's span) plus an LLM child span per metered driver turn. A span with a
// `parent_span_id` IS a tree, so the supervisor becomes readable by the same viewer as every other
// multi-agent shape — with no per-system reader. Telemetry only: the spawn journal remains the sole
// replay/resume record, and nothing here is ever read back.
export {
  createSupervisorSpanRecorder,
  type SupervisorSpanAttributes,
  type SupervisorSpanOptions,
  type SupervisorSpanOutcome,
  type SupervisorSpanRecorder,
} from './supervise/otel-spans'
// The mechanical patch gate as a generic DeliverableSpec over the worktree-CLI patch artifact:
// no-op / always-on secret-path floor / forbidden-path / diff-size + required test/typecheck pass.
export { type PatchDeliverableOptions, patchDelivered } from './supervise/patch-deliverable'
// PEER MAIL: the bounded, audited sibling channel. A worker reaches a live sibling through the
// parent's post office — typed envelopes, per-sender and per-receiver caps, a reply-depth ceiling,
// and an authority marking that keeps a peer's message from reading as the supervisor's.
export {
  AUTHORITY_MARKERS,
  claimsAuthority,
  createPeerMailbox,
  DEFAULT_PEER_MAIL_LIMITS,
  isPeerMailEnvelope,
  PEER_MAIL_WIRE_KEY,
  type PeerMailbox,
  type PeerMailboxOptions,
  type PeerMailEnvelope,
  type PeerMailEvent,
  type PeerMailKind,
  type PeerMailLimits,
  type PeerMailOutcome,
  type PeerMailReadout,
  type PeerMailRefusal,
  type PeerMailSendInput,
  peerMailTools,
  peerMailVerbNames,
} from './supervise/peer-mail'
// The LIVE read-model of a RUNNING worker — last activity, idle time, derived stall, turns,
// tokens so far, recent tool/file activity, unread steers. What `observe_agent` now returns
// mid-flight, and the evidence a supervisor steers FROM.
export {
  type ActivityLog,
  type ActivityNote,
  createActivityLog,
  DEFAULT_STALL_AFTER_MS,
  type ExecutorProgress,
  readWorkerProgress,
  type ScopeProgressInput,
  type WorkerProgress,
} from './supervise/progress'
// The kernel prompt registry: versioned prompt text as data (`<surface>/v<n>`), the directive
// store graph edges and the supervisor front doors resolve against.
export {
  analyzesFindingsReportPrompt,
  createPromptRegistry,
  delegatesWorkerBriefPrompt,
  dumbContinuationFailPrompt,
  dumbContinuationPassPrompt,
  formatPromptHandle,
  kernelPromptRegistry,
  naiveContinuationPrompt,
  type PromptHandle,
  type PromptRegistry,
  promptHandle,
  type RegisteredPrompt,
  supervisorPolicyPrompt,
} from './supervise/prompt-registry'
// The one-call store bundle for a supervised run: a journal + blob store + executor registry,
// shaped to spread straight into `SupervisorOpts`. `createInMemoryRunContext` is the default
// (fresh, process-lifetime); `createFileRunContext(dir)` is the durable one — file-backed stores
// plus `resume: true`, so re-running the same `runId` against the same `dir` picks up the
// children that already settled instead of re-running them. `{ withDriver: true }` wraps the
// registry for the recursive agents-drive-agents path.
export {
  createFileRunContext,
  createInMemoryRunContext,
  type InMemoryRunContext,
  type InMemoryRunContextOptions,
  type RunContext,
} from './supervise/run-context'
// The durable, cross-process face of a run: the `<root>/.agent/supervisor/<id>` layout that
// published `traces analyze --supervisor-run-dir` reads (`.loops/…` is the pre-rename location
// readers fall back to). Promoted from the loops repo (#4519 in agent-dev-container) so the
// writer contract is published alongside its reader.
export {
  cancelRun,
  cancelWorker,
  legacySupervisorRunDir,
  legacySupervisorRunsRoot,
  type RunCancellation,
  type RunCancelRequest,
  readRunCancellation,
  readRunCancelRequest,
  readWorkerCancellation,
  readWorkerCancelRequests,
  readWorkerSteerRequests,
  runCancellationFile,
  runCancelRequestFile,
  safeWorkerFile,
  supervisorRunDir,
  supervisorRunsRoot,
  supervisorWorkersDir,
  type WorkerCancellation,
  type WorkerCancelRequest,
  type WorkerSteerRequest,
  workerCancellationFile,
  workerCancellationsDir,
  workerCancelRequestsFile,
  workerControlLogFile,
  workerInboxFile,
  workerInboxFileFromEventDir,
  writeWorkerSteer,
} from './supervise/run-layout'
// The ONE built-in executor entrypoint: backend-as-data (`createExecutor({backend})`).
// The per-backend factories are internal case-arms; BYO agents implement `Executor`.
export {
  type BridgeModelCredential,
  type BridgeSeam,
  type CliSeam,
  type CliWorktreeBridgeSeam,
  type CliWorktreeSeam,
  cliWorktreeExecutor,
  createExecutor,
  createExecutorRegistry,
  type ExecutorConfig,
  type ProviderSeam,
  type RouterSeam,
  type RouterToolsSeam,
  type SandboxLeafOut,
  type SandboxOutputMarker,
  type SandboxSeam,
  type ToolSpec,
} from './supervise/runtime'
// The STEERABLE sandbox worker: one box, one server-side session, many turns — so a steer has a
// turn boundary to be folded into and the default cloud worker becomes correctable mid-flight.
export {
  createSteerableSandboxSession,
  DEFAULT_SANDBOX_STEERING_MAX_TURNS,
  type SandboxSteeringOptions,
  type SteerableSandboxArgs,
  type SteerableSandboxSession,
} from './supervise/sandbox-session'
export { createScope, type ScopeArgs, settledToIteration } from './supervise/scope'
// PROGRESS-BASED STOP RULES: end a long-horizon run because it stopped learning, not because it ran
// out. Enforcement lives here; the thresholds are the caller's policy. Composes with (and can never
// override) the conserved-pool / deadline / abort ceilings.
export {
  type AllWorkersStalledOptions,
  allOf,
  allWorkersStalled,
  anyOf,
  createProgressTracker,
  type NoProgressForOptions,
  noProgressFor,
  type PlateauOptions,
  type ProgressSample,
  type ProgressTracker,
  type ProgressTrackerOptions,
  type ProgressView,
  plateau,
  type StopDecision,
  type StopRule,
  sampleFromSettled,
} from './supervise/stop-rules'
// The one-call "just invoke the supervisor": `supervise(profile, task, { backend, budget })` with
// sensible defaults (blobs/perWorker/journal/executors). `workerFromBackend` derives the worker seam
// from a backend config + an optional completion oracle (settled⟺delivered).
export {
  type AuthorizedSpawn,
  type AuthorizedSpawnContext,
  DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY,
  type DeliverableResolutionInput,
  type SuperviseOptions,
  type SuperviseRegistry,
  type SuperviseRegistryTable,
  supervise,
  workerFromBackend,
} from './supervise/supervise'
export { createRootHandle, createSupervisor } from './supervise/supervisor'
// Build a supervisor FROM its profile: the brain is resolved from `profile.harness` like
// `createExecutor({backend})` resolves a worker — omitted/`cli-base` → the in-process router tool-loop,
// a coding-CLI harness → a sandboxed harness driving the coordination verbs. No hand-built brain.
export {
  assertCoordinationBinding,
  type CoordinationBinding,
  type DriveHarness,
  type DriveHarnessOwnerContext,
  type ObserveSupervisorNodeEvent,
  type ResolveDriveHarness,
  type ResolvedSupervisorProfile,
  type ResolveSupervisorTools,
  resolveSupervisorProfile,
  type SupervisorAgentDeps,
  type SupervisorNodeContext,
  type SupervisorNodeContextSeed,
  type SupervisorProfile,
  type SupervisorToolDescriptor,
  type SupervisorToolInvocationContext,
  supervisorAgent,
} from './supervise/supervisor-agent'
export {
  captureWorkerTraceEvidence,
  parseWorkerToolTraceArtifact,
  WORKER_TOOL_TRACE_SCHEMA_VERSION,
  type WorkerToolTraceArtifact,
  workerTraceAnalysisStore,
} from './supervise/trace-evidence'
// The substrate-agnostic trace source: a worker's tool calls as agent-eval `ToolSpan`s, from an
// OWNED loop (push) OR a sandbox box session (message parts). The common currency for both analysts.
export {
  createPushTraceSource,
  decodeToolPart,
  type SessionMessageLike,
  type SessionTraceBox,
  sandboxSessionTraceSource,
  type ToolStepInput,
  type TraceSource,
} from './supervise/trace-source'
// The SETTLE-time analyzer: collect a TraceSource's spans and run agent-eval's published batch
// analyzers (buildTrajectory / stuckLoopView / toolWasteView) — the post-hoc half.
export { analyzeTrace, type TrajectoryAnalysis } from './supervise/trajectory-recorder'
export type {
  Agent,
  AgentExecutionRef,
  AgentSpec,
  Budget,
  ExecutionBindingReceipt,
  Executor,
  ExecutorAccounting,
  ExecutorCancellation,
  ExecutorCancellationRequest,
  ExecutorContext,
  ExecutorExecutionBinding,
  ExecutorFactory,
  ExecutorMaterialization,
  ExecutorNodeContext,
  ExecutorProgressEvent,
  ExecutorRegistry,
  ExecutorResult,
  ExecutorToolCall,
  Handle,
  MaterializedExecutionIdentity,
  MaterializedModelIdentity,
  NodeExecutionIdentity,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  NoWinnerError,
  ProfileMaterializationReceipt,
  ProviderModelAttemptEvidence,
  ProviderModelExecutionEvidence,
  Restart,
  ResultBlobStore,
  ResumedKeyState,
  ResumedWork,
  RootHandle,
  RootMaterialization,
  RootProviderModelEvidence,
  RootSignal,
  Runtime,
  Scope,
  Settled,
  SpawnEvent,
  SpawnJournal,
  SpawnOpts,
  SpawnPrior,
  SpawnRejection,
  Spend,
  SpendChannel,
  SpendGap,
  SteerableRootHandle,
  SupervisedResult,
  Supervisor,
  SupervisorOpts,
  TreeView,
  UnconfirmedTeardown,
  UnknownMaterializationReason,
  UsageEvent,
  WaitOpts,
  WidenGate,
  WorkerInteractiveSession,
  WorkerInteractiveUnavailableReason,
  WorkerTraceEvidence,
  WorkerTraceUnavailableReason,
} from './supervise/types'
// Untracked-artifact fidelity for cloned worker workspaces: `git clone` carries history only, and
// real workspaces hold compiled build outputs as untracked files a worker's verify gate needs.
// Promoted from the loops repo (#4519).
export {
  type CopyOptions,
  copyUntrackedIntoClone,
  type UntrackedCopyStats,
  withUntrackedArtifacts,
} from './supervise/untracked-clone'
// WAIT-STATES: a tree node that waits on wall-clock time (`timer`) or a named external predicate
// (`poll`) with NO executor, NO sandbox, and NO conserved budget — journaled with its absolute
// deadline, so a killed run resumes still waiting to the same instant. Not `await_event`: that is
// an in-run rendezvous whose re-polls each cost a driver turn and vanish with the process.
export {
  createWaitProbes,
  isWaitOutcome,
  type PendingWait,
  pollFor,
  timerAt,
  validateWaitSpec,
  type WaitOutcome,
  type WaitProbe,
  type WaitProbeRegistry,
  type WaitRejection,
  type WaitSpec,
  waitUntil,
} from './supervise/wait'
// The bounded settle-evidence block a worker exposes so the brain's next decision is not authored
// blind. Complementary to `CompletionEvidence` (a pointer), which this block is the target of.
// Promoted from the loops repo (#4519).
export {
  closingWorkerNote,
  composeWorkerEvidence,
  EVIDENCE_MAX_CHARS,
  NOTE_MAX_CHARS,
  settledWorkerOut,
  VERIFY_TAIL_CHARS,
  type WorkerEvidenceInput,
} from './supervise/worker-evidence'
// The same tracing, carried ACROSS the process boundary: a spawned worker inherits the run's trace
// id and the spawning node's span id through the `TRACE_ID` / `PARENT_SPAN_ID` env convention this
// package already reads (`readTraceContextFromEnv`), so a worker on a remote sandbox emits spans
// that join the parent's trace and one viewer assembles the whole cross-machine tree. Off unless a
// run records spans; a caller's own seam env always wins. `worker-trace.ts` documents the
// precedence rule and names which backends carry it and which cannot.
export {
  readWorkerTraceContext,
  type WorkerTraceResolver,
  type WorkerTraceSeamCarrier,
  workerTraceEnv,
  workerTraceHeaders,
  workerTraceSeamKey,
} from './supervise/worker-trace'
// The worktree-CLI leaf executor: a supervisor-authored AgentProfile (systemPrompt + model)
// driving a local harness CLI on its own git worktree, surfaced as the open `Executor` port.
export {
  createWorktreeCliExecutor,
  type WorktreeCliExecutorOptions,
  type WorktreeCommandResult,
  type WorktreePatchArtifact,
  type WorktreeProfileMaterializationReceipt,
} from './supervise/worktree-cli-executor'
// The generic coding combinator: a fanout of authored harness profiles, each on its own
// worktree-CLI leaf, each gated by the injected deliverable, winner via the shared valid-only
// `selectValidWinner`.
export {
  type AuthoredHarness,
  type WorktreeFanoutOptions,
  worktreeFanout,
} from './supervise/worktree-fanout'
// `supervise()` specialized for a graded `AgenticSurface` task: workers each `runAgentic` over the surface
// (refine by default), settle on the surface's own check, and feed the driver a self-improvement lens (the
// failing tests, by default) so the next spawn targets them. One capability over `supervise` + `runAgentic`.
export {
  analystsFromRegistry,
  failuresAnalyst,
  type SuperviseSurfaceOptions,
  type SuperviseSurfaceResult,
  type SurfaceWorkerConfig,
  type SurfaceWorkerOut,
  superviseSurface,
} from './supervise-surface'
export {
  type BoxSurfaceReaderOptions,
  boxSurfaceReader,
  fsSurfaceReader,
  type HarvestSurfaceDiffsOptions,
  harvestSurfaceDiffs,
  type SurfaceDiff,
  type SurfaceReadBox,
  type SurfaceReader,
  type SurfaceReadOutcome,
  type WatchedSurface,
} from './surface-diff'
export type { SandboxControlClient } from './tangle-sandbox-exact-process-provider'
// Profile-owned supervisor configuration. The raw driver constructor lives only under `/testing`;
// production model execution enters through `supervise(AgentProfile)` — except the graph's root,
// where `RunGraphOptions.brain` accepts a caller-owned `ToolLoopChat` (see `runGraph`).
export type {
  ToolLoopCallContext,
  ToolLoopChat,
  ToolLoopCompaction,
  ToolLoopCompactionOptions,
  ToolLoopMessageRecord,
  ToolLoopToolCall,
} from './tool-loop'
export type {
  AgentRunSpec,
  DefaultVerdict,
  Driver,
  ExecCtx,
  Iteration,
  LoopDecisionPayload,
  LoopEndedPayload,
  LoopIterationDispatchPayload,
  LoopIterationEndedPayload,
  LoopIterationStartedPayload,
  LoopLineageOptions,
  LoopPlanDescription,
  LoopPlanPayload,
  LoopResult,
  LoopSandboxPlacement,
  LoopStartedPayload,
  LoopTeardownFailedPayload,
  LoopTokenUsage,
  LoopTraceEmitter,
  LoopTraceEvent,
  LoopWinner,
  MountManifestEntry,
  MountRecorder,
  OutputAdapter,
  RunProvenance,
  SandboxClient,
  SelectionReceipt,
  ValidationCtx,
  Validator,
} from './types'
export {
  createVerifierEnvironment,
  type VerifierEnvironmentOptions,
} from './verifier-environment'
export {
  createWaterfallCollector,
  type WaterfallCollector,
  type WaterfallReport,
  type WaterfallSpan,
} from './waterfall'
export {
  type GitWorkspaceOptions,
  gitWorkspace,
  jjWorkspace,
  localShell,
  runInWorkspace,
  type Shell,
  type Workspace,
  type WorkspaceCommit,
  type WorkspaceRun,
} from './workspace'
