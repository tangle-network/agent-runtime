/**
 * Recursive execution atom — the FROZEN type surface (the keystone contract).
 *
 * One self-similar `Agent` atom runs inside a budget-conserving reactive `Scope`,
 * orchestrated by a `Supervisor` over an event-sourced `SpawnJournal`. A leaf is an
 * `Agent` that never calls `scope.spawn`; a driver is an `Agent` that spawns and runs
 * a policy over its children's streaming results.
 *
 * Two invariants the surface exists to make enforceable:
 *  - Budget is an atomically-reserved CONSERVED pool, so `Σk(treatment) ≡ Σk(blind)` by
 *    construction (reserve-on-spawn, refund-unspent-on-settle, fail-closed admission).
 *  - The journal records a content-addressed `outRef` per child result, so replay
 *    rehydrates the exact `Settled` the driver branched on (the replay invariant below).
 *
 * The leaf RUNTIME is one OPEN `Executor` interface, not a closed `inline|sandbox|cli`
 * union the call site switches on. The built-ins (router/inline, sandbox, cli) are the
 * initial IMPLEMENTATIONS; any user agent is first-class the moment it implements the
 * interface. The interface IS the extension point — no per-vendor adapters live here.
 *
 * Layering: substrate types (`DefaultVerdict`) come from `@tangle-network/agent-eval`;
 * runtime-shaped types (everything else) live here. Pure types/interfaces only — this
 * module typechecks standalone and is imported by every keystone impl.
 *
 * @experimental
 */

export type { DefaultVerdict } from '@tangle-network/agent-eval'
export type {
  Budget,
  BudgetOverspend,
  BudgetViolation,
  ResourceSpend,
  Spend,
  SpendChannel,
  SpendGap,
} from './contracts/accounting'

export type {
  Agent,
  ReenteredWorkers,
  ResumedKeyState,
  ResumedWork,
  Scope,
  UnconfirmedTeardown,
} from './contracts/agent-scope'
export type {
  ExecutorProgressEvent,
  ExecutorToolCall,
  TokenUsageProvenance,
  UsageEvent,
} from './contracts/execution-events'
export type {
  AgentExecutionRef,
  ExecutionBindingReceipt,
  ExecutorExecutionBinding,
  ExecutorMaterialization,
  ExecutorNodeContext,
  MaterializedExecutionIdentity,
  NodeExecutionIdentity,
  ProfileMaterializationReceipt,
  UnknownMaterializationReason,
} from './contracts/execution-identity'
export type {
  AgentSpec,
  ExecutorContext,
  ExecutorFactory,
  ExecutorRegistry,
  SpawnModelSubstitution,
} from './contracts/executor-construction'
export type {
  EnvironmentTeardownReceipt,
  Executor,
  ExecutorAccounting,
  ExecutorCancellation,
  ExecutorCancellationRequest,
  ExecutorResult,
  HeldEnvironment,
  HeldForContinuation,
  HeldRelease,
  Runtime,
  WorkerInteractiveSession,
  WorkerInteractiveUnavailableReason,
  WorkerTraceEvidence,
} from './contracts/executor-port'
export type {
  Handle,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  RetainedExecutionState,
  Settled,
  SpawnOpts,
  SpawnPrior,
  SpawnRejection,
  SubtreeResult,
  SubtreeSummary,
  TreeView,
} from './contracts/node-lifecycle'
export type {
  ResultBlobStore,
  SpawnEvent,
  SpawnJournal,
  TraceRootReceipt,
  WorkspaceCheckpointMarker,
} from './contracts/spawn-journal'
export type {
  RecursiveReservationPolicy,
  RootHandle,
  RootSegment,
  RootSegmentEntry,
  RootSignal,
  SteerableRootHandle,
  Supervisor,
  SupervisorOpts,
} from './contracts/supervisor-port'
export type {
  FleetYield,
  NoWinnerError,
  ProviderModelAttemptEvidence,
  ProviderModelExecutionEvidence,
  RootProviderModelEvidence,
  RootStreamReceipt,
  SupervisedResult,
} from './contracts/supervisor-result'
export type { RetainedPendingCause } from './retained-executor'
