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

/** The default recursion-depth ceiling. The conserved pool is what bounds a tree's depth: every
 *  level draws its slice from the level above, so a tree ends when its slices run out. This
 *  ceiling only stops a runaway recursion that keeps spawning tiny slices, so it sits well above
 *  any depth a budget can usefully pay for. */
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
    // Reserve the attached control synchronously, before the first journal read or write. A handle
    // is one live route, so two concurrent runs may never race to overwrite that route and later
    // detach each other. The lease is released on every early failure as well as normal teardown.
    const rootLease = attached?.acquire()
    try {
      const opened = await openRunTree(opts, now)
      const cascade = rootCascade(intake.controller, opts)
      // The breaker watches `down` settlements via a counting journal decorator, so it
      // observes every child failure without intercepting `scope.next()` (the driver's
      // private channel). Tripping aborts the same controller; the trip is recorded so the
      // final result can name it.
      const breaker = createIntensityBreaker(opts, () => cascade.abort('intensity breaker tripped'))
      const journal = wrapJournalForBreaker(opts.journal, breaker)
      const scope = createRootScope<Out>(intake, opened, journal, now)
      // `view`/drain read the scope opaquely (`Out` erased) — the supervisor never `spawn`s
      // on it, so the live-tree readout and the join barrier are `Out`-agnostic.
      const openScope = scope as unknown as Scope<unknown>

      // Bind any attached RootHandle to THIS live run so view()/signal()/abort() reach the
      // live scope + the one cascade controller. Detached again in the finally barrier.
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

      // The run's tree, not this process's: on a resumed run the prior process's committed nodes are
      // carried in, so `tree` covers the same work `spentTotal` bills for. Identical to `scope.view`
      // on every run that did not resume.
      intake.persistence.assertAvailable()
      const tree = runTree(scope)
      // Reservations still open once every child has settled, read once at the barrier and named
      // by their holders. A leak breaks `total ≡ free + reserved + committed`, so the winner path
      // below still fails loud rather than hand back an output whose `spentTotal` cannot be
      // trusted. A run that produced NO winner reports the same leak as an integrity finding
      // instead: its tree and the spend the journal recorded are real, and replacing that
      // settlement with an exception discards a whole pursuit over cleanup bookkeeping (#1181).
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

/**
 * ONE internal controller is the root scope's abort source. Every cascade path (caller signal,
 * RootHandle.abort, breaker trip, deadline) aborts it; the scope fans it out to each live child's
 * executor (acquire-aware reap included).
 */
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
    // Carry the reason on the signal so it chains down to each child's abort signal
    // (`childAbort.signal.reason`) — the diagnostic the scope's executors observe.
    controller.abort(reason)
    return true
  }
  // `abortReason` keeps an `Error` reason's message and treats a reasonless `abort()` as the
  // fallback, so a caller that aborts with `new Error('why')` settles as 'why' rather than the
  // generic text, and every layer below sees the same reason this settlement records.
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

/**
 * A root whose result was already accepted is ending the turn that submitted it. The deadline
 * gives it a bounded grace to return that result before cascading: cascading now would discard
 * accepted work and settle the run with no winner. Every child carries the same cutoff on its own
 * timer, so the grace keeps nothing else running.
 */
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
  /** Whether every spawned child was ALREADY down when root execution settled. Read at settle,
   *  never after the join barrier: the barrier's own teardown turns healthy live children into
   *  `down` nodes, and reading it afterwards reported a crashed driver's run as
   *  `all-children-down` — the tree's state caused by the cleanup, not the cause of the failure. */
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
    // act()'s rejection is the PRIMARY error; capture it before the join barrier so a
    // teardown failure in the barrier can never overwrite it (firstError precedence).
    actOutcome = { ok: false, error }
  } finally {
    // Root execution has settled, so the run's output is fixed and nothing spawned from here
    // on could be joined by the barrier below or selected over by a driver that has stopped
    // reading. Close admission BEFORE the drain: a background supervisor-tool invocation that
    // outlived its response fence still holds this scope's verbs and can call `spawn`
    // in-process at any point during the barrier. One that did (2026-09-14) took a conserved
    // reservation 309 ms after the drain finished, and `assertNoOpenTickets` below read that
    // live ticket as a leak and destroyed a 63-child run over it.
    closeScopeAdmission(scope)
    executionAborted = controller.signal.aborted
    allChildrenDownAtSettle = allSpawnedChildrenDown(runTree(scope))
    // A child inherits the root cutoff and can settle the root act on that exact timer turn.
    // If its settlement callback runs before the root timer callback, the finally block clears
    // the still-pending root timer. Preserve the deadline cause from the shared absolute clock;
    // do not overwrite a caller/breaker abort that already won the controller race.
    if (!controller.signal.aborted && deadline.atMs > 0 && now() >= deadline.atMs) {
      deadline.exceeded = true
    }
    deadline.clear()
    // #741: a root driver that DIED did not make its children unhealthy. When the run was not
    // cancelled, `childSettleGraceMs` lets live children reach their own terminal state (and
    // write what they hold) before the cascade takes them. Bounded by the run's own deadline,
    // because nothing may outlive that.
    //
    // The grace covers a root that RETURNED with children still live, not only one that threw.
    // A harness root ends its turn when it stops speaking; with no re-prompt configured that
    // return is final, and the children it just spawned were torn down before their first turn
    // (measured 2026-09-03 on one fleet: 7 of 17 lead runs ended this way, every child at zero
    // tokens, nothing recorded). `drainLiveChildren` returns at once when nothing is live, so a
    // root that finished after its children costs nothing here.
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
      // A failed journal cannot prove a terminal outcome or authorize release. Join local
      // observers and admitted writes; retained providers keep their exact invocation alive.
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
    // Completion-oracle at the root: a `winner` MUST carry a real `Out`. A driver that ran to
    // completion but selected nothing (its keep-best finalize found no DELIVERED child) returns
    // `undefined` — that is a no-winner, never a winner wrapping `undefined`. The supervisor's
    // contract is to refuse coercing a non-result into a best-effort Out (Foreman's 0/18 lesson).
    if (out !== undefined) {
      // The one arm that claims a trustworthy `spentTotal` beside a delivered output, so it is
      // the one arm that keeps the invariant as an assertion: a leaked ticket here would let a
      // corrupt conserved total travel as a success.
      pool.assertNoOpenTickets()
      // The driver synthesized a winner. Content-address it for the replay `outRef`, put it
      // once, and sum the conserved spend off every journaled settlement. No re-ranking — the
      // driver already selected.
      const outRef = contentAddress(out)
      await settled.opts.blobs.put(outRef, out)
      // ONE ledger: the journal. `settled` events carry spawned-child WORK; `metered` events carry
      // the drivers' OWN inference (the twin of `pool.observe`). `spentTotal` is their sum and the
      // breakdown keeps the two separable — the A++ view of where the tokens went. No pool bridge.
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

  // act() rejected. The reason is proven from lifecycle state first, in precedence order:
  // a tripped breaker outranks any abort (it is the most specific cause) outranks
  // budget-exhaustion outranks a real `down` child. Only when NONE of those hold does the
  // rejection itself become the reason — `driver-failed`, the one arm that carries `error`.
  // A no-winner is TYPED — never a best-effort coercion of a partial child (M2).
  return noWinner(settled, { error: actOutcome.error })
}

/** A no-winner still incurred real conserved spend before failing, so it carries `spentTotal`
 *  summed off the SAME journal the winner path reads — the caller always learns the cost. */
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
  // The lifecycle causes outrank the driver's own rejection, so they are asked first and a
  // proven one ends it. `undefined` means the supervisor's own state explains nothing.
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
  // No lifecycle cause AND the driver threw ⇒ the driver itself is the fault. `error` is
  // REQUIRED on this arm, and it is present by construction: this is the only branch that
  // produces `driver-failed`, and it is unreachable unless a rejection was captured.
  if (rejection !== undefined) {
    return { ...common, reason: 'driver-failed', error: describeRejection(rejection.error) }
  }
  // The residual bucket: ran to completion under budget and selected nothing usable, with
  // every lifecycle cause ruled out above — no breaker, no abort, no exhausted pool, and
  // not every child down when the root settled. A root that never spawned is named as
  // such: `all-children-down` with nothing spawned was the settle reason on every
  // sandbox-placed director that quietly did its work in bash, and it sent every reader
  // looking at the fleet instead of at the root. A root whose children delivered (all of
  // them, or all but the `downCount` the record carries) and which then selected nothing
  // is named as such too: this bucket used to settle `all-children-down` as well, and on
  // the 2026-09-20 fleet corpus 46 of the 57 runs carrying that reason had zero down
  // children in their own `fleetYield`.
  if (fleetYield.spawned === 0) return { ...common, reason: 'no-children-spawned' }
  return { ...common, reason: 'no-result-selected' }
}
