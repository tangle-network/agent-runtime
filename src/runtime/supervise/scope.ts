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
  canonicalCandidateDigest,
  type Sha256Digest,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent, type RuntimeHooks } from '../../runtime-hooks'
import type { RetainedInteractiveAdmission } from '../retained-run-types'
import type { Iteration } from '../types'
import { cloneTokenUsage, zeroSpend } from '../util'
import { abortError, RunCancellationReason } from './abortable'
import {
  assertValidSpend,
  type BudgetPool,
  createBudgetPool,
  meterUsageEvent,
  newUsageTotals,
  type ReservationTicket,
  spendFromUsageTotals,
} from './budget'
import {
  armDeadlineTimer,
  boundedChildDeadlineAt,
  DEFAULT_SUCCESSFUL_SHUTDOWN_MS,
  teardownExecutor,
} from './deadline'
import { freeSlots } from './dispatch'
import { executableAgentSpecSnapshot } from './executable-spec'
import { executorFailureReason } from './executor-outcome'
import {
  interactiveAdmissionSeamKey,
  writeWorkerInteractiveAdmission,
} from './interactive-admission'
import {
  authoredProfileDigest,
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
  newExecutionAttemptId,
  runtimeOwnedDeferredExecutorRuntime,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  runtimeOwnedExecutorProviderEvidence,
  runtimeOwnedPendingExecutorMaterialization,
  unknownExecutionBindingReceipt,
  unknownMaterializationReceipt,
} from './materialization'
import { isTerminalNodeStatus } from './node-status'
import {
  DEFAULT_STALL_AFTER_MS,
  type ExecutorProgress,
  readWorkerProgress,
  type WorkerProgress,
} from './progress'
import { prepareScopeResume } from './recover-executors'
import { addResourceSpend, resourceTelemetry, withBudgetResources } from './resources'
import {
  type RetainedChildRecovery,
  RetainedExecutionPendingError,
  type RetainedExecutorContext,
  retainedExecutorSeamKey,
} from './retained-executor'
import { registerScopeRetainedOwner } from './retained-scope-owner'
import { detachedSnapshot } from './snapshot'
import { captureWorkerTraceEvidence } from './trace-evidence'
import type { TraceSource } from './trace-source'
import { runtimeOwnedNestedDriverTreeRoot } from './tree-key'
import type {
  Agent,
  AgentSpec,
  Budget,
  DefaultVerdict,
  EnvironmentTeardownReceipt,
  ExecutionBindingReceipt,
  Executor,
  ExecutorCancellation,
  ExecutorCancellationRequest,
  ExecutorContext,
  ExecutorExecutionBinding,
  ExecutorFactory,
  ExecutorNodeContext,
  ExecutorRegistry,
  ExecutorResult,
  Handle,
  NodeExecutionIdentity,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  ProfileMaterializationReceipt,
  ProviderModelExecutionEvidence,
  ResultBlobStore,
  ResumedKeyState,
  ResumedWork,
  Scope,
  Settled,
  SpawnEvent,
  SpawnJournal,
  SpawnOpts,
  SpawnPrior,
  SpawnRejection,
  Spend,
  TreeView,
  UsageEvent,
  WaitOpts,
  WorkerInteractiveSession,
  WorkerInteractiveUnavailableReason,
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
import { writeWorkerInteractiveBinding } from './worker-interactive'
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

type RuntimeOwnedProviderMeter = (
  spend: Spend,
  providerModel: ProviderModelExecutionEvidence | undefined,
  detail?: Record<string, unknown>,
  accountingOnly?: boolean,
) => Promise<void>

/** Runtime-owned provider evidence is written through this private scope capability. */
const runtimeOwnedProviderMeters = new WeakMap<object, RuntimeOwnedProviderMeter>()
const recoveryStarters = new WeakMap<object, () => Promise<void>>()
const retainedReleasers = new WeakMap<object, () => Promise<void>>()

/** Per-child bound on a retained release: one remote destroy, answered or abandoned. */
const RETAINED_RELEASE_TIMEOUT_MS = 30_000

/** @internal Admit original children before the parent acts; do not wait for their results. */
export async function startScopeRecoveries(scope: Scope<unknown>): Promise<void> {
  const start = recoveryStarters.get(scope)
  if (!start) return
  recoveryStarters.delete(scope)
  await start()
}

/**
 * @internal Release what this scope's settled children still hold for a retained execution, and
 * confirm each one's teardown afterwards through the executor's own teardown verb.
 *
 * A retained-pending child settles `down` with its cursor slot open and its environment alive,
 * because a resumed process reconciles the paid execution inside it. The supervisor calls this
 * once the root has reached a terminal outcome that no later process resumes — never while the
 * root is live, and never on a resumable interruption, since the open slot and the live
 * environment are exactly what a resume recovers. One `environment-teardown` receipt is journaled
 * per environment, on this scope's own tree; a nested manager reaches its children through
 * `Executor.releaseRetained`, and its nested scope journals theirs.
 */
export async function releaseRetainedEnvironments(scope: Scope<unknown>): Promise<void> {
  const release = retainedReleasers.get(scope)
  if (release) await release()
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
  cancellationReason?: RunCancellationReason
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
  recoveryReady?: Promise<void>
  acceptedResult?: ExecutorResult<unknown>
  recoveryPending?: boolean
  outRef?: string
  /** Durable structured tool evidence once this executor is terminal. */
  trace?: WorkerTraceEvidence
  /** Provider-served model evidence once this executor has attempted inference. */
  providerModel?: import('./types').ProviderModelExecutionEvidence
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
      providerModel?: import('./types').ProviderModelExecutionEvidence
      trace: WorkerTraceEvidence
      /** A driver child's OWN-inference subtree total (from `Executor.metered()`) — journaled as a
       *  `metered` event for this node, NOT reconciled (already debited live via `observe`). */
      metered?: Spend
    }
  | {
      kind: 'down'
      reason: string
      infra: boolean
      outRef?: string
      trace: WorkerTraceEvidence
      providerModel?: import('./types').ProviderModelExecutionEvidence
      /** A CRASHED driver child's partial OWN-inference subtree total — re-homed on the down path
       *  too, so the journal matches the pool (which already debited it via `observe`). */
      metered?: Spend
      /** The child-work floor a RETAINED-PENDING child's reservation was reconciled at. Its cursor
       *  slot stays open, so the settle path journals this as a `reconciled` record in place of
       *  the `settled` record it cannot write — otherwise every journal reader charges the ceiling
       *  the pool just refunded. */
      reconciled?: Spend
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
  const mountScope = (
    nestedRoot: NodeId,
    signal: AbortSignal,
    restored?: Awaited<ReturnType<typeof prepareScopeResume>>,
  ): Scope<unknown> => {
    // One clock read anchors both halves: the remaining duration is measured from the same
    // instant the nested pool derives its absolute deadline from.
    const mountedAtMs = now()
    const deadlineMs =
      childDeadlineAtMs === undefined ? undefined : Math.max(0, childDeadlineAtMs - mountedAtMs)
    const nestedBudget = {
      ...childBudget,
      ...(deadlineMs !== undefined ? { deadlineMs } : {}),
    }
    return createScope<unknown>({
      parentId: childNodeId,
      root: nestedRoot,
      pool: createBudgetPool(nestedBudget, mountedAtMs, restored?.poolRestore),
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
      ...(restored ? { resumeFrom: restored.resumeFrom } : {}),
      ...(args.now ? { now: args.now } : {}),
      ...(args.hooks ? { hooks: args.hooks } : {}),
      // The nested scope resolves the trace context against ITS OWN `parentId` (this driver
      // child), so a grandchild worker joins under the middle node's span, not the run root's.
      ...(args.workerTrace ? { workerTrace: args.workerTrace } : {}),
      ...(args.workerTraceUnpropagated
        ? { workerTraceUnpropagated: args.workerTraceUnpropagated }
        : {}),
      ...(args.interactiveBindingDir ? { interactiveBindingDir: args.interactiveBindingDir } : {}),
      ...(deferredOwner.ownerMaterialization === undefined
        ? {}
        : { ownerMaterialization: deferredOwner.ownerMaterialization }),
    })
  }
  return {
    nodeId: childNodeId,
    depth: args.depth,
    ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
    journalRoot: args.root,
    mount: mountScope,
    restore: async (nestedRoot, signal, events, recoverExecutor) => {
      const restored = await prepareScopeResume(
        {
          runId: nestedRoot,
          journal: args.journal,
          blobs: args.blobs,
          recoverExecutor,
        },
        events,
        signal,
        now,
        childNodeId,
      )
      signal.throwIfAborted()
      return mountScope(nestedRoot, signal, restored)
    },
  }
}

/** Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. */
export function createScope<Out>(args: ScopeArgs): Scope<Out> {
  const children = new Map<NodeId, LiveChild>()
  const settlementWrites = new Set<Promise<Settled<Out>>>()
  const interactiveBindingDir = args.interactiveBindingDir
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
  let progressSeq = 0
  const now = args.now ?? Date.now
  // Waits the journal shows as armed but never woken, keyed by label. `wait` RE-ADOPTS one instead
  // of arming a fresh countdown — that is what makes a resumed deadline the ORIGINAL deadline.
  const unclaimedWaits = new Map<string, PendingWait>(
    (args.resumeFrom?.waits ?? []).map((w) => [w.label, w]),
  )

  // The semantic-key registry (`SpawnOpts.key`): every keyed assignment's current state, seeded
  // from the prior journal on resume and updated live as keyed children spawn and settle. This is
  // what makes a keyed spawn idempotent per key across process lifetimes: `done` returns the
  // committed result, `live` refuses a concurrent duplicate, `down` retries after a terminal
  // receipt, and `in-doubt` refuses until the exact prior execution is recovered.
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
    if (children.get(settled.handle.id)?.recoveryPending) {
      keyed.set(key, { state: 'in-doubt', id: settled.handle.id, identity })
    } else if (settled.kind === 'done') {
      keyed.set(key, { state: 'done', id: settled.handle.id, identity, settled })
    } else {
      keyed.set(key, { state: 'down', id: settled.handle.id, identity, reason: settled.reason })
    }
  }

  function spawn<C extends Out>(
    agentOrFactory: Agent<unknown, C> | (() => Agent<unknown, C>),
    rawTask: unknown,
    rawOpts: SpawnOpts,
    recovery?: RetainedChildRecovery,
  ):
    | { ok: true; handle: Handle<C>; prior?: SpawnPrior<C> }
    | { ok: false; reason: SpawnRejection } {
    if (args.signal.aborted) return { ok: false, reason: 'scope-aborted' }
    const task = detachedSnapshot(rawTask, 'scope.spawn task')
    const opts = detachedSnapshot(rawOpts, 'scope.spawn options')

    // A key is an identity claim, not merely a cache label. An in-doubt start has no terminal
    // receipt, so it refuses before touching a lazy factory. Every other reuse prepares the
    // requested agent far enough to compare its authorized profile/task identity with the journal.
    // No executor is resolved, constructed, reserved, or run on the completed path.
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
      if (existing?.state === 'in-doubt' && recovery?.spawned.id !== existing.id) {
        // A durable start with no terminal receipt does not prove the remote execution stopped.
        // Do not invoke a lazy factory, reserve, or construct a replacement beside it.
        return { ok: false, reason: 'in-doubt' }
      }
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
      }
    }

    if (recovery) {
      prepared ??= prepare()
      if (
        recovery.spawned.parent !== args.parentId ||
        children.has(recovery.spawned.id) ||
        !prepared.identity ||
        !recovery.spawned.identity ||
        !sameNodeExecutionIdentity(prepared.identity, recovery.spawned.identity) ||
        contentAddress(opts.budget) !== contentAddress(recovery.spawned.budget)
      ) {
        throw new ValidationError('scope recovery does not match its original admitted child')
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
    // The ticket is named from the moment it exists. A node id arrives only after admission, so
    // the holder is refined below; a leak caught before then still carries the assignment.
    const assignment = opts.assignmentId ?? opts.key
    let reservation: ReturnType<BudgetPool['reserve']>
    try {
      reservation = args.pool.reserve(opts.budget, {
        ...(assignment === undefined ? {} : { assignment }),
        label: opts.label,
        stage: 'admitted',
      })
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
        args.pool.reconcile(reservation.ticket, withBudgetResources(zeroSpend(), opts.budget, true))
        permit.release()
        return { ok: false, reason: 'invalid-identity' }
      }
      const outcome = recovery
        ? {
            succeeded: true as const,
            value: recovery.factory as (spec: AgentSpec, ctx: ExecutorContext) => Executor<C>,
          }
        : args.executors.resolve<C>(spec)
      if (!outcome.succeeded) throw new ValidationError(`scope.spawn: ${outcome.error}`)
      resolved = outcome
    } catch (error) {
      args.pool.reconcile(reservation.ticket, withBudgetResources(zeroSpend(), opts.budget, true))
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
      const ordinal = recovery?.spawned.seq ?? spawnOrdinal++
      const id: NodeId = recovery?.spawned.id ?? `${args.parentId}:s${ordinal}`
      args.pool.attribute(reservation.ticket, { childId: id, stage: 'admitted' })
      const attemptId = newExecutionAttemptId(id)
      const startedAt = recovery ? Date.parse(recovery.spawned.at) : now()
      if (!Number.isFinite(startedAt))
        throw new ValidationError('scope recovery has an invalid original start time')
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
      let markRecoveryReady: (() => void) | undefined
      const recoveryReady =
        recovery?.spawned.ownedTreeRoot === undefined
          ? undefined
          : new Promise<void>((resolve) => {
              markRecoveryReady = resolve
            })
      const admissions = [...(recovery?.admissions ?? [])]
      const retainedWrites = new Set<Promise<void>>()
      let retainedWritesClosed = false
      const retainedWrite = (write: () => Promise<void>): Promise<void> => {
        controller.signal.throwIfAborted()
        if (retainedWritesClosed) throw new ValidationError('retained child writer is closed')
        const pending = write()
        retainedWrites.add(pending)
        void pending.then(
          () => retainedWrites.delete(pending),
          () => retainedWrites.delete(pending),
        )
        return pending
      }
      const closeRetainedWrites = async () => {
        retainedWritesClosed = true
        await Promise.allSettled([...retainedWrites])
      }
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
          [retainedExecutorSeamKey]: {
            admissions,
            ...(markRecoveryReady ? { onReady: markRecoveryReady } : {}),
            onAdmission: (admission) =>
              retainedWrite(async () => {
                controller.signal.throwIfAborted()
                const existing = admissions.find((record) => record.phase === admission.phase)
                if (existing) {
                  if (contentAddress(existing) !== contentAddress(admission)) {
                    throw new ValidationError(
                      'scope retained admission conflicts with its committed phase',
                    )
                  }
                  return
                }
                if (identity?.taskDigest === undefined)
                  throw new ValidationError('retained execution requires a canonical task identity')
                await args.journal.appendEvent(args.root, {
                  kind: 'execution-admitted',
                  id,
                  admission: detachedSnapshot(admission, 'retained admission'),
                  seq: ordinal,
                  at: new Date(now()).toISOString(),
                })
                admissions.push(detachedSnapshot(admission, 'retained admission'))
                live.recoveryPending = true
                controller.signal.throwIfAborted()
              }),
            onResult: (result) =>
              retainedWrite(async () => {
                controller.signal.throwIfAborted()
                assertValidSpend(result.spent, 'retained executor result')
                executorFailureReason(result)
                await pendingEvidence?.complete()
                const outRef = contentAddress(result.out)
                await args.blobs.put(outRef, result.out)
                controller.signal.throwIfAborted()
                await args.journal.appendEvent(args.root, {
                  kind: 'execution-result',
                  id,
                  outRef,
                  spent: result.spent,
                  ...(result.verdict ? { verdict: result.verdict } : {}),
                  ...(result.outcome ? { outcome: result.outcome } : {}),
                  seq: ordinal,
                  at: new Date(now()).toISOString(),
                })
                live.acceptedResult = detachedSnapshot(
                  { ...result, outRef },
                  'accepted retained child result',
                )
                live.recoveryPending = false
              }),
          } satisfies RetainedExecutorContext,
          [nestedScopeSeamKey]: makeNestedScopeSeam(
            args,
            liveWorkerCapacity,
            id,
            opts.budget,
            childDeadlineAtMs,
            deferredOwner,
          ),
          ...(workerTrace ? { [workerTraceSeamKey]: workerTrace } : {}),
          ...(interactiveBindingDir
            ? {
                [interactiveAdmissionSeamKey]: (admission: RetainedInteractiveAdmission) =>
                  Promise.resolve(
                    writeWorkerInteractiveAdmission(interactiveBindingDir, id, admission, now),
                  ).then(() => undefined),
              }
            : {}),
        },
      }
      const executor = resolved.value(spec, ctx) as Executor<C>
      const ownedTreeRoot = runtimeOwnedNestedDriverTreeRoot(executor, args.root, id)
      if (
        recovery &&
        (!executor.recover ||
          executor.runtime !== recovery.spawned.runtime ||
          ownedTreeRoot !== recovery.spawned.ownedTreeRoot)
      ) {
        throw new ValidationError(
          'scope recovery executor does not preserve its runtime, recovery method, or owned tree',
        )
      }

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
          controller.abort(new RunCancellationReason('worker-handle', reason ?? 'worker cancelled'))
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
        ...(recovery ? { recoveryPending: true } : {}),
        ...(recoveryReady ? { recoveryReady } : {}),
        ...(recovery?.priorMaterialization
          ? { materialization: recovery.priorMaterialization }
          : {}),
        executionBindings: recovery
          ? (args.resumeFrom?.events ?? []).flatMap((event) =>
              event.kind === 'execution-bound' && event.id === id ? [event.binding] : [],
            )
          : [],
        startedAt,
        lastActivityAt: startedAt,
        ...(executor.deliver
          ? { deliver: (message: unknown): boolean => executor.deliver?.(message) !== false }
          : {}),
        ...(executor.progress ? { readProgress: executor.progress.bind(executor) } : {}),
        ...(executor.traceSource ? { readTraceSource: executor.traceSource.bind(executor) } : {}),
        ...(executor.interactive ? { readInteractive: executor.interactive.bind(executor) } : {}),
        ...(executor.interactiveReady
          ? { readInteractiveReady: executor.interactiveReady.bind(executor) }
          : {}),
        ...(executor.cancel ? { requestCancel: executor.cancel.bind(executor) } : {}),
        ...(executor.releaseRetained
          ? {
              releaseRetained: executor.releaseRetained.bind(executor),
              confirmTeardown: () => teardownExecutor(executor, 'brutalKill', undefined, now),
            }
          : {}),
        abortChild: (reason?: unknown): void => controller.abort(reason),
      }
      const recordCancellation = (): void => {
        if (
          !live.executorDone &&
          live.acceptedResult === undefined &&
          controller.signal.reason instanceof RunCancellationReason
        ) {
          live.cancellationReason = controller.signal.reason
        }
      }
      if (controller.signal.aborted) recordCancellation()
      else controller.signal.addEventListener('abort', recordCancellation, { once: true })
      children.set(id, live)
      if (opts.key !== undefined) {
        keyed.set(opts.key, {
          state: 'live',
          id,
          identity: identity as NodeExecutionIdentity,
        })
      }

      // The authored child profile itself, not only its digest. `identity.profileDigest` is the
      // canonical AgentProfile digest, which is NOT a blob key: `FileResultBlobStore.put` asserts
      // the key IS `contentAddress(artifact)`, so the event carries both — the digest that names
      // the agent and the ref that retrieves its bytes. Content-addressed, so N children sharing a
      // profile store one body. The blob lands BEFORE the event that names it, so a reader that
      // sees `profileRef` can always resolve it.
      const profileRef = contentAddress(spec.profile)
      const taskRef = identity?.taskDigest === undefined ? undefined : contentAddress(task)
      const spawnCommitted = recovery
        ? Promise.resolve()
        : args.blobs
            .put(profileRef, spec.profile)
            .then(() => (taskRef === undefined ? undefined : args.blobs.put(taskRef, task)))
            .then(() =>
              args.journal.appendEvent(args.root, {
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
                profileRef,
                seq: ordinal,
                at: new Date(now()).toISOString(),
              }),
            )
            .then(async () => {
              if (taskRef !== undefined) {
                await args.journal.appendEvent(args.root, {
                  kind: 'execution-input',
                  id,
                  taskRef,
                  seq: ordinal,
                  at: new Date(now()).toISOString(),
                })
              }
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
            ...(recovery?.priorMaterialization ? { prior: recovery.priorMaterialization } : {}),
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
          if (plannedReceipt.status !== 'known') {
            throw new ValidationError('scope.spawn: pending executor returned an unknown receipt')
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
              // This is the terminal record for a failed attempt, so the receipt is not pending:
              // the child is down and the executor will never acknowledge. Recording a wait that
              // has already ended reads as "not yet known" on a row that is final, and a consumer
              // fleet mined exactly that value as a pre-launch death predictor (41 of 41 deaths).
              // The correlation was total because only this failure path ever wrote the value.
              const unknown = unknownMaterializationReceipt({
                authoredProfileDigest: profileDigest,
                runtime: executor.runtime,
                reason: 'executor-failed-before-receipt',
              })
              const unknownBinding = unknownExecutionBindingReceipt(
                unknown,
                attemptId,
                'executor-failed-before-receipt',
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

      if (!recovery)
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
              attemptId,
              startedAt,
            },
          },
          { signal: args.signal },
        )

      // Drive the executor to settlement off to the side; `next()` awaits the resulting
      // promise. A thrown executor (or a real abort) is TYPED into a `down` record by
      // `runChild` (never re-thrown) so a single failing child never rejects the cursor.
      const childRun = runChild(
        live,
        executor,
        controller,
        task,
        opts,
        args.pool,
        reservation.ticket,
        args.blobs,
        now,
        args.journal,
        args.root,
        () => progressSeq++,
        materializationCommitted,
        {
          complete: async () => pendingEvidence?.complete(),
          fail: async () => pendingEvidence?.fail(),
        },
        childDeadlineAtMs,
        recovery !== undefined,
        closeRetainedWrites,
      )
      // `runChild` owns the ticket from here: only the child's settlement closes it, so a leak
      // found at the join barrier points at a child that never settled rather than at admission.
      args.pool.attribute(reservation.ticket, { stage: 'executing' })
      const interactiveBindingCommitted = spawnCommitted.then(async () => {
        if (args.interactiveBindingDir === undefined) return
        const immediate = readInteractiveSession(live)
        if (
          immediate.status === 'available' ||
          immediate.reason !== 'interactive-session-not-started' ||
          live.readInteractiveReady === undefined
        ) {
          writeWorkerInteractiveBinding(
            args.interactiveBindingDir,
            id,
            opts.label,
            args.root,
            immediate,
            now,
          )
          return
        }
        const ready = await readInteractiveReadyUntilWorkerEnds(
          live.readInteractiveReady,
          childRun,
          controller.signal,
        )
        if (
          ready !== undefined &&
          (ready.status === 'available' || ready.reason !== 'interactive-session-not-started')
        ) {
          writeWorkerInteractiveBinding(
            args.interactiveBindingDir,
            id,
            opts.label,
            args.root,
            ready,
            now,
          )
        }
      })
      const settled = childRun
        .then(async (s) => {
          let resolution = s
          try {
            await interactiveBindingCommitted
          } catch {
            resolution = downRecord(
              'interactive worker binding persistence failed',
              true,
              s.trace,
              s.metered,
              s.providerModel,
            )
          }
          live.resolved = resolution
          return resolution
        })
        .finally(() => {
          // `maxLiveWorkers` caps workers that are SIMULTANEOUSLY LIVE, and a terminally-settled
          // child is not live. Gating the release on proof of destruction conflated two questions:
          // how many workers are running, and how many remote environments were never reclaimed.
          // A child whose cleanup cannot be confirmed — which is every retained execution, because
          // its executor answers `destroyed: false` by construction while reconciliation is pending
          // — then held its slot for the life of the process.
          //
          // Measured 2026-09-11 across 14 pursuits: 127 of 177 children settled that way, each
          // permanently consuming one of 16 slots. One run recorded `max-live-workers` refusals
          // carrying `live: 16, freeSlots: 0` at moments when 2 and then 1 child was actually
          // running, and two directors wrote the resulting refusal into their durable records as a
          // trade-off they believed they had chosen (#1183).
          //
          // The unconfirmed-cleanup fact is not lost: it stays on `live.cleanupConfirmed`, in
          // `scope.workerCapacity.unconfirmed`, in the `teardown-unconfirmed` journal event, and in
          // `result.teardownUnconfirmed`. Back-pressure against unreclaimed environments is a real
          // concern, but it needs its own counter and its own refusal reason rather than a refusal
          // that reports live workers it does not have.
          permit.release()
          clearChildDeadline?.()
          if (cascadeAbort) args.signal.removeEventListener('abort', cascadeAbort)
        })
      ;(live as { settled: Promise<PreSeqSettled> }).settled = settled

      return { ok: true, handle, ...(prior ? { prior } : {}) }
    } catch (err) {
      permit.release()
      clearChildDeadline?.()
      if (cascadeAbort) args.signal.removeEventListener('abort', cascadeAbort)
      args.pool.reconcile(reservation.ticket, withBudgetResources(zeroSpend(), opts.budget, true))
      throw err
    }
  }

  async function commitSettlement(
    child: LiveChild,
    settlement: PreSeqSettled,
    seq: number,
  ): Promise<Settled<Out>> {
    const pending = finalizeSettlement<Out>(child, settlement, seq, args, now).then((delivered) => {
      if (child.key !== undefined) recordKeyedSettlement(child.key, delivered)
      return delivered
    })
    settlementWrites.add(pending)
    try {
      return await pending
    } finally {
      settlementWrites.delete(pending)
    }
  }

  async function next(): Promise<Settled<Out> | null> {
    const undelivered = () => [...children.values()].filter((c) => !c.delivered)

    // ray.wait n=1: await the FIRST not-yet-delivered child to settle. Loop because a
    // concurrent `next()` may take the race winner between the await and the pick.
    for (;;) {
      const pending = undelivered()
      if (pending.length === 0) {
        await Promise.all([...settlementWrites])
        return null
      }
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
      return await commitSettlement(chosen, settlement, seq)
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
      if (!pick) {
        await Promise.all([...settlementWrites])
        return null
      }
      const settlement = await pick.settled
      if (pick.delivered) continue // lost the race with a concurrent cursor — pick again
      pick.delivered = true
      const seq = cursorSeq++
      return await commitSettlement(pick, settlement, seq)
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
      abortChild: (reason?: unknown): void => waitAbort.abort(reason),
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
        ...addResourceSpend(child.spent.resources),
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

  async function cancel(
    nodeId: NodeId,
    request: ExecutorCancellationRequest,
  ): Promise<ExecutorCancellation> {
    const child = children.get(nodeId)
    if (!child) {
      throw new ValidationError(`scope.cancel: unknown node ${JSON.stringify(nodeId)}`)
    }
    if (child.requestCancel) return await child.requestCancel(request)
    // No backend operation exists for this runtime. Abort the child locally and say exactly that,
    // so a caller never reads a local abort as provider acceptance.
    child.abortChild(new RunCancellationReason('scope', 'cancelled'))
    return {
      status: 'unknown',
      effect: 'cancel_requested',
      observedAt: new Date().toISOString(),
      detail: `executor runtime ${JSON.stringify(child.runtime ?? 'unknown')} exposes no cancellation operation; the child was aborted locally`,
    }
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

  function interactive(nodeId: NodeId): WorkerInteractiveSession {
    const child = children.get(nodeId)
    if (!child) return noInteractiveSession('unknown-node')
    // A wait-state node holds no executor, and a settled one holds no process.
    if (child.wait || child.executorDone || isTerminalNodeStatus(child.status)) {
      return noInteractiveSession('not-live')
    }
    const session = readInteractiveSession(child)
    if (args.interactiveBindingDir !== undefined && session.status === 'available') {
      writeWorkerInteractiveBinding(
        args.interactiveBindingDir,
        child.id,
        child.label,
        args.root,
        session,
        now,
      )
    }
    return session
  }

  async function meterInternal(
    spend: Spend,
    detail?: Record<string, unknown>,
    providerModel?: ProviderModelExecutionEvidence,
    accountingOnly = false,
  ): Promise<void> {
    if (args.signal.aborted) {
      throw new ValidationError('scope.meter: cannot record new driver work after scope abort')
    }
    const partial = providerModel !== undefined || accountingOnly
    if (!partial) spend = withBudgetResources(spend, args.pool.readout())
    const seq = meterSeq++
    // Debit the driver's own inference against the shared conserved pool (free → committed), so
    // equal-k counts it live and `budget.tokensLeft` reflects it for the in-loop guard.
    // An invalid observation (currently: unknown dollar cost under a dollar ceiling) still
    // describes compute that already happened. Preserve it in the durable record before
    // returning the refusal; otherwise the terminal result would falsely report that cost as $0.
    let observeError: unknown
    try {
      args.pool.observe(spend, { partial })
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
      ...(accountingOnly ? { accountingOnly: true as const } : {}),
      ...(providerModel === undefined
        ? {}
        : { providerModel: detachedSnapshot(providerModel, 'runtime provider model evidence') }),
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
    interactive,
    cancel,
    signal: args.signal,
    meter: (spend, detail) => meterInternal(spend, detail),
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
        // The nodes behind a charged-but-idle slot: settled, yet their executor never
        // acknowledged teardown. This scope names its OWN children; a nested manager names its
        // own, so a leak is attributable rather than an integer.
        unconfirmed: Object.freeze(
          [...children.values()]
            .filter((child) => isTerminalNodeStatus(child.status) && !child.cleanupConfirmed)
            .map((child) =>
              Object.freeze({
                id: child.id,
                label: child.label,
                runtime: child.runtime,
                status: child.status,
              }),
            ),
        ),
      }
    },
  }
  runtimeOwnedProviderMeters.set(
    scope as Scope<unknown>,
    async (spend, providerModel, detail, accountingOnly) =>
      meterInternal(spend, detail, providerModel, accountingOnly),
  )
  if (args.ownerMaterialization !== undefined) {
    const authoredProfile =
      args.ownerMaterialization.authoredProfile === undefined
        ? undefined
        : detachedSnapshot(
            args.ownerMaterialization.authoredProfile,
            'scope owner authored profile',
          )
    ownerMaterializationStates.set(scope as Scope<unknown>, {
      retainedRoot: args.root,
      blobs: args.blobs,
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
  if (args.resumeFrom?.recoveries?.length) {
    recoveryStarters.set(scope, async () => {
      const adopted: LiveChild[] = []
      try {
        for (const recovery of args.resumeFrom!.recoveries!) {
          args.signal.throwIfAborted()
          const node = recovery.spawned
          const agent = Object.assign(
            {
              name: recovery.spec.profile.name ?? node.label,
              act: async () => {
                throw new ValidationError(
                  'retained children execute through their recovered executor',
                )
              },
            },
            { executorSpec: recovery.spec },
          )
          const result = spawn(
            agent,
            recovery.task,
            {
              budget: node.budget,
              label: node.label,
              ...(node.key === undefined ? {} : { key: node.key }),
              ...(node.assignmentId === undefined ? {} : { assignmentId: node.assignmentId }),
            },
            recovery,
          )
          if (!result.ok)
            throw new ValidationError(
              `scope recovery admission refused '${node.id}': ${result.reason}`,
            )
          adopted.push(children.get(node.id)!)
        }
        await Promise.all(
          adopted.map((child) =>
            child.recoveryReady === undefined
              ? undefined
              : Promise.race([
                  child.recoveryReady,
                  child.settled.then(() => {
                    throw new ValidationError(
                      `scope recovery '${child.id}' ended before nested adoption completed`,
                    )
                  }),
                ]),
          ),
        )
      } catch (error) {
        for (const child of adopted) child.abortChild?.('recovery startup failed')
        await Promise.allSettled(adopted.map((child) => child.settled))
        for (;;) {
          try {
            if ((await next()) === null) break
          } catch {
            break
          }
        }
        throw error
      }
    })
  }
  retainedReleasers.set(scope, async () => {
    // Settled children whose cleanup is unconfirmed because they hold a retained execution
    // themselves, or because a nested manager's descendants do. Any other unconfirmed child (a
    // destroy that failed on the ordinary path) is named exactly as before and not retried here.
    const held = [...children.values()].filter(
      (child) =>
        isTerminalNodeStatus(child.status) &&
        !child.cleanupConfirmed &&
        (child.recoveryPending === true || child.ownedTreeRoot !== undefined) &&
        child.releaseRetained !== undefined &&
        child.confirmTeardown !== undefined,
    )
    const released = await Promise.all(
      held.map(
        async (
          child,
        ): Promise<{ child: LiveChild; receipts: ReadonlyArray<EnvironmentTeardownReceipt> }> => {
          const bound = new AbortController()
          const timer = setTimeout(
            () =>
              bound.abort(
                new ValidationError(
                  `retained release did not acknowledge within ${RETAINED_RELEASE_TIMEOUT_MS}ms`,
                ),
              ),
            RETAINED_RELEASE_TIMEOUT_MS,
          )
          timer.unref?.()
          try {
            const receipts = await child.releaseRetained!(bound.signal)
            if (receipts.every((receipt) => receipt.destroyed)) {
              try {
                await child.confirmTeardown!()
                child.cleanupConfirmed = true
              } catch {
                // Still unconfirmed; the barrier names the node as it did before.
              }
            }
            return { child, receipts }
          } catch {
            // The executor answered with no receipt at all. Nothing can be named, so the node
            // stays unconfirmed rather than being receipted as released.
            return { child, receipts: [] }
          } finally {
            clearTimeout(timer)
          }
        },
      ),
    )
    for (const { child, receipts } of released) {
      for (const receipt of receipts) {
        await appendEnvironmentTeardown(
          args.journal,
          args.root,
          child.id,
          receipt,
          new Date(now()).toISOString(),
        )
      }
    }
  })
  registerScopeRetainedOwner(scope as Scope<unknown>, {
    rootId: args.root,
    nodeId: args.parentId,
    journal: args.journal,
    blobs: args.blobs,
    priorEvents: args.resumeFrom?.events ?? [],
    now,
  })
  return scope
}

/** @internal Meter one Runtime-owned provider attempt into the durable scope journal. */
export function meterRuntimeOwnedProviderAttempt(
  scope: Scope<unknown>,
  spend: Spend,
  providerModel: ProviderModelExecutionEvidence,
  detail?: Record<string, unknown>,
): Promise<void> {
  const meter = runtimeOwnedProviderMeters.get(scope as object)
  if (meter === undefined) {
    throw new ValidationError('scope: Runtime-owned provider meter is not bound to this scope')
  }
  return meter(spend, providerModel, detail)
}

/** @internal Meter Runtime-owned accounting that does not represent provider execution. */
export function meterRuntimeOwnedAccounting(
  scope: Scope<unknown>,
  spend: Spend,
  detail?: Record<string, unknown>,
): Promise<void> {
  const meter = runtimeOwnedProviderMeters.get(scope as object)
  if (meter === undefined) {
    throw new ValidationError('scope: Runtime-owned provider meter is not bound to this scope')
  }
  return meter(spend, undefined, detail, true)
}

interface OwnerMaterializationState {
  readonly retainedRoot: NodeId
  readonly blobs: ResultBlobStore
  readonly journal: SpawnJournal
  readonly root: NodeId
  readonly nodeId: NodeId
  readonly runtime: NodeSnapshot['runtime']
  /** Rotated by `beginScopeOwnerAttempt` on every driver attempt after the first. */
  attemptId: string
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
    // A root driver may be re-entered inside one process after a transient executor failure
    // (`runDriverWithRetry`, #741). That attempt publishes the SAME materialization with a NEW
    // execution binding, which is the resume path's shape minus the process boundary — so it
    // appends a binding rather than a second receipt. A materialization that actually CHANGED is
    // still a fault: backend, model, execution identity, and plan may not move under a live run.
    if (canonicalCandidateDigest(state.receipt) !== canonicalCandidateDigest(receipt)) {
      await rejectOwnerMaterialization(state)
      throw new ValidationError(
        'scope owner materialization changed mid-run; backend, model, execution identity, and plan must match across driver attempts',
      )
    }
    await appendOwnerBinding(state, binding)
    state.onReceipt?.(state.receipt, binding)
    state.publishedThisProcess = true
    return
  }
  await appendOwnerMaterialization(state, receipt, binding)
  state.onReceipt?.(receipt, binding)
  state.publishedThisProcess = true
}

/** @internal Kernel identity for constructing the exact deferred owner executor. */
/**
 * @internal Each driver attempt of the scope owner is its own execution attempt. A driver retry
 * after a failed drive, and the `repromptOnUnmet` re-entry after an unmet completion check, both
 * run the harness again and report a new execution binding; the journal keys owner bindings by
 * attempt id, so every attempt after the first is given a fresh kernel-minted id and its
 * published flags are cleared, and the new binding lands beside the earlier ones. The first
 * attempt keeps the id minted at run start. Returns the id the attempt reports under, or
 * undefined when the scope owner is not a deferred runtime-owned root.
 */
export function beginScopeOwnerAttempt(scope: Scope<unknown>, attempt: number): string | undefined {
  const state = ownerMaterializationStates.get(scope)
  if (state === undefined) return undefined
  if (attempt > 1) {
    state.attemptId = newExecutionAttemptId(state.nodeId)
    state.bindingPublished = false
    state.publishedThisProcess = false
  }
  return state.attemptId
}

export function scopeOwnerExecutorNodeContext(scope: Scope<unknown>): ExecutorNodeContext {
  const state = ownerMaterializationState(scope)
  return Object.freeze({
    rootId: state.root,
    parentId: state.nodeId,
    nodeId: state.nodeId,
    attemptId: state.attemptId,
  })
}

/** Reuse a committed owner invocation without inventing another provider attempt. @internal */
export async function restoreScopeOwnerAcceptedExecution(scope: Scope<unknown>): Promise<void> {
  const state = ownerMaterializationState(scope)
  const events = (await state.journal.loadTree(state.retainedRoot)) ?? []
  const owned = events.filter((event) => event.id === state.nodeId)
  const latestInput = [...owned].reverse().find((event) => event.kind === 'execution-input')
  const latestResult = [...owned].reverse().find((event) => event.kind === 'execution-result')
  const inputIndex = latestInput === undefined ? -1 : owned.indexOf(latestInput)
  const resultIndex = latestResult === undefined ? -1 : owned.indexOf(latestResult)
  const result = owned[resultIndex]
  if (inputIndex < 0 || resultIndex <= inputIndex || result?.kind !== 'execution-result') {
    throw new ValidationError('scope owner has no accepted retained invocation')
  }
  const receiptEvent = owned
    .slice(0, resultIndex)
    .reverse()
    .find((event) => event.kind === 'materialized')
  const bindingEvent = owned
    .slice(inputIndex, resultIndex)
    .reverse()
    .find((event) => event.kind === 'execution-bound')
  if (receiptEvent?.kind !== 'materialized' || bindingEvent?.kind !== 'execution-bound') {
    throw new ValidationError(
      'accepted scope owner result has no preceding materialization evidence',
    )
  }
  const { receipt } = receiptEvent
  const { binding } = bindingEvent
  if (
    receipt.status !== 'known' ||
    binding.status !== 'known' ||
    receipt.runtime !== state.runtime ||
    receipt.authoredProfileDigest !== state.authoredProfileDigest ||
    binding.materializationReceiptDigest !== canonicalCandidateDigest(receipt) ||
    (state.prior !== undefined &&
      canonicalCandidateDigest(state.prior) !== canonicalCandidateDigest(receipt))
  ) {
    throw new ValidationError(
      'accepted scope owner materialization does not match the resumed owner',
    )
  }
  assertValidSpend(result.spent, 'accepted scope owner result')
  const output = await state.blobs.get(result.outRef)
  if (output === undefined || contentAddress(output) !== result.outRef) {
    throw new ValidationError('accepted scope owner output is missing or corrupt')
  }
  state.receipt = receipt
  state.bindingPublished = true
  state.publishedThisProcess = true
  state.onReceipt?.(receipt, binding)
}

/** @internal Ensure a deferred root that never published evidence remains visibly unknown. */
export async function finalizeScopeOwnerMaterialization(scope: Scope<unknown>): Promise<void> {
  const state = ownerMaterializationStates.get(scope)
  // Rejection paths publish an unknown binding before returning the original validation error.
  // Finalization still runs after that error, so it must not append the same attempt again.
  if (state === undefined || state.publishedThisProcess || state.bindingPublished) return
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
  await appendOwnerEvidence(state, {
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
  await appendOwnerEvidence(state, {
    kind: 'execution-bound',
    id: state.nodeId,
    binding,
    seq: 0,
    at: new Date(state.now()).toISOString(),
  })
  state.bindingPublished = true
}

async function appendOwnerEvidence(
  state: OwnerMaterializationState,
  event: Extract<SpawnEvent, { kind: 'materialized' | 'execution-bound' }>,
): Promise<void> {
  for (const root of new Set([state.root, state.retainedRoot])) {
    await appendExactMaterializationEvent(state.journal, root, event)
  }
}

async function appendExactMaterializationEvent(
  journal: SpawnJournal,
  root: NodeId,
  event: Extract<SpawnEvent, { kind: 'materialized' | 'execution-bound' }>,
): Promise<void> {
  const prior = (await journal.loadTree(root))?.find(
    (item) =>
      item.id === event.id &&
      (event.kind === 'materialized'
        ? item.kind === 'materialized'
        : item.kind === 'execution-bound' && item.binding.attemptId === event.binding.attemptId),
  )
  if (prior?.kind === 'materialized' || prior?.kind === 'execution-bound') {
    const previous = prior.kind === 'materialized' ? prior.receipt : prior.binding
    const next = event.kind === 'materialized' ? event.receipt : event.binding
    if (canonicalCandidateDigest(previous) !== canonicalCandidateDigest(next)) {
      throw new ValidationError('scope execution evidence conflicts with its committed record')
    }
    return
  }
  await journal.appendEvent(root, event)
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
  await appendExactMaterializationEvent(args.journal, args.root, {
    kind: 'materialized',
    id,
    receipt,
    seq,
    at,
  })
  await appendExactMaterializationEvent(args.journal, args.root, {
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

/** Rehomed inference has its own per-child sequence, independent of terminal cursors. */
async function appendSettlementMetering(
  journal: SpawnJournal,
  root: NodeId,
  id: NodeId,
  spend: Spend,
  at: string,
): Promise<void> {
  const seq = await nextPerNodeSeq(journal, root, 'metered', id)
  await appendAcknowledged(journal, root, { kind: 'metered', id, spend, seq, at })
}

/** An open node's reconciled floor has the same per-child sequence discipline as its metering:
 *  outside the cursor namespace, monotonic per node, so a node reconciled once per process (a
 *  retained failure, a recovery, a second retained failure) keeps its records ordered. */
async function appendReconciledFloor(
  journal: SpawnJournal,
  root: NodeId,
  id: NodeId,
  spent: Spend,
  at: string,
): Promise<void> {
  const seq = await nextPerNodeSeq(journal, root, 'reconciled', id)
  await appendAcknowledged(journal, root, { kind: 'reconciled', id, spent, seq, at })
}

/** A release receipt has the same per-child sequence discipline: outside the cursor namespace and
 *  monotonic per node, so a run released in two processes keeps its receipts ordered. */
async function appendEnvironmentTeardown(
  journal: SpawnJournal,
  root: NodeId,
  id: NodeId,
  receipt: EnvironmentTeardownReceipt,
  at: string,
): Promise<void> {
  const seq = await nextPerNodeSeq(journal, root, 'environment-teardown', id)
  await journal.appendEvent(root, {
    kind: 'environment-teardown',
    id,
    provider: receipt.provider,
    environmentId: receipt.environmentId,
    destroyed: receipt.destroyed,
    ...(receipt.detail === undefined ? {} : { detail: receipt.detail }),
    seq,
    at,
  })
}

async function nextPerNodeSeq(
  journal: SpawnJournal,
  root: NodeId,
  kind: 'metered' | 'reconciled' | 'environment-teardown',
  id: NodeId,
): Promise<number> {
  const prior = (await journal.loadTree(root)) ?? []
  return (
    prior.reduce(
      (max, event) => (event.kind === kind && event.id === id ? Math.max(max, event.seq) : max),
      -1,
    ) + 1
  )
}

async function appendAcknowledged(
  journal: SpawnJournal,
  root: NodeId,
  event: Extract<SpawnEvent, { kind: 'metered' | 'reconciled' }>,
): Promise<void> {
  try {
    await journal.appendEvent(root, event)
  } catch (error) {
    // An acknowledged durable prefix permits the terminal write; a missing prefix does not.
    const persisted = await journal.loadTree(root)
    if (
      !persisted?.some(
        (record) => record.kind === event.kind && contentAddress(record) === contentAddress(event),
      )
    )
      throw error
  }
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
  // A terminal cursor must never hide inference that has not reached the parent journal.
  if (settlement.metered) {
    await appendSettlementMetering(args.journal, args.root, child.id, settlement.metered, at)
  }
  if (settlement.kind === 'down') {
    const cancellation = child.cancellationReason
    child.status = cancellation === undefined ? 'failed' : 'cancelled'
    child.trace = settlement.trace
    child.providerModel = settlement.providerModel
    if (!child.recoveryPending)
      await args.journal.appendEvent(args.root, {
        ...(cancellation === undefined
          ? { kind: 'settled' as const, status: 'down' as const }
          : { kind: 'cancelled' as const, source: cancellation.source }),
        id: child.id,
        spent: child.spent,
        infra: settlement.infra,
        reason: settlement.reason,
        ...(settlement.outRef ? { outRef: settlement.outRef } : {}),
        ...(settlement.providerModel ? { providerModel: settlement.providerModel } : {}),
        trace: settlement.trace,
        seq,
        at,
      })
    // A retained-pending node keeps its cursor slot open for recovery, so it carries no terminal
    // record — but its reservation WAS reconciled, and a journal that says nothing about that
    // leaves every reader (terminal accounting, a restored pool, the tree view) charging the
    // ceiling the pool refunded: measured 2026-09-11, the reported `childWork` carried 4M per
    // retained child against a metered 10 (#1190). The floor is journaled in the settlement's
    // place, outside the cursor namespace, so the slot stays open and the ledgers agree.
    else if (settlement.reconciled !== undefined)
      await appendReconciledFloor(args.journal, args.root, child.id, settlement.reconciled, at)
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
          ...settledNodeEvidence(child, settlement, settledAt),
        },
      },
      { signal: args.signal },
    )
    return {
      kind: 'down',
      handle,
      reason: settlement.reason,
      infra: settlement.infra,
      ...(settlement.providerModel ? { providerModel: settlement.providerModel } : {}),
      trace: settlement.trace,
      settledAt,
      seq,
    }
  }

  child.status = 'done'
  child.outRef = settlement.outRef
  child.spent = settlement.spent
  child.trace = settlement.trace
  child.providerModel = settlement.providerModel
  await args.journal.appendEvent(args.root, {
    kind: 'settled',
    id: child.id,
    status: 'done',
    outRef: settlement.outRef,
    ...(settlement.verdict ? { verdict: settlement.verdict } : {}),
    spent: settlement.spent,
    ...(settlement.providerModel ? { providerModel: settlement.providerModel } : {}),
    trace: settlement.trace,
    seq,
    at,
  })
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
        ...settledNodeEvidence(child, settlement, settledAt),
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
    ...(settlement.providerModel ? { providerModel: settlement.providerModel } : {}),
    trace: settlement.trace,
    settledAt,
    seq,
  }
}

/**
 * The evidence a settled node carries beyond its status: the receipts that name what actually
 * ran, the own-inference spend the parent tree re-homes as a `metered` event, and the wall-clock
 * window. One builder feeds BOTH terminal paths, so an observer never sees a `down` node
 * described in different terms from a `done` one. Every field is omitted when the fact is
 * absent — an unreported receipt must not read as an empty one. Snapshots are detached because
 * an observer may serialize them after the live child has moved on.
 */
function settledNodeEvidence(
  child: LiveChild,
  settlement: PreSeqSettled,
  settledAt: number,
): Record<string, unknown> {
  return {
    runtime: child.runtime,
    startedAt: child.startedAt,
    settledAt,
    ...(settlement.metered ? { metered: detachedSnapshot(settlement.metered, 'metered') } : {}),
    ...(child.providerModel
      ? { providerModel: detachedSnapshot(child.providerModel, 'provider model evidence') }
      : {}),
    ...(child.materialization
      ? { materialization: detachedSnapshot(child.materialization, 'materialization receipt') }
      : {}),
    ...(child.executionBindings.length > 0
      ? {
          executionBindings: detachedSnapshot(
            [...child.executionBindings],
            'execution binding receipts',
          ),
        }
      : {}),
    trace: detachedSnapshot(settlement.trace, 'worker trace evidence'),
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
  journal: SpawnJournal,
  journalRoot: NodeId,
  nextProgressSeq: () => number,
  executionReady: Promise<void>,
  executionEvidence: {
    complete: () => Promise<void>
    fail: () => Promise<void>
  },
  deadlineAtMs: number | undefined,
  recovering = false,
  closeRetainedWrites: () => Promise<void> = async () => {},
): Promise<PreSeqSettled> {
  let reconciled = false
  let reconciliationError: unknown
  let teardownFailure: unknown
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
    try {
      await teardownExecutor(executor, grace, deadlineAtMs, now)
      live.cleanupConfirmed = true
    } catch (error) {
      teardownFailure = error
      throw error
    }
  }
  const reconcileOnce = (spend: Spend): unknown | undefined => {
    if (reconciled) return reconciliationError
    reconciled = true
    // A refused pre-execution path (including an unmetered executor) reconciles zero and refunds
    // its whole reservation. Every path that actually executes reports measured or unknown spend.
    try {
      try {
        spend = withBudgetResources(spend, opts.budget, !started)
        live.spent = withBudgetResources(
          live.spent,
          opts.budget,
          !started || executor.accounting?.() !== undefined,
        )
      } catch (error) {
        // Invalid resource receipts cannot leave a ticket open or authorize a refund.
        spend = withBudgetResources({ ...spend, resources: undefined }, opts.budget)
        live.spent = withBudgetResources({ ...live.spent, resources: undefined }, opts.budget)
        try {
          pool.reconcile(ticket, spend)
        } catch {
          // Unknown enforced usage closes the ticket before reporting its violation.
        }
        throw error
      }
      pool.reconcile(ticket, spend)
      return undefined
    } catch (error) {
      reconciliationError = error
      return error
    }
  }
  try {
    // Identity and kernel-owned materialization evidence must be durable before execution can
    // begin. A failed append or invalid executor declaration produces a typed-down child and
    // refunds its reservation; the executor observes zero calls.
    await executionReady
    if (childAbort.signal.aborted) throw abortError(childAbort.signal, 'execution aborted')
    // A budgetExempt WORKER (e.g. the raw `cli` printer) reports zero spend by contract; its
    // reconcile refunds the whole reservation, keeping it out of the conserved Σk by construction.
    // Only the DRIVER path refuses budget-exempt runtimes (`driveHarnessFromBackend`), because a
    // driver's own inference must be metered.
    live.status = 'running'
    started = true
    const ran = recovering
      ? executor.recover!(task, childAbort.signal)
      : executor.execute(task, childAbort.signal)
    let artifact: ExecutorResult<C>
    if (isAsyncIterable(ran)) {
      // Streaming: fold the incremental usage events as they arrive (the conserved-pool
      // authority), then read the terminal artifact after the stream drains. Each event also
      // republishes the running total + a fresh activity stamp onto the live child, so a
      // concurrent `scope.progress(id)` sees a worker mid-flight rather than a zeroed row.
      const spend = await foldStream(
        ran,
        async (running) => {
          live.spent = running
          live.lastActivityAt = now()
          await journal.appendEvent(journalRoot, {
            kind: 'progress',
            id: live.id,
            spend: running,
            seq: nextProgressSeq(),
            at: new Date(now()).toISOString(),
          })
        },
        childAbort.signal,
      )
      live.spent = spend
      await executionEvidence.complete()
      artifact = executor.resultArtifact() as ExecutorResult<C>
      assertReportedSpend(artifact.spent, `scope.spawn ${live.id}`)
      const accounting = executor.accounting?.()
      const terminalSpend = preserveUnknownTelemetry(spend, artifact.spent)
      live.spent = accounting?.reported ?? terminalSpend
      terminalTelemetryCaptured = true
      live.executorDone = true
      const reconcileError = reconcileOnce(accounting?.reservation ?? terminalSpend)
      if (reconcileError !== undefined) throw reconcileError
    } else {
      const terminal = await awaitAbortable(Promise.resolve(ran), childAbort.signal)
      assertReportedSpend(terminal.spent, `scope.spawn ${live.id}`)
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

    if (childAbort.signal.aborted && live.acceptedResult === undefined) {
      await teardownOnce(opts.shutdown ?? 'brutalKill')
      return downRecord(
        'aborted before settle',
        true,
        trace,
        ownMetered,
        runtimeOwnedExecutorProviderEvidence(executor),
      )
    }

    // The durable record is keyed by the canonical content address of the output — the
    // single addressing scheme the blob store enforces and the supervisor's winner path
    // uses. An executor's self-minted `resultArtifact().outRef` is its own internal dedup
    // hint; the journal/blob `outRef` is re-derived here so replay rehydrates by one
    // scheme. Persist the blob BEFORE the journal `settled` record references its `outRef`,
    // so a crash never leaves a journaled ref pointing at a missing blob.
    const outRef = contentAddress(artifact.out)
    await blobs.put(outRef, artifact.out)
    const failureReason = executorFailureReason(artifact)
    if (failureReason !== undefined) {
      await teardownOnce(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS).catch(() => undefined)
      return {
        ...downRecord(
          failureReason,
          false,
          trace,
          ownMetered,
          runtimeOwnedExecutorProviderEvidence(executor),
        ),
        outRef,
      }
    }
    await teardownOnce(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS)
    return {
      kind: 'done',
      out: artifact.out,
      outRef,
      ...(artifact.verdict ? { verdict: artifact.verdict } : {}),
      spent: live.spent,
      trace,
      providerModel: runtimeOwnedExecutorProviderEvidence(executor),
      ...(ownMetered ? { metered: ownMetered } : {}),
    }
  } catch (cause) {
    let err = cause
    await closeRetainedWrites()
    if (
      live.acceptedResult !== undefined &&
      reconciliationError === undefined &&
      (isAbortError(err) ||
        (teardownFailure !== undefined && err === teardownFailure) ||
        (childAbort.signal.aborted && err === childAbort.signal.reason))
    ) {
      // Provider release and cancellation cannot revoke an already committed terminal result.
      const accepted = live.acceptedResult
      live.spent = executor.accounting?.()?.reported ?? accepted.spent
      live.executorDone = true
      live.recoveryPending = false
      terminalTelemetryCaptured = true
      const acceptedAccountingError = reconcileOnce(
        executor.accounting?.()?.reservation ?? accepted.spent,
      )
      if (acceptedAccountingError === undefined) {
        const trace = await captureTraceOnce()
        await teardownOnce(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS).catch(() => undefined)
        const metered = executor.metered?.()
        const failureReason = executorFailureReason(accepted)
        if (failureReason !== undefined) {
          return {
            ...downRecord(
              failureReason,
              false,
              trace,
              metered,
              runtimeOwnedExecutorProviderEvidence(executor),
            ),
            outRef: accepted.outRef,
          }
        }
        return {
          kind: 'done',
          out: accepted.out,
          outRef: accepted.outRef,
          ...(accepted.verdict ? { verdict: accepted.verdict } : {}),
          spent: live.spent,
          trace,
          providerModel: runtimeOwnedExecutorProviderEvidence(executor),
          ...(metered ? { metered } : {}),
        }
      }
      err = acceptedAccountingError
    }
    if (err instanceof RetainedExecutionPendingError || live.recoveryPending) {
      live.recoveryPending = true
      live.executorDone = true
      const trace = await captureTraceOnce()
      // Attempt teardown so a receipt exists at all. A pending retained execution answers
      // `destroyed: false` by construction, so this cannot confirm cleanup and the permit release
      // above deliberately does not depend on it — but the attempt and its answer belong in the
      // record, and today these children carry no teardown receipt of any kind.
      await teardownOnce(opts.shutdown ?? 'brutalKill').catch(() => undefined)
      // Charge what was observed, not the reservation ceiling — by the one rule the done and crash
      // paths already apply: a recursive executor's explicit accounting, else the running total
      // the conserved pool metered off the stream.
      //
      // `reconcile` refunds `reserved - spent`, so passing the ceiling as spend refunded exactly
      // nothing: a child that ran no turn was charged its entire per-worker allowance. Measured
      // 2026-09-11, all three runs at a 4M per-worker ceiling against a 32M root budget: 16 dead
      // children charged 64M (200% of the whole run's budget) having metered 890k; 14 charged 56M
      // (175%) having metered 139k, a 359x overcharge. `budget-exhausted` is the second most common
      // no-winner reason in that archive, and a run could reach it having metered almost nothing
      // (#1190).
      //
      // The floor is `live.spent` for a leaf: every production leaf streams its usage into it, and
      // none implements `metered`, so a fallback keyed on `metered` alone kept charging the ceiling
      // for exactly the children measured above. Every channel is marked unknown, because the
      // remote execution may still be consuming what it was handed off to: the floor is never read
      // back as a measurement. The child-work part is journaled as this node's `reconciled` floor
      // (its slot stays open, so no `settled` record can carry it), and a driver's own inference
      // rides its `metered` record as on every other path.
      //
      // A ticket already reconciled at a measured terminal spend (a persistence failure after the
      // artifact landed) keeps that measurement: `live.spent` is then what the pool committed.
      if (!reconciled) {
        const accounting = executor.accounting?.()
        const ms = Math.max(0, now() - live.startedAt)
        live.spent = { ...unknownFloor(accounting?.reported ?? live.spent), ms }
        reconcileOnce({ ...unknownFloor(accounting?.reservation ?? live.spent), ms })
      }
      return {
        ...downRecord(errMessage(err), true, trace, executor.metered?.()),
        reconciled: live.spent,
      }
    }
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
    const providerModel = runtimeOwnedExecutorProviderEvidence(executor)
    const aborted = childAbort.signal.aborted || isAbortError(err)
    if (started && !terminalTelemetryCaptured && accounting === undefined) {
      // The provider never delivered a terminal usage receipt. This is true for an ordinary
      // network/provider crash just as it is for an abort. Preserve observed partial counts as a
      // lower bound, but never reinterpret the unreported remainder as zero under either root
      // ceiling. A recursive executor's explicit accounting remains authoritative on its throw
      // path; a persistence/teardown failure after a terminal artifact does too.
      live.spent = unknownFloor(live.spent)
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
      providerModel,
    )
  } finally {
    await closeRetainedWrites()
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
    tokenUsage: cloneTokenUsage(settled.spent.tokens),
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
    ...(c.providerModel ? { providerModel: c.providerModel } : {}),
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
/**
 * An executor's terminal artifact must carry a `Spend`: the pool reconciles on it, so a missing one
 * is a contract breach, refused by name BEFORE it can replace the live spend. The child then goes
 * down and its reservation reconciles on what was proven so far (the stream total, else zero),
 * exactly like a crash. A budget-exempt executor reports zero; a metered one reports what it spent
 * or marks it unknown — it never omits it.
 */
function assertReportedSpend(spent: unknown, context: string): asserts spent is Spend {
  const candidate = spent as Partial<Spend> | null | undefined
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.iterations !== 'number' ||
    typeof candidate.tokens !== 'object' ||
    candidate.tokens === null
  ) {
    throw new ValidationError(
      `${context}: executor settled without a Spend — report what was spent or mark it unknown; a budget-exempt executor reports zero`,
    )
  }
}

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
  onProgress?: (running: Spend) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<Spend> {
  const totals = newUsageTotals()
  const iterator = stream[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = signal
        ? await awaitAbortable(Promise.resolve(iterator.next()), signal)
        : await iterator.next()
      if (next.done) break
      const ev = next.value
      meterUsageEvent(totals, ev)
      await onProgress?.({
        ...addResourceSpend(totals.resources),
        iterations: totals.iterations,
        tokens: cloneTokenUsage(totals.tokens),
        ...(totals.tokensKnown ? {} : { tokensKnown: false }),
        usd: totals.usd,
        ...(totals.usdKnown ? {} : { usdKnown: false }),
        // A live read says which receipt the running total came from, so `observe_agent` on a
        // codex seat reports store-read tokens as store-read rather than as a stream receipt.
        ...(totals.tokensProvenance === undefined || totals.tokensProvenance === 'stream-receipt'
          ? {}
          : { tokensProvenance: totals.tokensProvenance }),
        ms: 0,
      })
    }
  } catch (error) {
    // Ask a cooperative async generator to close, but never let a broken `return()` hide the
    // deadline that already won. Its promise is observed so a late rejection is not unhandled.
    void Promise.resolve(iterator.return?.()).catch(() => undefined)
    throw error
  }
  return spendFromUsageTotals(totals)
}

/** Usage events carry measured increments; the terminal artifact carries whether a provider omitted
 * a whole accounting channel. Preserve those unknowns on the common streaming path. */
function preserveUnknownTelemetry(streamed: Spend, terminal: Spend): Spend {
  const terminalTokens = cloneTokenUsage(terminal.tokens)
  return {
    ...streamed,
    ...resourceTelemetry(streamed, terminal),
    tokens: {
      ...streamed.tokens,
      ...(streamed.tokens.freshInput === undefined && terminalTokens.freshInput !== undefined
        ? { freshInput: terminalTokens.freshInput }
        : {}),
      ...(streamed.tokens.cacheRead === undefined && terminalTokens.cacheRead !== undefined
        ? { cacheRead: terminalTokens.cacheRead }
        : {}),
      ...(streamed.tokens.cacheWrite === undefined && terminalTokens.cacheWrite !== undefined
        ? { cacheWrite: terminalTokens.cacheWrite }
        : {}),
      ...(streamed.tokens.cacheBreakdownKnown === false ||
      terminalTokens.cacheBreakdownKnown === false
        ? { cacheBreakdownKnown: false as const }
        : {}),
    },
    ...(terminal.tokensKnown === false ? { tokensKnown: false } : {}),
    ...(terminal.usdKnown === false ? { usdKnown: false } : {}),
    ms: terminal.ms,
    // The platform box-time channel is terminal-artifact-only BY DESIGN: a box's minutes are not
    // known until it dies, so nothing on the usage stream can carry them and the conserved pool
    // never sees them. That makes this the one place they can reach `live.spent`, and from there
    // the journal, the tree view and every rollup. Without this the channel would be reported by
    // the executor and dropped at settlement — measured by the value audit on PR #1053.
    ...(terminal.boxMinutes !== undefined ? { boxMinutes: terminal.boxMinutes } : {}),
    ...(terminal.boxMinutesKnown !== undefined
      ? { boxMinutesKnown: terminal.boxMinutesKnown }
      : {}),
    ...(terminal.boxMinutesProvenance !== undefined
      ? { boxMinutesProvenance: terminal.boxMinutesProvenance }
      : {}),
    // Token provenance travels with the counters. The stream fold already derives it from the
    // events; the terminal artifact answers for an executor whose settlement states it and whose
    // stream did not, so a store-read receipt is not dropped on the way to the journal.
    ...((streamed.tokensProvenance ?? terminal.tokensProvenance) === undefined
      ? {}
      : { tokensProvenance: streamed.tokensProvenance ?? terminal.tokensProvenance }),
  }
}

async function awaitAbortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // `execute()` may have returned a promise that rejects from the same abort. Observe it before
    // returning the already-winning cancellation so a fast abort cannot become an unhandled
    // provider rejection.
    void work.catch(() => undefined)
    throw abortError(signal, 'execution aborted')
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
        reject(abortError(signal, 'execution aborted'))
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

/** Observed partial counts as a lower bound on every channel: the work happened, its remainder went
 *  unreported, and no reader may take the counts for a measurement. */
function unknownFloor(spend: Spend): Spend {
  return {
    ...spend,
    tokensKnown: false,
    usdKnown: false,
    ...(spend.resources === undefined
      ? {}
      : {
          resources: Object.fromEntries(
            Object.entries(spend.resources).map(([name, value]) => [
              name,
              { ...value, known: false },
            ]),
          ),
        }),
  }
}

function downRecord(
  reason: string,
  infra: boolean,
  trace: WorkerTraceEvidence,
  metered?: Spend,
  providerModel?: import('./types').ProviderModelExecutionEvidence,
): Extract<PreSeqSettled, { kind: 'down' }> {
  return {
    kind: 'down',
    reason,
    infra,
    trace,
    ...(providerModel ? { providerModel } : {}),
    ...(metered ? { metered } : {}),
  }
}

/** The one place an absent interactive process is spelled, so every refusal reads the same. */
function noInteractiveSession(
  reason: WorkerInteractiveUnavailableReason,
): WorkerInteractiveSession {
  return Object.freeze({ status: 'unavailable' as const, reason })
}

/** Read one executor's declared interactive capability without letting a malformed port escape. */
function readInteractiveSession(child: LiveChild): WorkerInteractiveSession {
  if (!child.readInteractive) {
    return noInteractiveSession('executor-exposes-no-interactive-session')
  }
  let reported: WorkerInteractiveSession
  try {
    reported = child.readInteractive()
  } catch {
    return noInteractiveSession('executor-exposes-no-interactive-session')
  }
  if (reported?.status === 'unavailable' && reported.reason) return reported
  if (reported?.status === 'available' && reported.handle) return reported
  return noInteractiveSession('executor-exposes-no-interactive-session')
}

/** Stop waiting for optional readiness when the worker settles or its lifetime is cancelled. */
async function readInteractiveReadyUntilWorkerEnds(
  readReady: () => Promise<WorkerInteractiveSession>,
  workerEnded: Promise<unknown>,
  signal: AbortSignal,
): Promise<WorkerInteractiveSession | undefined> {
  if (signal.aborted) return undefined
  let resolveAborted!: () => void
  const aborted = new Promise<void>((resolve) => {
    resolveAborted = resolve
  })
  const onAbort = () => resolveAborted()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(readReady)
        .then((session) => ({ kind: 'ready' as const, session })),
      workerEnded.then(
        () => ({ kind: 'ended' as const }),
        () => ({ kind: 'ended' as const }),
      ),
      aborted.then(() => ({ kind: 'ended' as const })),
    ])
    return outcome.kind === 'ready' ? outcome.session : undefined
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
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

/** The message a settle record carries for a thrown executor, with its cause chain. A wrapper such
 *  as `RetainedExecutionPendingError` has one fixed message, so without the chain a run record says
 *  a child went down and nothing else; across 16 pursuits on 2026-09-11, 143 of 199 children
 *  settled that way and none was diagnosable from the record (#1182). Bounded, because a cause
 *  chain can be cyclic or long and a reason is a line, not a dump. */
function errMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts = [err.message]
  let cause: unknown = err.cause
  for (let depth = 0; depth < 4 && cause !== undefined && cause !== null; depth += 1) {
    parts.push(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause))
    cause = cause instanceof Error ? cause.cause : undefined
  }
  return parts.join(': caused by ')
}
