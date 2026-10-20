import type { RuntimeHooks } from '../../runtime-hooks'
import type { RuntimeFailureCause } from '../failure-cause'
import type { HarnessTranscriptEvidence } from '../harness-transcript'
import type { RetainedRunEnvironmentAdmission } from '../retained-run-types'
import type { RunCancellationReason } from './abortable'
import type { BudgetPool } from './budget'
import type { DeadlineCheckIn, TeardownAnswer } from './deadline'
import type { ExecutorProgress } from './progress'
import type { RetainedChildRecovery, RetainedPendingCause } from './retained-executor'
import type { TraceRootWriter } from './trace-root'
import type { TraceSource } from './trace-source'
import type {
  Budget,
  BudgetViolation,
  DefaultVerdict,
  EnvironmentTeardownReceipt,
  ExecutionBindingReceipt,
  ExecutorCancellation,
  ExecutorCancellationRequest,
  ExecutorFactory,
  ExecutorRegistry,
  ExecutorResult,
  HeldEnvironment,
  HeldForContinuation,
  NodeExecutionIdentity,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  ProfileMaterializationReceipt,
  RecursiveReservationPolicy,
  ResultBlobStore,
  ResumedKeyState,
  RetainedExecutionState,
  Scope,
  Settled,
  SpawnEvent,
  SpawnJournal,
  SpawnModelSubstitution,
  Spend,
  SubtreeSummary,
  TraceRootReceipt,
  TreeView,
  WorkerInteractiveSession,
  WorkerTraceEvidence,
} from './types'
import type { WorkerEvents } from './worker-events'
import type { SlotPermit, WorkerSlots } from './worker-slots'
import type { WorkerTraceResolver } from './worker-trace'

/** Construction args for `createScope`. The supervisor threads the shared pool, journal,
 *  blob store, and executor registry through; `depth`/`maxDepth` pair the runtime
 *  recursion ceiling with the conserved pool (R3). */
export interface ScopeArgs {
  /** This scope's owning node id — children get `${parentId}:s${seq}` ids. */
  readonly parentId: NodeId
  /** Journal/blob root key the supervisor `beginTree`'d. */
  readonly root: NodeId
  /** The reservation pool for this scope: the root total or one nested allocated partition. */
  readonly pool: BudgetPool
  /** Append-only spawn journal; this scope writes `spawned` + `settled` records. */
  readonly journal: SpawnJournal
  /** Content-addressed result store backing `outRef` rehydration. */
  readonly blobs: ResultBlobStore
  /** The open executor resolver (BYO → router/inline → registered harness factory). */
  readonly executors: ExecutorRegistry
  /** Per-spawn executor-construction seams (sandbox client, router config, cli bin). */
  readonly seams: Readonly<Record<string, unknown>>
  /** This scope's recursion depth (root = 0). */
  readonly depth: number
  /** Runtime recursion-depth ceiling — a spawn past it fails closed `depth-exceeded`. */
  readonly maxDepth?: number
  /** The allocator that bounds concurrently working agents across this scope, every nested scope,
   *  and every other tree that shares it. Absent means no bound: only the budget limits concurrency. */
  readonly workerSlots?: WorkerSlots
  /** @internal The slot this scope's own manager holds in its parent scope. A nested scope's first
   *  running child works on it while the manager waits. Absent on a root scope. */
  readonly slotOwner?: SlotPermit
  /** Optional policy that keeps part of each manager's budget for its own inference. */
  readonly reservationPolicy?: RecursiveReservationPolicy
  /** The budget from which this scope's owner-share floor is derived. */
  readonly ownerBudget?: Budget
  /** What a steerable child's own time box does: a check-in by default (`deadline.ts`
   *  `DeadlineCheckIn`); `false` stops the child at its time box. Nested scopes inherit it. */
  readonly deadlineCheckIn?: DeadlineCheckIn
  /** How long a keyed leaf whose turn ended over its budget keeps its environment for a same-key
   *  re-spawn to continue (ms). Default {@link DEFAULT_BUDGET_STOP_HOLD_MS}; `0` keeps none.
   *  Nested scopes inherit it. */
  readonly budgetStopHoldMs?: number
  /** Abort signal for this scope; an abort cascades into every live child's executor. */
  readonly signal: AbortSignal
  /** Injected clock — keeps the journal `at` timestamp deterministic in tests. */
  readonly now?: () => number
  /** Lifecycle stream sink. `spawn` emits `agent.spawn`, `next` emits `agent.child` — the
   *  SAME stream `runAgentRounds`/`tool-loop` feed, so the recursive tree is ONE observable stream
   *  (the topology viewer reads it). Undefined ⇒ the journal stays the only record. */
  readonly hooks?: RuntimeHooks
  /**
   * Trace context to hand down to each spawned worker (`SupervisorOpts.workerTrace`). Called with
   * THIS scope's own `parentId` — the node doing the spawning — and the resolved context is seeded
   * onto each child's `ExecutorContext` under `workerTraceSeamKey`. Absent (the untraced default)
   * ⇒ no seam is seeded and no worker environment is touched.
   */
  readonly workerTrace?: WorkerTraceResolver
  /**
   * Present when this run RECORDS spans but the worker backend has NO channel to carry the trace
   * context (`WORKER_TRACE_PROPAGATION[backend] === false` — cli-worktree has no env
   * channel; router / router-tools / provider have no worker process). Each spawn then journals a
   * `trace-unpropagated` event naming the severed hop, so a child whose trace shows up as a
   * disconnected root is a recorded fact rather than a silent stranger. Absent ⇒ either the run
   * is untraced or the backend propagates; nothing is journaled.
   */
  readonly workerTraceUnpropagated?: {
    readonly backend: string
    readonly reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted'
  }
  /** Durable run directory that receives exact worker interactive bindings. */
  readonly interactiveBindingDir?: string
  /** @internal Trusted root-adapter publication channel. It is never exposed as a Scope method. */
  readonly ownerMaterialization?: {
    readonly runtime: NodeSnapshot['runtime']
    readonly authoredProfile?: unknown
    readonly attemptId: string
    readonly prior?: ProfileMaterializationReceipt
    readonly journalRoot?: NodeId
    readonly nodeId?: NodeId
    readonly requiredKnown?: boolean
    readonly onReceipt?: (
      materialization: ProfileMaterializationReceipt,
      binding: ExecutionBindingReceipt,
    ) => void
  }
  /**
   * Resume seam — set ONLY by the supervisor when `SupervisorOpts.resume` is on AND a non-empty
   * journal tree exists for this root. It carries the replayed committed work (so `scope.resume`
   * exposes it to a resume-aware `act`) and the recorded ordinal/cursor maxima the new counters
   * continue past, so a freshly-spawned child never reuses a journaled `seq`. Absent ⇒ fresh run.
   */
  readonly resumeFrom?: {
    /** @internal Executor adoption plans validated by the supervisor's recovery preparation. */
    readonly recoveries?: readonly RetainedChildRecovery[]
    readonly events?: readonly SpawnEvent[]
    readonly settled: ReadonlyArray<Settled<unknown>>
    readonly view: TreeView
    /** Highest `spawned` ordinal already journaled; new spawns start at `+1`. */
    readonly maxSpawnOrdinal: number
    /** Highest cursor `seq` already journaled; new settlements start at `+1`. */
    readonly maxCursorSeq: number
    /** Keyed assignments from the prior journal — what a keyed re-spawn resolves against. */
    readonly keys: ReadonlyMap<string, ResumedKeyState<unknown>>
    /** Prior committed spend summed off the journal (settled child work + metered inference). */
    readonly priorSpend: { readonly childWork: Spend; readonly driverInference: Spend }
  }
}

/**
 * Internal live-set entry. `settled` resolves once the child's executor has fully drained,
 * its reservation reconciled, and its result blob persisted; `next()` awaits these to drive
 * the cursor. `resolved` mirrors that terminal value synchronously so a concurrent `next()`
 * can pick the next undelivered settlement without re-racing. `delivered` guards exactly-once
 * delivery; `seq` is stamped by `next()`, never here.
 */
export interface LiveChild {
  readonly events: WorkerEvents
  cancellationReason?: RunCancellationReason
  readonly id: NodeId
  status: NodeStatus
  runtime: NodeSnapshot['runtime']
  readonly ownedTreeRoot?: NodeId
  readonly budget: Budget
  readonly label: string
  readonly assignmentId?: string
  readonly identity?: NodeExecutionIdentity
  readonly modelSubstitution?: SpawnModelSubstitution
  /** The semantic spawn key, when this child was spawned with one — the settle path folds the
   *  terminal state back into the scope's key registry under it. */
  readonly key?: string
  spent: Spend
  /** The overspend its reconciliation returned. Every terminal record of this node carries it. */
  budgetViolation?: BudgetViolation
  /** The overspend a RETAINED reconcile returned, held back from the open-slot surfaces (the
   *  driver's settlement, the tree, the first `agent.child`) because the floor is not the
   *  execution's final spend. The release sweep restores it onto `budgetViolation` before it
   *  writes the terminal record, so that record agrees with what the pool committed. */
  retainedViolation?: BudgetViolation
  recoveryReady?: Promise<void>
  /** The environment a settled budget-stopped turn kept for a same-key continuation, until it is
   *  released or handed to the successor node. */
  held?: { readonly continuation: HeldForContinuation; clearCeiling?: () => void }
  /** The environment admission of this child's current invocation: what a continuation reuses. */
  readEnvironmentAdmission?: () => RetainedRunEnvironmentAdmission | undefined
  acceptedResult?: ExecutorResult<unknown>
  recoveryPending?: boolean
  outRef?: string
  /** The trace root of each output this process stored for the node, by `outRef`. */
  readonly traceRoots: TraceRootWriter
  /** Durable structured tool evidence once this executor is terminal. */
  trace?: WorkerTraceEvidence
  /** Provider-served model evidence once this executor has attempted inference. */
  providerModel?: import('./types').ProviderModelExecutionEvidence
  /** Exact terminal timestamp committed to the journal. */
  settledAt?: number
  /** The cursor seq `next()` stamped on this child's settlement. A retained-pending child's
   *  terminal record is written later by the release sweep under THIS seq, so replay yields it
   *  at the position the driver saw it; the sweep never mints a new `cursorSeq` for it, and
   *  neither does a resume that heals a crashed sweep — it reads this seq back from the
   *  reconciled record's `settledSeq`. */
  settledSeq?: number
  /** Mirrors the journal's statement about a retained execution so `makeTreeView` reports it. */
  retainedExecution?: RetainedExecutionState
  retainedPendingCause?: RetainedPendingCause
  /** Resolves with the terminal settlement WITHOUT a `seq` — `next()` stamps the seq. */
  readonly settled: Promise<PreSeqSettled>
  /** Synchronous mirror of `settled`'s value once it has resolved (else `undefined`). */
  resolved?: PreSeqSettled
  /** True once the EXECUTOR's own work is finished (artifact read or throw caught) — from then
   *  on `settled` resolves without further executor progress (only persistence/teardown), so a
   *  non-blocking drain may await it without waiting on live work. */
  executorDone: boolean
  /** True only after executor teardown returned `{ destroyed: true }`. A failed/unknown cleanup
   * retains the shared capacity slot so replacement work cannot exceed the physical live count. */
  cleanupConfirmed: boolean
  /** True once `next()` has yielded this child's settlement. */
  delivered: boolean
  /** The executor's out-of-band inbox, captured at spawn — backs `scope.send`. */
  readonly deliver?: (msg: unknown) => boolean
  /** The executor's optional live progress read, captured at spawn — backs `scope.progress`. */
  readonly readProgress?: () => ExecutorProgress | undefined
  /** The executor's optional live tool trace, captured at spawn — backs `scope.traceSource`. */
  readonly readTraceSource?: () => TraceSource | undefined
  /** The executor's optional interactive process, captured at spawn — backs `scope.interactive`. */
  readonly readInteractive?: () => WorkerInteractiveSession
  /** Async readiness for an executor that creates its interactive process during `execute`. */
  readonly readInteractiveReady?: () => Promise<WorkerInteractiveSession>
  /** The executor's optional cancellation operation, captured at spawn — backs `scope.cancel`. */
  readonly requestCancel?: (request: ExecutorCancellationRequest) => Promise<ExecutorCancellation>
  /** The executor's optional retained release, captured at spawn — what the root's settlement
   *  sweep calls for a settled child whose cleanup is still unconfirmed. */
  readonly releaseRetained?: (
    signal: AbortSignal,
  ) => Promise<ReadonlyArray<EnvironmentTeardownReceipt>>
  /** Re-ask the executor's teardown verb after a retained release; resolves only on
   *  `destroyed: true`, so confirmation always comes from the same verb every other path uses. */
  readonly confirmTeardown?: () => Promise<void>
  /** Every teardown Runtime sends this child's executor, single-flight: while one request is
   *  still running, another ask awaits it instead of sending a second (see
   *  `singleFlightTeardown`). Unbounded itself; each caller bounds its wait. */
  readonly askTeardown?: (grace: number | 'brutalKill' | 'infinity') => Promise<TeardownAnswer>
  /** The executor's `heldEnvironments` read, captured at spawn: what a sweeper must delete when
   *  this child's teardown stays unconfirmed. */
  readonly readHeldEnvironments?: () => ReadonlyArray<HeldEnvironment>
  /** The scope this child's recursive executor owns, once it has mounted one. */
  readonly readNestedScope?: () => Scope<unknown> | undefined
  /** Persist the executor's harness transcript as it stands now. A retained release may read a
   *  session the failure path could not, and the record that closes the slot carries it. */
  readonly readTranscriptAtRelease?: () => Promise<HarnessTranscriptEvidence>
  /** The bounded account of the team this child led, read from its own scope at settlement. */
  subtree?: SubtreeSummary
  /** How many teardown requests this child's executor was sent. */
  teardownAttempts: number
  /** Why the last teardown attempt did not confirm destruction. */
  teardownDetail?: string
  /** The executor answered that asking again cannot change its answer. */
  teardownPermanent?: boolean
  /** The settlement retry's pass over this child still in flight, so a later pass awaits it. */
  teardownRetry?: Promise<void>
  /** Abort this child's own signal — the local half of `scope.cancel`. */
  readonly abortChild: (reason?: unknown) => void
  /** Kernel-owned declaration of the exact execution plan, durable before `execute` starts. */
  materialization?: ProfileMaterializationReceipt
  /** One immutable record per concrete execution attempt. */
  executionBindings: ExecutionBindingReceipt[]
  /** Wall-clock of the spawn, and of the last metered usage event this child produced. Both are
   *  stamped by the scope from the stream the conserved pool already meters, so EVERY executor —
   *  including one that implements no progress read at all — has an observable liveness signal. */
  readonly startedAt: number
  lastActivityAt: number
}

/** A child's terminal settlement before the cursor stamps the monotonic `seq`. */
export type PreSeqSettled =
  | {
      kind: 'done'
      out: unknown
      outRef: string
      traceRoot?: TraceRootReceipt
      verdict?: DefaultVerdict
      spent: Spend
      providerModel?: import('./types').ProviderModelExecutionEvidence
      trace: WorkerTraceEvidence
      /** Whether the child's own harness transcript survived its environment. Sibling of `trace`;
       *  see the `Settled` doc for why it cannot live inside the trace receipt. */
      harnessTranscript?: HarnessTranscriptEvidence
      /** A driver child's OWN-inference subtree total (from `Executor.metered()`) — journaled as a
       *  `metered` event for this node, NOT reconciled (already debited live via `observe`). */
      metered?: Spend
    }
  | {
      kind: 'down'
      reason: string
      /** See `Settled['infra']`: `true` platform, `false` the work, absent unattributable. */
      infra?: boolean
      outRef?: string
      traceRoot?: TraceRootReceipt
      trace: WorkerTraceEvidence
      /** The dropped child's own harness transcript, or the named reason it is absent. The whole
       *  point of #1244: this path has no result artifact for a capture to ride in. */
      harnessTranscript?: HarnessTranscriptEvidence
      providerModel?: import('./types').ProviderModelExecutionEvidence
      /** A CRASHED driver child's partial OWN-inference subtree total — re-homed on the down path
       *  too, so the journal matches the pool (which already debited it via `observe`). */
      metered?: Spend
      /** The child-work floor a RETAINED-PENDING child's reservation was reconciled at. Its cursor
       *  slot stays open, so the settle path journals this as a `reconciled` record in place of
       *  the `settled` record it cannot write — otherwise every journal reader charges the ceiling
       *  the pool just refunded. */
      reconciled?: Spend
      /** Why the retained execution is pending, as a value (#1204). Present iff `reconciled` is. */
      retainedPendingCause?: RetainedPendingCause
      /** See `Settled['failure']`: the thrown error, classified before `errMessage` flattens it. */
      failure?: RuntimeFailureCause
    }

/**
 * The recursion seam key. A `Scope` seeds a value of this on each child's
 * `ExecutorContext.seams` so a child whose executor is a DRIVER can mount a NESTED `Scope`
 * over the driver's reserved child allocation at `depth+1`. A leaf executor never reads it. Single-sourced
 * here so the scope and the driver-executor agree on the seam without a circular import.
 */
export const nestedScopeSeamKey = 'nested-scope'

/**
 * The recursion seam value: mount a nested `Scope` for a driver child. `parentId` is the
 * driver child's own node id (so its children get `${nodeId}:s${ordinal}` ids and its
 * nested journal tree is namespaced under it); `root` is the journal tree key for the
 * nested tree (distinct from the parent's so cursor seqs never collide in the per-tree
 * guard). `depth` is `parent.depth + 1`. The nested scope spends from a child pool backed by
 * the driver's already-reserved allocation; it shares the parent's `journal`/`blobs` and
 * `executors` (a nested child resolves to leaf-or-driver through the same open registry).
 */
export interface NestedScopeSeam {
  /** Durable id of the driver child that owns the nested tree. */
  readonly nodeId: NodeId
  /** This scope's recursion depth — a nested scope runs at `depth + 1`. */
  readonly depth: number
  /** The runtime recursion-depth ceiling, paired with the conserved pool (R3). */
  readonly maxDepth?: number
  /** The journal tree key the parent scope writes to (used to namespace nested trees). */
  readonly journalRoot: NodeId
  /** Mount a nested scope rooted at `nestedRoot`, parented at this driver child's node id. */
  mount(nestedRoot: NodeId, signal: AbortSignal): Scope<unknown>
  restore?(
    nestedRoot: NodeId,
    signal: AbortSignal,
    events: SpawnEvent[],
    recoverExecutor: ExecutorFactory<unknown>,
  ): Promise<Scope<unknown>>
}

export interface DeferredOwnerSlot {
  ownerMaterialization?: NonNullable<ScopeArgs['ownerMaterialization']>
}
