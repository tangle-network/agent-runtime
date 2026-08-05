/**
 *
 * The reactive `Scope` impl (KEYSTONE, build step 4 + the step-8 adapter).
 *
 * An `Agent.act` runs inside a `Scope`. It `spawn`s children dynamically and reacts to
 * them via `next()`. The scope owns ONE in-memory nursery — the authoritative live set —
 * and is the single place that drives a child's lifecycle: reserve budget atomically,
 * resolve a `Executor` through the open registry, run it (one-shot OR streaming),
 * fold its normalized `UsageEvent`s into a conserved `Spend`, reconcile the reservation
 * (refunding the unspent remainder), persist the result blob + journal records, and
 * deliver the `Settled` through the `next()` cursor.
 *
 * Three invariants this impl enforces by construction:
 *  - `next()` is a ray.wait n=1 cursor over THIS scope's live set; it assigns the
 *    monotonic `seq` (the recorded cursor order) at the moment it yields a settlement, so
 *    replay re-delivers in the identical order — `seq` is never wall-clock.
 *  - Budget is reserved at spawn and reconciled at settle through the shared `BudgetPool`,
 *    so `spawn` fails CLOSED on an exhausted pool and total ≡ free + reserved + committed.
 *  - `view` reads the in-memory nursery, never the journal — O(live), synchronous.
 *
 * The settle path is the only writer of journal `settled` events; the spawn path the only
 * writer of `spawned` events. The result blob is `put` BEFORE the journal `settled` record
 * references its `outRef`, so a crash can never leave a journaled ref with no blob.
 *
 * @stable
 */

import {
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  type Sha256Digest,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent, type RuntimeHooks } from '../../runtime-hooks'
import type { Iteration } from '../types'
import { type BudgetPool, createBudgetPool, type ReservationTicket } from './budget'
import {
  armDeadlineTimer,
  boundedChildDeadlineAt,
  DEFAULT_SUCCESSFUL_SHUTDOWN_MS,
  teardownExecutor,
} from './deadline'
import { freeSlots } from './dispatch'
import { executableAgentSpecSnapshot } from './executable-spec'
import {
  authoredProfileDigest,
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
  newExecutionAttemptId,
  runtimeOwnedDeferredExecutorRuntime,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedPendingExecutorMaterialization,
  unknownExecutionBindingReceipt,
  unknownMaterializationReceipt,
} from './materialization'
import {
  DEFAULT_STALL_AFTER_MS,
  type ExecutorProgress,
  readWorkerProgress,
  type WorkerProgress,
} from './progress'
import { detachedSnapshot } from './snapshot'
import { captureWorkerTraceEvidence } from './trace-evidence'
import type { TraceSource } from './trace-source'
import { runtimeOwnedNestedDriverTreeRoot } from './tree-key'
import type {
  Agent,
  AgentSpec,
  Budget,
  DefaultVerdict,
  ExecutionBindingReceipt,
  Executor,
  ExecutorContext,
  ExecutorExecutionBinding,
  ExecutorNodeContext,
  ExecutorRegistry,
  ExecutorResult,
  Handle,
  NodeExecutionIdentity,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  ProfileMaterializationReceipt,
  ResultBlobStore,
  ResumedKeyState,
  ResumedWork,
  Scope,
  Settled,
  SpawnJournal,
  SpawnOpts,
  SpawnPrior,
  SpawnRejection,
  Spend,
  TreeView,
  UsageEvent,
  WaitOpts,
  WorkerTraceEvidence,
} from './types'
import {
  assertWaitWithinDeadline,
  type PendingWait,
  runWait,
  validateWaitSpec,
  type WaitOutcome,
  type WaitProbeRegistry,
  type WaitRejection,
  type WaitSpec,
} from './wait'
import { type WorkerTraceResolver, workerTraceSeamKey } from './worker-trace'

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
  /** Predicate resolver for `poll` wait-states. Absent ⇒ `wait` refuses a `poll` with
   *  `unknown-probe`; `timer` waits never touch it. */
  readonly probes?: WaitProbeRegistry
  /** Injected sleeper for wait-states — a test drives a week-long timer in microseconds. */
  readonly waitSleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** Per-spawn executor-construction seams (sandbox client, router config, cli bin). */
  readonly seams: Readonly<Record<string, unknown>>
  /** This scope's recursion depth (root = 0). */
  readonly depth: number
  /** Runtime recursion-depth ceiling — a spawn past it fails closed `depth-exceeded`. */
  readonly maxDepth?: number
  /** Root-owned limit on live spawned workers across this scope and every nested scope. */
  readonly maxLiveWorkers?: number
  /** @internal Shared counter inherited by nested scopes. Callers set `maxLiveWorkers`; the root
   *  scope creates this state once and passes the same object through its recursion seam. */
  readonly liveWorkerCapacity?: LiveWorkerCapacityState
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
   * context (`WORKER_TRACE_PROPAGATION[backend] === false` — bridge / cli-worktree have no env
   * channel; router / router-tools / provider have no worker process). Each spawn then journals a
   * `trace-unpropagated` event naming the severed hop, so a child whose trace shows up as a
   * disconnected root is a recorded fact rather than a silent stranger. Absent ⇒ either the run
   * is untraced or the backend propagates; nothing is journaled.
   */
  readonly workerTraceUnpropagated?: {
    readonly backend: string
    readonly reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted'
  }
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
    readonly settled: ReadonlyArray<Settled<unknown>>
    readonly view: TreeView
    /** Highest `spawned` ordinal already journaled; new spawns start at `+1`. */
    readonly maxSpawnOrdinal: number
    /** Highest cursor `seq` already journaled; new settlements start at `+1`. */
    readonly maxCursorSeq: number
    /** Highest `waiting` ordinal already journaled; new waits start at `+1`. */
    readonly maxWaitOrdinal: number
    /** Waits journaled as armed but never woken — re-armed (same node id, same absolute deadline)
     *  when `wait` is called again with the SAME label. */
    readonly waits: ReadonlyArray<PendingWait>
    /** Keyed assignments from the prior journal — what a keyed re-spawn resolves against. */
    readonly keys: ReadonlyMap<string, ResumedKeyState<unknown>>
    /** Prior committed spend summed off the journal (settled child work + metered inference). */
    readonly priorSpend: { readonly childWork: Spend; readonly driverInference: Spend }
  }
}

/** Mutable only inside Scope admission/release. Every nested scope receives this exact object. */
export interface LiveWorkerCapacityState {
  readonly max: number | undefined
  live: number
}

/**
 * Internal live-set entry. `settled` resolves once the child's executor has fully drained,
 * its reservation reconciled, and its result blob persisted; `next()` awaits these to drive
 * the cursor. `resolved` mirrors that terminal value synchronously so a concurrent `next()`
 * can pick the next undelivered settlement without re-racing. `delivered` guards exactly-once
 * delivery; `seq` is stamped by `next()`, never here.
 */
interface LiveChild {
  readonly id: NodeId
  status: NodeStatus
  runtime: NodeSnapshot['runtime']
  readonly ownedTreeRoot?: NodeId
  readonly budget: Budget
  readonly label: string
  readonly assignmentId?: string
  readonly identity?: NodeExecutionIdentity
  /** The semantic spawn key, when this child was spawned with one — the settle path folds the
   *  terminal state back into the scope's key registry under it. */
  readonly key?: string
  spent: Spend
  outRef?: string
  /** Durable structured tool evidence once this executor is terminal. */
  trace?: WorkerTraceEvidence
  /** Exact terminal timestamp committed to the journal. */
  settledAt?: number
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
  /** Kernel-owned declaration of the exact execution plan, durable before `execute` starts. */
  materialization?: ProfileMaterializationReceipt
  /** One immutable record per concrete execution attempt. */
  executionBindings: ExecutionBindingReceipt[]
  /** Wall-clock of the spawn, and of the last metered usage event this child produced. Both are
   *  stamped by the scope from the stream the conserved pool already meters, so EVERY executor —
   *  including one that implements no progress read at all — has an observable liveness signal. */
  readonly startedAt: number
  lastActivityAt: number
  /** Present ONLY on a wait-state node. Its presence is what routes the settle path to the
   *  `woken` journal event instead of `settled`, and what keeps a wait out of `inFlight`. */
  readonly wait?: {
    readonly spec: WaitSpec
    readonly armedAt: number
    readonly label: string
    armCommitted: boolean
  }
}

/** A child's terminal settlement before the cursor stamps the monotonic `seq`. A wait-state's
 *  `done` carries a `WaitOutcome` as its `out` and a zero `spent` — waiting is free by type, not
 *  by measurement. */
type PreSeqSettled =
  | {
      kind: 'done'
      out: unknown
      outRef: string
      verdict?: DefaultVerdict
      spent: Spend
      trace: WorkerTraceEvidence
      /** A driver child's OWN-inference subtree total (from `Executor.metered()`) — journaled as a
       *  `metered` event for this node, NOT reconciled (already debited live via `observe`). */
      metered?: Spend
    }
  | {
      kind: 'down'
      reason: string
      infra: boolean
      restartCount: number
      trace: WorkerTraceEvidence
      /** A CRASHED driver child's partial OWN-inference subtree total — re-homed on the down path
       *  too, so the journal matches the pool (which already debited it via `observe`). */
      metered?: Spend
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
}

interface DeferredOwnerSlot {
  ownerMaterialization?: NonNullable<ScopeArgs['ownerMaterialization']>
}

function makeNestedScopeSeam(
  args: ScopeArgs,
  liveWorkerCapacity: LiveWorkerCapacityState,
  childNodeId: NodeId,
  childBudget: Budget,
  childDeadlineAtMs: number | undefined,
  deferredOwner: DeferredOwnerSlot,
): NestedScopeSeam {
  const now = args.now ?? Date.now
  return {
    nodeId: childNodeId,
    depth: args.depth,
    ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
    journalRoot: args.root,
    mount(nestedRoot: NodeId, signal: AbortSignal): Scope<unknown> {
      const deadlineMs =
        childDeadlineAtMs === undefined ? undefined : Math.max(0, childDeadlineAtMs - now())
      const nestedBudget = {
        ...childBudget,
        ...(deadlineMs !== undefined ? { deadlineMs } : {}),
      }
      return createScope<unknown>({
        parentId: childNodeId,
        root: nestedRoot,
        pool: createBudgetPool(nestedBudget, now),
        journal: args.journal,
        blobs: args.blobs,
        executors: args.executors,
        // Re-seed the parent's NON-recursion seams (sandbox/router for leaf grandchildren);
        // the nested scope adds its OWN nested-scope seam per child in `spawn`.
        seams: args.seams,
        depth: args.depth + 1,
        ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
        liveWorkerCapacity,
        signal,
        ...(args.now ? { now: args.now } : {}),
        ...(args.hooks ? { hooks: args.hooks } : {}),
        // The nested scope resolves the trace context against ITS OWN `parentId` (this driver
        // child), so a grandchild worker joins under the middle node's span, not the run root's.
        ...(args.workerTrace ? { workerTrace: args.workerTrace } : {}),
        ...(args.workerTraceUnpropagated
          ? { workerTraceUnpropagated: args.workerTraceUnpropagated }
          : {}),
        ...(deferredOwner.ownerMaterialization === undefined
          ? {}
          : { ownerMaterialization: deferredOwner.ownerMaterialization }),
      })
    },
  }
}

/** Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. */
export function createScope<Out>(args: ScopeArgs): Scope<Out> {
  const children = new Map<NodeId, LiveChild>()
  const liveWorkerCapacity: LiveWorkerCapacityState = args.liveWorkerCapacity ?? {
    max: normalizeLiveWorkerLimit(args.maxLiveWorkers),
    live: 0,
  }
  // Two distinct monotonic counters in two namespaces:
  //  - `spawnOrdinal` is the spawn order (0,1,2,…); it mints the deterministic node id
  //    `${parent}:s${ordinal}` and stamps the `spawned` event's `seq`. Known at spawn.
  //  - `cursorSeq` is the order `next()` yields settlements (B2); it stamps the
  //    `settled`/`cancelled` event's `seq` and the `Settled.seq` the driver branches on.
  // They are separate so a `spawned` event never collides with a `settled` event in the
  // journal's per-tree uniqueness guard (which is scoped to the cursor namespace).
  // On a resumed scope, continue both monotonic namespaces PAST the recorded maxima so a
  // freshly-spawned child or settlement never reuses a journaled `seq` (the per-tree
  // uniqueness guard would otherwise fail loud). On a fresh scope both start at 0.
  //  - `waitOrdinal` is a THIRD namespace for wait-states (`${parent}:w${ordinal}`, stamping the
  //    `waiting` event's `seq`), separate from the spawn ordinal so a wait and a worker can never
  //    mint the same node id.
  let spawnOrdinal = args.resumeFrom ? args.resumeFrom.maxSpawnOrdinal + 1 : 0
  let cursorSeq = args.resumeFrom ? args.resumeFrom.maxCursorSeq + 1 : 0
  let waitOrdinal = args.resumeFrom ? args.resumeFrom.maxWaitOrdinal + 1 : 0
  let meterSeq = 0
  const now = args.now ?? Date.now
  // Waits the journal shows as armed but never woken, keyed by label. `wait` RE-ADOPTS one instead
  // of arming a fresh countdown — that is what makes a resumed deadline the ORIGINAL deadline.
  const unclaimedWaits = new Map<string, PendingWait>(
    (args.resumeFrom?.waits ?? []).map((w) => [w.label, w]),
  )

  // The semantic-key registry (`SpawnOpts.key`): every keyed assignment's current state, seeded
  // from the prior journal on resume and updated live as keyed children spawn and settle. This is
  // what makes a keyed spawn idempotent per key across process lifetimes: `done` returns the
  // committed result, `live` refuses a concurrent duplicate, `down`/`in-doubt` spawn fresh but
  // say so explicitly.
  type KeyState =
    | { readonly state: 'live'; readonly id: NodeId; readonly identity: NodeExecutionIdentity }
    | {
        readonly state: 'done'
        readonly id: NodeId
        readonly identity: NodeExecutionIdentity
        readonly settled: Settled<Out> & { kind: 'done' }
      }
    | {
        readonly state: 'down'
        readonly id: NodeId
        readonly identity: NodeExecutionIdentity
        readonly reason: string
      }
    | { readonly state: 'in-doubt'; readonly id: NodeId; readonly identity: NodeExecutionIdentity }
  const keyed = new Map<string, KeyState>()
  for (const [key, prior] of args.resumeFrom?.keys ?? []) {
    if (prior.state === 'completed' && prior.settled?.kind === 'done') {
      if (prior.identity === undefined) continue
      keyed.set(key, {
        state: 'done',
        id: prior.id,
        identity: prior.identity,
        settled: prior.settled as Settled<Out> & { kind: 'done' },
      })
    } else if (prior.state === 'down' && prior.settled?.kind === 'down') {
      if (prior.identity === undefined) continue
      keyed.set(key, {
        state: 'down',
        id: prior.id,
        identity: prior.identity,
        reason: prior.settled.reason,
      })
    } else if (prior.identity !== undefined) {
      keyed.set(key, { state: 'in-doubt', id: prior.id, identity: prior.identity })
    }
  }
  /** Fold a keyed child's terminal settlement back into the registry, so a later spawn with the
   *  same key resolves to it (done → committed result; down → explicit retry). */
  const recordKeyedSettlement = (key: string, settled: Settled<Out>): void => {
    const identity = settled.handle.identity
    if (identity === undefined) {
      throw new ValidationError(`scope: keyed settlement '${key}' lost its execution identity`)
    }
    if (settled.kind === 'done') {
      keyed.set(key, { state: 'done', id: settled.handle.id, identity, settled })
    } else {
      keyed.set(key, { state: 'down', id: settled.handle.id, identity, reason: settled.reason })
    }
  }

  function spawn<C extends Out>(
    agentOrFactory: Agent<unknown, C> | (() => Agent<unknown, C>),
    rawTask: unknown,
    rawOpts: SpawnOpts,
  ):
    | { ok: true; handle: Handle<C>; prior?: SpawnPrior<C> }
    | { ok: false; reason: SpawnRejection } {
    if (args.signal.aborted) return { ok: false, reason: 'scope-aborted' }
    const task = detachedSnapshot(rawTask, 'scope.spawn task')
    const opts = detachedSnapshot(rawOpts, 'scope.spawn options')

    // A key is an identity claim, not merely a cache label. On every reuse, prepare the requested
    // agent far enough to derive the authorized profile/task identity, then compare it with the
    // journal before returning an old result or retrying old work. No executor is resolved,
    // constructed, reserved, or run on the completed path.
    let prior: SpawnPrior<C> | undefined
    let prepared:
      | {
          readonly agent: Agent<unknown, C>
          readonly spec: AgentSpec
          readonly identity: NodeExecutionIdentity | undefined
        }
      | undefined
    const prepare = () => {
      const agent = typeof agentOrFactory === 'function' ? agentOrFactory() : agentOrFactory
      const rawSpec = (agent as unknown as { executorSpec?: unknown }).executorSpec
      if (!isAgentSpec(rawSpec)) {
        throw new ValidationError(
          `scope.spawn: agent "${agent.name}" exposes no \`executorSpec\` (AgentSpec) to resolve a Executor`,
        )
      }
      const spec = executableAgentSpecSnapshot(rawSpec, 'scope.spawn')
      return { agent, spec, identity: deriveNodeExecutionIdentity(spec, task) }
    }
    if (opts.key !== undefined) {
      const existing = keyed.get(opts.key)
      if (existing !== undefined) {
        prepared = prepare()
        if (!isCompleteIdentity(prepared.identity)) {
          return { ok: false, reason: 'invalid-identity' }
        }
        if (!sameNodeExecutionIdentity(existing.identity, prepared.identity)) {
          return { ok: false, reason: 'key-conflict' }
        }
      }
      if (existing?.state === 'live') return { ok: false, reason: 'duplicate-key' }
      if (existing?.state === 'done') {
        return {
          ok: true,
          handle: existing.settled.handle as Handle<C>,
          prior: { state: 'completed', settled: existing.settled as Settled<C> & { kind: 'done' } },
        }
      }
      if (existing?.state === 'down') {
        prior = { state: 'retried', priorId: existing.id, reason: existing.reason }
      } else if (existing?.state === 'in-doubt') {
        prior = { state: 'lost', priorId: existing.id }
      }
    }

    if (args.maxDepth !== undefined && args.depth >= args.maxDepth) {
      return { ok: false, reason: 'depth-exceeded' }
    }

    // A concrete child exposes its profile now, so parse and seal it before capacity or budget
    // admission. A lazy agent factory cannot reveal a profile without being constructed; preserve
    // the refusal invariant for those factories and validate the result immediately after the
    // reservation, before registry resolution or any executor code.
    if (typeof agentOrFactory !== 'function') prepared ??= prepare()

    // ONE admission counter is shared by the root scope and every recursive scope it mounts.
    // Acquire before calling a lazy worker factory, resolving/constructing its executor, or
    // reserving budget. A completed keyed assignment returned above never touches the counter.
    const permit = acquireLiveWorker(liveWorkerCapacity)
    if (!permit.ok) return { ok: false, reason: 'max-live-workers' }

    // Reserve the child's whole ceiling atomically; fail CLOSED when the pool can't cover
    // it (never read-then-spawn overcommit, so Σk is conserved by construction). This happens
    // before a fresh lazy agent factory is called: refused work constructs nothing.
    let reservation: ReturnType<BudgetPool['reserve']>
    try {
      reservation = args.pool.reserve(opts.budget)
    } catch (error) {
      permit.release()
      throw error
    }
    if (!reservation.ok) {
      permit.release()
      return { ok: false, reason: reservation.reason }
    }

    // Resolve the leaf executor through the open registry after both worker and budget admission.
    // If preparation fails, refund the reservation here because runChild never receives it.
    let spec: AgentSpec
    let resolved: { succeeded: true; value: (spec: AgentSpec, ctx: ExecutorContext) => Executor<C> }
    let identity: NodeExecutionIdentity | undefined
    try {
      prepared ??= prepare()
      spec = prepared.spec
      identity = prepared.identity
      if (opts.key !== undefined && !isCompleteIdentity(identity)) {
        args.pool.reconcile(reservation.ticket, zeroSpend())
        permit.release()
        return { ok: false, reason: 'invalid-identity' }
      }
      const outcome = args.executors.resolve<C>(spec)
      if (!outcome.succeeded) throw new ValidationError(`scope.spawn: ${outcome.error}`)
      resolved = outcome
    } catch (error) {
      args.pool.reconcile(reservation.ticket, zeroSpend())
      permit.release()
      throw error
    }

    // Everything between reserve and runChild's hand-off owns the reservation. A SYNCHRONOUS
    // throw here (most likely the executor factory `resolved.value(spec, ctx)`) would otherwise
    // leak the reservation — runChild, which reconciles the ticket, is never reached. Release it
    // with zero spend on throw, then rethrow, so `total ≡ free + reserved + committed` holds.
    // (runChild is the last statement and never sync-throws, so there is no double-reconcile.)
    let cascadeAbort: (() => void) | undefined
    let clearChildDeadline: (() => void) | undefined
    try {
      const ordinal = spawnOrdinal++
      const id: NodeId = `${args.parentId}:s${ordinal}`
      const attemptId = newExecutionAttemptId(id)
      const startedAt = now()
      const childDeadlineAtMs = boundedChildDeadlineAt(
        args.pool.readout().deadlineMs,
        opts.budget.deadlineMs,
        startedAt,
      )

      // The child's abort chains off this scope's signal (a scope abort reaps every child)
      // AND off its own handle.abort() or bounded deadline. Aborting mid-acquire cascades through
      // the executor's signal into its acquireSandbox find-by-name reap, so an acquiring node
      // never leaks.
      const controller = new AbortController()
      cascadeAbort = () => controller.abort(args.signal.reason)
      if (args.signal.aborted) controller.abort(args.signal.reason)
      else args.signal.addEventListener('abort', cascadeAbort, { once: true })
      if (childDeadlineAtMs !== undefined) {
        clearChildDeadline = armDeadlineTimer(Math.max(0, childDeadlineAtMs - now()), () =>
          controller.abort('child deadline exceeded'),
        )
      }

      // Seed THIS scope's own keystone deps into the child's `ExecutorContext.seams`, so a
      // child whose executor is a DRIVER can mount a nested `Scope` at `depth+1` over a child
      // pool backed by THIS reservation. A leaf executor ignores it; the parent's sandbox/router
      // seams still pass through for leaves. Each nested driver repeats the same partitioning.
      const deferredOwner: DeferredOwnerSlot = {}
      // Resolved per spawn, not once per scope: the span of the spawning node is opened by the
      // `agent.spawn` hook, so reading it lazily needs no assumption about hook ordering. Absent
      // resolver (the untraced default) ⇒ no seam, and the child's `ExecutorContext` is exactly
      // the object it was before worker trace propagation existed.
      const workerTrace = args.workerTrace?.(args.parentId)
      const ctx: ExecutorContext = {
        signal: controller.signal,
        node: {
          rootId: args.root,
          parentId: args.parentId,
          nodeId: id,
          attemptId,
          ...(identity ? { identity } : {}),
        },
        seams: {
          ...args.seams,
          [nestedScopeSeamKey]: makeNestedScopeSeam(
            args,
            liveWorkerCapacity,
            id,
            opts.budget,
            childDeadlineAtMs,
            deferredOwner,
          ),
          ...(workerTrace ? { [workerTraceSeamKey]: workerTrace } : {}),
        },
      }
      const executor = resolved.value(spec, ctx) as Executor<C>
      const ownedTreeRoot = runtimeOwnedNestedDriverTreeRoot(executor, args.root, id)

      const handle: Handle<C> = {
        id,
        label: opts.label,
        ...(opts.assignmentId === undefined ? {} : { assignmentId: opts.assignmentId }),
        ...(identity ? { identity } : {}),
        get status(): NodeStatus {
          return children.get(id)?.status ?? 'cancelled'
        },
        get materialization(): ProfileMaterializationReceipt | undefined {
          return children.get(id)?.materialization
        },
        get executionBindings(): ReadonlyArray<ExecutionBindingReceipt> | undefined {
          const bindings = children.get(id)?.executionBindings
          return bindings && bindings.length > 0 ? Object.freeze([...bindings]) : undefined
        },
        abort(reason?: string): void {
          controller.abort(reason)
        },
      }

      const live: LiveChild = {
        id,
        status: 'acquiring',
        runtime: executor.runtime,
        ...(ownedTreeRoot === undefined ? {} : { ownedTreeRoot }),
        ...(identity ? { identity } : {}),
        budget: opts.budget,
        label: opts.label,
        ...(opts.assignmentId === undefined ? {} : { assignmentId: opts.assignmentId }),
        ...(opts.key !== undefined ? { key: opts.key } : {}),
        spent: zeroSpend(),
        settled: undefined as unknown as Promise<PreSeqSettled>,
        delivered: false,
        executorDone: false,
        cleanupConfirmed: false,
        executionBindings: [],
        startedAt,
        lastActivityAt: startedAt,
        ...(executor.deliver
          ? { deliver: (message: unknown): boolean => executor.deliver?.(message) !== false }
          : {}),
        ...(executor.progress ? { readProgress: executor.progress.bind(executor) } : {}),
        ...(executor.traceSource ? { readTraceSource: executor.traceSource.bind(executor) } : {}),
      }
      children.set(id, live)
      if (opts.key !== undefined) {
        keyed.set(opts.key, {
          state: 'live',
          id,
          identity: identity as NodeExecutionIdentity,
        })
      }

      const spawnCommitted = args.journal
        .appendEvent(args.root, {
          kind: 'spawned',
          id,
          parent: args.parentId,
          label: opts.label,
          ...(opts.key !== undefined ? { key: opts.key } : {}),
          ...(opts.assignmentId === undefined ? {} : { assignmentId: opts.assignmentId }),
          budget: opts.budget,
          runtime: executor.runtime,
          ...(ownedTreeRoot === undefined ? {} : { ownedTreeRoot }),
          ...(identity ? { identity } : {}),
          seq: ordinal,
          at: new Date(now()).toISOString(),
        })
        .then(async () => {
          // The severed distributed-trace hop, journaled beside the spawn it annotates: this run
          // records spans AND resolved a context for this child, but the backend has no channel to
          // carry it — the child's own trace will surface as a disconnected root, and this record
          // is what makes that a queryable fact instead of a silent stranger tree.
          if (args.workerTraceUnpropagated === undefined || workerTrace === undefined) return
          await args.journal.appendEvent(args.root, {
            kind: 'trace-unpropagated',
            id,
            expectedTraceId: workerTrace.traceId,
            backend: args.workerTraceUnpropagated.backend,
            reason: args.workerTraceUnpropagated.reason,
            seq: ordinal,
            at: new Date(now()).toISOString(),
          })
        })
      let pendingEvidence: { complete: () => Promise<void>; fail: () => Promise<void> } | undefined
      const materializationCommitted = spawnCommitted.then(async () => {
        const profileDigest = identity?.profileDigest ?? authoredProfileDigest(spec.profile)
        let receipt: ProfileMaterializationReceipt
        let binding: ExecutionBindingReceipt
        const declaration = runtimeOwnedExecutorMaterialization(executor)
        const pending = runtimeOwnedPendingExecutorMaterialization(executor)
        const deferredRuntime = runtimeOwnedDeferredExecutorRuntime(executor)
        if (deferredRuntime !== undefined) {
          deferredOwner.ownerMaterialization = {
            runtime: deferredRuntime,
            authoredProfile: spec.profile,
            attemptId,
            journalRoot: args.root,
            nodeId: id,
            requiredKnown: true,
            onReceipt(materialization, executionBinding) {
              live.runtime = materialization.runtime
              live.materialization = materialization
              live.executionBindings.push(executionBinding)
            },
          }
          return
        }
        if (pending !== undefined) {
          if (profileDigest === undefined) {
            throw new ValidationError(
              'scope.spawn: a pending materialization requires a canonical authored profile',
            )
          }
          if (pending.runtime !== executor.runtime || pending.binding.attemptId !== attemptId) {
            throw new ValidationError(
              'scope.spawn: pending executor did not bind the kernel-minted attempt id',
            )
          }
          // Validate the planned shape before spend, but do not persist it as proof that the
          // external bridge actually used it. Only the terminal acknowledgement can finalize it.
          const plannedReceipt = knownMaterializationReceipt({
            authoredProfileDigest: profileDigest,
            runtime: executor.runtime,
            declaration: pending.declaration,
          })
          if (
            plannedReceipt.status !== 'known' ||
            plannedReceipt.effectiveProfileDigest !== plannedReceipt.authoredProfileDigest
          ) {
            throw new ValidationError(
              'scope.spawn: pending executor changed the authored AgentProfile before execution',
            )
          }
          let recorded = false
          pendingEvidence = {
            complete: async () => {
              if (recorded) return
              const acknowledged = runtimeOwnedExecutorMaterialization(executor)
              const acknowledgedBinding = runtimeOwnedExecutorExecutionBinding(executor)
              if (acknowledged === undefined || acknowledgedBinding?.attemptId !== attemptId) {
                throw new ValidationError(
                  'scope.spawn: external executor completed without a terminal materialization acknowledgement',
                )
              }
              const finalReceipt = knownMaterializationReceipt({
                authoredProfileDigest: profileDigest,
                runtime: executor.runtime,
                declaration: acknowledged,
              })
              if (finalReceipt.status !== 'known') {
                throw new ValidationError('scope.spawn: terminal materialization remained unknown')
              }
              if (finalReceipt.effectiveProfileDigest !== finalReceipt.authoredProfileDigest) {
                throw new ValidationError(
                  'scope.spawn: external executor changed the authored AgentProfile',
                )
              }
              const finalBinding = knownExecutionBindingReceipt(finalReceipt, acknowledgedBinding)
              await appendNodeMaterialization(args, id, ordinal, finalReceipt, finalBinding, now)
              live.materialization = finalReceipt
              live.executionBindings.push(finalBinding)
              recorded = true
            },
            fail: async () => {
              if (recorded) return
              // The remote turn can be acknowledged before a later local persistence/check step
              // fails. Preserve that known execution truth even though the child settles down.
              if (runtimeOwnedExecutorMaterialization(executor) !== undefined) {
                await pendingEvidence?.complete()
                return
              }
              const unknown = unknownMaterializationReceipt({
                authoredProfileDigest: profileDigest,
                runtime: executor.runtime,
                reason: 'executor-receipt-pending',
              })
              const unknownBinding = unknownExecutionBindingReceipt(
                unknown,
                attemptId,
                'executor-receipt-pending',
              )
              await appendNodeMaterialization(args, id, ordinal, unknown, unknownBinding, now)
              live.materialization = unknown
              live.executionBindings.push(unknownBinding)
              recorded = true
            },
          }
          return
        }
        if (declaration === undefined) {
          receipt = unknownMaterializationReceipt({
            ...(profileDigest === undefined ? {} : { authoredProfileDigest: profileDigest }),
            runtime: executor.runtime,
            reason: 'executor-did-not-report',
          })
          binding = unknownExecutionBindingReceipt(receipt, attemptId, 'executor-did-not-report')
        } else {
          try {
            if (profileDigest === undefined) {
              throw new ValidationError(
                'scope.spawn: a known materialization requires a canonical authored profile',
              )
            }
            receipt = knownMaterializationReceipt({
              authoredProfileDigest: profileDigest,
              runtime: executor.runtime,
              declaration,
            })
            const reportedBinding = runtimeOwnedExecutorExecutionBinding(executor)
            if (reportedBinding === undefined || reportedBinding.attemptId !== attemptId) {
              throw new ValidationError(
                'scope.spawn: trusted executor did not bind the kernel-minted attempt id',
              )
            }
            binding = knownExecutionBindingReceipt(receipt, reportedBinding)
          } catch (error) {
            receipt = unknownMaterializationReceipt({
              ...(profileDigest === undefined ? {} : { authoredProfileDigest: profileDigest }),
              runtime: executor.runtime,
              reason: 'invalid-executor-report',
            })
            binding = unknownExecutionBindingReceipt(receipt, attemptId, 'invalid-executor-report')
            await appendNodeMaterialization(args, id, ordinal, receipt, binding, now)
            live.materialization = receipt
            live.executionBindings.push(binding)
            throw new ValidationError(
              `scope.spawn: executor ${JSON.stringify(executor.runtime)} returned invalid materialization evidence`,
              { cause: error },
            )
          }
        }
        await appendNodeMaterialization(args, id, ordinal, receipt, binding, now)
        live.materialization = receipt
        live.executionBindings.push(binding)
      })

      notifyRuntimeHookEvent(
        args.hooks,
        {
          id: `${id}:spawn`,
          runId: args.root,
          target: 'agent.spawn',
          phase: 'after',
          timestamp: now(),
          stepIndex: ordinal,
          parentId: args.parentId,
          payload: {
            childId: id,
            label: opts.label,
            ...(opts.assignmentId === undefined ? {} : { assignmentId: opts.assignmentId }),
            runtime: executor.runtime,
            ...(identity ? { identity } : {}),
            budget: opts.budget,
            depth: args.depth,
          },
        },
        { signal: args.signal },
      )

      // Drive the executor to settlement off to the side; `next()` awaits the resulting
      // promise. A thrown executor (or a real abort) is TYPED into a `down` record by
      // `runChild` (never re-thrown) so a single failing child never rejects the cursor.
      const settled = runChild(
        live,
        executor,
        controller,
        task,
        opts,
        args.pool,
        reservation.ticket,
        args.blobs,
        now,
        materializationCommitted,
        {
          complete: async () => pendingEvidence?.complete(),
          fail: async () => pendingEvidence?.fail(),
        },
        childDeadlineAtMs,
      )
        .then((s) => {
          live.resolved = s
          return s
        })
        .finally(() => {
          if (live.cleanupConfirmed) permit.release()
          clearChildDeadline?.()
          if (cascadeAbort) args.signal.removeEventListener('abort', cascadeAbort)
        })
      ;(live as { settled: Promise<PreSeqSettled> }).settled = settled

      return { ok: true, handle, ...(prior ? { prior } : {}) }
    } catch (err) {
      permit.release()
      clearChildDeadline?.()
      if (cascadeAbort) args.signal.removeEventListener('abort', cascadeAbort)
      args.pool.reconcile(reservation.ticket, zeroSpend())
      throw err
    }
  }

  async function next(): Promise<Settled<Out> | null> {
    const undelivered = () => [...children.values()].filter((c) => !c.delivered)
    if (undelivered().length === 0) return null

    // ray.wait n=1: await the FIRST not-yet-delivered child to settle. Loop because a
    // concurrent `next()` may take the race winner between the await and the pick.
    for (;;) {
      const pending = undelivered()
      if (pending.length === 0) return null
      // Prefer an already-resolved-but-undelivered child (no await needed).
      const ready = pending.find((c) => c.resolved !== undefined)
      const chosen = ready ?? (await raceFirstSettled(pending))
      if (chosen.delivered) continue
      chosen.delivered = true

      const seq = cursorSeq++
      const settlement = chosen.resolved
      if (!settlement) {
        throw new ValidationError(
          `scope.next: child '${chosen.id}' won the settle race without a resolved value`,
        )
      }
      const delivered = await finalizeSettlement<Out>(chosen, settlement, seq, args, now)
      if (chosen.key !== undefined) recordKeyedSettlement(chosen.key, delivered)
      return delivered
    }
  }

  async function nextResolved(): Promise<Settled<Out> | null> {
    // Same exactly-once delivery as `next()`, but never awaits a RUNNING executor. A child
    // whose executor has finished (`executorDone`) may still be mid-persistence — awaiting its
    // `settled` promise there completes in bounded bookkeeping time, never on live work.
    for (;;) {
      const candidates = [...children.values()].filter((c) => !c.delivered)
      const pick =
        candidates.find((c) => c.resolved !== undefined) ?? candidates.find((c) => c.executorDone)
      if (!pick) return null
      const settlement = await pick.settled
      if (pick.delivered) continue // lost the race with a concurrent cursor — pick again
      pick.delivered = true
      const seq = cursorSeq++
      const delivered = await finalizeSettlement<Out>(pick, settlement, seq, args, now)
      if (pick.key !== undefined) recordKeyedSettlement(pick.key, delivered)
      return delivered
    }
  }

  function send(nodeId: NodeId, msg: unknown): boolean {
    if (args.signal.aborted) return false
    const child = children.get(nodeId)
    // Deliver only to a child that is still LIVE (not yet yielded by the cursor) and whose executor
    // accepts an inbox. A settled/unknown child, or a leaf with no `deliver`, cannot be steered.
    if (!child || child.delivered || !child.deliver) return false
    const accepted = child.deliver(msg) !== false
    if (!accepted) return false
    // A delivered steer IS activity: it resets the idle clock so a worker that was about to read
    // as stalled is not immediately re-steered before it can act on the message it just got.
    child.lastActivityAt = now()
    return true
  }

  /**
   * Arm a wait-state node. Deliberately NOT a `spawn` with a sleeping executor: it resolves no
   * `AgentSpec`, constructs no `Executor`, and — the point of the whole mechanic — reserves NOTHING
   * from the conserved pool, so a week-long wait costs zero tokens and zero dollars and cannot
   * starve a worker of budget.
   *
   * Fail-closed admission, mirroring `spawn`'s typed outcome. The deadline check is the one that
   * matters: a wait may not silently sleep past the pool's hard wall-clock ceiling, and it may not
   * extend that ceiling either (that would make a wait override a budget guard).
   */
  function wait(
    spec: WaitSpec,
    opts: WaitOpts,
  ): { ok: true; handle: Handle<WaitOutcome> } | { ok: false; reason: WaitRejection } {
    if (args.signal.aborted) return { ok: false, reason: 'deadline-exceeded' }
    if (validateWaitSpec(spec) !== null) return { ok: false, reason: 'invalid-spec' }
    if (spec.kind === 'poll' && args.probes?.resolve(spec.probe) === undefined) {
      return { ok: false, reason: 'unknown-probe' }
    }

    // Re-adopt a journaled, still-unfired wait with this label: same node id, same spec, same
    // ORIGINAL arm instant. The caller passes the spec it would have used fresh; the journaled one
    // wins, so a restart cannot slide the deadline forward.
    const adopted = unclaimedWaits.get(opts.label)
    if (adopted) unclaimedWaits.delete(opts.label)
    const effectiveSpec = adopted?.spec ?? spec
    const armedAt = adopted?.armedAt ?? now()

    if (!assertWaitWithinDeadline(effectiveSpec, args.pool.readout().deadlineMs)) {
      return { ok: false, reason: 'deadline-exceeded' }
    }

    const id: NodeId = adopted ? adopted.id : `${args.parentId}:w${waitOrdinal}`
    const ordinal = adopted ? adopted.ordinal : waitOrdinal
    if (!adopted) waitOrdinal += 1

    const waitAbort = new AbortController()
    const cascadeAbort = () => waitAbort.abort()
    if (args.signal.aborted) waitAbort.abort()
    else args.signal.addEventListener('abort', cascadeAbort, { once: true })

    const handle: Handle<WaitOutcome> = {
      id,
      label: opts.label,
      get status(): NodeStatus {
        return children.get(id)?.status ?? 'cancelled'
      },
      abort(reason?: string): void {
        waitAbort.abort(reason)
      },
    }

    const live: LiveChild = {
      id,
      status: 'waiting',
      runtime: 'wait',
      // A wait's recorded budget is zero on every channel — nothing was reserved, so nothing may
      // be reconciled, and a journal reader sums it as the zero it truly is.
      budget: { maxIterations: 0, maxTokens: 0 },
      label: opts.label,
      spent: zeroSpend(),
      settled: undefined as unknown as Promise<PreSeqSettled>,
      delivered: false,
      executorDone: false,
      cleanupConfirmed: true,
      executionBindings: [],
      startedAt: armedAt,
      lastActivityAt: now(),
      wait: {
        spec: effectiveSpec,
        armedAt,
        label: opts.label,
        armCommitted: adopted !== undefined,
      },
    }
    children.set(id, live)

    // Only a FRESH arm journals `waiting`; an adopted one already has its record (re-writing it
    // would duplicate the wait ordinal in the journal's per-tree guard). A fresh wait may not
    // start racing its timer/probe until this identity record is durable: otherwise a zero-delay
    // wait can journal `woken` before `waiting`, or disappear entirely if this append fails.
    const armCommitted = adopted
      ? Promise.resolve()
      : args.journal.appendEvent(args.root, {
          kind: 'waiting',
          id,
          parent: args.parentId,
          label: opts.label,
          spec: effectiveSpec,
          armedAt,
          seq: ordinal,
          at: new Date(now()).toISOString(),
        })

    const settled = armCommitted
      .then(() => {
        if (live.wait) live.wait.armCommitted = true
        notifyRuntimeHookEvent(
          args.hooks,
          {
            id: `${id}:waiting`,
            runId: args.root,
            target: 'agent.spawn',
            phase: 'after',
            timestamp: now(),
            stepIndex: ordinal,
            parentId: args.parentId,
            payload: {
              childId: id,
              label: opts.label,
              runtime: 'wait',
              wait: effectiveSpec,
              armedAt,
              resumed: adopted !== undefined,
            },
          },
          { signal: args.signal },
        )
        return runWait({
          spec: effectiveSpec,
          label: opts.label,
          armedAt,
          resumed: adopted !== undefined,
          signal: waitAbort.signal,
          ...(args.probes ? { probes: args.probes } : {}),
          now,
          ...(args.waitSleep ? { sleep: args.waitSleep } : {}),
        })
      })
      .then(async (resolution): Promise<PreSeqSettled> => {
        live.executorDone = true
        live.lastActivityAt = now()
        if (resolution.kind === 'cancelled') {
          return {
            kind: 'down',
            reason: resolution.reason,
            infra: false,
            restartCount: 0,
            trace: { status: 'unavailable', reason: 'not-an-executor' },
          }
        }
        const outRef = contentAddress(resolution.outcome)
        await args.blobs.put(outRef, resolution.outcome)
        return {
          kind: 'done',
          out: resolution.outcome,
          outRef,
          spent: zeroSpend(),
          trace: { status: 'unavailable', reason: 'not-an-executor' },
        }
      })
      .catch((err): PreSeqSettled => {
        live.executorDone = true
        return {
          kind: 'down',
          reason: errMessage(err),
          infra: true,
          restartCount: 0,
          trace: { status: 'unavailable', reason: 'not-an-executor' },
        }
      })
      .then((s) => {
        live.resolved = s
        return s
      })
      .finally(() => {
        args.signal.removeEventListener('abort', cascadeAbort)
      })
    ;(live as { settled: Promise<PreSeqSettled> }).settled = settled

    return { ok: true, handle }
  }

  function progress(
    nodeId: NodeId,
    opts: { now?: number; stallAfterMs?: number } = {},
  ): WorkerProgress | undefined {
    const child = children.get(nodeId)
    if (!child) return undefined
    // The executor's own read is best-effort enrichment on a live path — a throwing progress
    // implementation must never break the driver's observation of an otherwise healthy worker.
    let fromExecutor: ExecutorProgress | undefined
    try {
      fromExecutor = child.readProgress?.()
    } catch {
      fromExecutor = undefined
    }
    return readWorkerProgress(
      {
        id: child.id,
        status: child.status,
        steerable: child.deliver !== undefined && !child.delivered,
        startedAt: child.startedAt,
        lastActivityAt: child.lastActivityAt,
        turns: child.spent.iterations,
        tokens: child.spent.tokens,
        ...(child.spent.tokensKnown === false ? { tokensKnown: false } : {}),
        usd: child.spent.usd,
        ...(child.spent.usdKnown === false ? { usdKnown: false } : {}),
      },
      fromExecutor,
      opts.now ?? now(),
      opts.stallAfterMs ?? DEFAULT_STALL_AFTER_MS,
    )
  }

  function traceSource(nodeId: NodeId): TraceSource | undefined {
    const child = children.get(nodeId)
    if (!child) return undefined
    try {
      return child.readTraceSource?.()
    } catch {
      return undefined
    }
  }

  async function meter(spend: Spend, detail?: Record<string, unknown>): Promise<void> {
    if (args.signal.aborted) {
      throw new ValidationError('scope.meter: cannot record new driver work after scope abort')
    }
    const seq = meterSeq++
    // Debit the driver's own inference against the shared conserved pool (free → committed), so
    // equal-k counts it live and `budget.tokensLeft` reflects it for the in-loop guard.
    // An invalid observation (currently: unknown dollar cost under a dollar ceiling) still
    // describes compute that already happened. Preserve it in the durable record before
    // returning the refusal; otherwise the terminal result would falsely report that cost as $0.
    let observeError: unknown
    try {
      args.pool.observe(spend)
    } catch (error) {
      observeError = error
    }
    // Journal it as a `metered` event — the durable TWIN of the pool debit (as `settled` is the
    // twin of `reconcile`), so every journal-based cost reader sums driver inference automatically.
    // Awaited like the settled append (cost-critical), so it has landed before the supervisor's
    // join-barrier cost roll-up.
    await args.journal.appendEvent(args.root, {
      kind: 'metered',
      id: args.parentId,
      spend,
      seq,
      at: new Date(now()).toISOString(),
    })
    // Emit it as an `agent.turn` event so the trace/topology view sees per-turn driver inference
    // (the same stream `spawn`/`next` feed — one observable tree).
    notifyRuntimeHookEvent(
      args.hooks,
      {
        id: `${args.parentId}:meter:${seq}`,
        runId: args.root,
        target: 'agent.turn',
        phase: 'after',
        timestamp: now(),
        parentId: args.parentId,
        payload: { spend, ...(detail ?? {}) },
      },
      { signal: args.signal },
    )
    if (observeError !== undefined) throw observeError
  }

  // The replayed committed work, frozen once at construction — a resume-aware `act` reads it
  // to skip re-spawning settled children. Absent on a fresh scope.
  const resume: ResumedWork<Out> | undefined = args.resumeFrom
    ? {
        settled: args.resumeFrom.settled as ReadonlyArray<Settled<Out>>,
        view: args.resumeFrom.view,
        waits: args.resumeFrom.waits,
        keys: args.resumeFrom.keys as ReadonlyMap<string, ResumedKeyState<Out>>,
        priorSpend: args.resumeFrom.priorSpend,
      }
    : undefined

  const scope: Scope<Out> = {
    spawn,
    next,
    nextResolved,
    send,
    wait,
    progress,
    traceSource,
    signal: args.signal,
    meter,
    ...(resume ? { resume } : {}),
    get view(): TreeView {
      return makeTreeView(args.parentId, children)
    },
    get budget() {
      return args.pool.readout()
    },
    get workerCapacity() {
      return {
        live: liveWorkerCapacity.live,
        freeSlots: freeSlots(liveWorkerCapacity.live, liveWorkerCapacity.max),
      }
    },
  }
  if (args.ownerMaterialization !== undefined) {
    const authoredProfile =
      args.ownerMaterialization.authoredProfile === undefined
        ? undefined
        : detachedSnapshot(
            args.ownerMaterialization.authoredProfile,
            'scope owner authored profile',
          )
    ownerMaterializationStates.set(scope as Scope<unknown>, {
      journal: args.journal,
      root: args.ownerMaterialization.journalRoot ?? args.root,
      nodeId: args.ownerMaterialization.nodeId ?? args.parentId,
      runtime: args.ownerMaterialization.runtime,
      attemptId: args.ownerMaterialization.attemptId,
      ...(authoredProfile === undefined ? {} : { authoredProfile }),
      ...(authoredProfile === undefined
        ? {}
        : { authoredProfileDigest: authoredProfileDigest(authoredProfile) }),
      ...(args.ownerMaterialization.prior === undefined
        ? {}
        : { prior: args.ownerMaterialization.prior }),
      requiredKnown: args.ownerMaterialization.requiredKnown === true,
      ...(args.ownerMaterialization.onReceipt === undefined
        ? {}
        : { onReceipt: args.ownerMaterialization.onReceipt }),
      now,
      receipt: args.ownerMaterialization.prior,
      bindingPublished: false,
      publishedThisProcess: false,
    })
  }
  return scope
}

interface OwnerMaterializationState {
  readonly journal: SpawnJournal
  readonly root: NodeId
  readonly nodeId: NodeId
  readonly runtime: NodeSnapshot['runtime']
  readonly attemptId: string
  readonly authoredProfile?: unknown
  readonly authoredProfileDigest?: Sha256Digest
  readonly prior?: ProfileMaterializationReceipt
  readonly requiredKnown: boolean
  readonly onReceipt?: (
    materialization: ProfileMaterializationReceipt,
    binding: ExecutionBindingReceipt,
  ) => void
  readonly now: () => number
  receipt?: ProfileMaterializationReceipt
  bindingPublished: boolean
  publishedThisProcess: boolean
}

const ownerMaterializationStates = new WeakMap<Scope<unknown>, OwnerMaterializationState>()

/**
 * @internal Publish exact root-manager materialization from a runtime-owned adapter after dynamic
 * attachments exist and before its executor starts. This is deliberately a module function backed
 * by a private WeakMap, not a Scope method an Agent can call.
 */
export async function recordScopeOwnerMaterialization(
  scope: Scope<unknown>,
  runtime: NodeSnapshot['runtime'],
  declaration: import('./types').ExecutorMaterialization,
  bindingInput: ExecutorExecutionBinding,
): Promise<void> {
  const state = ownerMaterializationState(scope)
  if (runtime !== state.runtime) {
    await rejectOwnerMaterialization(state)
    throw new ValidationError(
      `scope owner materialization runtime ${JSON.stringify(runtime)} does not match ${JSON.stringify(state.runtime)}`,
    )
  }
  if (state.authoredProfileDigest === undefined) {
    await rejectOwnerMaterialization(state)
    throw new ValidationError('scope owner materialization requires an exact authored profile')
  }
  let receipt: ProfileMaterializationReceipt
  let binding: ExecutionBindingReceipt
  try {
    if (bindingInput.attemptId !== state.attemptId) {
      throw new ValidationError(
        'scope owner execution binding does not use the kernel-minted attempt id',
      )
    }
    if (canonicalAgentProfileDigest(declaration.effectiveProfile) !== state.authoredProfileDigest) {
      throw new ValidationError(
        'scope owner stable effective profile conflicts with its admitted authored profile',
      )
    }
    receipt = knownMaterializationReceipt({
      authoredProfileDigest: state.authoredProfileDigest,
      runtime,
      declaration,
    })
    binding = knownExecutionBindingReceipt(receipt, bindingInput)
  } catch (error) {
    await rejectOwnerMaterialization(state)
    throw new ValidationError('scope owner returned invalid materialization evidence', {
      cause: error,
    })
  }
  if (state.prior !== undefined) {
    if (canonicalCandidateDigest(state.prior) !== canonicalCandidateDigest(receipt)) {
      await rejectOwnerMaterialization(state)
      throw new ValidationError(
        'scope owner materialization changed across resume; backend, model, execution identity, and plan must match',
      )
    }
    state.receipt = state.prior
    await appendOwnerBinding(state, binding)
    state.onReceipt?.(state.prior, binding)
    state.publishedThisProcess = true
    return
  }
  if (state.receipt !== undefined) {
    throw new ValidationError('scope owner materialization was already recorded')
  }
  await appendOwnerMaterialization(state, receipt, binding)
  state.onReceipt?.(receipt, binding)
  state.publishedThisProcess = true
}

/** @internal Kernel identity for constructing the exact deferred owner executor. */
export function scopeOwnerExecutorNodeContext(scope: Scope<unknown>): ExecutorNodeContext {
  const state = ownerMaterializationState(scope)
  return Object.freeze({
    rootId: state.root,
    parentId: state.nodeId,
    nodeId: state.nodeId,
    attemptId: state.attemptId,
  })
}

/** @internal Ensure a deferred root that never published evidence remains visibly unknown. */
export async function finalizeScopeOwnerMaterialization(scope: Scope<unknown>): Promise<void> {
  const state = ownerMaterializationStates.get(scope)
  if (state === undefined || state.publishedThisProcess) return
  if (state.prior !== undefined) {
    await appendUnknownOwnerBinding(state, state.prior, 'root-agent-did-not-report')
    throw new ValidationError(
      'resumed scope owner did not re-attest its prior materialization before execution',
    )
  }
  if (state.receipt !== undefined) return
  const receipt = unknownMaterializationReceipt({
    ...(state.authoredProfileDigest === undefined
      ? {}
      : { authoredProfileDigest: state.authoredProfileDigest }),
    runtime: state.runtime,
    reason: 'root-agent-did-not-report',
  })
  const binding = unknownExecutionBindingReceipt(
    receipt,
    state.attemptId,
    'root-agent-did-not-report',
  )
  await appendOwnerMaterialization(state, receipt, binding)
  state.onReceipt?.(receipt, binding)
  if (state.requiredKnown) {
    throw new ValidationError(
      'runtime-owned scope owner did not publish materialization before completing',
    )
  }
}

function ownerMaterializationState(scope: Scope<unknown>): OwnerMaterializationState {
  const state = ownerMaterializationStates.get(scope)
  if (state === undefined) {
    throw new ValidationError('scope has no deferred runtime-owned root materialization channel')
  }
  return state
}

async function rejectOwnerMaterialization(state: OwnerMaterializationState): Promise<void> {
  if (state.bindingPublished) return
  if (state.prior !== undefined) {
    await appendUnknownOwnerBinding(state, state.prior, 'invalid-executor-report')
    return
  }
  if (state.receipt !== undefined) {
    await appendUnknownOwnerBinding(state, state.receipt, 'invalid-executor-report')
    return
  }
  const receipt = unknownMaterializationReceipt({
    ...(state.authoredProfileDigest === undefined
      ? {}
      : { authoredProfileDigest: state.authoredProfileDigest }),
    runtime: state.runtime,
    reason: 'invalid-executor-report',
  })
  const binding = unknownExecutionBindingReceipt(
    receipt,
    state.attemptId,
    'invalid-executor-report',
  )
  await appendOwnerMaterialization(state, receipt, binding)
  state.onReceipt?.(receipt, binding)
}

async function appendOwnerMaterialization(
  state: OwnerMaterializationState,
  receipt: ProfileMaterializationReceipt,
  binding: ExecutionBindingReceipt,
): Promise<void> {
  await state.journal.appendEvent(state.root, {
    kind: 'materialized',
    id: state.nodeId,
    receipt,
    seq: 0,
    at: new Date(state.now()).toISOString(),
  })
  state.receipt = receipt
  await appendOwnerBinding(state, binding)
}

async function appendOwnerBinding(
  state: OwnerMaterializationState,
  binding: ExecutionBindingReceipt,
): Promise<void> {
  await state.journal.appendEvent(state.root, {
    kind: 'execution-bound',
    id: state.nodeId,
    binding,
    seq: 0,
    at: new Date(state.now()).toISOString(),
  })
  state.bindingPublished = true
}

async function appendUnknownOwnerBinding(
  state: OwnerMaterializationState,
  receipt: ProfileMaterializationReceipt,
  reason: import('./types').UnknownMaterializationReason,
): Promise<void> {
  const binding = unknownExecutionBindingReceipt(receipt, state.attemptId, reason)
  await appendOwnerBinding(state, binding)
  state.onReceipt?.(receipt, binding)
}

async function appendNodeMaterialization(
  args: Pick<ScopeArgs, 'journal' | 'root'>,
  id: NodeId,
  seq: number,
  receipt: ProfileMaterializationReceipt,
  binding: ExecutionBindingReceipt,
  now: () => number,
): Promise<void> {
  const at = new Date(now()).toISOString()
  await args.journal.appendEvent(args.root, {
    kind: 'materialized',
    id,
    receipt,
    seq,
    at,
  })
  await args.journal.appendEvent(args.root, {
    kind: 'execution-bound',
    id,
    binding,
    seq,
    at,
  })
}

/** Await whichever pending child settles first, returning the child (its `resolved` is set
 *  by the time this resolves because `runChild`'s `.then` sets it before the promise
 *  resolves downstream). */
async function raceFirstSettled(pending: LiveChild[]): Promise<LiveChild> {
  return Promise.race(pending.map((c) => c.settled.then(() => c)))
}

/** Stamp the cursor `seq`, write the `settled` journal record, and project the
 *  `PreSeqSettled` into the frozen `Settled` the driver branches on. */
async function finalizeSettlement<Out>(
  child: LiveChild,
  settlement: PreSeqSettled,
  seq: number,
  args: ScopeArgs,
  now: () => number,
): Promise<Settled<Out>> {
  const handle = frozenHandle<Out>(child)
  // A wait-state settles into the `woken` cursor event, not `settled` — kept distinct so any
  // journal reader can separate zero-cost waiting from paid work without inspecting payloads
  // (`spentFromJournal` therefore sums waits as the zero they are, with no special case).
  if (child.wait) return finalizeWait<Out>(child, settlement, seq, args, now, handle)
  const settledAt = now()
  child.settledAt = settledAt
  const at = new Date(settledAt).toISOString()
  if (settlement.kind === 'down') {
    child.status = 'failed'
    child.trace = settlement.trace
    await args.journal.appendEvent(args.root, {
      kind: 'settled',
      id: child.id,
      status: 'down',
      spent: child.spent,
      infra: settlement.infra,
      reason: settlement.reason,
      trace: settlement.trace,
      seq,
      at,
    })
    // Re-home a crashed driver child's partial inference too (the pool already debited it via
    // `observe`) — so spentTotal/trajectory never undercount a sub-driver that died mid-run.
    if (settlement.metered) {
      await args.journal.appendEvent(args.root, {
        kind: 'metered',
        id: child.id,
        spend: settlement.metered,
        seq,
        at,
      })
    }
    notifyRuntimeHookEvent(
      args.hooks,
      {
        id: `${child.id}:settled`,
        runId: args.root,
        target: 'agent.child',
        phase: 'after',
        timestamp: settledAt,
        stepIndex: seq,
        parentId: args.parentId,
        payload: {
          childId: child.id,
          status: 'down',
          reason: settlement.reason,
          infra: settlement.infra,
          spent: child.spent,
        },
      },
      { signal: args.signal },
    )
    return {
      kind: 'down',
      handle,
      reason: settlement.reason,
      infra: settlement.infra,
      restartCount: settlement.restartCount,
      trace: settlement.trace,
      settledAt,
      seq,
    }
  }

  child.status = 'done'
  child.outRef = settlement.outRef
  child.spent = settlement.spent
  child.trace = settlement.trace
  await args.journal.appendEvent(args.root, {
    kind: 'settled',
    id: child.id,
    status: 'done',
    outRef: settlement.outRef,
    ...(settlement.verdict ? { verdict: settlement.verdict } : {}),
    spent: settlement.spent,
    trace: settlement.trace,
    seq,
    at,
  })
  // Re-home a driver child's OWN-inference subtree total up to THIS (parent) tree as a `metered`
  // event for the child node — mirroring how `settled.spent` rolls child WORK up. So summing any
  // sub-tree root yields its true driver-inference cost, NOT reconciled (already pool-debited).
  if (settlement.metered) {
    await args.journal.appendEvent(args.root, {
      kind: 'metered',
      id: child.id,
      spend: settlement.metered,
      seq,
      at,
    })
  }
  notifyRuntimeHookEvent(
    args.hooks,
    {
      id: `${child.id}:settled`,
      runId: args.root,
      target: 'agent.child',
      phase: 'after',
      timestamp: settledAt,
      stepIndex: seq,
      parentId: args.parentId,
      payload: {
        childId: child.id,
        status: 'done',
        outRef: settlement.outRef,
        score: settlement.verdict?.score,
        valid: settlement.verdict?.valid,
        spent: settlement.spent,
      },
    },
    { signal: args.signal },
  )
  return {
    kind: 'done',
    handle,
    out: settlement.out as Out,
    outRef: settlement.outRef,
    ...(settlement.verdict ? { verdict: settlement.verdict } : {}),
    spent: settlement.spent,
    trace: settlement.trace,
    settledAt,
    seq,
  }
}

/** Journal a wait-state's settlement as a `woken` event and project it onto the same `Settled`
 *  the driver branches on. `by` names WHY it woke — `fired` / `timeout` / `cancelled` — which is
 *  the fact a resumed reader needs and cannot recover from a payload it may never fetch. */
async function finalizeWait<Out>(
  child: LiveChild,
  settlement: PreSeqSettled,
  seq: number,
  args: ScopeArgs,
  now: () => number,
  handle: Handle<Out>,
): Promise<Settled<Out>> {
  const settledAt = now()
  child.settledAt = settledAt
  const at = new Date(settledAt).toISOString()
  if (settlement.kind === 'down') {
    child.status = 'cancelled'
    // A failed fresh `waiting` append means this node never existed durably. Do not leave a
    // terminal `woken` record with no arm record for replay to attach it to.
    if (child.wait?.armCommitted) {
      await args.journal.appendEvent(args.root, {
        kind: 'woken',
        id: child.id,
        by: 'cancelled',
        seq,
        at,
      })
    }
    return {
      kind: 'down',
      handle,
      reason: settlement.reason,
      infra: settlement.infra,
      restartCount: settlement.restartCount,
      trace: settlement.trace,
      settledAt,
      seq,
    }
  }
  child.status = 'done'
  child.outRef = settlement.outRef
  const out = settlement.out as WaitOutcome
  await args.journal.appendEvent(args.root, {
    kind: 'woken',
    id: child.id,
    by: out.settled,
    outRef: settlement.outRef,
    seq,
    at,
  })
  notifyRuntimeHookEvent(
    args.hooks,
    {
      id: `${child.id}:woken`,
      runId: args.root,
      target: 'agent.child',
      phase: 'after',
      timestamp: settledAt,
      stepIndex: seq,
      parentId: args.parentId,
      payload: { childId: child.id, status: 'done', wait: out },
    },
    { signal: args.signal },
  )
  return {
    kind: 'done',
    handle,
    out: settlement.out as Out,
    outRef: settlement.outRef,
    spent: settlement.spent,
    trace: settlement.trace,
    settledAt,
    seq,
  }
}

/**
 * Drive one child's `Executor` to a terminal `PreSeqSettled`, folding usage into the
 * conserved `Spend`, reconciling the reservation, and persisting the result blob. Both
 * executor shapes are handled here: a one-shot `Promise<ExecutorResult>` and a streaming
 * `AsyncIterable<UsageEvent>` whose terminal artifact is read from `resultArtifact()`.
 *
 * A thrown executor (or a real abort) becomes a TYPED `down` — never re-thrown — so a
 * single failing child cannot reject the `next()` cursor (the M2 typed-result discipline,
 * applied per child). The reservation is reconciled on EVERY path (success, abort, throw)
 * so the conserved pool can never leak a reservation.
 */
async function runChild<C>(
  live: LiveChild,
  executor: Executor<C>,
  childAbort: AbortController,
  task: unknown,
  opts: SpawnOpts,
  pool: BudgetPool,
  ticket: ReservationTicket,
  blobs: ResultBlobStore,
  now: () => number,
  executionReady: Promise<void>,
  executionEvidence: {
    complete: () => Promise<void>
    fail: () => Promise<void>
  },
  deadlineAtMs: number | undefined,
): Promise<PreSeqSettled> {
  let reconciled = false
  let started = false
  let terminalTelemetryCaptured = false
  let teardownStarted = false
  let traceEvidence: WorkerTraceEvidence | undefined
  const captureTraceOnce = async (): Promise<WorkerTraceEvidence> => {
    traceEvidence ??= await captureWorkerTraceEvidence(live.readTraceSource, blobs, started)
    return traceEvidence
  }
  const teardownOnce = async (grace: number | 'brutalKill' | 'infinity'): Promise<void> => {
    if (teardownStarted) return
    teardownStarted = true
    await teardownExecutor(executor, grace, deadlineAtMs, now)
    live.cleanupConfirmed = true
  }
  const reconcileOnce = (spend: Spend): unknown | undefined => {
    if (reconciled) return undefined
    reconciled = true
    // A refused pre-execution path (including an unmetered executor) reconciles zero and refunds
    // its whole reservation. Every path that actually executes reports measured or unknown spend.
    try {
      pool.reconcile(ticket, spend)
      return undefined
    } catch (error) {
      return error
    }
  }
  try {
    // Identity and kernel-owned materialization evidence must be durable before execution can
    // begin. A failed append or invalid executor declaration produces a typed-down child and
    // refunds its reservation; the executor observes zero calls.
    await executionReady
    if (childAbort.signal.aborted) throw abortError(childAbort.signal)
    // A budgetExempt WORKER (e.g. the raw `cli` printer) reports zero spend by contract; its
    // reconcile refunds the whole reservation, keeping it out of the conserved Σk by construction.
    // Only the DRIVER path refuses budget-exempt runtimes (`driveHarnessFromBackend`), because a
    // driver's own inference must be metered.
    live.status = 'running'
    started = true
    const ran = executor.execute(task, childAbort.signal)
    let artifact: ExecutorResult<C>
    if (isAsyncIterable(ran)) {
      // Streaming: fold the incremental usage events as they arrive (the conserved-pool
      // authority), then read the terminal artifact after the stream drains. Each event also
      // republishes the running total + a fresh activity stamp onto the live child, so a
      // concurrent `scope.progress(id)` sees a worker mid-flight rather than a zeroed row.
      const spend = await foldStream(
        ran,
        (running) => {
          live.spent = running
          live.lastActivityAt = now()
        },
        childAbort.signal,
      )
      live.spent = spend
      await executionEvidence.complete()
      artifact = executor.resultArtifact() as ExecutorResult<C>
      const accounting = executor.accounting?.()
      const terminalSpend = preserveUnknownTelemetry(spend, artifact.spent)
      live.spent = accounting?.reported ?? terminalSpend
      terminalTelemetryCaptured = true
      live.executorDone = true
      const reconcileError = reconcileOnce(accounting?.reservation ?? terminalSpend)
      if (reconcileError !== undefined) throw reconcileError
    } else {
      const terminal = await awaitAbortable(Promise.resolve(ran), childAbort.signal)
      await executionEvidence.complete()
      const accounting = executor.accounting?.()
      live.spent = accounting?.reported ?? terminal.spent
      artifact = terminal
      terminalTelemetryCaptured = true
      live.executorDone = true
      const reconcileError = reconcileOnce(accounting?.reservation ?? terminal.spent)
      if (reconcileError !== undefined) throw reconcileError
    }
    // Executor work is complete; everything below is persistence/teardown. From here `settled`
    // resolves without further executor progress — the non-blocking drain keys on this.
    live.executorDone = true

    // A driver child's OWN-inference subtree total — re-homed by the parent on EVERY settle exit
    // (done, aborted, crash) so the journal always matches what the pool already debited.
    const ownMetered = executor.metered?.()
    const trace = await captureTraceOnce()

    if (childAbort.signal.aborted) {
      await teardownOnce(opts.shutdown ?? 'brutalKill')
      return downRecord('aborted before settle', true, trace, ownMetered)
    }

    // The durable record is keyed by the canonical content address of the output — the
    // single addressing scheme the blob store enforces and the supervisor's winner path
    // uses. An executor's self-minted `resultArtifact().outRef` is its own internal dedup
    // hint; the journal/blob `outRef` is re-derived here so replay rehydrates by one
    // scheme. Persist the blob BEFORE the journal `settled` record references its `outRef`,
    // so a crash never leaves a journaled ref pointing at a missing blob.
    const outRef = contentAddress(artifact.out)
    await blobs.put(outRef, artifact.out)
    await teardownOnce(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS)
    return {
      kind: 'done',
      out: artifact.out,
      outRef,
      ...(artifact.verdict ? { verdict: artifact.verdict } : {}),
      spent: live.spent,
      trace,
      ...(ownMetered ? { metered: ownMetered } : {}),
    }
  } catch (err) {
    // A thrown executor has also finished its own work — only the down-record persistence
    // remains, so the non-blocking drain may await this child too.
    live.executorDone = true
    let evidenceError: unknown
    try {
      await executionEvidence.fail()
    } catch (error) {
      evidenceError = error
    }
    // A recursive executor can still report the nested work committed before it threw.
    // Reconcile that whole partial subtree while journaling its child-work component separately.
    // A box-backed trace must be collected before teardown destroys the session that owns it.
    const trace = await captureTraceOnce()
    let teardownError: unknown
    try {
      await teardownOnce('brutalKill')
    } catch (error) {
      teardownError = error
    }
    const accounting = executor.accounting?.()
    if (accounting) live.spent = accounting.reported
    const aborted = childAbort.signal.aborted || isAbortError(err)
    if (started && !terminalTelemetryCaptured && accounting === undefined) {
      // The provider never delivered a terminal usage receipt. This is true for an ordinary
      // network/provider crash just as it is for an abort. Preserve observed partial counts as a
      // lower bound, but never reinterpret the unreported remainder as zero under either root
      // ceiling. A recursive executor's explicit accounting remains authoritative on its throw
      // path; a persistence/teardown failure after a terminal artifact does too.
      live.spent = { ...live.spent, tokensKnown: false, usdKnown: false }
    }
    const reconcileError = reconcileOnce(accounting?.reservation ?? live.spent)
    // A crashed driver child still re-homes the partial inference it durably metered.
    return downRecord(
      // The operation that failed is the causal error. Cleanup and accounting can independently
      // fail while handling it, but must never replace it with a secondary diagnostic (for
      // example, missing terminal usage after a provider crash). Their presence still marks the
      // settlement as infrastructure-related, while the unknown spend flags retain the accounting
      // failure itself in the durable record.
      errMessage(err),
      evidenceError !== undefined ||
        teardownError !== undefined ||
        reconcileError !== undefined ||
        aborted ||
        isInfraError(err),
      trace,
      executor.metered?.(),
    )
  }
}

/**
 * The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's
 * `Iteration` shape so `defaultSelectWinner` stays single-sourced — the supervisor selects
 * across settled children with the SAME argmax the loop kernel uses, not a forked copy.
 *
 * `index` is the cursor `seq` (the recorded, replay-stable order); `output`/`verdict`/
 * `tokenUsage`/`costUsd` are read straight off the settlement (already rehydrated from the
 * `outRef` blob by `next()`). Events are empty — a settled child is an opaque leaf result,
 * not a sandbox event stream — and the timing/cost fields project its conserved `Spend`.
 * Fail loud on a `down` settlement: only a `done` child is an iteration.
 */
export function settledToIteration<Out>(settled: Settled<Out>): Iteration<unknown, Out> {
  if (settled.kind === 'down') {
    throw new ValidationError(
      `settledToIteration: cannot adapt a 'down' settlement (node '${settled.handle.id}', seq ${settled.seq}) to an Iteration`,
    )
  }
  return {
    index: settled.seq,
    task: undefined,
    agentRunName: settled.handle.label,
    output: settled.out,
    ...(settled.verdict ? { verdict: settled.verdict } : {}),
    events: [],
    startedAt: 0,
    endedAt: settled.spent.ms,
    costUsd: settled.spent.usd,
    tokenUsage: { input: settled.spent.tokens.input, output: settled.spent.tokens.output },
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function normalizeLiveWorkerLimit(value: number | undefined): number | undefined {
  if (value === undefined || value <= 0) return undefined
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(
      `createScope: maxLiveWorkers must be a positive safe integer or <= 0 for uncapped, got ${String(value)}`,
    )
  }
  return value
}

function acquireLiveWorker(
  capacity: LiveWorkerCapacityState,
): { ok: true; release: () => void } | { ok: false } {
  if (capacity.max !== undefined && capacity.live >= capacity.max) return { ok: false }
  capacity.live += 1
  let released = false
  return {
    ok: true,
    release(): void {
      if (released) return
      released = true
      capacity.live -= 1
      if (capacity.live < 0) {
        throw new ValidationError('scope: live-worker capacity released more than once')
      }
    },
  }
}

function makeTreeView(root: NodeId, children: Map<NodeId, LiveChild>): TreeView {
  const nodes: NodeSnapshot[] = [...children.values()].map((c) => ({
    id: c.id,
    parent: root,
    label: c.label,
    status: c.status,
    runtime: c.runtime,
    budget: c.budget,
    ...(c.ownedTreeRoot === undefined ? {} : { ownedTreeRoot: c.ownedTreeRoot }),
    ...(c.assignmentId === undefined ? {} : { assignmentId: c.assignmentId }),
    ...(c.identity ? { identity: c.identity } : {}),
    ...(c.materialization ? { materialization: c.materialization } : {}),
    ...(c.executionBindings.length > 0
      ? { executionBindings: Object.freeze([...c.executionBindings]) }
      : {}),
    spent: c.spent,
    ...(c.settledAt === undefined ? {} : { settledAt: c.settledAt }),
    ...(c.outRef ? { outRef: c.outRef } : {}),
    ...(c.trace ? { trace: c.trace } : {}),
  }))
  return {
    root,
    nodes,
    inFlight: nodes.filter((n) => n.status === 'running' || n.status === 'acquiring').length,
    waiting: nodes.filter((n) => n.status === 'waiting').length,
  }
}

function frozenHandle<C>(child: LiveChild): Handle<C> {
  return {
    id: child.id,
    label: child.label,
    status: child.status,
    ...(child.assignmentId === undefined ? {} : { assignmentId: child.assignmentId }),
    ...(child.identity ? { identity: child.identity } : {}),
    ...(child.materialization ? { materialization: child.materialization } : {}),
    ...(child.executionBindings.length > 0
      ? { executionBindings: Object.freeze([...child.executionBindings]) }
      : {}),
    abort(): void {
      // A settled child is terminal; abort is a no-op (its executor already tore down).
    },
  }
}

/** Derive the portable identity of the exact profile and task a node will execute. Caller-owned
 * candidate/correlation fields are checked at this boundary before they enter the durable log. */
export function deriveNodeExecutionIdentity(
  spec: Pick<AgentSpec, 'profile' | 'execution'>,
  task: unknown,
): NodeExecutionIdentity | undefined {
  const digest = (value: unknown) => {
    try {
      return canonicalCandidateDigest(value)
    } catch {
      return undefined
    }
  }
  const profileDigest = authoredProfileDigest(spec.profile)
  const taskDigest = digest(task)
  const candidateDigest = spec.execution?.candidateDigest
  if (candidateDigest !== undefined && !sha256DigestSchema.safeParse(candidateDigest).success) {
    throw new ValidationError('scope.spawn: execution.candidateDigest must be a sha256 digest')
  }
  const correlation = freezeCorrelation(spec.execution?.correlation)
  if (!profileDigest && !taskDigest && !candidateDigest && !correlation) return undefined
  return Object.freeze({
    ...(profileDigest ? { profileDigest } : {}),
    ...(taskDigest ? { taskDigest } : {}),
    ...(candidateDigest ? { candidateDigest } : {}),
    ...(correlation ? { correlation } : {}),
  })
}

function isCompleteIdentity(
  identity: NodeExecutionIdentity | undefined,
): identity is NodeExecutionIdentity & {
  readonly profileDigest: string
  readonly taskDigest: string
} {
  return identity?.profileDigest !== undefined && identity.taskDigest !== undefined
}

function sameNodeExecutionIdentity(a: NodeExecutionIdentity, b: NodeExecutionIdentity): boolean {
  return canonicalCandidateDigest(a) === canonicalCandidateDigest(b)
}

function freezeCorrelation(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('scope.spawn: execution.correlation must be a string record')
  }
  const entries = Object.entries(value)
  for (const [key, item] of entries) {
    if (key.length === 0 || typeof item !== 'string' || item.length === 0) {
      throw new ValidationError(
        'scope.spawn: execution.correlation keys and values must be non-empty strings',
      )
    }
  }
  return Object.freeze(Object.fromEntries(entries))
}

/**
 * Fold a streaming executor's normalized usage into the conserved `Spend`, publishing the
 * running total after EVERY event via `onProgress`.
 *
 * The publish is what makes a running worker observable. Before it, `live.spent` was assigned
 * once — after the whole stream drained — so `observe_agent` on a RUNNING worker reported
 * `{tokens:0, iterations:0}` for the entire run and a driver had no way to tell a worker three
 * turns deep from one that had produced nothing. It also means a worker that THROWS mid-stream
 * now reconciles its real partial spend instead of refunding work the provider already billed.
 */
async function foldStream(
  stream: AsyncIterable<UsageEvent>,
  onProgress?: (running: Spend) => void,
  signal?: AbortSignal,
): Promise<Spend> {
  const tokens = { input: 0, output: 0 }
  let tokensKnown = true
  let usd = 0
  let usdKnown = true
  let iterations = 0
  const iterator = stream[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = signal
        ? await awaitAbortable(Promise.resolve(iterator.next()), signal)
        : await iterator.next()
      if (next.done) break
      const ev = next.value
      if (ev.kind === 'tokens') {
        tokens.input += ev.input
        tokens.output += ev.output
        if (ev.tokensKnown === false) tokensKnown = false
      } else if (ev.kind === 'cost') {
        usd += ev.usd
        if (ev.usdKnown === false) usdKnown = false
      } else {
        iterations += 1
      }
      onProgress?.({
        iterations,
        tokens: { ...tokens },
        ...(tokensKnown ? {} : { tokensKnown: false }),
        usd,
        ...(usdKnown ? {} : { usdKnown: false }),
        ms: 0,
      })
    }
  } catch (error) {
    // Ask a cooperative async generator to close, but never let a broken `return()` hide the
    // deadline that already won. Its promise is observed so a late rejection is not unhandled.
    void Promise.resolve(iterator.return?.()).catch(() => undefined)
    throw error
  }
  return {
    iterations,
    tokens,
    ...(tokensKnown ? {} : { tokensKnown: false }),
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ms: 0,
  }
}

/** Usage events carry measured increments; the terminal artifact carries whether a provider omitted
 * a whole accounting channel. Preserve those unknowns on the common streaming path. */
function preserveUnknownTelemetry(streamed: Spend, terminal: Spend): Spend {
  return {
    ...streamed,
    ...(terminal.tokensKnown === false ? { tokensKnown: false } : {}),
    ...(terminal.usdKnown === false ? { usdKnown: false } : {}),
    ms: terminal.ms,
  }
}

async function awaitAbortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // `execute()` may have returned a promise that rejects from the same abort. Observe it before
    // returning the already-winning cancellation so a fast abort cannot become an unhandled
    // provider rejection.
    void work.catch(() => undefined)
    throw abortError(signal)
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      // A cooperative executor often resolves its terminal usage receipt from an abort listener.
      // Give that already-triggered resolution one microtask to win; an ignoring executor still
      // loses immediately afterward.
      queueMicrotask(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(abortError(signal))
      })
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason
  const error = new Error(
    typeof reason === 'string' && reason.length > 0 ? reason : 'execution aborted',
  )
  error.name = 'AbortError'
  return error
}

function downRecord(
  reason: string,
  infra: boolean,
  trace: WorkerTraceEvidence,
  metered?: Spend,
): PreSeqSettled {
  return { kind: 'down', reason, infra, restartCount: 0, trace, ...(metered ? { metered } : {}) }
}

function zeroSpend(): Spend {
  return { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<UsageEvent> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AsyncIterable<UsageEvent>)[Symbol.asyncIterator] === 'function'
  )
}

/** An `AgentSpec` is identified structurally — it carries a `profile` and a `harness`
 *  field (`null` or a `BackendType`) and optionally an `executor`. */
function isAgentSpec(value: unknown): value is AgentSpec {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return 'profile' in v && 'harness' in v
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'AbortError'
  )
}

/** External-boundary failures (network/FS/subprocess) are infra — excluded from the merge
 *  `n` and the equal-k assertion. A `ValidationError` from a built-in executor wraps a
 *  config/transport failure, so it counts as infra; other throws are a real bad result. */
function isInfraError(err: unknown): boolean {
  return err instanceof ValidationError
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
