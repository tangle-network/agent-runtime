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

/** Runs a root under the conserved pool, durable journal, abort cascade and restart breaker.
 * @stable */
export interface Supervisor<Task, Out> {
  run(root: Agent<Task, Out>, task: Task, opts: SupervisorOpts): Promise<SupervisedResult<Out>>
  attach(h: RootHandle<Out>): void
}

/** Optional recursive admission policy. `ownerShare` is the fraction of every manager's budget
 * for its own inference: its turns spend that share first, and its children may reserve the rest. */
export interface RecursiveReservationPolicy {
  readonly ownerShare: number
}

/** One root's model, harness and package versions. Changed execution starts a new segment
 * under the same run id; a turn, lost stream or restart is only a new entry. */
export interface RootSegment {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly harness?: string
  /** Caller package versions; recorded without interpretation. */
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
  /** Authored request, independent of whether the root uses an external executor. */
  readonly requestedProfile?: import('@tangle-network/agent-interface').AgentProfile
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
  /** Teardown retry window, including after the run deadline, counted from the first release.
   * Pending environments are journaled before retry; unresolved teardown is named in
   * teardownUnconfirmed. Kept environments, environments a provider holds for retention and
   * permanent refusals are not retried. Zero makes one attempt.
   * retained-owner-release.ts owns the default, RELEASE_DESTROY_MS; supervisor-child-join.ts
   * owns the retry backoff. */
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
  /** Held execution fate at root settlement. Release journals environment teardown and closes
   * each cursor, marking unconfirmed teardown release-unconfirmed. A later resume heals a
   * crash between confirmed teardown and terminal publication from its durable floor.
   * Keep preserves environments for resume and is the default when resume is enabled;
   * otherwise release is the default. supervisePursuit always releases because its sealed
   * result refuses re-entry. Process death does not itself release environments.
   * Missing receipts always leave measured terminal usage incomplete. */
  readonly retainedAtSettlement?: 'release' | 'keep'
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
  /** Durable supervisor-run directory that receives exact worker interactive bindings and each
   * worker's redacted progress stream (`streams/<node>.jsonl`, the `root-stream.jsonl` record
   * shape). `supervise({ runDir })` wires this automatically. Direct kernel callers omit it. */
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
