/**
 *
 * Driven-loop substrate. `runAgentRounds` orchestrates around the sandbox SDK; it
 * does not invent its own notion of "what an agent is". Each iteration is
 * a `sandboxClient.create({ backend: { profile } })` + `box.streamPrompt`
 * call. The driver owns topology; the validator owns scoring; the output
 * adapter owns event-stream decode; the kernel owns iteration accounting,
 * concurrency, abort, cost aggregation, and trace emission.
 *
 * @experimental
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
  materializeTreeView,
  // The waits a journaled tree shows as armed but never woken — what a resumed run re-arms with
  // the ORIGINAL deadline. Exported for the same reason the replay readers are: a durable wait a
  // consumer cannot read back is only a log line.
  pendingWaits,
  replaySpawnTree,
} from '../durable/spawn-journal'
// The typed coordination-bus event (up: settled/question/finding; down: steer/answer) — surfaced
// here so a host folding the bus onto its own timeline (the supervise-topology observability) can
// type its `onEvent` subscriber without reaching into the `/mcp` subpath. `MakeWorkerAgent` rides
// alongside it: the worker-seam type `supervise`/`workerFromBackend` traffic in, so a host authoring
// its own seam types it from the loop layer rather than the `/mcp` subpath.
export type {
  AnalystFindingEvent,
  AnalystRegistry,
  CoordinationEvent,
  DownMessageEvent,
  MakeWorkerAgent,
} from './../mcp/tools/coordination'
export { DEFAULT_AWAIT_EVENT_TIMEOUT_MS } from './../mcp/tools/coordination'
export type { WorktreeCheckRunner, WorktreeHarnessResult } from './../mcp/worktree-harness'
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
// runProfileMatrix call (expandProfileAxes × loopDispatch × naiveDriver),
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
  type AgentTurnInput,
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
// The one router chat client (chat / chat-with-tools / off-box tool loop). `ToolSpec` is exported
// with the executor seam block below. `routerBrain` is the production supervisor BRAIN — the
// router's tool-calling as the canonical `ToolLoopChat` seam a `driverAgent` drives
// (tests script a mock `ToolLoopChat`, production passes `routerBrain(cfg)`).
export {
  type RouterChatResult,
  type RouterChatToolsResult,
  type RouterConfig,
  type RouterToolCall,
  type RouterToolLoopResult,
  routerBrain,
  routerChatWithTools,
  routerChatWithUsage,
  routerToolLoop,
} from './router-client'
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
// `runAgentRounds` is the multi-agent fanout/vote/refine kernel (many sandbox sessions per
// call). It is NOT `runToolLoop`/`streamToolLoop` (`/tool-loop`: one chat turn, tool calls
// folded back in) and NOT `routerToolLoop` (also on this subpath — router chat + tools).
// `runLoop`/`RunLoopOptions` are the pre-rename names, kept as deprecated aliases.
export {
  defaultSelectWinner,
  type RunAgentRoundsOptions,
  type RunLoopOptions,
  runAgentRounds,
  runLoop,
} from './run-loop'
export { type AcquireOptions, acquireSandbox } from './sandbox-acquire'
export {
  type CriuCapableClient,
  probeSandboxCapabilities,
  type SandboxCapabilities,
} from './sandbox-capabilities'
export {
  createSandboxToolPartState,
  extractLlmCallEvent,
  mapSandboxEvent,
  mapSandboxToolEvent,
  type SandboxToolPartState,
  sumSandboxUsage,
} from './sandbox-events'
export {
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
export {
  type ApplyContinuation,
  type DumbDriverOptions,
  dumbDriver,
  type NaiveDriverOptions,
  naiveDriver,
  type SteeringDecision,
} from './steering-drivers'
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
  type ShotPersona,
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
  authoredWorker,
  defaultProfileRichnessThresholds,
  type ProfileRichness,
  type ProfileRichnessThresholds,
  profileRichnessFinding,
  supervisorInstructions,
} from './supervise/authoring'
export {
  type BudgetPool,
  type BudgetReadout,
  createBudgetPool,
  type ReservationTicket,
  spendFromUsageEvents,
} from './supervise/budget'
// The completion-oracle: settled ⟺ DELIVERED. `gateOnDeliverable` wraps an executor so its
// settlement `valid` reflects a deployable deliverable check (a test/judge), never self-report.
export { type DeliverableSpec, gateOnDeliverable } from './supervise/completion-gate'
// The CHEAP / offline driver: an in-process router-tools loop that drives the coordination
// verbs over the Scope (no box, no creds). The CAPABLE driver is a sandbox agent with the
// coordination verbs mounted as an MCP — this is the low-cost + offline-testable variant.
export {
  type DriverAgentOptions,
  driverAgent,
  finalizeBestDelivered,
} from './supervise/coordination-driver'
// The durable coordination side-log a file-backed `RunContext` carries: the questions and analyst
// findings the spawn journal does not record, replayed into a resumed driver so a restarted
// coordinator keeps the coordination context its workers produced.
export {
  type CoordinationLog,
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
export {
  bestDelivered,
  collectDelivered,
  type DeliveredOutput,
  type FinalizeContext,
  type FinalizerSettled,
  pickBestDelivered,
  runFinalizer,
  runTree,
  type SupervisorFinalizer,
} from './supervise/finalizer'
// The down-leg receive end: a per-worker inbox an executor exposes as `Executor.deliver`; the loop
// drains it at the step boundary + before settle (queued) or aborts the turn (forceful interrupt).
export { createInbox, type Inbox, type InboxMessage } from './supervise/inbox'
// The fail-loud model-subset guard the front doors call: restrict a run to a chosen set of models.
export { assertModelAllowed } from './supervise/model-policy'
// The mechanical patch gate as a generic DeliverableSpec over the worktree-CLI patch artifact:
// no-op / always-on secret-path floor / forbidden-path / diff-size + required test/typecheck pass.
export { type PatchDeliverableOptions, patchDelivered } from './supervise/patch-deliverable'
// pi WRAPPED, not forked: `piExecutor` speaks pi's own out-of-process RPC protocol, so its
// steering queue, session persistence, abort, and compaction stay upstream's. Registered as
// runtime `'pi'` through the documented `ExecutorRegistry.register` extension point.
export {
  PI_RUNTIME,
  type PiSeam,
  piExecutor,
  piSeamKey,
} from './supervise/pi-executor'
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
// The durable, cross-process face of a run: the `<root>/.loops/supervisor/<id>` layout that
// published `traces analyze --supervisor-run-dir` reads. Promoted from the loops repo (#4519 in
// agent-dev-container) so the writer contract is published alongside its reader.
export {
  readWorkerSteerRequests,
  safeWorkerFile,
  supervisorRunDir,
  type WorkerSteerRequest,
  workerInboxFile,
  workerInboxFileFromEventDir,
  writeWorkerSteer,
} from './supervise/run-layout'
// The ONE built-in executor entrypoint: backend-as-data (`createExecutor({backend})`).
// The per-backend factories are internal case-arms; BYO agents implement `Executor`.
export {
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
  type SuperviseOptions,
  supervise,
  workerFromBackend,
} from './supervise/supervise'
export { createSupervisor } from './supervise/supervisor'
// Build a supervisor FROM its profile: the brain is resolved from `profile.harness` like
// `createExecutor({backend})` resolves a worker — `null` → the in-process router tool-loop,
// a coding-CLI harness → a sandboxed harness driving the coordination verbs. No hand-built brain.
export {
  type DriveHarness,
  type SupervisorAgentDeps,
  type SupervisorProfile,
  supervisorAgent,
} from './supervise/supervisor-agent'
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
  AgentSpec,
  Budget,
  Executor,
  ExecutorContext,
  ExecutorFactory,
  ExecutorRegistry,
  ExecutorResult,
  Handle,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  Restart,
  ResultBlobStore,
  ResumedKeyState,
  ResumedWork,
  RootHandle,
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
  SupervisedResult,
  Supervisor,
  SupervisorOpts,
  TreeView,
  UsageEvent,
  WaitOpts,
  WidenGate,
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
  failuresAnalyst,
  type SuperviseSurfaceOptions,
  type SuperviseSurfaceResult,
  type SurfaceWorkerConfig,
  type SurfaceWorkerOut,
  superviseSurface,
} from './supervise-surface'
export type { SandboxControlClient } from './tangle-sandbox-exact-process-provider'
// The driver-brain seam type a consumer scripts (a mock) or passes (`routerBrain`) into
// `DriverAgentOptions.brain` — the canonical one-inference-turn tool-loop chat. `ToolLoopCompaction`
// is the self-compaction config that bounds the brain's own context window (the supervisor chapter-close).
export type {
  ToolLoopChat,
  ToolLoopCompaction,
  ToolLoopCompactionOptions,
  ToolLoopMessageRecord,
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
