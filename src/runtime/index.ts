/**
 *
 * Driven-loop runtime. `runAgentRounds` creates isolated runs through an
 * `AgentEnvironmentProvider`; it does not invent its own notion of an agent.
 * The driver owns planning, the validator owns scoring, the output adapter
 * decodes provider events, and the runtime owns iteration accounting,
 * concurrency, cancellation, cost aggregation, and trace emission.
 *
 * @experimental
 */

// The analyst-finding factory + id helper from the substrate, re-surfaced here so a host that builds
// findings on the coordination bus (the profile-richness gate, an online detector) does not need a
// separate agent-eval import. The taxonomy + firewall provenance live in agent-eval.
export { type AnalystFinding, computeFindingId, makeFinding } from '@tangle-network/agent-eval'
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
// alongside it so a host can type custom worker construction from the loop layer.
export type {
  AnalystRegistry,
  CoordinationEvent,
  MakeWorkerAgent,
} from './../mcp/tools/coordination'
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
  type Interval,
  type Leaderboard,
  type LeaderboardOptions,
  type LeaderboardRow,
  leaderboard,
  type PairwiseOptions,
  type PairwiseVerdict,
  pairwiseSignificance,
  renderLeaderboardHtml,
  renderLeaderboardMarkdown,
  renderLeaderboardSvg,
  renderPairwiseMarkdown,
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
export { createEnvironmentForSpec } from './environment-create'
export {
  createEnvironmentToolPartState,
  type EnvironmentToolPartState,
  extractEnvironmentFinalText,
  extractEnvironmentTurnText,
  extractLlmCallEvent,
  mapAgentEnvironmentEvent,
  mapEnvironmentToolEvent,
  notifyAgentEnvironmentEventObserver,
  sumEnvironmentUsage,
} from './environment-events'
export {
  createEnvironmentLineage,
  type EnvironmentLineage,
  type EnvironmentLineageHandle,
  turnEvents,
} from './environment-lineage'
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
  createAgentEnvironmentProviderRegistry,
  type ExecRequest,
  type ExecResult,
  type ForkRequest,
  type PlacementInfo,
  type ResourceRequest,
  resolveAgentEnvironmentProvider,
  type WorkspaceRequest,
} from './environment-provider'
export {
  type EnvironmentDeliverable,
  type EnvironmentRun,
  EnvironmentRunAbortError,
  type EnvironmentTurnOptions,
  type EnvironmentTurnResult,
  type OpenEnvironmentRunBeforeStartContext,
  type OpenEnvironmentRunOptions,
  openEnvironmentRun,
} from './environment-run'
export {
  type HarvestCorpusOptions,
  type HarvestFailure,
  type HarvestReport,
  harvestCorpus,
} from './harvest-corpus'
export {
  type InProcessEnvironmentProviderOptions,
  type InProcessOnTurn,
  type InProcessTurnContext,
  type InProcessTurnEvents,
  inProcessEnvironmentProvider,
} from './in-process-environment-provider'
export {
  type InlineEnvironmentProviderOptions,
  inlineEnvironmentProvider,
} from './inline-environment-provider'
// API-key provisioning for adopted external MCP servers: secrets ride the
// profile by NAME only; a KeyProvider resolves values at materialize time.
export {
  envKeyProvider,
  type KeyProvider,
  mcpSecretEnvMetadataKey,
  resolveSecretEnv,
  secretEnvOfMcpServer,
} from './key-provider'
// Same-host execution for trusted profiles whose stdio MCP servers must run
// against the current worktree.
export {
  type LocalEnvironmentProviderOptions,
  localEnvironmentProvider,
} from './local-environment-provider'
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
// Trace analysis and reusable learning records for supervised runs.
export {
  assertTraceDerivedFindings,
  buildSteerContext,
  type CreateScopeAnalystOptions,
  createScopeAnalyst,
  type RegistryAnalyzeProjection,
  registryScopeAnalyst,
} from './personify/analyst'
export {
  FileCorpus,
  InMemoryCorpus,
  renderCorpusToInstructions,
} from './personify/corpus'
export { equalKOnCost, trajectoryReport } from './personify/trajectory'
export type {
  AssertTraceDerivedFindings,
  Corpus,
  CorpusFilter,
  CorpusRecord,
  EqualKArm,
  EqualKOnCost,
  EqualKOnCostOptions,
  EqualKVerdict,
  RenderCorpusToInstructions,
  RenderCorpusToInstructionsOptions,
  ScopeAnalyst,
  ScopeAnalyzeInput,
  SteerContext,
  TrajectoryNode,
  TrajectoryReport,
  TrajectoryReportFn,
  TrajectoryReportOptions,
} from './personify/wave-types'
export {
  type PromotionGateOptions,
  type PromotionVerdict,
  promotionGate,
} from './promotion-gate'
export { reportLoopUsage, type UsageSink } from './report-usage'
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
  type ToolSpec,
} from './router-client'
export {
  type RouterEnvironmentProviderOptions,
  routerEnvironmentProvider,
} from './router-environment-provider'
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
// call). It is NOT `runToolLoop`/`streamToolLoop` (package root: one chat turn, tool calls
// folded back in) and NOT `routerToolLoop` (also on this subpath — router chat + tools).
export { defaultSelectWinner, type RunAgentRoundsOptions, runAgentRounds } from './run-loop'
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
  type ArtifactHandle,
  adaptiveRefine,
  breadthStrategy,
  type CorpusReadbackOptions,
  defineStrategy,
  depthStrategy,
  type EnvironmentScore,
  type EnvironmentTask,
  type EnvironmentTool,
  type RunStrategyOptions,
  refine,
  runStrategy,
  type ShotPersona,
  type ShotSpec,
  type Strategy,
  type StrategyCtx,
  type StrategyResult,
  type StrategyRunResult,
  type StrategyWorkerOptions,
  sample,
  sampleThenRefine,
  type TaskEnvironment,
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
  runStrategyEvolution,
  type StrategyEvolutionConfig,
  selectChampion,
} from './strategy-evolution'
export {
  type AgentTurnTarget,
  type AgentTurnUsage,
  type CollectedAgentTurn,
  collectAgentTurn,
  type StreamAgentTurnOptions,
  streamAgentTurn,
} from './stream-agent-turn'
// Sample candidates, rank them with task-visible checks, then repair within a fixed budget.
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
// One persistent provider session across turns so steering is applied at the
// next turn boundary without recreating the environment.
export {
  assertSteerableEnvironmentProvider,
  createSteerableEnvironmentSession,
  DEFAULT_ENVIRONMENT_STEERING_MAX_TURNS,
  type EnvironmentSteeringOptions,
  type SteerableEnvironmentArgs,
  type SteerableEnvironmentSession,
} from './supervise/environment-session'
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
export type {
  EnvironmentWorkerOptions,
  EnvironmentWorkerResult,
} from './supervise/runtime'
export { createScope, settledToIteration } from './supervise/scope'
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
export {
  type SuperviseOptions,
  supervise,
  workerFromEnvironment,
  workerFromExecutor,
} from './supervise/supervise'
export { createSupervisor } from './supervise/supervisor'
// Build a supervisor from its profile. A null harness uses the in-process router loop;
// a coding harness drives the coordination tools through its own environment.
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
  type SessionTraceBox,
  sandboxSessionTraceSource,
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
  NodeId,
  ResultBlobStore,
  ResumedWork,
  Runtime,
  Scope,
  Settled,
  SpawnEvent,
  SpawnJournal,
  SpawnOpts,
  Spend,
  SupervisedResult,
  Supervisor,
  SupervisorOpts,
  TreeView,
  UsageEvent,
  WidenGate,
} from './supervise/types'
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
// The worktree-CLI leaf executor: a supervisor-authored AgentProfile (systemPrompt + model)
// driving a local harness CLI on its own git worktree, surfaced as the open `Executor` port.
export {
  createWorktreeCliExecutor,
  type WorktreeCliExecutorOptions,
  type WorktreeCommandResult,
  type WorktreePatchArtifact,
  type WorktreeProfileMaterializationReceipt,
} from './supervise/worktree-cli-executor'
// `supervise()` specialized for a graded `TaskEnvironment` task: workers each `runStrategy` over the surface
// (refine by default), settle on the surface's own check, and feed the driver a self-improvement lens (the
// failing tests, by default) so the next spawn targets them. One capability over `supervise` + `runStrategy`.
export {
  failuresAnalyst,
  type SuperviseSurfaceOptions,
  type SuperviseSurfaceResult,
  type SurfaceWorkerConfig,
  type SurfaceWorkerOut,
  superviseSurface,
} from './supervise-surface'
// The driver-brain seam type a consumer scripts (a mock) or passes (`routerBrain`) into
// `DriverAgentOptions.brain` — the canonical one-inference-turn tool-loop chat. `ToolLoopCompaction`
// is the self-compaction config that bounds the brain's own context window (the supervisor chapter-close).
export type { ToolLoopChat, ToolLoopCompaction, ToolLoopCompactionOptions } from './tool-loop'
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
