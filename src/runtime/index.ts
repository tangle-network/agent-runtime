/**
 * @experimental
 *
 * Driven-loop substrate. `runLoop` orchestrates around the sandbox SDK; it
 * does not invent its own notion of "what an agent is". Each iteration is
 * a `sandboxClient.create({ backend: { profile } })` + `box.streamPrompt`
 * call. The driver owns topology; the validator owns scoring; the output
 * adapter owns event-stream decode; the kernel owns iteration accounting,
 * concurrency, abort, cost aggregation, and trace emission.
 */

// The analyst-finding factory + id helper from the substrate, re-surfaced here so a host that builds
// findings on the coordination bus (the profile-richness gate, an online detector) does not need a
// separate agent-eval import. The taxonomy + firewall provenance live in agent-eval.
export { type AnalystFinding, computeFindingId, makeFinding } from '@tangle-network/agent-eval'
// One-stop import: sandbox-SDK types consumers need to spell out an
// `AgentRunSpec` without importing `@tangle-network/sandbox` separately.
export type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
// Two substrates for the same "recursive agent decision" atom, both exported here (per
// docs/architecture.md): canonical = the reactive `Scope`/`Supervisor` + the personify
// combinators (budget-conserving, equal-k by construction — prefer for new recursive work);
// the round-synchronous `runLoop` kernel = the path most benches still drive, with a
// caller-supplied `Driver` (fixed-shape or scripted) authoring the per-round topology.
// Recursive execution atom (the keystone): the open `Executor` runtime, the
// budget-conserving reactive `Scope`, the event-sourced `Supervisor`, and the spawn
// journal. Substrate types come from `./supervise/types`; the in-memory journal +
// blob store live in `../durable/spawn-journal`.
export {
  contentAddress,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../durable/spawn-journal'
// The typed coordination-bus event (up: settled/question/finding; down: steer/answer) — surfaced
// here so a host folding the bus onto its own timeline (the supervise-topology observability) can
// type its `onEvent` subscriber without reaching into the `/mcp` subpath. `MakeWorkerAgent` rides
// alongside it: the worker-seam type `supervise`/`workerFromBackend` traffic in, so a host authoring
// its own seam types it from the loop layer rather than the `/mcp` subpath.
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
// runLoop / openSandboxRun (the typed offline seam, no SandboxInstance cast).
export {
  type InProcessOnPrompt,
  type InProcessPromptCtx,
  type InProcessSandboxClientOptions,
  inProcessSandboxClient,
} from './in-process-sandbox-client'
// The one pseudo-box adapter: any non-box Executor → a SandboxClient for runLoop.
export { inlineSandboxClient } from './inline-sandbox-client'
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
export { defaultSelectWinner, runLoop } from './run-loop'
export { acquireSandbox } from './sandbox-acquire'
export {
  type CriuCapableClient,
  probeSandboxCapabilities,
  type SandboxCapabilities,
} from './sandbox-capabilities'
export { extractLlmCallEvent, mapSandboxEvent, sumSandboxUsage } from './sandbox-events'
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
  type OpenSandboxRunOptions,
  openSandboxRun,
  type SandboxRun,
  SandboxRunAbortError,
  type TurnResult,
} from './sandbox-run'
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
  defineStrategy,
  depthStrategy,
  type RunAgenticOptions,
  refine,
  runAgentic,
  type ShotPersona,
  type ShotSpec,
  type Strategy,
  type StrategyCtx,
  type StrategyResult,
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
  runStrategyEvolution,
  type StrategyEvolutionConfig,
  selectChampion,
} from './strategy-evolution'
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
// The one-call in-memory store bundle for a supervised run: a fresh journal + blob store +
// executor registry, shaped to spread straight into `SupervisorOpts`. `{ withDriver: true }`
// wraps the registry for the recursive agents-drive-agents path.
export {
  createInMemoryRunContext,
  type InMemoryRunContext,
  type InMemoryRunContextOptions,
} from './supervise/run-context'
// The ONE built-in executor entrypoint: backend-as-data (`createExecutor({backend})`).
// The per-backend factories are internal case-arms; BYO agents implement `Executor`.
export {
  cliWorktreeExecutor,
  createExecutor,
  createExecutorRegistry,
  type ExecutorConfig,
  type ProviderSeam,
  type ToolSpec,
} from './supervise/runtime'
export { createScope, settledToIteration } from './supervise/scope'
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
  ResultBlobStore,
  Runtime,
  Scope,
  Settled,
  Spend,
  SupervisedResult,
  Supervisor,
  SupervisorOpts,
  TreeView,
  UsageEvent,
  WidenGate,
} from './supervise/types'
// The worktree-CLI leaf executor: a supervisor-authored AgentProfile (systemPrompt + model)
// driving a local harness CLI on its own git worktree, surfaced as the open `Executor` port.
export {
  createWorktreeCliExecutor,
  type WorktreeCliExecutorOptions,
  type WorktreeCommandResult,
  type WorktreePatchArtifact,
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
