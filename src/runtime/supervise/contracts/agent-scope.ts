import type { HarnessTranscriptCapture } from '../../harness-transcript'
import type { ReservationShortfall } from '../budget'
import type { ExecutorProgress, WorkerProgress } from '../progress'
import type { TraceSource } from '../trace-source'
import type { Spend } from './accounting'
import type { NodeExecutionIdentity } from './execution-identity'
import type {
  ExecutorCancellation,
  ExecutorCancellationRequest,
  HeldEnvironment,
  HeldRelease,
  Runtime,
  WorkerInteractiveSession,
} from './executor-port'
import type {
  Handle,
  NodeId,
  NodeStatus,
  Settled,
  SpawnOpts,
  SpawnPrior,
  SpawnRejection,
  TreeView,
} from './node-lifecycle'

/**
 * One self-similar atom. A leaf is an `Agent` that never calls `scope.spawn`; a driver
 * is an `Agent` whose `act` spawns children and reacts to them via `scope.next()`. An
 * analyst is an `Agent` whose task is "read these traces → findings" — `where` it runs
 * is its executor, not a separate type.
 *
 * `act` MUST be replay-safe: it may read `verdict`, `spent`, and `out` (rehydrated by
 * `outRef`) off each `Settled`; it MUST NOT read `Date.now`, `Math.random`, or any
 * unordered collection. `scope.next()` delivers strictly in recorded `seq` order.
 */
export interface Agent<Task, Out> {
  readonly name: string
  act(task: Task, scope: Scope<Out>): Promise<Out>
  /**
   * Optional manager inbox. A parent or attached `RootHandle` uses this to deliver the same raw
   * down-message accepted by executor inboxes. Return `false` when the manager has no live receive
   * path; returning `true` means the message was accepted for the current manager session.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: void is the legacy contract; boolean adds an acknowledgement without breaking existing agents.
  deliver?(msg: unknown): void | boolean
  /** Optional live tool evidence exposed by executors that can observe it. */
  traceSource?(): TraceSource | undefined
  /** Optional live execution progress exposed by executors that can observe it. */
  progress?(): ExecutorProgress | undefined
  /**
   * Optional capture of this agent's own harness session, for an agent that runs a harness as a
   * manager. A driver child forwards it to its executor, so the manager settles with the same
   * receipt a leaf gets instead of `executor-exposes-no-transcript`.
   */
  harnessTranscript?():
    | HarnessTranscriptCapture
    | undefined /** Forwarded the same way: resolves once {@link harnessTranscript} is final (see `Executor`). */
  harnessTranscriptSettled?(): Promise<void>
  /**
   * True once this agent's result is committed: its completion check accepted a submission and
   * the coordination record holds it. `act` then resolves with that result once the turn that
   * submitted it has ended, so an abort that arrives after acceptance waits for it, bounded,
   * instead of discarding it (see `Executor.resultAccepted`).
   */
  resultAccepted?(): boolean
}

/**
 * The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves
 * budget atomically from the shared pool and fails closed when the pool cannot cover it.
 * `next()` waits for one settlement from this scope's live set; `view` reads live state,
 * not the replay log.
 *
 * @stable
 */
export interface Scope<Out> {
  /**
   * Spawn a child. For a fresh key or an unkeyed spawn, tree-wide worker admission happens before a
   * lazy factory is called, so a full worker allocation creates no worker, executor, or reservation.
   * Reserves `opts.budget` from the conserved pool atomically; refunds the unspent remainder on
   * settle. Returns a typed outcome — fail-closed on an exhausted pool, an exceeded depth ceiling, a
   * full worker allocation, or a still-live duplicate `key` (the caller inspects `ok` before
   * `handle`). A KEYED spawn whose key already settled `done` invokes the factory only far enough to
   * prepare and authorize the exact profile/task identity, then compares that identity with the
   * journal. On a match it spends nothing, constructs no executor, reserves no budget, and runs no
   * work: it returns the committed result on `prior` (see `SpawnOpts.key`).
   */
  spawn<C extends Out>(
    agent: Agent<unknown, C> | (() => Agent<unknown, C>),
    task: unknown,
    opts: SpawnOpts,
  ):
    | { ok: true; handle: Handle<C>; prior?: SpawnPrior<C> }
    | { ok: false; reason: SpawnRejection; shortfalls?: readonly ReservationShortfall[] }
  /** ray.wait n=1 over this scope's in-memory live set; resolves as each child settles;
   *  `null` when the live set is empty. */
  next(): Promise<Settled<Out> | null>
  /**
   * Non-blocking twin of `next()`: deliver an ALREADY-settled, undelivered child, or `null`
   * when none is ready — never awaits a live child. The driver's post-loop drain reads this so
   * a child that settled while the driver was busy (or after it stopped pulling) still reaches
   * the finalize ledger instead of being silently lost.
   */
  nextResolved(): Promise<Settled<Out> | null>
  /**
   * Steer a RUNNING child out-of-band — deliver a message to its executor's inbox (the driver's
   * `send` verb: next-instruction, interrupt, or resume). Returns `true` if the message was
   * delivered to a live child whose executor accepts delivery, `false` otherwise (unknown id,
   * already settled, or an executor with no inbox). The executor reads its inbox between turns;
   * a leaf that does not implement `deliver` simply cannot be steered mid-flight. In-process this
   * is a direct call; the sandbox/Agent-Bus transports surface the SAME verb as an MCP tool.
   */
  send(nodeId: NodeId, msg: unknown): boolean
  /**
   * Release the environment a settled child holds after a budget stop. Resolves `true` when one was
   * held (and journals its `environment-teardown` with `heldRelease`), `false` otherwise.
   */
  releaseHeld?(nodeId: NodeId, reason: HeldRelease): Promise<boolean>
  /**
   * The LIVE read-model of one child, valid WHILE it runs: last-activity timestamp, idle time,
   * a derived `stalled` flag, tokens/turns spent so far, whether a steer can even reach it
   * (`steerable`), and whatever tool activity its executor exposes. `undefined` for an unknown
   * id. This is the counterpart to `send`: a driver that can steer but cannot observe has
   * nothing to steer on, which is precisely why steering went unused.
   *
   * Pull-based and side-effect free — reading it starts no timer and spends nothing. `now` and
   * `stallAfterMs` are injectable so a caller (and a test) controls what counts as stalled.
   */
  progress(
    nodeId: NodeId,
    opts?: { now?: number; stallAfterMs?: number },
  ): WorkerProgress | undefined
  /** The complete owned tree, including nested managers and resumed nodes. */
  observeTree?(): TreeView
  /** Bounded live output; unavailable or expired history is reported explicitly. */
  observeEvents?(
    nodeId: NodeId,
    cursor?: import('../worker-events').WorkerEventCursor,
  ): import('../worker-events').WorkerEventPage
  /** The live tool-call trace of one child when its executor exposes one (`Executor.traceSource`),
   *  for running the online detector panel over a RUNNING worker. `undefined` otherwise. */
  traceSource(nodeId: NodeId): TraceSource | undefined
  /**
   * Attach a human terminal to the exact process ONE child is running in.
   *
   * Returns that child's `RetainedInteractiveRunHandle` when its executor holds an interactive
   * session — the caller then types, resizes, detaches, reconnects, and closes against the same
   * admitted execution, with one ordered output history. Every other worker returns an explicit
   * `unavailable` reason: a headless run, a runner whose provider publishes no interactive
   * contract, and an unknown or settled node are each distinguishable, and none of them is ever
   * converted into a fake attachment.
   */
  interactive(nodeId: NodeId): WorkerInteractiveSession
  /**
   * Ask one child's backend to stop, and report what it acknowledged. It delegates to
   * `Executor.cancel` when the runtime has one; otherwise the child is aborted locally and the
   * answer is `unknown`, never `accepted`. Resource release still belongs to teardown.
   */
  cancel(nodeId: NodeId, request: ExecutorCancellationRequest): Promise<ExecutorCancellation>
  /** This scope's abort signal — aborted when the run is cancelled, a breaker trips, the pool
   *  is exhausted, or a parent scope cascades. A long-running driver `act` over this scope reads
   *  it to break promptly (the conserved pool + driver-stop are the other bounds). A nested
   *  scope carries its own signal, chained off its driver child's abort. */
  readonly signal: AbortSignal
  /**
   * Meter the driver's OWN compute against the conserved pool — its inference turns, which are
   * real tokens/usd but not a spawned child (no reserve/reconcile). A direct `free → committed`
   * debit, so equal-k counts the driver's tokens AND the in-loop budget guard (`budget.tokensLeft`)
   * halts a driver that thinks the pool dry. `detail` rides an `agent.turn` trace event for live
   * observability (turn index, tool calls, cumulative spend). It also journals a `metered` event —
   * the durable twin of the pool debit (as `settled` is the twin of `reconcile`) — so every
   * journal-based cost reader (`spentFromJournal`, `trajectoryReport`) sums driver inference
   * automatically. A leaf never calls this; a driver meters each chat turn and awaits it (the
   * metered event is cost-critical, so it lands before the join-barrier roll-up).
   */
  meter(spend: Spend, detail?: Record<string, unknown>): Promise<void>
  /**
   * Prior committed work, present ONLY on a resumed run (`undefined` on a fresh run, which is
   * every run that did not pass `SupervisorOpts.resume`). The supervisor `loadTree`s the journal
   * first; when a non-empty tree exists it rehydrates the already-settled children (via
   * `replaySpawnTree`) and hands them here so a resume-aware `act` re-uses them instead of
   * re-spawning committed work. A resume-blind driver simply ignores it and re-spawns — correct
   * but redundant. The scope's spawn ordinal + cursor seq are already advanced past the recorded
   * maxima, so any NEW spawn appends without colliding with a journaled event.
   *
   * Retained provider children can reconcile their original execution through `recoverExecutor`.
   * Missing recovery evidence leaves keyed work in doubt.
   * Local ownership does not provide distributed fencing.
   * @experimental
   */
  readonly resume?: ResumedWork<Out>
  /** The live tree — reads the in-memory nursery, not the journal. */
  readonly view: TreeView
  /** Conserved-pool readouts (post-reservation). */
  readonly budget: import('../budget').BudgetReadout
  /** The worker-slot allocator as this scope sees it. Every scope of a tree, and every tree that
   *  shares the allocator, reads the same counts; the root agent itself holds no slot. `working`
   *  counts agents that hold a slot, `queued` counts admitted spawns that wait for one, and
   *  `freeSlots` is `null` when no bound is set. `unconfirmed` NAMES this scope's settled children
   *  whose executor teardown was never acknowledged. Empty on every healthy run. */
  readonly workerCapacity: Readonly<{
    working: number
    queued: number
    freeSlots: number | null
    unconfirmed: ReadonlyArray<UnconfirmedTeardown>
  }>
}

/** One settled child whose executor teardown was never acknowledged: the run cannot prove the
 *  resource is gone. Named so an operator can act on it. */
export interface UnconfirmedTeardown {
  readonly id: NodeId
  readonly label: string
  readonly runtime: Runtime
  readonly status: NodeStatus
  /** The provider environments the node may still hold and nothing keeps on purpose, by the
   *  provider's own id: what an operator's sweeper deletes. Present when the executor names at
   *  least one (`Executor.heldEnvironments`); absence means nothing was named, never "nothing is
   *  held". Never contains a kept environment. */
  readonly environments?: ReadonlyArray<HeldEnvironment>
  /** The environments the node holds on purpose, each with `keptFor` set: a retained execution
   *  a resume reconciles, or a workspace preserved as evidence. A sweeper never deletes these. */
  readonly kept?: ReadonlyArray<HeldEnvironment>
  /** How many teardown requests Runtime sent the executor. */
  readonly attempts?: number
  /** Why the last attempt did not confirm destruction. */
  readonly detail?: string
}

/**
 * The committed work a resumed run inherits from its journal. `settled` is the replayed
 * `Settled[]` (cursor-ordered, rehydrated from the blob store by `replaySpawnTree`); `view`
 * is the tree as `materializeTreeView` folded it at the recorded cursor position. A
 * resume-aware `act` reads `scope.resume?.settled` to pick up where the crashed run left off.
 */
export interface ResumedWork<Out> {
  readonly settled: ReadonlyArray<Settled<Out>>
  readonly view: TreeView
  /**
   * Keyed assignments from the prior journal: `SpawnOpts.key` → what the journal proves about it.
   * `completed`/`down` carry the rehydrated settlement; `in-doubt` means the spawn was journaled
   * but no settlement ever landed — the process died with it in flight. `Scope.spawn` refuses a
   * keyed replacement in that state, rather than duplicate a possibly live remote execution. Empty
   * when no prior spawn carried a key.
   */
  readonly keys: ReadonlyMap<string, ResumedKeyState<Out>>
  /**
   * The conserved spend the prior process(es) already committed for this run, summed off the same
   * journal replay reads: every `settled` child's reconciled spend (`childWork`) plus every
   * `metered` driver-inference record (`driverInference`). What a resume-aware driver reports as
   * "already paid" — the run's final `spentTotal` includes it because the journal spans processes.
   */
  readonly priorSpend: { readonly childWork: Spend; readonly driverInference: Spend }
  /**
   * This scope's direct workers the journal held open when the prior process stopped, and those
   * this process re-places (`replaced`, a subset of `live`). The rest are gone: they will not
   * report. The root's `root-reentered` journal record and its first re-entered drive both read
   * this one value.
   */
  readonly reentered: ReenteredWorkers
}

/** The workers a resumed scope found open; see {@link ResumedWork.reentered}. */
export interface ReenteredWorkers {
  readonly live: ReadonlyArray<NodeId>
  readonly replaced: ReadonlyArray<NodeId>
}

/** What the journal proves about one keyed assignment at resume time. */
export interface ResumedKeyState<Out = unknown> {
  readonly id: NodeId
  readonly label: string
  /** Identity recorded when this key was first admitted. Every reuse must match it exactly. */
  readonly identity?: NodeExecutionIdentity
  readonly state: 'completed' | 'down' | 'in-doubt'
  /** The rehydrated settlement; absent when `state` is `'in-doubt'`, and when `'down'` was
   * *derived* — the resume itself proved the execution dead (an `inline` runtime cannot outlive
   * its process), so there is no settlement to rehydrate and `reason` says how it died. */
  readonly settled?: Settled<Out>
  /** Why a derived `'down'` state exists. Absent on every state backed by a settlement. */
  readonly reason?: string
}

/**
 * The progressive-widening gate (MCTS-PW). Decides whether a settled child is
 * `promising` enough to spawn another under the remaining pool. DEFAULTS TO FLAT
 * (`shouldWiden` always false) so a gate run never widens and the selector≠judge
 * firewall conflict (R2) stays dormant. When widening IS enabled, `promising` MUST be
 * derived from TRACE findings (`analyses`), never raw `verdict` — or the gate carries
 * an explicit, argued `judgeExempt: true` (the documented escape hatch, off by default).
 */
export interface WidenGate<Out> {
  /** Default impl returns false for every settlement (flat — never widens). */
  shouldWiden(settled: Settled<Out>, budget: Scope<Out>['budget']): boolean
  /** When true, widening may read `verdict` directly (collides with the steer firewall —
   *  must be explicitly argued per cell, never defaulted on). */
  readonly judgeExempt?: boolean
}
