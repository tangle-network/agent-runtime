import type { ReasoningEffort } from '@tangle-network/agent-interface'
import type { RuntimeHooks } from '../../../runtime-hooks'
import type { WorkerTraceResolver } from '../worker-trace'
import type { Budget } from './accounting'
import type { Agent } from './agent-scope'
import type { NodeExecutionIdentity, RootMaterialization } from './execution-identity'
import type { ExecutorFactory, ExecutorRegistry } from './executor-construction'
import type { NodeId, TreeView } from './node-lifecycle'
import type { ResultBlobStore, SpawnJournal } from './spawn-journal'
import type { SupervisedResult } from './supervisor-result'

/**
 * Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker,
 * and the root handle. `run` executes the root `Agent` to completion; `attach` wires a
 * live `RootHandle` (the Q2 substrate the chat/pi-viz client later consumes).
 *
 * @stable
 */
export interface Supervisor<Task, Out> {
  run(root: Agent<Task, Out>, task: Task, opts: SupervisorOpts): Promise<SupervisedResult<Out>>
  attach(h: RootHandle<Out>): void
}

/** Optional recursive admission policy. `ownerShare` is the fraction of every manager's budget
 * kept free for its own inference while children hold their declared slices. */
export interface RecursiveReservationPolicy {
  readonly ownerShare: number
}

/**
 * What a root runs on during one segment of its run.
 *
 * Its profile's `model.provider`, `model.default`, `model.reasoningEffort` and `harness`, and the
 * package versions the caller ran it under. A run is one id for its whole life; a turn that ends, a lost stream or a dead supervisor is a
 * boundary between entries, and an entry on anything else here starts a new segment.
 */
export interface RootSegment {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly harness?: string
  /** The package versions the caller runs this segment under, by package name (its Runtime among
   *  them). Runtime records them and never reads them. */
  readonly stack?: Readonly<Record<string, string>>
}

/** The segment a root enters with this process. */
export interface RootSegmentEntry {
  /** What the recorded root profile runs on, without a stack. */
  readonly registered: RootSegment
  /** What the root runs on from this entry. */
  readonly current: RootSegment
  readonly reason: string
}

export interface SupervisorOpts {
  /** The root conserved-pool ceiling (tokens + usd + iterations + deadline). */
  readonly budget: Budget
  /** Exact root profile/task identity supplied by the one-call composition surface. */
  readonly rootIdentity?: NodeExecutionIdentity
  /** The segment this entry runs the root in. `rootIdentity` stays the recorded root's; when the
   *  segment differs from the one the run last ran, the journal gains one `root-segment` record. A
   *  fresh run refuses a segment that changes the recorded profile's model or harness. */
  readonly rootSegment?: RootSegmentEntry
  /** Trusted composition evidence for a root whose `act` drives an external backend. A generic
   *  root omits it and is durably marked unknown; model-facing Scope never receives this writer. */
  readonly rootMaterialization?: RootMaterialization
  /** Trace-correlation root + the journal/blob root key. */
  readonly runId: NodeId
  /** Event source — defaults to the in-memory journal in the impl; pass JSONL/FS for durability. */
  readonly journal: SpawnJournal
  /** Result payload store backing `outRef` rehydration. */
  readonly blobs: ResultBlobStore
  /** Executor resolution — the open registry mapping `AgentSpec` → `Executor`. */
  readonly executors: ExecutorRegistry
  /** Reconstruct configured executors for interrupted children before resuming the driver. */
  readonly recoverExecutor?: ExecutorFactory<unknown>
  /** Recursion ceiling (root = 0). The conserved pool bounds depth; this only stops a runaway
   *  recursion. Omit = `DEFAULT_MAX_DEPTH` (16). */
  readonly maxDepth?: number
  /** The bound on concurrently working agents across the whole tree, as a number or as an
   *  allocator from `createWorkerSlots` that several runs share. A spawn past it waits in a queue
   *  instead of being refused. The root holds no slot. Omit/`<= 0` bounds concurrency by the budget
   *  alone. */
  readonly workerSlots?: number | import('../worker-slots').WorkerSlots
  /** Opt in to keeping each manager's inference share free of its children's slices. A resumed
   *  run must use the same policy. */
  readonly reservationPolicy?: RecursiveReservationPolicy
  /** What a child's own time box does. Default: a check-in (the child is told to save its state and
   *  submit what it has, and is stopped only once it then makes no progress for 30 min); `false`
   *  stops it at the time box. See `deadline.ts` `DeadlineCheckIn`. */
  readonly deadlineCheckIn?: import('../deadline').DeadlineCheckIn
  /** How long a keyed worker whose turn ended over its budget keeps its environment, so that
   *  re-spawning its key with a larger budget continues the same session (ms). After it the
   *  environment is released and the worker stays settled `done` with its `budgetViolation`.
   *  Default 600,000 (`DEFAULT_BUDGET_STOP_HOLD_MS`); `0` keeps none. */
  readonly budgetStopHoldMs?: number
  /**
   * OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
   * trips the supervisor to `no-winner` rather than restarting forever.
   */
  readonly maxRestarts?: number
  readonly withinMs?: number
  /**
   * How long live children may keep running after the root driver returns or fails, before the join
   * barrier cascades the abort into them (#741). A child mid-unit holds work already paid for, and
   * killing it instantly discards everything it has not yet written. `null` waits until children
   * settle or the caller cancels. An explicit run deadline always wins. Omit/`0` = immediate
   * teardown.
   */
  readonly childSettleGraceMs?: number | null
  /**
   * How long the join barrier keeps retrying a settled child's teardown until the executor
   * confirms its resources are destroyed. A child's first teardown gets a short acknowledgement
   * window, and a provider delete that fails or answers late then left the sandbox running: on
   * 2026-09-20, cancelling 20 Discovery lanes left 2 workers running, and 136 of 612 agents
   * across that campaign ended with teardown unconfirmed. The barrier re-asks each unconfirmed
   * child with exponential backoff (starting at 1/300 of this window, doubling, capped at 1/10 of
   * it) and releases a failed retained environment again under `retainedAtSettlement:
   * 'release'`. A child still unconfirmed when the window closes is named in
   * `teardownUnconfirmed` with the environment ids its executor reports, and journaled. The
   * nodes pending when the window opens are journaled first as `teardown-pending`, so a process
   * that dies inside the window still leaves their environment ids on record. A retained
   * environment kept for a resume is not retried, and neither is an answer the executor marks
   * `permanent`. The window runs after the run's deadline too: a deadline stops work, not
   * cleanup, so settlement can return up to this long after it. `0` makes one attempt only.
   * Default: 300000 (5 minutes).
   */
  readonly teardownConfirmMs?: number
  /**
   * Load prior journal state and expose committed settlements through `Scope.resume`.
   * Use persistent journal and blob stores to recover across process restarts.
   * `createFileRunContext` provides the file-backed stores and local ownership lock.
   *
   * Default `false` refuses an existing run ID instead of replacing its journal.
   * Configure `recoverExecutor` to reconcile retained children before new work is admitted.
   * Unresolved keyed work remains in doubt.
   * The file run lock provides local ownership, without distributed fencing.
   * @experimental
   */
  readonly resume?: boolean
  /**
   * What root settlement does with a provider environment that a settled child still holds for a
   * RETAINED execution (`Executor.releaseRetained`). Such a child settles `down` with its cursor
   * slot open and its environment alive, because a later process that resumes this run reconciles
   * the paid execution inside it.
   *
   * - `'release'`: the run will not be resumed, so nothing would ever reconcile or release those
   *   environments. The join barrier releases each one and journals an `environment-teardown`
   *   receipt per environment. Measured 2026-09-11: four settled runs held 18 of a 60-slot
   *   Sandbox fleet for 19 to 37 hours without it. It then closes each released child's cursor
   *   slot with a terminal record marked `retainedExecution: 'released'`, so `spendGaps` names
   *   it `unreported` (a floor) rather than `never-settled` (a ceiling) and
   *   `fleetYield.releasedUnrecovered` counts it. A release that is refused or cannot be
   *   confirmed names the node in `teardownUnconfirmed` and its `teardown-unconfirmed` record,
   *   and after the retry window closes its slot with `retainedExecution: 'release-unconfirmed'`,
   *   counted by `fleetYield.releaseUnconfirmed`: the settlement is final, so the slot closes
   *   whether or not the environment is confirmed gone. Measured 2026-09-23/24 on the Discovery
   *   fleet (Runtime 0.249.1 to 0.261.0): 338 of 1,620 agents never settled, and 179 of the
   *   retained ones had an admission that never named an environment. A process that dies
   *   between the last `destroyed: true` receipt and the released record leaves the slot open
   *   only until the next resume, whose `healReleasedSlots` writes the identical record from the
   *   `reconciled` record.
   * - `'keep'`: a later process may resume this run, so the environments stay for its recovery.
   *
   * Default: `'keep'` when `resume` is true (a durable run a later process may continue), else
   * `'release'`. A caller that owns finality says so: `supervisePursuit` records a settle record
   * that refuses re-entry, so it always releases. A process crash never reaches settlement, so it
   * releases nothing under either value.
   */
  readonly retainedAtSettlement?: 'release' | 'keep'
  /** @internal Whether provider-backed retained owner cleanup must preserve unreceipted sources. */
  readonly ownerWorkspaceRetention?: boolean
  readonly now?: () => number
  readonly signal?: AbortSignal
  /** Lifecycle stream sink, threaded into the root `Scope` so every `spawn`/settle emits on the
   *  same `agent.spawn`/`agent.child` stream `runAgentRounds` feeds — one observable recursive tree. */
  readonly hooks?: RuntimeHooks
  /**
   * Trace context to hand DOWN to each spawned worker, so a worker in another process or on another
   * machine emits spans that join THIS run's trace instead of opening its own root. Supply
   * `SupervisorSpanRecorder.workerTrace`; the `Scope` seeds the resolved context onto every child's
   * `ExecutorContext` and the backends with an environment channel stamp it as
   * `TRACEPARENT` plus the legacy `TRACE_ID` / `PARENT_SPAN_ID` pair (see `worker-trace.ts` for
   * the precedence rule and for which backends propagate). Omit and no worker environment is
   * touched at all.
   */
  readonly workerTrace?: WorkerTraceResolver
  /**
   * Declare that this run's worker backend CANNOT carry the trace context
   * (`WORKER_TRACE_PROPAGATION[backend] === false`). With `workerTrace` also set, every spawn then
   * journals a `trace-unpropagated` event naming the severed hop — the host-side record of a
   * distributed trace that will surface disconnected. `supervise()` derives this from its backend;
   * a direct `createSupervisor()` caller may set it for a caller-owned executor registry.
   */
  readonly workerTraceUnpropagated?: {
    readonly backend: string
    readonly reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted'
  }
  /** Durable supervisor-run directory that receives exact worker interactive bindings.
   * `supervise({ runDir })` wires this automatically. Direct kernel callers omit it. */
  readonly interactiveBindingDir?: string
}

/** Live root handle — a chat/pi-viz client uses it to inspect and control one root run. */
export interface RootHandle<Out> {
  view(): TreeView
  /** Optional for structural compatibility with existing view/signal/abort wrappers. Handles
   * minted by `createRootHandle` implement the required form in `SteerableRootHandle`. */
  deliver?(msg: unknown): boolean
  /** Cancel the live tree. Unsupported signals from older callers throw a validation error. */
  signal(msg: RootSignal): void
  abort(reason?: string): void
  /** Phantom: binds the handle to the supervised run's output type. Type-only — never
   *  present at runtime; lets `attach(h: RootHandle<Out>)` stay output-typed. */
  readonly __out?: Out
}

/** A Runtime-minted root handle that can deliver raw steering or answers to a live manager inbox.
 * Delivery returns `false` when the manager has no receive path; detached calls fail loud. */
export interface SteerableRootHandle<Out> extends RootHandle<Out> {
  deliver(msg: unknown): boolean
}

/** Cancellation of a running root. Send steering or answers through the root's `deliver` inbox. */
export type RootSignal = { kind: 'cancel'; reason?: string }
