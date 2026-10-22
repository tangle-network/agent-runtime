import { contentAddress } from '../../durable/content-address'
import { RuntimeRunStateError } from '../../errors'
import { abortReason, RunCancellationReason, runAbortable } from './abortable'
import type { BudgetPool } from './budget'
import { ACCEPTED_RESULT_GRACE_MS, armDeadlineTimer, ROOT_DEADLINE_REASON } from './deadline'
import { runTree } from './finalizer'
import { retainedOwnerWorkspaceRetentionSeamKey } from './retained-scope-owner'
import {
  closeScopeAdmission,
  createScope,
  finalizeScopeOwnerMaterialization,
  startScopeRecoveries,
  waitForScopeChildren,
} from './scope'
import { isNonEmptySpend, terminalAccounting } from './supervisor-accounting'
import { boundedSettleGrace } from './supervisor-child-join'
import {
  createIntensityBreaker,
  type IntensityBreaker,
  wrapJournalForBreaker,
} from './supervisor-intensity-breaker'
import {
  allSpawnedChildrenDown,
  classifyNoWinner,
  type DriverRejection,
  describeRejection,
} from './supervisor-result'
import { assertRootIdentity } from './supervisor-root-contract'
import { pushRootSignal, type RootControl, rootControls } from './supervisor-root-handle'
import { admitSupervisorRun, type SupervisorRunIntake } from './supervisor-run-intake'
import { joinRunChildren, type RunJoin } from './supervisor-run-join'
import { type OpenedRunTree, openRunTree } from './supervisor-run-tree'
import type {
  Agent,
  RootHandle,
  Scope,
  SpawnEvent,
  SupervisedResult,
  Supervisor,
  SupervisorOpts,
  UnconfirmedTeardown,
} from './types'

/** The default recursion-depth ceiling. The conserved pool bounds depth (every level draws its
 *  slice from the one above); this only stops a runaway recursion of tiny slices. */
export const DEFAULT_MAX_DEPTH = 16

/** Create a supervisor that owns one recursive agent execution tree. */
export function createSupervisor<Task, Out>(): Supervisor<Task, Out> {
  let attached: RootControl | undefined

  async function run(
    root: Agent<Task, Out>,
    task: Task,
    opts: SupervisorOpts,
  ): Promise<SupervisedResult<Out>> {
    const intake = admitSupervisorRun(task, opts)
    opts = intake.opts
    task = intake.task
    const rootAct = root.act.bind(root)
    const rootDeliver = root.deliver?.bind(root)
    const rootResultAccepted = root.resultAccepted?.bind(root)
    const now = opts.now ?? Date.now
    assertRootIdentity(opts)
    // Reserve the attached control synchronously, before the first journal access: a handle is
    // one live route, so concurrent runs must not overwrite and later detach each other.
    const rootLease = attached?.acquire()
    try {
      const opened = await openRunTree(opts, now)
      const cascade = rootCascade(intake.controller, opts)
      // The breaker counts `down` settlements via a journal decorator, so it sees every child
      // failure without intercepting `scope.next()`. Tripping aborts the same controller.
      const breaker = createIntensityBreaker(opts, () => cascade.abort('intensity breaker tripped'))
      const journal = wrapJournalForBreaker(opts.journal, breaker)
      const scope = createRootScope<Out>(intake, opened, journal, now)
      // The supervisor never `spawn`s on it, so the readout and join barrier are `Out`-agnostic.
      const openScope = scope as unknown as Scope<unknown>

      // Bind any attached RootHandle to THIS live run; detached again in the finally barrier.
      if (rootLease) {
        rootLease.bind({
          scope: openScope,
          cascadeAbort: (reason) =>
            cascade.abort(
              new RunCancellationReason('root-handle', reason ?? 'root handle aborted'),
            ),
          signal: pushRootSignal(cascade.abort),
          deliver: rootDeliver ? (message) => rootDeliver(message) !== false : () => false,
        })
      }

      const deadline = armRootDeadline(opened.pool, opts, now, rootResultAccepted, cascade)
      const settled = await executeRoot<Out>({
        run: () => rootAct(task, scope),
        scope: openScope,
        intake,
        opened,
        cascade,
        deadline,
        now,
        rootLease,
      })

      // The run's tree, not this process's: a resumed run carries the prior process's committed
      // nodes, so `tree` covers the work `spentTotal` bills for.
      intake.persistence.assertAvailable()
      const tree = runTree(scope)
      // A leak breaks `total ≡ free + reserved + committed`, so the winner path fails loud rather
      // than return an untrustworthy `spentTotal`; a NO-winner run reports it as an integrity
      // finding, since discarding a whole pursuit over cleanup bookkeeping is worse (#1181).
      const leakedReservations = opened.pool.openReservations()
      return await settleRootResult<Out>({
        ...settled,
        controller: intake.controller,
        opts,
        pool: opened.pool,
        journal,
        breaker,
        deadline,
        now,
        runEpochMs: opened.runEpochMs,
        tree,
        leakedReservations,
      })
    } finally {
      rootLease?.release()
    }
  }

  function attach(h: RootHandle<Out>): void {
    const control = rootControls.get(h as RootHandle<unknown>)
    if (!control) {
      throw new RuntimeRunStateError(
        'supervisor.attach: handle was not minted by createRootHandle (no control channel)',
      )
    }
    attached = control
  }

  return { run, attach }
}

/** ONE controller is the root scope's abort source: every cascade path (caller signal,
 *  RootHandle.abort, breaker trip, deadline) aborts it and the scope fans it out to each child. */
interface RootCascade {
  /** Whether a cascade path, not a persistence failure, aborted the controller. */
  readonly aborted: () => boolean
  readonly abort: (reason?: unknown) => boolean
  /** Stop listening to the caller's signal. */
  readonly detach: () => void
}

function rootCascade(controller: AbortController, opts: SupervisorOpts): RootCascade {
  let cascadeAborted = false
  const cascadeAbort = (reason?: unknown): boolean => {
    if (controller.signal.aborted) return false
    cascadeAborted = true
    // The reason chains down to each child's abort signal.
    controller.abort(reason)
    return true
  }
  // `abortReason` keeps an `Error` reason's message, so `abort(new Error('why'))` settles as 'why'.
  const onCallerAbort = () => {
    const reason = opts.signal
      ? abortReason(opts.signal, 'caller signal aborted')
      : 'caller signal aborted'
    cascadeAbort(
      reason instanceof RunCancellationReason
        ? reason
        : new RunCancellationReason(
            'signal',
            typeof reason === 'string' ? reason : 'caller signal aborted',
          ),
    )
  }
  if (opts.signal) {
    if (opts.signal.aborted) onCallerAbort()
    else opts.signal.addEventListener('abort', onCallerAbort, { once: true })
  }
  return {
    aborted: () => cascadeAborted,
    abort: cascadeAbort,
    detach: () => {
      if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort)
    },
  }
}

function createRootScope<Out>(
  intake: SupervisorRunIntake<unknown>,
  opened: OpenedRunTree,
  journal: ReturnType<typeof wrapJournalForBreaker>,
  now: () => number,
): Scope<Out> {
  const { opts } = intake
  // The root's latest materialization: its first, or a later segment's (a seat, or a root segment).
  const priorRootMaterialization = opened.prior
    ?.filter(
      (event): event is Extract<SpawnEvent, { kind: 'materialized' | 'seat-materialized' }> =>
        (event.kind === 'materialized' || event.kind === 'seat-materialized') &&
        event.id === opts.runId,
    )
    .at(-1)?.receipt
  return createScope<Out>({
    parentId: opts.runId,
    root: opts.runId,
    pool: opened.pool,
    journal,
    blobs: opts.blobs,
    executors: opts.executors,
    seams: { [retainedOwnerWorkspaceRetentionSeamKey]: intake.ownerWorkspaceRetention === true },
    depth: 0,
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    workerSlots: intake.slots,
    ...(opts.reservationPolicy
      ? { reservationPolicy: opts.reservationPolicy, ownerBudget: opts.budget }
      : {}),
    ...(intake.deadlineCheckIn === undefined ? {} : { deadlineCheckIn: intake.deadlineCheckIn }),
    ...(intake.budgetStopHoldMs === undefined ? {} : { budgetStopHoldMs: intake.budgetStopHoldMs }),
    signal: intake.controller.signal,
    now,
    hooks: opts.hooks,
    ...(opts.rootMaterialization?.declaration === 'deferred'
      ? {
          ownerMaterialization: {
            runtime: opts.rootMaterialization.runtime,
            authoredProfile: opts.rootMaterialization.authoredProfile,
            attemptId: opened.rootAttemptId,
            requiredKnown: true,
            ...(priorRootMaterialization === undefined ? {} : { prior: priorRootMaterialization }),
          },
        }
      : {}),
    ...(opts.workerTrace ? { workerTrace: opts.workerTrace } : {}),
    ...(opts.workerTraceUnpropagated
      ? { workerTraceUnpropagated: opts.workerTraceUnpropagated }
      : {}),
    ...(opts.interactiveBindingDir ? { interactiveBindingDir: opts.interactiveBindingDir } : {}),
    ...(opened.resumeFrom ? { resumeFrom: opened.resumeFrom } : {}),
  })
}

interface RootDeadline {
  readonly atMs: number
  exceeded: boolean
  /** Clear the root timer and any accepted-result grace. */
  readonly clear: () => void
}

/** A root whose result was already accepted gets a bounded grace at the deadline to return it;
 *  cascading now would discard accepted work. Children carry the cutoff on their own timers. */
function armRootDeadline(
  pool: BudgetPool,
  opts: SupervisorOpts,
  now: () => number,
  rootResultAccepted: (() => boolean) | undefined,
  cascade: RootCascade,
): RootDeadline {
  let clearAcceptedGrace: (() => void) | undefined
  const deadline: RootDeadline = {
    atMs: pool.readout().deadlineMs,
    exceeded: false,
    clear: () => {
      clearRootDeadline?.()
      clearAcceptedGrace?.()
    },
  }
  const reachRootDeadline = (): void => {
    if (clearAcceptedGrace !== undefined) return
    if (rootResultAccepted?.() === true) {
      clearAcceptedGrace = armDeadlineTimer(ACCEPTED_RESULT_GRACE_MS, () => {
        deadline.exceeded = cascade.abort(ROOT_DEADLINE_REASON)
      })
      return
    }
    deadline.exceeded = cascade.abort(ROOT_DEADLINE_REASON)
  }
  if (deadline.atMs > 0 && now() >= deadline.atMs) reachRootDeadline()
  const clearRootDeadline =
    opts.budget.deadlineMs === undefined
      ? undefined
      : armDeadlineTimer(Math.max(0, deadline.atMs - now()), reachRootDeadline)
  return deadline
}

interface RootExecution {
  readonly run: () => Promise<unknown>
  readonly scope: Scope<unknown>
  readonly intake: SupervisorRunIntake<unknown>
  readonly opened: OpenedRunTree
  readonly cascade: RootCascade
  readonly deadline: RootDeadline
  readonly now: () => number
  readonly rootLease: ReturnType<RootControl['acquire']> | undefined
}

interface RootSettled<Out> {
  readonly actOutcome: { ok: true; out: Out } | { ok: false; error: unknown }
  readonly executionAborted: boolean
  /** Whether every spawned child was ALREADY down at settle. Read before the join barrier, whose
   *  own teardown turns healthy children `down` and misreported a crashed driver as `all-children-down`. */
  readonly allChildrenDownAtSettle: boolean
  readonly teardownUnconfirmed: ReadonlyArray<UnconfirmedTeardown>
}

/** Run the root's `act`, then hold the join barrier over every child it left. */
async function executeRoot<Out>(root: RootExecution): Promise<RootSettled<Out>> {
  const { scope, intake, cascade, deadline, now } = root
  const { controller, persistence, opts } = intake
  let actOutcome: RootSettled<Out>['actOutcome'] = {
    ok: false,
    error: new RuntimeRunStateError('supervisor: root execution did not start'),
  }
  const join: RunJoin = {
    scope,
    controller,
    opts,
    now,
    persistence,
    retainedAtSettlement: opts.retainedAtSettlement ?? (opts.resume === true ? 'keep' : 'release'),
    resumeFrom: root.opened.resumeFrom,
    teardownUnconfirmed: [],
    teardownSeq: 0,
  }
  let executionAborted = controller.signal.aborted
  let allChildrenDownAtSettle = false
  try {
    await startScopeRecoveries(scope)
    const out = (await runAbortable(root.run, controller.signal, 'supervisor aborted')) as Out
    actOutcome = { ok: true, out }
  } catch (error) {
    // act()'s rejection is the PRIMARY error, captured before the join barrier can overwrite it.
    actOutcome = { ok: false, error }
  } finally {
    // Close admission BEFORE the drain: a background supervisor-tool invocation that outlived its
    // response fence can still `spawn` in-process during the barrier. One did on 2026-09-14,
    // 309 ms after the drain, and `assertNoOpenTickets` destroyed a 63-child run over it.
    closeScopeAdmission(scope)
    executionAborted = controller.signal.aborted
    allChildrenDownAtSettle = allSpawnedChildrenDown(runTree(scope))
    // A child inherits the root cutoff and can settle the root act on that exact timer turn,
    // before the root timer fires. Keep the deadline cause from the shared clock, unless a
    // caller/breaker abort already won.
    if (!controller.signal.aborted && deadline.atMs > 0 && now() >= deadline.atMs) {
      deadline.exceeded = true
    }
    deadline.clear()
    // #741: a root that DIED did not make its children unhealthy. When not cancelled,
    // `childSettleGraceMs` lets live children finish before the cascade, bounded by the run's
    // deadline. It covers a root that RETURNED with children live too (a harness root ends its
    // turn when it stops speaking; 7 of 17 lead runs on 2026-09-03 tore children down at zero
    // tokens). `drainLiveChildren` returns at once when nothing is live.
    const settleGraceMs = !controller.signal.aborted
      ? boundedSettleGrace(opts.childSettleGraceMs, deadline.atMs, now)
      : 0
    try {
      await joinRunChildren(join, settleGraceMs)
    } catch (error) {
      if (actOutcome?.ok !== false) actOutcome = { ok: false, error }
    }
    if (!persistence.failed) {
      try {
        await finalizeScopeOwnerMaterialization(scope)
      } catch (error) {
        if (actOutcome?.ok !== false) actOutcome = { ok: false, error }
      }
    }
    if (persistence.failed) {
      // A failed journal proves no terminal outcome: join local observers and admitted writes;
      // retained providers keep their invocation alive.
      await waitForScopeChildren(scope)
      await persistence.drain()
    }
    // Explicit cancellation can arrive during the join barrier; its cleanup abort is distinct.
    executionAborted ||= cascade.aborted()
    cascade.detach()
    root.rootLease?.release()
  }
  return {
    actOutcome,
    executionAborted,
    allChildrenDownAtSettle,
    teardownUnconfirmed: join.teardownUnconfirmed,
  }
}

interface RootSettlement<Out> extends RootSettled<Out> {
  readonly controller: AbortController
  readonly opts: SupervisorOpts
  readonly pool: BudgetPool
  readonly journal: ReturnType<typeof wrapJournalForBreaker>
  readonly breaker: IntensityBreaker
  readonly deadline: RootDeadline
  readonly now: () => number
  readonly runEpochMs: number
  readonly tree: ReturnType<typeof runTree>
  readonly leakedReservations: ReturnType<BudgetPool['openReservations']>
}

async function settleRootResult<Out>(settled: RootSettlement<Out>): Promise<SupervisedResult<Out>> {
  const { actOutcome, controller, pool, teardownUnconfirmed } = settled
  if (controller.signal.reason instanceof RunCancellationReason) return noWinner(settled)
  if (actOutcome.ok) {
    if (settled.executionAborted) return noWinner(settled)
    const out = actOutcome.out
    // A `winner` MUST carry a real `Out`: a driver that selected nothing returns `undefined`,
    // which is a no-winner, never a best-effort coercion (Foreman's 0/18 lesson).
    if (out !== undefined) {
      // The one arm claiming a trustworthy `spentTotal` beside an output asserts the invariant.
      pool.assertNoOpenTickets()
      const outRef = contentAddress(out)
      await settled.opts.blobs.put(outRef, out)
      // ONE ledger: `settled` events carry child WORK, `metered` events the drivers' OWN inference;
      // `spentTotal` is their sum and the breakdown keeps the two separable.
      const { spentTotal, childWork, driverInference, gaps, providerModel, fleetYield } =
        await terminalAccounting(
          settled.journal,
          settled.opts.runId,
          settled.now() - settled.runEpochMs,
        )
      return {
        kind: 'winner',
        out,
        outRef,
        tree: settled.tree,
        spentTotal,
        providerModel,
        ...(teardownUnconfirmed.length > 0 ? { teardownUnconfirmed } : {}),
        ...(gaps.length > 0 ? { spendGaps: gaps } : {}),
        fleetYield,
        ...(isNonEmptySpend(driverInference)
          ? { spentBreakdown: { driverInference, childWork } }
          : {}),
      }
    }
    return noWinner(settled)
  }

  // act() rejected: lifecycle state decides first (breaker, then abort, then budget exhaustion,
  // then a real `down` child); only otherwise is the rejection itself the reason.
  return noWinner(settled, { error: actOutcome.error })
}

/** A no-winner still carries `spentTotal`, summed off the SAME journal the winner path reads. */
async function noWinner<Out>(
  settled: RootSettlement<Out>,
  rejection?: DriverRejection,
): Promise<SupervisedResult<Out>> {
  const { controller, teardownUnconfirmed, leakedReservations } = settled
  const { spentTotal, gaps, providerModel, fleetYield } = await terminalAccounting(
    settled.journal,
    settled.opts.runId,
    settled.now() - settled.runEpochMs,
  )
  const common = {
    kind: 'no-winner' as const,
    tree: settled.tree,
    downCount: settled.breaker.downCount(),
    spentTotal,
    providerModel,
    ...(teardownUnconfirmed.length > 0 ? { teardownUnconfirmed } : {}),
    ...(leakedReservations.length > 0 ? { leakedReservations } : {}),
    ...(gaps.length > 0 ? { spendGaps: gaps } : {}),
    fleetYield,
  }
  // Lifecycle causes outrank the driver's own rejection; `undefined` means they explain nothing.
  const lifecycle = classifyNoWinner(
    settled.executionAborted,
    settled.pool,
    settled.opts,
    settled.breaker,
    settled.deadline.exceeded,
    settled.allChildrenDownAtSettle,
  )
  if (controller.signal.reason instanceof RunCancellationReason) {
    const cancellation = controller.signal.reason
    return {
      ...common,
      reason: 'cancelled',
      source: cancellation.source,
      cancellationReason: cancellation.message,
      ...(cancellation.operationId === undefined ? {} : { operationId: cancellation.operationId }),
    }
  }
  if (lifecycle !== undefined) return { ...common, reason: lifecycle }
  // No lifecycle cause AND the driver threw: the driver is the fault (the only `error` arm).
  if (rejection !== undefined) {
    return { ...common, reason: 'driver-failed', error: describeRejection(rejection.error) }
  }
  // Residual: completed under budget, selected nothing usable, every lifecycle cause ruled out.
  // A root that never spawned is named so: `all-children-down` with nothing spawned sent readers
  // looking at the fleet instead of the root; and on the 2026-09-20 corpus 46 of 57 runs with
  // that reason had zero down children in their own `fleetYield`.
  if (fleetYield.spawned === 0) return { ...common, reason: 'no-children-spawned' }
  return { ...common, reason: 'no-result-selected' }
}
