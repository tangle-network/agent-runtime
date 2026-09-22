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
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  AuthorizeDownMessage,
  AuthorizedDownMessage,
  ContinuationInstruction,
  CoordinationEvent,
  DownMessageAuthorizationInput,
  DownMessageDeliveryAttempt,
  DownMessageDeliveryOutcome,
  DownMessageEvent,
  MakeWorkerAgent,
  WorkerSpawnContext,
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
  type EnvelopeRuntimeEventsOptions,
  envelopeRuntimeEvents,
  type RuntimeEventIdentity,
  type RuntimeStreamEventEnvelope,
} from '../runtime-event-envelope'
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
  type ExecutePortableContextTransferOptions,
  executePortableContextTransfer,
  type PlanPortableContextOptions,
  type PortableContextPartDecisionInput,
  type PortableContextTransferExecution,
  planPortableContext,
} from './portable-context'
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
  type NativeContextContinuationExecution,
  type NativeContextContinuationInput,
  type ReconnectRetainedRunOptions,
  type RetainedRunCancellation,
  type RetainedRunCancelOptions,
  type RetainedRunEffect,
  type RetainedRunEventOptions,
  type RetainedRunHandle,
  type RetainedRunReplayPoint,
  type RetainedRunSnapshot,
  reconnectRetainedRun,
  type StartRetainedRunOptions,
  startRetainedRun,
} from './retained-run'
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
  streamRouterChatWithTools,
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
  mapSandboxCanonicalEvent,
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
  type SteeringDirectiveData,
  steeringDriver,
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
