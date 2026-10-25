import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import { zeroSpend } from '../util'
import type { ReservationShortfall, ReservationTicket } from './budget'
import { armDeadlineTimer, boundedChildDeadlineAt, CHILD_DEADLINE_REASON } from './deadline'
import { executableAgentSpecSnapshot } from './executable-spec'
import { newExecutionAttemptId } from './materialization'
import { withBudgetResources } from './resources'
import { BUDGET_CONTINUATION_TASK, type RetainedChildRecovery } from './retained-executor'
import { createChildMaterialization } from './scope-child-materialization'
import { createChildRetention } from './scope-child-retention'
import {
  type AdmittedChild,
  bindInteractiveWorker,
  childExecutorContext,
  childHandle,
  commitSpawnRecord,
  type HeldContinuation,
  handOverContinuation,
  liveChildRecord,
  notifyChildSpawned,
  recordChildCancellation,
  resolveChildSettlement,
} from './scope-child-start'
import type { DeferredOwnerSlot, LiveChild, PreSeqSettled, ScopeArgs } from './scope-contract'
import { runChild } from './scope-execution'
import {
  deriveNodeExecutionIdentity,
  isAgentSpec,
  isCompleteIdentity,
  sameNodeExecutionIdentity,
} from './scope-identity'
import { ScopeKeyRegistry } from './scope-key-registry'
import { detachedSnapshot } from './snapshot'
import { traceRootWriter } from './trace-root'
import { runtimeOwnedNestedDriverTreeRoot } from './tree-key'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorContext,
  Handle,
  HeldRelease,
  NodeExecutionIdentity,
  NodeId,
  Settled,
  SpawnOpts,
  SpawnPrior,
  SpawnRejection,
} from './types'
import { deferSlot, type openSlotGroup, type SlotPermit, type WorkerSlots } from './worker-slots'

interface ScopeSpawnerDeps {
  args: ScopeArgs
  children: Map<NodeId, LiveChild>
  slotGroup: ReturnType<typeof openSlotGroup>
  workerSlots: WorkerSlots
  ownerFloor: { tokens: number; iterations: number; usd?: number } | undefined
  now: () => number
  isAdmissionClosed: () => boolean
  checkInAtTimeBox: (id: NodeId, controller: AbortController) => (() => void) | undefined
  releaseHeld: (child: LiveChild, reason: HeldRelease) => Promise<boolean>
}

type SpawnResult<C> =
  | { ok: true; handle: Handle<C>; prior?: SpawnPrior<C> }
  | { ok: false; reason: SpawnRejection; shortfalls?: readonly ReservationShortfall[] }

/** The agent a spawn runs, prepared far enough to compare its identity with the journal. */
interface PreparedAgent<C> {
  readonly agent: Agent<unknown, C>
  readonly spec: AgentSpec
  readonly identity: NodeExecutionIdentity | undefined
}

/** One spawn call in flight: its detached inputs and the agent once it is prepared. */
interface SpawnRequest<C> {
  readonly agentOrFactory: Agent<unknown, C> | (() => Agent<unknown, C>)
  readonly task: unknown
  readonly opts: SpawnOpts
  readonly recovery: RetainedChildRecovery | undefined
  prepared?: PreparedAgent<C>
}

/** What a keyed spawn resumes from: a retried down node, or a held over-budget environment. */
interface KeyedReuse<C> {
  readonly prior?: SpawnPrior<C>
  readonly continuing?: HeldContinuation
}

/** The executor factory admission resolved for a spawn. */
interface ResolvedExecutor<C> {
  readonly succeeded: true
  readonly value: (spec: AgentSpec, ctx: ExecutorContext) => Executor<C>
}

/** Cleanup a failed start must run for what it already armed. */
interface StartCleanup {
  cascadeAbort?: () => void
  clearChildDeadline?: () => void
}

/** Own child admission, keyed identity and executor startup. */
export function createScopeSpawner<Out>(deps: ScopeSpawnerDeps) {
  const spawner = new ScopeSpawner<Out>(deps)
  return { spawn: spawner.spawn, recordKeyedSettlement: spawner.keys.recordSettlement }
}

class ScopeSpawner<Out> {
  readonly keys: ScopeKeyRegistry<Out>
  private spawnOrdinal: number
  private progressSeq = 0

  constructor(private readonly deps: ScopeSpawnerDeps) {
    this.keys = new ScopeKeyRegistry<Out>(deps.args.resumeFrom, deps.children)
    this.spawnOrdinal = deps.args.resumeFrom ? deps.args.resumeFrom.maxSpawnOrdinal + 1 : 0
  }

  readonly spawn = <C extends Out>(
    agentOrFactory: Agent<unknown, C> | (() => Agent<unknown, C>),
    rawTask: unknown,
    rawOpts: SpawnOpts,
    recovery?: RetainedChildRecovery,
  ): SpawnResult<C> => {
    const { args } = this.deps
    if (args.signal.aborted) return { ok: false, reason: 'scope-aborted' }
    // The run reached its join barrier: no later child can be joined, released, or selected over.
    // Distinct from an abort — nothing cancelled this run (see `closeScopeAdmission`).
    if (this.deps.isAdmissionClosed()) return { ok: false, reason: 'scope-settled' }
    const request: SpawnRequest<C> = {
      agentOrFactory,
      task: detachedSnapshot(rawTask, 'scope.spawn task'),
      opts: detachedSnapshot(rawOpts, 'scope.spawn options'),
      recovery,
    }
    const reuse = this.resolveKeyedReuse(request)
    if ('ok' in reuse) return reuse
    if (recovery) this.assertRecoveryMatches(request, recovery)
    if (args.maxDepth !== undefined && args.depth >= args.maxDepth) {
      return { ok: false, reason: 'depth-exceeded' }
    }
    // A concrete child exposes its profile now, so parse and seal it before capacity or budget
    // admission. A lazy agent factory cannot reveal a profile without being constructed; preserve
    // the refusal invariant for those factories and validate the result immediately after the
    // reservation, before registry resolution or any executor code.
    if (typeof agentOrFactory !== 'function') prepareOnce(request)
    const reservation = this.reserve(request)
    if (!reservation.ok) {
      return {
        ok: false,
        reason: reservation.reason,
        ...(reservation.shortfalls === undefined ? {} : { shortfalls: reservation.shortfalls }),
      }
    }
    const resolved = this.resolveExecutorFactory(request, reservation.ticket)
    if (resolved === 'invalid-identity') return { ok: false, reason: 'invalid-identity' }
    // A recovered execution already runs remotely, so it takes a slot past the bound. A child
    // that waits for budget asks for its slot only once the budget is granted, so it never holds
    // a slot that the children it waits on need.
    const budgetGranted = reservation.granted
    const acquire = () =>
      this.deps.slotGroup.acquire(args.depth + 1, { force: recovery !== undefined })
    const permit = budgetGranted === undefined ? acquire() : deferSlot(budgetGranted, acquire)
    return this.start(request, reuse, reservation.ticket, budgetGranted, resolved, permit)
  }

  /**
   * A key is an identity claim, not a cache label. An in-doubt start has no terminal receipt, so
   * it refuses before touching a lazy factory; every other reuse compares the prepared agent's
   * identity with the journal. The completed path resolves, reserves and runs nothing.
   */
  private resolveKeyedReuse<C extends Out>(
    request: SpawnRequest<C>,
  ): KeyedReuse<C> | SpawnResult<C> {
    const { opts, recovery } = request
    if (opts.key === undefined) return {}
    const existing = this.keys.get(opts.key)
    if (existing?.state === 'in-doubt' && recovery?.spawned.id !== existing.id) {
      // No terminal receipt does not prove the remote execution stopped: no replacement beside it.
      return { ok: false, reason: 'in-doubt' }
    }
    if (existing === undefined) return {}
    const prepared = prepareOnce(request)
    if (!isCompleteIdentity(prepared.identity)) {
      return { ok: false, reason: 'invalid-identity' }
    }
    if (!sameNodeExecutionIdentity(existing.identity, prepared.identity)) {
      return { ok: false, reason: 'key-conflict' }
    }
    if (existing.state === 'live') return { ok: false, reason: 'duplicate-key' }
    if (existing.state === 'down') {
      return { prior: { state: 'retried', priorId: existing.id, reason: existing.reason } }
    }
    if (existing.state !== 'done') return {}
    // A result that ended over its budget, whose environment is still held, continues in a new
    // node when the caller asks for it; any other committed result is returned as it stands.
    const from = this.deps.children.get(existing.id)
    const admission =
      opts.continueHeld === true && existing.settled.budgetViolation !== undefined
        ? from?.held !== undefined
          ? from.readEnvironmentAdmission?.()
          : undefined
        : undefined
    if (from?.held === undefined || admission === undefined) {
      return {
        ok: true,
        handle: existing.settled.handle as Handle<C>,
        prior: {
          state: 'completed',
          settled: existing.settled as Settled<C> & { kind: 'done' },
        },
      }
    }
    return {
      continuing: { from, admission, held: from.held },
      prior: {
        state: 'continued',
        priorId: existing.id,
        environmentId: from.held.continuation.environmentId,
      },
    }
  }

  private assertRecoveryMatches<C extends Out>(
    request: SpawnRequest<C>,
    recovery: RetainedChildRecovery,
  ): void {
    const prepared = prepareOnce(request)
    if (
      recovery.spawned.parent !== this.deps.args.parentId ||
      this.deps.children.has(recovery.spawned.id) ||
      !prepared.identity ||
      !recovery.spawned.identity ||
      !sameNodeExecutionIdentity(prepared.identity, recovery.spawned.identity) ||
      contentAddress(request.opts.budget) !== contentAddress(recovery.spawned.budget)
    ) {
      throw new ValidationError('scope recovery does not match its original admitted child')
    }
  }

  /**
   * Reserve the child's whole ceiling atomically so Σk is conserved by construction. A ceiling
   * the pool could cover once this scope's running children return what they hold WAITS (the
   * child is admitted `queued`); it fails CLOSED when nothing running could free enough. This
   * runs before a lazy agent factory is called: refused work constructs nothing. The ticket is
   * named from the start (assignment now, node id at admission).
   */
  private reserve<C extends Out>({ opts, recovery }: SpawnRequest<C>) {
    const { args, ownerFloor } = this.deps
    const assignment = opts.assignmentId ?? opts.key
    return args.pool.reserve(
      opts.budget,
      {
        ...(assignment === undefined ? {} : { assignment }),
        label: opts.label,
        stage: 'admitted',
      },
      { wait: true, ...(!recovery && ownerFloor ? { keep: ownerFloor } : {}) },
    )
  }

  /**
   * Resolve the leaf executor through the open registry after budget admission. If preparation
   * fails, refund the reservation here because runChild never receives it.
   */
  private resolveExecutorFactory<C extends Out>(
    request: SpawnRequest<C>,
    ticket: ReservationTicket,
  ): ResolvedExecutor<C> | 'invalid-identity' {
    const { args } = this.deps
    const { opts, recovery } = request
    try {
      const { spec, identity } = prepareOnce(request)
      if (opts.key !== undefined && !isCompleteIdentity(identity)) {
        args.pool.reconcile(ticket, withBudgetResources(zeroSpend(), opts.budget, true))
        return 'invalid-identity'
      }
      const outcome = recovery
        ? {
            succeeded: true as const,
            value: recovery.factory as (spec: AgentSpec, ctx: ExecutorContext) => Executor<C>,
          }
        : args.executors.resolve<C>(spec)
      if (!outcome.succeeded) throw new ValidationError(`scope.spawn: ${outcome.error}`)
      return outcome
    } catch (error) {
      args.pool.reconcile(ticket, withBudgetResources(zeroSpend(), opts.budget, true))
      throw error
    }
  }

  /**
   * Everything between reserve and runChild's hand-off owns the reservation: a SYNCHRONOUS throw
   * (most likely the executor factory) would leak it, so it is released with zero spend and
   * rethrown, keeping `total ≡ free + reserved + committed`. runChild never sync-throws.
   */
  private start<C extends Out>(
    request: SpawnRequest<C>,
    reuse: KeyedReuse<C>,
    ticket: ReservationTicket,
    budgetGranted: Promise<void> | undefined,
    resolved: ResolvedExecutor<C>,
    permit: SlotPermit,
  ): SpawnResult<C> {
    const { args } = this.deps
    const cleanup: StartCleanup = {}
    try {
      return this.startChild(request, reuse, ticket, budgetGranted, resolved, permit, cleanup)
    } catch (err) {
      this.releaseStart(permit, cleanup)
      args.pool.reconcile(ticket, withBudgetResources(zeroSpend(), request.opts.budget, true))
      throw err
    }
  }

  private startChild<C extends Out>(
    request: SpawnRequest<C>,
    reuse: KeyedReuse<C>,
    ticket: ReservationTicket,
    budgetGranted: Promise<void> | undefined,
    resolved: ResolvedExecutor<C>,
    permit: SlotPermit,
    cleanup: StartCleanup,
  ): SpawnResult<C> {
    const { args, children, now } = this.deps
    const { recovery, opts } = request
    const child = this.admit(request, reuse, ticket)
    const { id, continuing } = child
    const controller = this.armChildAbort(child, cleanup)
    const deferredOwner: DeferredOwnerSlot = {}
    // Resolved per spawn: the spawning node's span is opened by the `agent.spawn` hook, so lazy
    // reading assumes no hook ordering. No resolver (untraced) means no seam.
    const workerTrace = args.workerTrace?.(args.parentId)
    const { recoveryReady, markRecoveryReady } = recoveryReadyGate(recovery, budgetGranted)
    // Built before the retained seam, which cites it before the live child exists.
    const traceRoots = traceRootWriter(args.blobs, id)
    const retention = createChildRetention({
      args,
      controller,
      id,
      ordinal: child.ordinal,
      identity: child.identity,
      recovery,
      opts,
      now,
      traceRoots,
      markRecoveryReady,
      childDeadlineAtMs: child.childDeadlineAtMs,
      readLive: () => live,
      completeEvidence: async () => materialization.complete(),
    })
    const ctx = childExecutorContext(args, child, controller, {
      workerSlots: this.deps.workerSlots,
      permit,
      deferredOwner,
      workerTrace,
      retainedContext: retention.retainedContext,
      now,
    })
    const executor = resolved.value(child.spec, ctx) as Executor<C>
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
    const handle = childHandle<C>(child, children, controller)
    const live = liveChildRecord(args, child, executor, {
      granted: permit.granted,
      controller,
      ownedTreeRoot,
      traceRoots,
      recoveryReady,
      readEnvironmentAdmission: retention.readEnvironmentAdmission,
      now,
    })
    recordChildCancellation(live, executor, controller)
    children.set(id, live)
    if (opts.key !== undefined) {
      this.keys.markLive(opts.key, id, child.identity as NodeExecutionIdentity)
    }
    const spawnCommitted = recovery
      ? Promise.resolve()
      : commitSpawnRecord(args, child, executor, ownedTreeRoot, workerTrace, now)
    const materialization = createChildMaterialization({
      args,
      spawnCommitted,
      identity: child.identity,
      spec: child.spec,
      executor,
      deferredOwner,
      attemptId: child.attemptId,
      id,
      recovery,
      live,
      ordinal: child.ordinal,
      now,
    })
    if (!recovery) notifyChildSpawned(args, child, executor, now)
    if (continuing !== undefined) handOverContinuation(continuing)

    // A thrown executor (or a real abort) is TYPED into a `down` record by `runChild`, never
    // re-thrown, so one failing child never rejects the cursor.
    const childRun = runChild(
      live,
      executor,
      controller,
      // A recovered continuation replays its own invocation's task, and a keyed continuation
      // tells the held session to go on; the spawn identity above stays the node's original task.
      recovery?.continuation?.task ??
        (continuing === undefined ? request.task : BUDGET_CONTINUATION_TASK),
      opts,
      args.pool,
      ticket,
      args.blobs,
      now,
      args.journal,
      args.root,
      () => this.progressSeq++,
      materialization.ready,
      {
        complete: async () => materialization.complete(),
        fail: async () => materialization.fail(),
      },
      child.childDeadlineAtMs,
      recovery !== undefined,
      retention.closeRetainedWrites,
      budgetGranted,
      permit.ready,
      recovery?.continuation?.priorSpent,
      child.startedAt,
    )
    // `runChild` owns the ticket from here: a leak at the join barrier is a child that never settled.
    args.pool.attribute(ticket, { stage: 'executing' })
    const interactiveBindingCommitted = bindInteractiveWorker(
      args,
      live,
      opts.label,
      childRun,
      controller.signal,
      spawnCommitted,
      now,
    )
    this.trackSettlement(
      live,
      childRun,
      interactiveBindingCommitted,
      retention.holdMs,
      permit,
      cleanup,
    )
    return { ok: true, handle, ...(reuse.prior ? { prior: reuse.prior } : {}) }
  }

  /** Publish the child's settlement for the cursor, freeing its slot and timers once it ends. */
  private trackSettlement(
    live: LiveChild,
    childRun: Promise<PreSeqSettled>,
    interactiveBindingCommitted: Promise<void>,
    holdMs: number,
    permit: SlotPermit,
    cleanup: StartCleanup,
  ): void {
    const settled = childRun
      .then((ran) =>
        resolveChildSettlement(
          live,
          ran,
          interactiveBindingCommitted,
          holdMs,
          this.deps.releaseHeld,
        ),
      )
      .finally(() => {
        // The worker slot bounds agents that are SIMULTANEOUSLY WORKING, and a settled child is
        // not working. Gating the release on proof of destruction held a slot forever for every
        // retained execution (its executor answers `destroyed: false` while reconciliation is
        // pending): 127 of 177 children across 14 pursuits, until `max-live-workers`
        // refused with `live: 16, freeSlots: 0` while 1 child ran (#1183). The unconfirmed-cleanup
        // fact stays on `live.cleanupConfirmed`, `scope.workerCapacity.unconfirmed`, the
        // `teardown-unconfirmed` journal event and `result.teardownUnconfirmed`.
        this.releaseStart(permit, cleanup)
      })
    // Persistence may fail before a cursor starts awaiting this child.
    void settled.catch(() => undefined)
    ;(live as { settled: Promise<PreSeqSettled> }).settled = settled
  }

  /** Free what a start armed: its worker slot, its deadline watch, and its abort cascade. */
  private releaseStart(permit: SlotPermit, cleanup: StartCleanup): void {
    permit.release()
    cleanup.clearChildDeadline?.()
    if (cleanup.cascadeAbort) {
      this.deps.args.signal.removeEventListener('abort', cleanup.cascadeAbort)
    }
  }

  /** Name the admitted child: its node id, attempt, start time and bounded deadline. */
  private admit<C extends Out>(
    request: SpawnRequest<C>,
    reuse: KeyedReuse<C>,
    ticket: ReservationTicket,
  ): AdmittedChild {
    const { args, now } = this.deps
    const { recovery, opts } = request
    const { spec, identity } = request.prepared as PreparedAgent<C>
    const ordinal = recovery?.spawned.seq ?? this.spawnOrdinal++
    const id: NodeId = recovery?.spawned.id ?? `${args.parentId}:s${ordinal}`
    const successorOf = opts.successorOf ?? reuse.continuing?.from.id
    args.pool.attribute(ticket, { childId: id, stage: 'admitted' })
    const attemptId = newExecutionAttemptId(id)
    const startedAt = recovery ? Date.parse(recovery.spawned.at) : now()
    if (!Number.isFinite(startedAt))
      throw new ValidationError('scope recovery has an invalid original start time')
    return {
      id,
      ordinal,
      attemptId,
      startedAt,
      childDeadlineAtMs: boundedChildDeadlineAt(
        args.pool.readout().deadlineMs,
        opts.budget.deadlineMs,
        startedAt,
      ),
      successorOf,
      task: request.task,
      opts,
      spec,
      identity,
      modelSubstitution: recovery ? recovery.spawned.modelSubstitution : spec.modelSubstitution,
      recovery,
      continuing: reuse.continuing,
    }
  }

  /**
   * The child's abort chains off this scope's signal AND its own handle.abort() or bounded
   * deadline; aborting mid-acquire cascades into acquireSandbox's find-by-name reap.
   */
  private armChildAbort(child: AdmittedChild, cleanup: StartCleanup): AbortController {
    const { args, now } = this.deps
    const { id, childDeadlineAtMs } = child
    const controller = new AbortController()
    cleanup.cascadeAbort = () => controller.abort(args.signal.reason)
    if (args.signal.aborted) controller.abort(args.signal.reason)
    else args.signal.addEventListener('abort', cleanup.cascadeAbort, { once: true })
    if (childDeadlineAtMs !== undefined) {
      // The run's own deadline (a root scope's pool cutoff) stops the child; any shorter cutoff
      // is a time box its lead set, which is a check-in for a child that can be told.
      const runDeadlineAtMs = args.depth === 0 ? args.pool.readout().deadlineMs : 0
      const timeBox = !(runDeadlineAtMs > 0 && childDeadlineAtMs >= runDeadlineAtMs)
      let clearCheckIn: (() => void) | undefined
      const clearTimer = armDeadlineTimer(Math.max(0, childDeadlineAtMs - now()), () => {
        clearCheckIn = timeBox ? this.deps.checkInAtTimeBox(id, controller) : undefined
        if (clearCheckIn === undefined) controller.abort(CHILD_DEADLINE_REASON)
      })
      cleanup.clearChildDeadline = () => {
        clearTimer()
        clearCheckIn?.()
      }
    }
    return controller
  }
}

/**
 * The barrier a recovered owner's nested mount opens. A budget-queued recovery is already
 * represented by its child handle, and waiting for its mount here can deadlock a funded sibling
 * that needs its parent.
 */
function recoveryReadyGate(
  recovery: RetainedChildRecovery | undefined,
  budgetGranted: Promise<void> | undefined,
): { recoveryReady?: Promise<void>; markRecoveryReady?: () => void } {
  if (recovery?.spawned.ownedTreeRoot === undefined || budgetGranted !== undefined) return {}
  let markRecoveryReady: (() => void) | undefined
  const recoveryReady = new Promise<void>((resolve) => {
    markRecoveryReady = resolve
  })
  return { recoveryReady, markRecoveryReady }
}

/** Prepare the requested agent once: construct a lazy factory and seal its executable spec. */
function prepareOnce<C>(request: SpawnRequest<C>): PreparedAgent<C> {
  if (request.prepared !== undefined) return request.prepared
  const { agentOrFactory } = request
  const agent = typeof agentOrFactory === 'function' ? agentOrFactory() : agentOrFactory
  const rawSpec = (agent as unknown as { executorSpec?: unknown }).executorSpec
  if (!isAgentSpec(rawSpec)) {
    throw new ValidationError(
      `scope.spawn: agent "${agent.name}" exposes no \`executorSpec\` (AgentSpec) to resolve a Executor`,
    )
  }
  const spec = executableAgentSpecSnapshot(rawSpec, 'scope.spawn')
  request.prepared = { agent, spec, identity: deriveNodeExecutionIdentity(spec, request.task) }
  return request.prepared
}
