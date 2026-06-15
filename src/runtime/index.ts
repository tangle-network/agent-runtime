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
// journal. Substrate types come from `./supervise/types`; the durable journal +
// replay live in `../durable/spawn-journal`.
export {
  contentAddress,
  FileResultBlobStore,
  FileSpawnJournal,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
  replaySpawnTree,
} from '../durable/spawn-journal'
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
  type HarvestCorpusOptions,
  type HarvestFailure,
  type HarvestReport,
  harvestCorpus,
} from './harvest-corpus'
// The one pseudo-box adapter: any non-box Executor → a SandboxClient for runLoop.
export { inlineSandboxClient } from './inline-sandbox-client'
export {
  type LoopDispatchOptions,
  type LoopOptionsForDispatch,
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
} from './personify/wave-types'
export {
  type PromotionGateOptions,
  type PromotionVerdict,
  promotionGate,
} from './promotion-gate'
export { reportLoopUsage, type UsageSink } from './report-usage'
// The one router chat client (chat / chat-with-tools / off-box tool loop).
// `ToolSpec` is exported with the executor seam block below.
export {
  type RouterChatResult,
  type RouterChatToolsResult,
  type RouterConfig,
  type RouterToolCall,
  type RouterToolLoopResult,
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
export type { RunLoopOptions } from './run-loop'
export { createSandboxForSpec, defaultSelectWinner, runLoop } from './run-loop'
export { acquireSandbox } from './sandbox-acquire'
export {
  type CriuCapableClient,
  probeSandboxCapabilities,
  type SandboxCapabilities,
} from './sandbox-capabilities'
export { extractLlmCallEvent, mapSandboxEvent } from './sandbox-events'
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
  type TurnResult,
} from './sandbox-run'
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
  breadthDriver,
  defineStrategy,
  depthDriver,
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
export {
  type BudgetPool,
  type BudgetReadout,
  createBudgetPool,
  type ReservationTicket,
  spendFromUsageEvents,
} from './supervise/budget'
// The CHEAP / offline driver: an in-process router-tools loop that drives the coordination
// verbs over the Scope (no box, no creds). The CAPABLE driver is a sandbox agent with the
// coordination verbs mounted as an MCP — this is the low-cost + offline-testable variant.
export {
  type CoordinationDriverOptions,
  coordinationDriverAgent,
  type DriverChat,
  type DriverMessage,
  type DriverToolCall,
  type DriverTurn,
} from './supervise/coordination-driver'
// The recursive driver-executor: a spawned child can BE a driver (agents drive agents),
// resolved through `withDriverExecutor` and run over a nested `Scope` one depth deeper on
// the SAME conserved pool.
export {
  driverChild,
  driverExecutorFactory,
  driverRuntime,
  isDriverSpec,
  withDriverExecutor,
} from './supervise/driver-executor'
// The ONE built-in executor entrypoint: backend-as-data (`createExecutor({backend})`).
// The per-backend factories are internal case-arms; BYO agents implement `Executor`.
export {
  type BridgeSeam,
  type CliSeam,
  createExecutor,
  createExecutorRegistry,
  type ExecutorConfig,
  type RouterSeam,
  type RouterToolsSeam,
  type SandboxSeam,
  type ToolSpec,
} from './supervise/runtime'
export {
  createScope,
  type NestedScopeSeam,
  nestedScopeSeamKey,
  settledToIteration,
} from './supervise/scope'
export {
  createRootHandle,
  createSupervisor,
} from './supervise/supervisor'
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
  RootHandle,
  RootSignal,
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
  OutputAdapter,
  SandboxClient,
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
  type Shell,
  type Workspace,
  type WorkspaceCommit,
} from './workspace'
