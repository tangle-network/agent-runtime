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
export {
  type StreamAgentTurnEnvelopeOptions,
  streamAgentTurnEnvelopes,
} from './stream-agent-turn-envelope'
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
  canonicalizeAuthoredProfile,
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
// The completion-oracle: settled ⟺ DELIVERED. `gateOnDeliverable` wraps an executor so its
// settlement `valid` reflects a deployable deliverable check (a test/judge), never self-report.
export { type DeliverableSpec, gateOnDeliverable } from './supervise/completion-gate'
export {
  createFileSupervisorControlClient,
  createInProcessSupervisorControlClient,
  type SupervisorCancelInput,
  type SupervisorControlAcknowledgement,
  type SupervisorControlClient,
  type SupervisorControlClientOptions,
  type SupervisorControlEffect,
  type SupervisorControlEffectReceiver,
  type SupervisorControlEffectRequest,
  type SupervisorControlEffectResult,
  type SupervisorControlFiles,
  type SupervisorControlRoute,
  type SupervisorControlRouteOptions,
  type SupervisorControlSnapshot,
  type SupervisorControlStatus,
  type SupervisorControlTarget,
  type SupervisorSteerInput,
  type SupervisorWatchOptions,
  startSupervisorControlRoute,
  supervisorControlFiles,
  supervisorSteerCommandDigest,
} from './supervise/control'
// The CHEAP / offline driver: an in-process router-tools loop that drives the coordination
// verbs over the Scope (no box, no creds). The CAPABLE driver is an external harness with the
// coordination verbs mounted as an MCP: `supervise()` wires a local bridge automatically, while a
// remote sandbox requires an explicit reachable `driveHarness`.
export {
  type DriverAgentOptions,
  driverAgent,
  finalizeBestDelivered,
} from './supervise/coordination-driver'
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
} from './supervise/graph'
// The down-leg receive end: a per-worker inbox an executor exposes as `Executor.deliver`; the loop
// drains it at the step boundary + before settle (queued) or aborts the turn (forceful interrupt).
export { createInbox, type Inbox, type InboxMessage } from './supervise/inbox'
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
  legacySupervisorRunDir,
  legacySupervisorRunsRoot,
  readWorkerSteerRequests,
  safeWorkerFile,
  supervisorRunDir,
  supervisorRunsRoot,
  supervisorWorkersDir,
  type WorkerSteerRequest,
  workerControlLogFile,
  workerInboxFile,
  workerInboxFileFromEventDir,
  writeWorkerSteer,
} from './supervise/run-layout'
// The ONE built-in executor entrypoint: backend-as-data (`createExecutor({backend})`).
// The per-backend factories are internal case-arms; BYO agents implement `Executor`.
