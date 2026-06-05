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
// Recursive execution atom (the keystone): the open `LeafExecutor` runtime, the
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
  type CompletionAnalyst,
  type CompletionEvidence,
  type CompletionPolicy,
  type CompletionVerdict,
  completionAuthorizes,
  deterministicCompletion,
  sentinelCompletion,
  stopSentinel,
} from './completion'
export type {
  AnalyzeInput,
  CreateDynamicDriverOptions,
  DynamicDecision,
  HistorySummaryRow,
  PlannerContext,
  TopologyMove,
  TopologyPlanner,
} from './drivers/dynamic'
export { createDynamicDriver, renderAnalyses, summarizeHistory } from './drivers/dynamic'
export type {
  CreateFanoutVoteDriverOptions,
  FanoutVoteDecision,
  FanoutVoteScored,
} from './drivers/fanout-vote'
export { createFanoutVoteDriver, scoreFanoutVoteIterations } from './drivers/fanout-vote'
export type { CreateRefineDriverOptions, RefineDecision } from './drivers/refine'
export { createRefineDriver, refineWinnerIndex } from './drivers/refine'
export type {
  CreateSandboxPlannerOptions,
  TopologyMoveEnvelope,
} from './drivers/sandbox-planner'
export { createSandboxPlanner } from './drivers/sandbox-planner'
export {
  type LoopDispatchOptions,
  type LoopOptionsForDispatch,
  loopDispatch,
} from './loop-dispatch'
// The personify layer + the RSI wave built on the recursive keystone: the persona content seam
// (`definePersona`/`runPersonified`), the open shape registry, the content-free generic
// combinators, the cross-run corpus, the analyst-on-scope steer firewall, and the trajectory +
// equal-k-on-cost ledger. The wave's type contracts live in `./personify/wave-types`.
export {
  assertTraceDerivedFindings,
  buildSteerContext,
  type CreateScopeAnalystOptions,
  createScopeAnalyst,
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
export { createShapeContext, definePersona, runPersonified } from './personify/persona'
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
// The recursive execution atom owns the headline `Agent` (re-exported from
// `./supervise/types` below). The program op-set's static-tree atom is a distinct
// concept (`act` returns a `Program`), surfaced as `ProgramAgent`.
export type {
  Agent as ProgramAgent,
  Program,
  ProgramResult,
  RunProgramOptions,
} from './program'
export {
  agentProgramPlanner,
  compileProgram,
  flattenProgram,
  isStraightLine,
  runAgent,
  runProgram,
} from './program'
export { reportLoopUsage, type UsageSink } from './report-usage'
export type { RunLoopOptions } from './run-loop'
export { createSandboxForSpec, defaultSelectWinner, runLoop } from './run-loop'
export { type AcquireOptions, acquireSandbox } from './sandbox-acquire'
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
  type BudgetPool,
  type BudgetReadout,
  createBudgetPool,
  type ReservationTicket,
  spendFromUsageEvents,
} from './supervise/budget'
export {
  type CliSeam,
  cliExecutor,
  createExecutorRegistry,
  type RouterSeam,
  routerInlineExecutor,
  type SandboxSeam,
  sandboxExecutor,
} from './supervise/runtime'
export { createScope, type ScopeArgs, settledToIteration } from './supervise/scope'
export {
  createRootHandle,
  createSupervisor,
} from './supervise/supervisor'
export type {
  Agent,
  AgentSpec,
  Budget,
  ExecutorContext,
  ExecutorRegistry,
  Handle,
  LeafExecutor,
  LeafExecutorFactory,
  LeafResult,
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
  LoopSandboxClient,
  LoopSandboxPlacement,
  LoopStartedPayload,
  LoopTeardownFailedPayload,
  LoopTokenUsage,
  LoopTraceEmitter,
  LoopTraceEvent,
  LoopWinner,
  OutputAdapter,
  ValidationCtx,
  Validator,
} from './types'
