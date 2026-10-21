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

// Whole-interface exports publish the owner API, including future additions.

// The analyst-finding factory + id helper from the substrate, re-surfaced here so a host that builds
// findings on the coordination bus (the profile-richness gate, an online detector) does not need a
// separate agent-eval import. The taxonomy + firewall provenance live in agent-eval.
export { type AnalystFinding, computeFindingId, makeFinding } from '@tangle-network/agent-eval'
// One-stop import: portable profile plus Sandbox execution types Runtime consumers need.
export type { AgentProfile } from '@tangle-network/agent-interface'
export type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentQuery,
  AgentEnvironmentStatus,
  AgentEnvironmentSummary,
  AgentSession,
  AgentSessionRef,
  AgentSessionStatus,
  AgentTurnResult,
  CheckpointRef,
  CheckpointRequest,
  CreateAgentEnvironmentInput,
  ExecRequest,
  ExecResult,
  ForkRequest,
  PlacementInfo,
  ResourceRequest,
  WorkspaceRequest,
} from '@tangle-network/agent-interface/environment-provider'
export type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
export { assertProfileMaterializes } from '../agent/profile-materialization'
export { contentAddress } from '../durable/content-address'
export { InMemoryResultBlobStore, InMemorySpawnJournal } from '../durable/in-memory-spawn-stores'
export { FileSpawnJournal } from '../durable/spawn-journal/journal-store'
export { replaySpawnTree } from '../durable/spawn-journal/replay'
export { FileResultBlobStore } from '../durable/spawn-journal/result-blob-store'
export { loadSpawnForest } from '../durable/spawn-journal/spawn-forest'
export { materializeTreeView } from '../durable/spawn-journal/tree-view'
export { openSqlRunStore } from '../durable/sql-run-store'
// The typed coordination-bus event (up: settled/question/finding; authorized instruction receipt;
// down: steer/answer delivery outcome) — surfaced here so a host folding the bus onto its own timeline can
// type its `onEvent` subscriber without reaching into the `/mcp` subpath. `MakeWorkerAgent` rides
// alongside it: the worker-seam type `supervise`/`workerFromBackend` traffic in, so a host authoring
// its own seam types it from the loop layer rather than the `/mcp` subpath.
export type { AnalystRegistry } from '../mcp/tools/coordination-analysts'
export type {
  MakeWorkerAgent,
  SuperviseProfileEntry,
  WorkerSpawnContext,
} from '../mcp/tools/coordination-contracts'
export type { CoordinationEvent } from '../mcp/tools/coordination-events'
// Re-exported on the KERNEL entry, not only the package root: a `supervise` caller imports
// `@tangle-network/agent-runtime/kernel`, so an exporter reachable only from the root is an
// exporter that caller cannot pass to `SupervisorOpts.otel` — the recorder above would have had
// nowhere to write without standing up an OTLP collector first.
export { createOtelExporter } from '../otel-export'
export { runAgentRounds } from './agent-rounds'
// The best-so-far / AUC / plateau math, extracted so the LIVE progress-based stop rules
// (`supervise/stop-rules`) decide from the SAME numbers the post-run report grades them by.
export * from './anytime'
// The domain-agnostic benchmark report engine: a fleet of `RunRecord`s → a ranked leaderboard, the full
// profile×axis score matrix, and embeddable SVG/HTML charts (the hosted-leaderboard surface). Reads only
// the universal `RunRecord` currency, so it reports ANY benchmark in ANY domain.
export * from './benchmark-report'
export { createCodeModeTools, runCodeMode } from './code-mode'
// codex's own rollout store, read as a spend receipt. The reader is public because a harness store
// is evidence a caller may need OUTSIDE a live run — reconciling a finished run, or auditing a seat
// whose transport forwarded no usage at all.
export * from './codex-rollout-store'
export * from './completion'
// A record's declared check: the frozen evaluator program Runtime runs in a fresh box on the
// check account, as a manager's completion check and as a version chain's judge.
export * from './declared-check'
// The declarative eval-leaderboard facade: cases + prompt + score → one
// runProfileMatrix call (expandProfileAxes × loopDispatch × the naive retry driver),
// with a structural BenchmarkAdapter view via toBenchmarkAdapter().
export {
  type DefinedLeaderboard,
  defineLeaderboard,
  type LeaderboardRunContext,
  type LeaderboardScenario,
  type LeaderboardSpec,
} from './define-leaderboard'
export {
  type ProviderExecutorOptions,
  type ProviderLeafOut,
  type ProviderPromptOptions,
  providerAsExecutor,
} from './environment-provider/provider-executor-admission'
export {
  type AgentEnvironmentProviderRegistry,
  createAgentEnvironmentProviderRegistry,
  resolveAgentEnvironmentProvider,
} from './environment-provider/provider-registry'
export { providerAsSandboxClient } from './environment-provider/provider-sandbox-adapter'
// Two substrates for the same "recursive agent decision" atom, both exported here (per
// docs/architecture.md): canonical = the reactive `Scope`/`Supervisor` + the personify
// combinators (budget-conserving, equal-k by construction — prefer for new recursive work);
// the round-synchronous `runAgentRounds` kernel = the path most benches still drive, with a
// caller-supplied `Driver` (fixed-shape or scripted) authoring the per-round topology.
// Recursive execution atom (the keystone): the open `Executor` runtime, the
// budget-conserving reactive `Scope`, the event-sourced `Supervisor`, and the spawn
// journal. Substrate types come from `./supervise/types`; the journal + blob store
// impls live in `../durable/spawn-journal`.
// Both pairs are exported: the in-memory stores (tests / scratch / a run that need not
// outlive its process) AND the file-backed stores that make a run RESUMABLE. Without the
// durable pair on the public surface a consumer cannot resume at all — and the one that
// tried wrote its own half-working copy, whose `loadTree` never read the file back. The
// replay readers ship with them, because a durable journal you cannot fold back into a
// tree is only a log.
export {
  captureHarnessTranscript,
  harnessTranscriptArtifact,
  persistHarnessTranscript,
  resolveHarnessTranscriptCapture,
  retainHarnessTranscript,
} from './harness-transcript'
// Per-harness usage decoders: the ONE registry of harnesses that report token usage only inside
// their own event, read alongside the canonical usage events by `createSandboxUsageLedger`. Only
// the composite is public, as with `decodeToolPart` — the registry and its entries stay internal
// so a harness is added in one place.
export { decodeHarnessUsage } from './harness-usage'
export * from './harvest-corpus'
// The in-process pseudo-box: a user `onPrompt` callback → a SandboxClient for
// runAgentRounds / openSandboxRun (the typed offline seam, no SandboxInstance cast).
export * from './in-process-sandbox-client'
// The one pseudo-box adapter: any non-box Executor → a SandboxClient for runAgentRounds.
export { inlineSandboxClient } from './inline-sandbox-client'
export * from './isolated-checker'
// `runAgentRounds` is the multi-agent fanout/vote/refine kernel over many sandbox sessions.
// It is distinct from `runToolLoop`/`streamToolLoop`, which execute one chat turn and fold
// tool results back into that same conversation.
export { defaultSelectWinner, TERMINAL_DECISIONS, type TerminalDecision } from './iteration-result'
// API-key provisioning for adopted external MCP servers: secrets ride the
// profile by NAME only; a KeyProvider resolves values at materialize time.
export * from './key-provider'
export { loopCampaignDispatch, loopDispatch, superviseDispatch } from './loop-dispatch'
export * from './mcp-environment'
export { observationFromRegistry } from './observation-registry'
// The third-person observer: a worker's trace → trace-grounded findings, an
// operator report, and durable corpus facts for the next run (the closed loop).
export * from './observe'
// The personify layer + the RSI wave built on the recursive keystone: the persona content seam
// (`definePersona`/`runPersonified`), the open shape registry, the content-free generic
// combinators, the cross-run corpus, the analyst-on-scope steer firewall, and the trajectory +
// equal-k-on-cost ledger. The wave's type contracts live in `./personify/wave-types`.
export * from './personify/analyst'
export * from './personify/combinators'
export {
  FileCorpus,
  InMemoryCorpus,
  renderCorpusToInstructions,
} from './personify/corpus'
export { definePersona, runPersonified } from './personify/persona'
export { equalKOnCost, trajectoryReport } from './personify/trajectory'
export type * from './personify/types'
export type {
  CombinatorShape,
  Corpus,
  CorpusRecord,
  EqualKArm,
  EqualKVerdict,
  Panel,
  PanelJudge,
  TrajectoryNode,
  TrajectoryReport,
  Verify,
  Widen,
  WinnerStrategy,
} from './personify/wave-types'
export * from './private-cas'
// Agent-eval integrations (judges, optimizers) use this exact-profile adapter instead of opening
// a second provider path. It lowers one AgentProfile through createExecutor + streamAgentTurn.
export { profileChatClient, profileOptimizerModelCall } from './profile-chat-client'
export type {
  ProviderWorkspaceRetentionContext,
  ProviderWorkspaceRetentionPort,
} from './provider-workspace-retention'
export * from './resolve-sandbox-client'
export * from './retained-interactive'
export * from './retained-interactive-control'
export type * from './retained-interactive-types'
export {
  reconnectRetainedRun,
  recoverRetainedRun,
  startRetainedRun,
  startRetainedRunInEnvironment,
} from './retained-run-start'
export type * from './retained-run-types'
// Router requests are an internal transport adapter. Public execution always enters through an
// exact AgentProfile (`createExecutor` + `streamAgentTurn`); callers may configure only the
// endpoint/auth transport used by that path.
export type { RouterTransportConfig } from './router-http-transport'
export type { ToolSpec } from './router-request-body'
export {
  type BenchmarkCell,
  type BenchmarkReport,
  type Environment,
  printBenchmarkReport,
  runBenchmark,
} from './run-benchmark'
// The product-facing backend selector: one call picks sandbox/bridge/router transport.
export * from './s3-private-cas-store'
export { acquireSandbox } from './sandbox-acquire'
export { extractLlmCallEvent, type SandboxUsageLedger, sumSandboxUsage } from './sandbox-events'
export {
  createSandboxToolPartState,
  mapSandboxEvent,
  mapSandboxToolEvent,
} from './sandbox-executor-output'
export { createSandboxLineage, type SandboxLineage } from './sandbox-lineage'
export * from './sandbox-run'
// Many workers per Sandbox box, each as its own harness process with its own directory.
export {
  DEFAULT_SHARED_BOX_RESOURCES,
  DEFAULT_SHARED_BOX_WORKERS,
  type SharedBoxPlacementOptions,
  sharedBoxPlacement,
} from './shared-box'
export { ROUTER_CLIENT_HEADER, sharedBoxRefusal, sharedWorkerClientName } from './shared-box-worker'
// Same-host stdio MCP: the ONE spawn+handshake connection (shared by the serve
// verifier and the live consumers) + the profile.mcp materializer.
export * from './stdio-mcp-client'
// The optimization suite: a domain = an Environment (5 hooks); a Strategy = how the
// budget is spent to beat its check. Built-ins `sample`/`refine`; author your own with
// `defineStrategy` (compose shot() + critique(), zero Supervisor ceremony); compare
// with runBenchmark. The depth/breadth drivers are the reference implementations.
export {
  type AgenticSurface,
  type AgenticTask,
  type AgenticTool,
  type ArtifactHandle,
  breadthStrategy,
  depthStrategy,
  refine,
  runAgentic,
  type SurfaceScore,
  sample,
} from './strategy'
export {
  adaptiveRefine,
  assertStrategyContract,
  authorStrategy,
  defineStrategy,
  type Strategy,
  sampleThenRefine,
  strategyAuthorContract,
  strategyAuthorSystemPrompt,
} from './strategy-author'
export * from './strategy-evolution'
export {
  type AgentTurnBackend,
  type AgentTurnInput,
  type AgentTurnUsage,
  type CollectedAgentTurn,
  collectAgentTurn,
  streamAgentTurn,
} from './stream-agent-turn'
// The structural lever as a strategy-family member: k samples → select by task-visible checks
// (official above authored, crash lowest) → guarded repair steered by the checks' failure output.
// Measured +8..+21pp hidden-test lift (docs/design/structural-rollout-integration.md).
export * from './structural-rollout'
// The supervisor's intelligence: it AUTHORS each worker's profile (instructions + model) from a
// SKILL (its own system prompt) — the optimizable self-improvement surface, not the plumbing.
export * from './supervise/authoring'
export {
  type BudgetPool,
  type BudgetReadout,
  createBudgetPool,
  type ReservationTicket,
} from './supervise/budget'
// The chat-transport leaf (#721): a worker that IS a model conversation on a bare
// OpenAI-compatible /v1/chat/completions endpoint — no sandbox. Ships with its session store and
// the continuity-honoring `makeWorkerAgent` seam. `workerFromBackend` resumes only bridge-backed
// workers; this leaf resumes its own sessions, so conversation graphs and chat-shot loops
// compose from data on any transport.
export * from './supervise/chat-transport-executor'
// ONE CHECK, ONE RESEND RULE, ONE NOTE: the check's verdict, the continuation policy a manager
// with a check must declare, and the note Runtime writes from the verdict. The profile owns every
// instruction word; a play may append a section but never replace one.
export type { CheckVerdict } from './supervise/completion-gate'
// The completion-oracle: settled ⟺ DELIVERED. `gateOnDeliverable` wraps an executor so its
// settlement `valid` reflects a deployable deliverable check (a test/judge), never self-report.
export * from './supervise/completion-gate'
export { admitContinuationPolicy, type ContinuationPolicy } from './supervise/continuation'
export type * from './supervise/contracts/accounting'
export type * from './supervise/contracts/agent-scope'
export type * from './supervise/contracts/execution-events'
export type * from './supervise/contracts/execution-identity'
export type * from './supervise/contracts/executor-construction'
export type * from './supervise/contracts/executor-port'
export type * from './supervise/contracts/node-lifecycle'
export type * from './supervise/contracts/spawn-journal'
export type * from './supervise/contracts/supervisor-port'
export type * from './supervise/contracts/supervisor-result'
// The durable coordination side-log a file-backed `RunContext` carries: questions, findings, answer
// decisions, and authorized continuation receipts the spawn journal does not own. Receipts persist
// as evidence and are never auto-delivered to a replacement worker.
export { type CoordinationLog, FileCoordinationLog } from './supervise/coordination-log'
// Supervisor-as-MCP: serve the coordination verbs as a real HTTP MCP over a live Scope, so any
// harness (claude-code / codex / opencode) BECOMES the supervisor by mounting one MCP server.
export { serveCoordinationMcp } from './supervise/coordination-mcp'
// The one generic delegation verb: hand it an INTENT, it routes to `supervise()` with a default
// authoring supervisor (no hardcoded worker profile) and returns the `SupervisedResult` unchanged —
// so `spentTotal` (what the delegation cost) rides straight back.
export * from './supervise/delegate'
// The designer's toolset on the existing extraTools seam: lookup / run-and-record / history.
export * from './supervise/designer-tools'
// The ONLINE analyst: watch a TraceSource and raise a `finding` the moment a worker loops/error-storms.
export * from './supervise/detector-monitor'
// REFILLING dispatch: hold N children in flight and admit the next queued unit the moment one
// settles, instead of draining a whole round (`fanout`) or opening one worker per driver turn.
// `freeSlots` is the reading the driver sees.
export * from './supervise/dispatch'
export type { DriverRetryPolicy } from './supervise/driver-retry'
// The child→parent message bus: the one typed pipe carrying settled outputs, questions, and
// analyst findings up to the driver (pass-through + queued lanes, transport-agnostic).
export * from './supervise/event-bus'
// FINALIZATION: how a driver's settled-worker ledger becomes the run's output. `bestDelivered` is
// the default and the unchanged keep-best; `collectDelivered` returns every verified distinct
// output with provenance (competing hypotheses, a Pareto set, a recorded evaluator split). Any
// finalizer runs under the delivered-only invariant — an undelivered or invalid child's output is
// unreachable, whatever the finalizer wants.
// `runTree` is deliberately absent: it merges a resumed run's committed nodes into the live view,
// and the supervisor applies it before returning, so `SupervisedResult.tree` already carries the
// merged tree. Exporting it added a `run*` name that read as a second graph runtime.
export { bestDelivered } from './supervise/finalizer'
// Agent graphs: profiles as nodes, registry-backed prompt directives as typed edges, every
// traversal ledgered. An interpretation layer over `supervise()` (the execution core), never a
// second scheduler — driver↔worker is the 2-node cyclic instance.
export {
  type AgentGraph,
  defaultEdgeTraversalCap,
  type EdgeTraversal,
  type GateDecision,
  type GateRequest,
  type GraphEdge,
  GraphEdgeCapError,
  type GraphNode,
  type GraphResult,
  GraphRouteError,
  type GraphTopology,
  type RouteWhen,
  type RunGraphOptions,
  runGraph,
} from './supervise/graph'
// The designer's memory: graphs and their outcomes as files in a workspace, so a rerun over
// the same sandbox replays a known-good graph (near-zero inference) or authors a better one.
export * from './supervise/graph-registry'
// The in-place CLI leaf executor: the same authored AgentProfile on the same local harness CLI,
// running in a workspace the CALLER supplies, so the edits stay in that directory for the next
// spawn. `createExecutor({ backend: 'cli-in-place', workspacePath })` routes to this leaf.
export * from './supervise/in-place-cli-executor'
// The down-leg receive end: a per-worker inbox an executor exposes as `Executor.deliver`; the loop
// leases it at the step boundary + before settle (queued) or aborts the turn (forceful interrupt),
// and answers each sender `consumed` or `failed`.
export type { Inbox } from './supervise/inbox'
/** Provider-backed native interactive workers. Runtime owns admission and control identity; the
 * provider owns the environment and process. */
export * from './supervise/interactive-worker'
// OPT-IN OTLP tracing for a supervised tree: a pure `RuntimeHooks` observer that turns the
// lifecycle events `Scope` already emits into one span per node (opened at spawn, closed at settle,
// parented to its parent node's span) plus an LLM child span per metered driver turn. A span with a
// `parent_span_id` IS a tree, so the supervisor becomes readable by the same viewer as every other
// multi-agent shape — with no per-system reader. Telemetry only: the spawn journal remains the sole
// replay/resume record, and nothing here is ever read back.
export * from './supervise/otel-spans'
// PEER MAIL: the bounded, audited sibling channel. A worker reaches a live sibling through the
// parent's post office — typed envelopes, per-sender and per-receiver caps, a reply-depth ceiling,
// and an authority marking that keeps a peer's message from reading as the supervisor's.
export * from './supervise/peer-mail'
// Named AgentProfiles with run receipts: which prompt revision is winning, per name.
export * from './supervise/profile-registry'
// The LIVE read-model of a RUNNING worker — last activity, idle time, derived stall, turns,
// tokens so far, recent tool/file activity, unread steers. What `observe_agent` now returns
// mid-flight, and the evidence a supervisor steers FROM.
export {
  type ActivityNote,
  createActivityLog,
  DEFAULT_STALL_AFTER_MS,
  readWorkerProgress,
  type ScopeProgressInput,
  type WorkerProgress,
} from './supervise/progress'
// The kernel prompt registry: versioned prompt text as data (`<surface>/v<n>`), the directive
// store graph edges and the supervisor front doors resolve against.
export * from './supervise/prompt-registry'
// One-call durable Runtime owner for external clients that need a real root, one interactive worker,
// the worker control acknowledger, and an exact cleanup receipt. Braid consumes this surface and
// never writes `.agent/supervisor` itself.
export * from './supervise/provision-supervisor'
// What a re-entered external driver is told, composed from the coordinator's own records and the
// drive harness's statement of what the next drive continues.
export * from './supervise/reentry'
export * from './supervise/remote-supervisor'
export {
  cancelRun,
  type RunCancellation,
  readRunCancellation,
  readRunCancelRequest,
} from './supervise/run-cancellation'
// The one-call store bundle for a supervised run: a journal + blob store + executor registry,
// shaped to spread straight into `SupervisorOpts`. `createInMemoryRunContext` is the default
// (fresh, process-lifetime); `createFileRunContext(dir)` is the durable one — file-backed stores
// plus `resume: true`, so re-running the same `runId` against the same `dir` picks up the
// children that already settled instead of re-running them. `{ withDriver: true }` wraps the
// registry for the recursive agents-drive-agents path.
export * from './supervise/run-context'
// The durable, cross-process face of a run: the `<root>/.agent/supervisor/<id>` layout that
// published `traces analyze --supervisor-run-dir` reads (`.loops/…` is the pre-rename location
// readers fall back to). Promoted from the loops repo (#4519 in agent-container) so the
// writer contract is published alongside its reader.
export {
  cancelWorker,
  legacySupervisorRunDir,
  readWorkerCancellation,
  readWorkerSteerAcknowledgement,
  readWorkerSteerRequests,
  safeWorkerFile,
  supervisorRunDir,
  supervisorRunsRoot,
  type WorkerCancellation,
  type WorkerSteerAcknowledgement,
  type WorkerSteerRequest,
  type WriteWorkerSteerOptions,
  workerInboxFileFromEventDir,
  writeWorkerSteer,
} from './supervise/run-layout'
// The ONE built-in executor entrypoint: backend-as-data (`createExecutor({backend})`).
// The per-backend factories are internal case-arms; BYO agents implement `Executor`.
export {
  type BridgeModelCredential,
  type CliInPlaceSeam,
  type CliWorktreeBridgeSeam,
  createExecutor,
  createExecutorRegistry,
  type ExecutorConfig,
  type ProviderSeam,
  type RouterSeam,
  type SandboxSeam,
} from './supervise/runtime'
// The STEERABLE sandbox worker: one box, one server-side session, many turns — so a steer has a
// turn boundary to be folded into and the default cloud worker becomes correctable mid-flight.
export * from './supervise/sandbox-session'
export { createScope, settledToIteration } from './supervise/scope'
// One data value per multi-agent research configuration (seven axes, a canonical digest, five
// presets) and the compiler that maps it onto exactly one `supervise` or `runGraph` call.
export * from './supervise/search-spec'
export type { SeatSegment, SeatStage } from './supervise/seat-chain'
export { subscriptionUsageLimitSignal } from './supervise/seat-chain'
// The fenced, cross-machine variant: one compare-and-set head, generation fencing, lease
// heartbeats, lost-ack recovery, and a SQL coordination side-log. @experimental.
export * from './supervise/sql-run-context'
// PROGRESS-BASED STOP RULES: end a long-horizon run because it stopped learning, not because it ran
// out. Enforcement lives here; the thresholds are the caller's policy. Composes with (and can never
// override) the conserved-pool / deadline / abort ceilings.
export {
  allWorkersStalled,
  anyOf,
  noProgressFor,
  plateau,
  type StopDecision,
  type StopRule,
} from './supervise/stop-rules'
// The one-call "just invoke the supervisor": `supervise(profile, task, { backend, budget })` with
// sensible defaults (blobs/perWorker/journal/executors). `workerFromBackend` derives the worker seam
// from a backend config + an optional completion oracle (settled⟺delivered).
export {
  type SuperviseOptions,
  type SuperviseRegistry,
  type SuperviseRegistryTable,
  supervise,
  superviseFleetCapabilities,
  workerFromBackend,
} from './supervise/supervise'
export { createRootHandle, createSupervisor, DEFAULT_MAX_DEPTH } from './supervise/supervisor'
// Build a supervisor FROM its profile: the brain is resolved from `profile.harness` like
// `createExecutor({backend})` resolves a worker — omitted/`cli-base` → the in-process router tool-loop,
// a coding-CLI harness → a sandboxed harness driving the coordination verbs. No hand-built brain.
export {
  type CoordinationVerbs,
  type DriveHarness,
  type ResolveSupervisorTools,
  type SupervisorNodeContext,
  type SupervisorProfile,
  type SupervisorToolDescriptor,
  type SupervisorToolInvocationContext,
  supervisorAgent,
} from './supervise/supervisor-agent'
export { parseWorkerToolTraceArtifact } from './supervise/trace-evidence'
// The Merkle root over the events a turn archived. Journal records carry its receipt beside the
// `outRef` it commits to; the artifact under `traceRoot.ref` holds every leaf and salt.
export {
  TRACE_ROOT_SCHEMA,
  TRACE_SUMMARY_SCHEMA,
  type TraceRootArtifact,
  type TraceSummary,
} from './supervise/trace-root'
// The substrate-agnostic trace source: a worker's tool calls as agent-eval `ToolSpan`s, from an
// OWNED loop (push) OR a sandbox box session (message parts). The common currency for both analysts.
export { createPushTraceSource, type TraceSource } from './supervise/trace-source'
// The SETTLE-time analyzer: collect a TraceSource's spans and run agent-eval's published batch
// analyzers (buildTrajectory / stuckLoopView / toolWasteView) — the post-hoc half.
export { analyzeTrace } from './supervise/trajectory-recorder'
// Untracked-artifact fidelity for cloned worker workspaces: `git clone` carries history only, and
// real workspaces hold compiled build outputs as untracked files a worker's verify gate needs.
// Promoted from the loops repo (#4519).
export * from './supervise/untracked-clone'
export { spendFromUsageEvents } from './supervise/usage-metering'
// The bounded settle-evidence block a worker exposes so the brain's next decision is not authored
// blind. Complementary to `CompletionEvidence` (a pointer), which this block is the target of.
// Promoted from the loops repo (#4519).
export * from './supervise/worker-evidence'
// Exact cross-process attachment to a provider-retained worker process. The durable binding is
// Runtime-owned and keyed by the supervised worker id; callers never inspect provider state.
export {
  attachWorker,
  readWorkerInteractiveBinding,
  type WorkerInteractiveBinding,
  type WorkerInteractiveProviderSource,
} from './supervise/worker-interactive'
// Worker-spawn persistence: the same second chance for a LEAF whose spawn a saturated executor
// refused before it ran. Fail-closed on two proofs of zero work — a pre-spawn signature in the
// error AND no execution event from the attempt — so a stream that may already have metered a
// provider call stays fatal. `SuperviseOptions.workerRetry` turns it on as data;
// `withWorkerSpawnRetry` composes it onto a caller-owned worker seam.
export * from './supervise/worker-retry'
export { createWorkerSlots } from './supervise/worker-slots'
// The worktree-CLI leaf executor: a supervisor-authored AgentProfile (systemPrompt + model)
// driving a local harness CLI on its own git worktree, surfaced as the open `Executor` port.
export * from './supervise/worktree-cli-executor'
// The generic coding combinator: a fanout of authored harness profiles, each on its own
// worktree-CLI leaf, each gated by the injected deliverable, winner via the shared valid-only
// `selectValidWinner`.
export * from './supervise/worktree-fanout'
export * from './supervise-analysts'
export * from './surface-diff'

export * from './task-queue'
// Profile-owned supervisor configuration. The raw driver constructor lives only under `/testing`;
// production model execution enters through `supervise(AgentProfile)` — except the graph's root,
// where `RunGraphOptions.brain` accepts a caller-owned `ToolLoopChat` (see `runGraph`).
export type {
  ToolLoopCallContext,
  ToolLoopChat,
  ToolLoopCompaction,
  ToolLoopMessageRecord,
  ToolLoopToolCall,
} from './tool-loop'
export type * from './types'
export * from './verifier-environment'
export * from './waterfall'
export * from './workspace'
