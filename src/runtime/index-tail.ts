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
export {
  createScope,
  type LiveWorkerCapacityState,
  type ScopeArgs,
  settledToIteration,
} from './supervise/scope'
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
  ControllableRootHandle,
  ExecutionBindingReceipt,
  Executor,
  ExecutorAccounting,
  ExecutorContext,
  ExecutorExecutionBinding,
  ExecutorFactory,
  ExecutorMaterialization,
  ExecutorNodeContext,
  ExecutorRegistry,
  ExecutorResult,
  Handle,
  MaterializedExecutionIdentity,
  MaterializedModelIdentity,
  NodeExecutionIdentity,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  NoWinnerError,
  ProfileMaterializationReceipt,
  Restart,
  ResultBlobStore,
  ResumedKeyState,
  ResumedWork,
  RootControlSnapshot,
  RootControlStatus,
  RootHandle,
  RootMaterialization,
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
  SteerableRootHandle,
  SupervisedResult,
  Supervisor,
  SupervisorOpts,
  TreeView,
  UnknownMaterializationReason,
  UsageEvent,
  WaitOpts,
  WidenGate,
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
