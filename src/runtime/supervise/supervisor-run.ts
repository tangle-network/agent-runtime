import { appendSpawnEvents, contentAddress } from '../../durable/spawn-journal'
import { RuntimeRunStateError, ValidationError } from '../../errors'
import { abortReason, RunCancellationReason, runAbortable } from './abortable'
import { type BudgetPool, createBudgetPool } from './budget'
import { ACCEPTED_RESULT_GRACE_MS, armDeadlineTimer, ROOT_DEADLINE_REASON } from './deadline'
import { runTree } from './finalizer'
import { newExecutionAttemptId } from './materialization'
import { prepareScopeResume, type ScopeResumeState } from './recover-executors'
import { retainedOwnerWorkspaceRetentionSeamKey } from './retained-scope-owner'
import { guardRunPersistence } from './run-persistence'
import {
  assertRecursiveReservationPolicy,
  closeRetainedSlots,
  closeScopeAdmission,
  createScope,
  finalizeScopeOwnerMaterialization,
  hasRetriableTeardowns,
  releaseHeldEnvironments,
  releaseRetainedEnvironments,
  settleManagerWork,
  startScopeRecoveries,
  unconfirmedTeardowns,
  waitForScopeChildren,
} from './scope'
import { detachedSnapshot } from './snapshot'
import { isNonEmptySpend, terminalAccounting } from './supervisor-accounting'
import {
  boundedSettleGrace,
  confirmSettledTeardowns,
  DEFAULT_TEARDOWN_CONFIRM_MS,
  drainLiveChildren,
  unconfirmedRecord,
} from './supervisor-child-join'
import { createIntensityBreaker, wrapJournalForBreaker } from './supervisor-intensity-breaker'
import {
  allSpawnedChildrenDown,
  classifyNoWinner,
  type DriverRejection,
  describeRejection,
} from './supervisor-result'
import {
  assertResumeContract,
  assertRootIdentity,
  changesRootProfile,
  recordRootReentered,
  recordRootSegment,
  rootExecutionBindingReceipt,
  rootMaterializationReceipt,
  rootStartedAtMs,
} from './supervisor-root-contract'
import { pushRootSignal, type RootControl, rootControls } from './supervisor-root-handle'
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
import { resolveWorkerSlots } from './worker-slots'

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
    // Read every caller-owned field once, then detach and freeze all decision data together before
    // the first await. Stateful runtime collaborators stay live by reference, but replacing a field
    // on the caller's opts object after intake cannot redirect this run.
    const {
      budget,
      rootIdentity,
      rootSegment,
      rootMaterialization,
      runId,
      journal: journalStore,
      blobs: blobStore,
      executors: executorRegistry,
      recoverExecutor,
      maxDepth,
      workerSlots,
      reservationPolicy,
      deadlineCheckIn,
      budgetStopHoldMs,
      maxRestarts,
      withinMs,
      childSettleGraceMs,
      teardownConfirmMs,
      resume,
      retainedAtSettlement: requestedRetainedAtSettlement,
      ownerWorkspaceRetention,
      now: suppliedNow,
      signal,
      hooks,
      workerTrace,
      workerTraceUnpropagated,
      interactiveBindingDir,
    } = opts
    const input = detachedSnapshot(
      {
        task,
        options: {
          budget,
          runId,
          ...(rootIdentity === undefined ? {} : { rootIdentity }),
          ...(rootSegment === undefined ? {} : { rootSegment }),
          ...(rootMaterialization === undefined ? {} : { rootMaterialization }),
          ...(maxDepth === undefined ? {} : { maxDepth }),
          ...(typeof workerSlots === 'number' ? { workerSlots } : {}),
          ...(reservationPolicy === undefined ? {} : { reservationPolicy }),
          ...(maxRestarts === undefined ? {} : { maxRestarts }),
          ...(withinMs === undefined ? {} : { withinMs }),
          ...(childSettleGraceMs === undefined ? {} : { childSettleGraceMs }),
          ...(teardownConfirmMs === undefined ? {} : { teardownConfirmMs }),
          ...(resume === undefined ? {} : { resume }),
          ...(requestedRetainedAtSettlement === undefined
            ? {}
            : { retainedAtSettlement: requestedRetainedAtSettlement }),
          ...(ownerWorkspaceRetention === undefined ? {} : { ownerWorkspaceRetention }),
          ...(interactiveBindingDir === undefined ? {} : { interactiveBindingDir }),
        },
      },
      'supervisor.run',
    )
    assertRecursiveReservationPolicy(reservationPolicy)
    // A shared allocator is a live collaborator, not decision data: it stays by reference.
    const slots = resolveWorkerSlots(workerSlots)
    if (
      teardownConfirmMs !== undefined &&
      (typeof teardownConfirmMs !== 'number' ||
        !Number.isFinite(teardownConfirmMs) ||
        teardownConfirmMs < 0)
    ) {
      throw new ValidationError(
        `supervisor: teardownConfirmMs must be a nonnegative finite number of milliseconds, got ${JSON.stringify(teardownConfirmMs)}`,
      )
    }
    if (
      requestedRetainedAtSettlement !== undefined &&
      requestedRetainedAtSettlement !== 'release' &&
      requestedRetainedAtSettlement !== 'keep'
    ) {
      throw new ValidationError(
        `supervisor: retainedAtSettlement must be 'release' or 'keep', got ${JSON.stringify(requestedRetainedAtSettlement)}`,
      )
    }
    const controller = new AbortController()
    const persistence = guardRunPersistence(journalStore, blobStore, (error) => {
      controller.abort(error)
    })
    opts = Object.freeze({
      ...input.options,
      journal: persistence.journal,
      blobs: persistence.blobs,
      executors: executorRegistry,
      ...(recoverExecutor ? { recoverExecutor } : {}),
      ...(suppliedNow === undefined ? {} : { now: suppliedNow }),
      ...(signal === undefined ? {} : { signal }),
      ...(hooks === undefined ? {} : { hooks }),
      ...(workerTrace === undefined ? {} : { workerTrace }),
      ...(workerTraceUnpropagated === undefined ? {} : { workerTraceUnpropagated }),
      ...(interactiveBindingDir === undefined ? {} : { interactiveBindingDir }),
    })
    task = input.task
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
      const rootAttemptId = newExecutionAttemptId(opts.runId)
      // One instant owns both the fresh pool's absolute deadline and its durable root records. Capture
      // it before any asynchronous journal work so a slow begin cannot extend the run on restart.
      const runStartedAtMs = now()
      const runStartedAt = new Date(runStartedAtMs).toISOString()

      // RESUME-FIRST (opt-in via `opts.resume`): read any prior journal tree for this runId BEFORE
      // beginning a fresh one. A non-empty tree means a prior run for this runId already committed
      // work (it crashed mid-flight, or this is an explicit resume), so rehydrate it instead of
      // starting over. An empty/absent tree — and every run that did NOT opt in — takes the fresh
      // path unchanged. This wires the already-built+tested resume primitives
      // (`replaySpawnTree`/`materializeTreeView`); the journal/blob store decide durability.
      const existing = await opts.journal.loadTree(opts.runId)
      if (opts.resume !== true && existing !== undefined) {
        throw new RuntimeRunStateError(
          `supervisor: runId '${opts.runId}' already exists; pass resume: true to continue it or use a new runId`,
        )
      }
      let prior = opts.resume === true ? existing : undefined
      const resuming = prior !== undefined && prior.length > 0
      let resumeFrom: ScopeResumeState | undefined
      let pool: BudgetPool
      // The instant terminal wall-clock `ms` measures from. A resumed run anchors to the ORIGINAL
      // root instant (the same anchor the absolute deadline uses), so its duration spans processes.
      let runEpochMs = runStartedAtMs
      if (resuming && prior !== undefined) {
        const rootEvent = assertResumeContract(prior, opts)
        runEpochMs = rootStartedAtMs(rootEvent)
        const recoveryController = new AbortController()
        const abortRecovery = () => recoveryController.abort(opts.signal?.reason)
        if (opts.signal?.aborted) abortRecovery()
        else opts.signal?.addEventListener('abort', abortRecovery, { once: true })
        // The execution deadline forbids new work, not recovery of committed evidence.
        // Restore the tree first so an expired run reaches the normal deadline settlement
        // and teardown path. Caller cancellation still interrupts reconciliation.
        let restored: Awaited<ReturnType<typeof prepareScopeResume>>
        try {
          // A run cancelled before this entry settles from its journal and starts nothing:
          // queens21-h22-tree4-20261018a's resume threw on the aborted recovery, and the next one
          // re-ran its work to budget exhaustion before the cancel applied.
          const cancelledAtEntry =
            opts.signal?.aborted === true && opts.signal.reason instanceof RunCancellationReason
          restored = await prepareScopeResume(
            opts,
            prior,
            recoveryController.signal,
            now,
            opts.runId,
            cancelledAtEntry,
          )
        } finally {
          opts.signal?.removeEventListener('abort', abortRecovery)
        }
        resumeFrom = restored.resumeFrom
        prior = [...resumeFrom.events]
        pool = createBudgetPool(opts.budget, runEpochMs, restored.poolRestore)
        await recordRootSegment(opts, prior, runStartedAt, false)
        await recordRootReentered(opts, resumeFrom, runStartedAt)
      } else {
        if (opts.rootSegment !== undefined && changesRootProfile(opts.rootSegment)) {
          throw new RuntimeRunStateError(
            `supervisor: run '${opts.runId}' has no recorded root to change the model or harness of; a new run takes them from its profile`,
          )
        }
        pool = createBudgetPool(opts.budget, runStartedAtMs)
        // Fresh run: begin the tree and journal the root as its own `spawned` node (parent-less, the
        // spawn-ordinal-0 marker), so a journal-based reader — `trajectoryReport`, `replaySpawnTree`,
        // `materializeTreeView` — can reconstruct the WHOLE realized tree from a real run, not only
        // hand-built journals. The root is never `scope.spawn`ed (the supervisor runs `act` directly),
        // so without this the root node is absent and `trajectoryReport` fails its `nodes.has(root)`
        // invariant. The uniqueness guard skips `spawned` events (only the cursor namespace must be
        // unique), so sharing ordinal 0 with the first child's spawn is not a collision; replay ignores
        // `spawned` events for settlement reconstruction, so the replayed `Settled[]` is unchanged.
        // A crash may have committed only beginTree. It owns no root yet, but beginning it
        // again with a different timestamp would reject a valid empty durable run.
        if (existing === undefined) await opts.journal.beginTree(opts.runId, runStartedAt)
        const rootReceipt = rootMaterializationReceipt(opts)
        const rootRuntime = opts.rootMaterialization?.runtime ?? 'inline'
        // The root records publish as ONE grouped record where the store supports it, so a SQL
        // context's fenced head advances once for the whole initialization.
        const rootEvents: SpawnEvent[] = [
          {
            kind: 'spawned',
            id: opts.runId,
            label: 'root',
            budget: opts.budget,
            runtime: rootRuntime,
            ...(opts.reservationPolicy
              ? { recursiveAdmission: { policy: opts.reservationPolicy } }
              : {}),
            ...(opts.rootIdentity ? { identity: opts.rootIdentity } : {}),
            seq: 0,
            at: runStartedAt,
          },
        ]
        if (rootReceipt !== undefined) {
          rootEvents.push({
            kind: 'materialized',
            id: opts.runId,
            receipt: rootReceipt,
            seq: 0,
            at: runStartedAt,
          })
        }
        await appendSpawnEvents(opts.journal, opts.runId, rootEvents)
        await recordRootSegment(opts, [], runStartedAt, true)
      }

      const stableRootReceipt = resuming
        ? prior?.find(
            (event): event is Extract<SpawnEvent, { kind: 'materialized' }> =>
              event.kind === 'materialized' && event.id === opts.runId,
          )?.receipt
        : rootMaterializationReceipt(opts)
      if (stableRootReceipt !== undefined) {
        const rootBinding = rootExecutionBindingReceipt(opts, stableRootReceipt, rootAttemptId)
        if (rootBinding !== undefined) {
          await opts.journal.appendEvent(opts.runId, {
            kind: 'execution-bound',
            id: opts.runId,
            binding: rootBinding,
            seq: 0,
            at: runStartedAt,
          })
        }
      }

      // ONE internal controller is the root scope's abort source. Every cascade path
      // (caller signal, RootHandle.abort, breaker trip, deadline) aborts it; the scope
      // fans it out to each live child's executor (acquire-aware reap included).
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

      // The breaker watches `down` settlements via a counting journal decorator, so it
      // observes every child failure without intercepting `scope.next()` (the driver's
      // private channel). Tripping aborts the same controller; the trip is recorded so the
      // final result can name it.
      const breaker = createIntensityBreaker(opts, () => cascadeAbort('intensity breaker tripped'))
      const journal = wrapJournalForBreaker(opts.journal, breaker)
      // The root's latest materialization: its first, or a later segment's (a seat, or a root segment).
      const priorRootMaterialization = prior
        ?.filter(
          (event): event is Extract<SpawnEvent, { kind: 'materialized' | 'seat-materialized' }> =>
            (event.kind === 'materialized' || event.kind === 'seat-materialized') &&
            event.id === opts.runId,
        )
        .at(-1)?.receipt

      const scope = createScope<Out>({
        parentId: opts.runId,
        root: opts.runId,
        pool,
        journal,
        blobs: opts.blobs,
        executors: opts.executors,
        seams: { [retainedOwnerWorkspaceRetentionSeamKey]: ownerWorkspaceRetention === true },
        depth: 0,
        maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
        workerSlots: slots,
        ...(opts.reservationPolicy
          ? { reservationPolicy: opts.reservationPolicy, ownerBudget: opts.budget }
          : {}),
        ...(deadlineCheckIn === undefined ? {} : { deadlineCheckIn }),
        ...(budgetStopHoldMs === undefined ? {} : { budgetStopHoldMs }),
        signal: controller.signal,
        now,
        hooks: opts.hooks,
        ...(opts.rootMaterialization?.declaration === 'deferred'
          ? {
              ownerMaterialization: {
                runtime: opts.rootMaterialization.runtime,
                authoredProfile: opts.rootMaterialization.authoredProfile,
                attemptId: rootAttemptId,
                requiredKnown: true,
                ...(priorRootMaterialization === undefined
                  ? {}
                  : { prior: priorRootMaterialization }),
              },
            }
          : {}),
        ...(opts.workerTrace ? { workerTrace: opts.workerTrace } : {}),
        ...(opts.workerTraceUnpropagated
          ? { workerTraceUnpropagated: opts.workerTraceUnpropagated }
          : {}),
        ...(opts.interactiveBindingDir
          ? { interactiveBindingDir: opts.interactiveBindingDir }
          : {}),
        ...(resumeFrom ? { resumeFrom } : {}),
      })

      // `view`/drain read the scope opaquely (`Out` erased) — the supervisor never `spawn`s
      // on it, so the live-tree readout and the join barrier are `Out`-agnostic.
      const openScope = scope as unknown as Scope<unknown>

      // Bind any attached RootHandle to THIS live run so view()/signal()/abort() reach the
      // live scope + the one cascade controller. Detached again in the finally barrier.
      if (rootLease) {
        rootLease.bind({
          scope: openScope,
          cascadeAbort: (reason) =>
            cascadeAbort(new RunCancellationReason('root-handle', reason ?? 'root handle aborted')),
          signal: pushRootSignal(cascadeAbort),
          deliver: rootDeliver ? (message) => rootDeliver(message) !== false : () => false,
        })
      }

      let deadlineExceeded = false
      const rootDeadlineAtMs = pool.readout().deadlineMs
      // A root whose result was already accepted is ending the turn that submitted it. The
      // deadline gives it a bounded grace to return that result before cascading: cascading now
      // would discard accepted work and settle the run with no winner. Every child carries the
      // same cutoff on its own timer, so the grace keeps nothing else running.
      let clearAcceptedGrace: (() => void) | undefined
      const reachRootDeadline = (): void => {
        if (clearAcceptedGrace !== undefined) return
        if (rootResultAccepted?.() === true) {
          clearAcceptedGrace = armDeadlineTimer(ACCEPTED_RESULT_GRACE_MS, () => {
            deadlineExceeded = cascadeAbort(ROOT_DEADLINE_REASON)
          })
          return
        }
        deadlineExceeded = cascadeAbort(ROOT_DEADLINE_REASON)
      }
      if (rootDeadlineAtMs > 0 && now() >= rootDeadlineAtMs) reachRootDeadline()
      const clearRootDeadline =
        opts.budget.deadlineMs === undefined
          ? undefined
          : armDeadlineTimer(Math.max(0, rootDeadlineAtMs - now()), reachRootDeadline)
      let actOutcome: { ok: true; out: Out } | { ok: false; error: unknown } = {
        ok: false,
        error: new RuntimeRunStateError('supervisor: root execution did not start'),
      }
      // Settled children whose executor teardown was never acknowledged, read at the join
      // barrier. Surfaced on every result arm so the leak is loud without voiding the run.
      let teardownUnconfirmed: ReadonlyArray<UnconfirmedTeardown> = []
      const retainedAtSettlement =
        opts.retainedAtSettlement ?? (opts.resume === true ? 'keep' : 'release')
      // `teardown-unconfirmed` records live outside the cursor namespace, like `metered`/`edge`.
      let teardownSeq = 0
      let executionAborted = controller.signal.aborted
      // Whether every spawned child was ALREADY down when root execution settled. Read at settle,
      // never after the join barrier: the barrier's own teardown turns healthy live children into
      // `down` nodes, and reading it afterwards reported a crashed driver's run as
      // `all-children-down` — the tree's state caused by the cleanup, not the cause of the failure.
      let allChildrenDownAtSettle = false
      try {
        await startScopeRecoveries(openScope)
        const out = await runAbortable(
          () => rootAct(task, scope),
          controller.signal,
          'supervisor aborted',
        )
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
        closeScopeAdmission(openScope)
        executionAborted = controller.signal.aborted
        allChildrenDownAtSettle = allSpawnedChildrenDown(runTree(openScope))
        // A child inherits the root cutoff and can settle the root act on that exact timer turn.
        // If its settlement callback runs before the root timer callback, the finally block clears
        // the still-pending root timer. Preserve the deadline cause from the shared absolute clock;
        // do not overwrite a caller/breaker abort that already won the controller race.
        if (!controller.signal.aborted && rootDeadlineAtMs > 0 && now() >= rootDeadlineAtMs) {
          deadlineExceeded = true
        }
        clearRootDeadline?.()
        clearAcceptedGrace?.()
        // Join barrier: tear down every still-live child. Generalizes the kernel's
        // `finally{ Promise.allSettled(destroy) }` — a teardown throw is allSettled'd and
        // journaled, never re-thrown.
        //
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
          ? boundedSettleGrace(opts.childSettleGraceMs, rootDeadlineAtMs, now)
          : 0
        try {
          await drainLiveChildren(openScope, controller, settleGraceMs)
          // No later spawn can continue a budget-stopped worker, so what it held is released now.
          await releaseHeldEnvironments(openScope)
          teardownUnconfirmed = unconfirmedTeardowns(openScope)
          // A manager that settled may still be capturing the workspace of its last turn, which
          // it took over so that its node could settle first, and may be releasing its
          // environment after it. Both finish before the run settles, under either policy.
          await settleManagerWork(openScope)
          // A retained-pending child kept its environment through the barrier so that a process
          // resuming this run could reconcile the paid execution inside it. When the run will not
          // be resumed, nothing ever would — measured 2026-09-11, four settled `no-winner` runs
          // held 18 of a 60-slot fleet for 19 to 37 hours and later runs were refused for capacity.
          // Whether a later process resumes is the caller's knowledge, not the outcome's, so the
          // policy decides; the unconfirmed set is re-read so a released node is no longer named.
          if (!persistence.failed && retainedAtSettlement === 'release') {
            teardownUnconfirmed = await releaseRetainedEnvironments(openScope)
          }
          // A first teardown that failed or answered late is not the provider's last word, and a
          // run that settles over it leaves the sandbox running: measured 2026-09-20, cancelling
          // 20 Discovery lanes left 2 workers running. Ask again until confirmed or out of time.
          const confirmWindowMs = opts.teardownConfirmMs ?? DEFAULT_TEARDOWN_CONFIRM_MS
          const releasing = !persistence.failed && retainedAtSettlement === 'release'
          if (
            teardownUnconfirmed.length > 0 &&
            confirmWindowMs > 0 &&
            hasRetriableTeardowns(openScope, releasing)
          ) {
            // The window can last minutes, and a process that dies inside it must not lose the
            // environment ids: the pending set is durable before the first retry.
            const pending = teardownUnconfirmed
            for (const node of pending) {
              await opts.journal.appendEvent(opts.runId, {
                kind: 'teardown-pending',
                ...unconfirmedRecord(node),
                seq: teardownSeq++,
                at: new Date(now()).toISOString(),
              })
            }
            teardownUnconfirmed = await confirmSettledTeardowns(
              openScope,
              confirmWindowMs,
              releasing,
            )
            const still = new Set(teardownUnconfirmed.map((node) => node.id))
            for (const node of pending) {
              if (still.has(node.id)) continue
              await opts.journal.appendEvent(opts.runId, {
                kind: 'teardown-confirmed',
                id: node.id,
                seq: teardownSeq++,
                at: new Date(now()).toISOString(),
              })
            }
          }
          // An expired or cancelled resume can stop before adopting retained children.
          // Preserve those nodes and name their source environments instead of implying
          // that the empty live scope confirmed their cleanup.
          const adopted = new Set(openScope.view.nodes.map((node) => node.id))
          const unrecovered: UnconfirmedTeardown[] = []
          for (const recovery of resumeFrom?.recoveries ?? []) {
            if (adopted.has(recovery.spawned.id)) continue
            const environments = new Map<
              string,
              { provider: string; environmentId: string; keptFor: 'evidence' }
            >()
            for (const admission of recovery.admissions) {
              const environment =
                admission.phase === 'environment'
                  ? admission
                  : admission.phase === 'dispatched'
                    ? admission.controlRef
                    : undefined
              if (environment === undefined) continue
              const ref = {
                provider: environment.provider,
                environmentId: environment.environmentId,
                keptFor: 'evidence' as const,
              }
              environments.set(JSON.stringify([ref.provider, ref.environmentId]), ref)
            }
            unrecovered.push({
              id: recovery.spawned.id,
              label: recovery.spawned.label,
              runtime: recovery.spawned.runtime,
              status:
                resumeFrom?.view.nodes.find((node) => node.id === recovery.spawned.id)?.status ??
                'pending',
              ...(environments.size === 0 ? {} : { kept: [...environments.values()] }),
              attempts: 0,
              detail:
                'Retained child was not recovered before settlement; source evidence and teardown remain unverified.',
            })
          }
          teardownUnconfirmed = [...teardownUnconfirmed, ...unrecovered]
          // The leak is real and must surface, so it is journaled per node — durable evidence a
          // fleet autopsy reads without the run's outcome being voided by cleanup bookkeeping,
          // naming the environment ids an operator's sweeper deletes.
          for (const node of teardownUnconfirmed) {
            await opts.journal.appendEvent(opts.runId, {
              kind: 'teardown-unconfirmed',
              ...unconfirmedRecord(node),
              seq: teardownSeq++,
              at: new Date(now()).toISOString(),
            })
          }
          // A released run is never resumed, so a retained child whose release the retries could
          // not confirm is as final as a released one. Its slot closes now, marked
          // `release-unconfirmed`, with the leak already named above; left open, it read as
          // never-settled forever (#1301).
          if (releasing) await closeRetainedSlots(openScope)
        } catch (error) {
          if (actOutcome?.ok !== false) actOutcome = { ok: false, error }
        }
        if (!persistence.failed) {
          try {
            await finalizeScopeOwnerMaterialization(openScope)
          } catch (error) {
            if (actOutcome?.ok !== false) actOutcome = { ok: false, error }
          }
        }
        if (persistence.failed) {
          // A failed journal cannot prove a terminal outcome or authorize release. Join local
          // observers and admitted writes; retained providers keep their exact invocation alive.
          await waitForScopeChildren(openScope)
          await persistence.drain()
        }
        // Explicit cancellation can arrive during the join barrier; its cleanup abort is distinct.
        executionAborted ||= cascadeAborted
        if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort)
        rootLease?.release()
      }

      // The run's tree, not this process's: on a resumed run the prior process's committed nodes are
      // carried in, so `tree` covers the same work `spentTotal` bills for. Identical to `scope.view`
      // on every run that did not resume.
      persistence.assertAvailable()
      const tree = runTree(scope)
      // Reservations still open once every child has settled, read once at the barrier and named
      // by their holders. A leak breaks `total ≡ free + reserved + committed`, so the winner path
      // below still fails loud rather than hand back an output whose `spentTotal` cannot be
      // trusted. A run that produced NO winner reports the same leak as an integrity finding
      // instead: its tree and the spend the journal recorded are real, and replacing that
      // settlement with an exception discards a whole pursuit over cleanup bookkeeping (#1181).
      const leakedReservations = pool.openReservations()
      if (controller.signal.reason instanceof RunCancellationReason) return noWinner()
      if (actOutcome.ok) {
        if (executionAborted) return noWinner()
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
          await opts.blobs.put(outRef, out)
          // ONE ledger: the journal. `settled` events carry spawned-child WORK; `metered` events carry
          // the drivers' OWN inference (the twin of `pool.observe`). `spentTotal` is their sum and the
          // breakdown keeps the two separable — the A++ view of where the tokens went. No pool bridge.
          const { spentTotal, childWork, driverInference, gaps, providerModel, fleetYield } =
            await terminalAccounting(journal, opts.runId, now() - runEpochMs)
          return {
            kind: 'winner',
            out,
            outRef,
            tree,
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
        return noWinner()
      }

      // act() rejected. The reason is proven from lifecycle state first, in precedence order:
      // a tripped breaker outranks any abort (it is the most specific cause) outranks
      // budget-exhaustion outranks a real `down` child. Only when NONE of those hold does the
      // rejection itself become the reason — `driver-failed`, the one arm that carries `error`.
      // A no-winner is TYPED — never a best-effort coercion of a partial child (M2).
      return noWinner({ error: actOutcome.error })

      // A no-winner still incurred real conserved spend before failing, so it carries `spentTotal`
      // summed off the SAME journal the winner path reads — the caller always learns the cost.
      async function noWinner(rejection?: DriverRejection): Promise<SupervisedResult<Out>> {
        const { spentTotal, gaps, providerModel, fleetYield } = await terminalAccounting(
          journal,
          opts.runId,
          now() - runEpochMs,
        )
        const common = {
          kind: 'no-winner' as const,
          tree,
          downCount: breaker.downCount(),
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
          executionAborted,
          pool,
          opts,
          breaker,
          deadlineExceeded,
          allChildrenDownAtSettle,
        )
        if (controller.signal.reason instanceof RunCancellationReason) {
          const cancellation = controller.signal.reason
          return {
            ...common,
            reason: 'cancelled',
            source: cancellation.source,
            cancellationReason: cancellation.message,
            ...(cancellation.operationId === undefined
              ? {}
              : { operationId: cancellation.operationId }),
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

// ── Root handle ───────────────────────────────────────────────────────────────
