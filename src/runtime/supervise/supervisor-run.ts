import {
  contentAddress,
  materializeTreeView,
  pendingWaits,
  replaySpawnTree,
} from '../../durable/spawn-journal'
import { RuntimeRunStateError } from '../../errors'
import { type BudgetPool, createBudgetPool } from './budget'
import type { SupervisorControlRoute } from './control'
import { armDeadlineTimer } from './deadline'
import { runTree } from './finalizer'
import { newExecutionAttemptId } from './materialization'
import { createScope, finalizeScopeOwnerMaterialization } from './scope'
import { detachedSnapshot } from './snapshot'
import { startSupervisorControlRouteForScope } from './supervisor-control-route'
import {
  addSpend,
  classifyNoWinner,
  createIntensityBreaker,
  drainLiveChildren,
  isNonEmptySpend,
  runAbortable,
  spentFromJournal,
  sumMeasuredSpendFromEvents,
  sumSpendFromEvents,
  wrapJournalForBreaker,
} from './supervisor-finalization'
import {
  assertResumeContract,
  assertRootIdentity,
  type DriverRejection,
  defaultMaxDepth,
  describeRejection,
  keyedAssignments,
  maxSeqOf,
  type ResumeFrom,
  rootDeadline,
  rootExecutionBindingReceipt,
  rootMaterializationReceipt,
  uncertainSpawnBudgets,
} from './supervisor-replay'
import { pushRootSignal, type RootControl } from './supervisor-root-control'
import type {
  Agent,
  RootControlStatus,
  Scope,
  SpawnEvent,
  SupervisedResult,
  SupervisorOpts,
} from './types'

export async function runSupervisor<Task, Out>(
  root: Agent<Task, Out>,
  task: Task,
  initialOpts: SupervisorOpts,
  attached?: RootControl,
): Promise<SupervisedResult<Out>> {
  let opts = initialOpts
  const {
    budget,
    rootIdentity,
    rootMaterialization,
    runId,
    journal: journalStore,
    blobs: blobStore,
    executors: executorRegistry,
    probes,
    maxDepth,
    maxLiveWorkers,
    maxRestarts,
    withinMs,
    resume,
    now: suppliedNow,
    signal,
    controlDir,
    controlCapabilityToken,
    hooks,
    workerTrace,
    workerTraceUnpropagated,
  } = opts
  const input = detachedSnapshot(
    {
      task,
      options: {
        budget,
        runId,
        ...(rootIdentity === undefined ? {} : { rootIdentity }),
        ...(rootMaterialization === undefined ? {} : { rootMaterialization }),
        ...(maxDepth === undefined ? {} : { maxDepth }),
        ...(maxLiveWorkers === undefined ? {} : { maxLiveWorkers }),
        ...(maxRestarts === undefined ? {} : { maxRestarts }),
        ...(withinMs === undefined ? {} : { withinMs }),
        ...(resume === undefined ? {} : { resume }),
      },
    },
    'supervisor.run',
  )
  opts = Object.freeze({
    ...input.options,
    journal: journalStore,
    blobs: blobStore,
    executors: executorRegistry,
    ...(probes === undefined ? {} : { probes }),
    ...(suppliedNow === undefined ? {} : { now: suppliedNow }),
    ...(signal === undefined ? {} : { signal }),
    ...(controlDir === undefined ? {} : { controlDir }),
    ...(controlCapabilityToken === undefined ? {} : { controlCapabilityToken }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(workerTrace === undefined ? {} : { workerTrace }),
    ...(workerTraceUnpropagated === undefined ? {} : { workerTraceUnpropagated }),
  })
  task = input.task
  const rootAct = root.act.bind(root)
  const rootDeliver = root.deliver?.bind(root)
  const now = opts.now ?? Date.now
  if (opts.controlDir && !opts.controlCapabilityToken) {
    throw new RuntimeRunStateError(
      'supervisor: controlCapabilityToken is required when controlDir is configured',
    )
  }
  assertRootIdentity(opts)
  const rootLease = attached?.acquire()
  try {
    const rootAttemptId = newExecutionAttemptId(opts.runId)
    const runStartedAtMs = now()
    const runStartedAt = new Date(runStartedAtMs).toISOString()
    const existing = await opts.journal.loadTree(opts.runId)
    if (opts.resume !== true && existing !== undefined) {
      throw new RuntimeRunStateError(
        `supervisor: runId '${opts.runId}' already exists; pass resume: true to continue it or use a new runId`,
      )
    }
    const prior = opts.resume === true ? existing : undefined
    const resuming = prior !== undefined && prior.length > 0
    let resumeFrom: ResumeFrom | undefined
    let pool: BudgetPool
    if (resuming) {
      const rootEvent = assertResumeContract(prior, opts)
      const measured = sumMeasuredSpendFromEvents(prior)
      pool = createBudgetPool(opts.budget, now, {
        committed: addSpend(measured.childWork, measured.driverInference),
        uncertainReservations: uncertainSpawnBudgets(prior),
        ...(rootEvent.budget.deadlineMs !== undefined
          ? { absoluteDeadlineMs: rootDeadline(rootEvent) }
          : {}),
      })
      const settled = await replaySpawnTree(opts.journal, opts.blobs, opts.runId)
      const view = materializeTreeView(prior)
      resumeFrom = {
        settled,
        view,
        maxSpawnOrdinal: maxSeqOf(prior, (event) => event.kind === 'spawned'),
        maxCursorSeq: maxSeqOf(
          prior,
          (event) =>
            event.kind === 'settled' || event.kind === 'cancelled' || event.kind === 'woken',
        ),
        maxWaitOrdinal: maxSeqOf(prior, (event) => event.kind === 'waiting'),
        waits: pendingWaits(prior),
        keys: keyedAssignments(prior, settled),
        priorSpend: sumSpendFromEvents(prior),
      }
    } else {
      pool = createBudgetPool(opts.budget, now, {
        ...(opts.budget.deadlineMs !== undefined
          ? { absoluteDeadlineMs: runStartedAtMs + opts.budget.deadlineMs }
          : {}),
      })
      await opts.journal.beginTree(opts.runId, runStartedAt)
      const rootReceipt = rootMaterializationReceipt(opts)
      const rootRuntime = opts.rootMaterialization?.runtime ?? 'inline'
      await opts.journal.appendEvent(opts.runId, {
        kind: 'spawned',
        id: opts.runId,
        label: 'root',
        budget: opts.budget,
        runtime: rootRuntime,
        ...(opts.rootIdentity ? { identity: opts.rootIdentity } : {}),
        seq: 0,
        at: runStartedAt,
      })
      if (rootReceipt !== undefined) {
        await opts.journal.appendEvent(opts.runId, {
          kind: 'materialized',
          id: opts.runId,
          receipt: rootReceipt,
          seq: 0,
          at: runStartedAt,
        })
      }
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
    const controller = new AbortController()
    const cascadeAbort = (reason?: unknown): boolean => {
      if (controller.signal.aborted) return false
      controller.abort(reason)
      return true
    }
    const onCallerAbort = () => cascadeAbort(opts.signal?.reason ?? 'caller signal aborted')
    if (opts.signal) {
      if (opts.signal.aborted) cascadeAbort(opts.signal.reason ?? 'caller signal aborted')
      else opts.signal.addEventListener('abort', onCallerAbort, { once: true })
    }
    const breaker = createIntensityBreaker(opts, () => cascadeAbort('intensity breaker tripped'))
    const journal = wrapJournalForBreaker(opts.journal, breaker)
    const priorRootMaterialization = prior?.find(
      (event): event is Extract<SpawnEvent, { kind: 'materialized' }> =>
        event.kind === 'materialized' && event.id === opts.runId,
    )?.receipt
    const scope = createScope<Out>({
      parentId: opts.runId,
      root: opts.runId,
      pool,
      journal,
      blobs: opts.blobs,
      executors: opts.executors,
      seams: {},
      depth: 0,
      maxDepth: opts.maxDepth ?? defaultMaxDepth,
      ...(opts.maxLiveWorkers !== undefined ? { maxLiveWorkers: opts.maxLiveWorkers } : {}),
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
      ...(opts.probes ? { probes: opts.probes } : {}),
      ...(opts.workerTrace ? { workerTrace: opts.workerTrace } : {}),
      ...(opts.workerTraceUnpropagated
        ? { workerTraceUnpropagated: opts.workerTraceUnpropagated }
        : {}),
      ...(resumeFrom ? { resumeFrom } : {}),
    })
    const openScope = scope as unknown as Scope<unknown>
    if (rootLease) {
      rootLease.bind({
        scope: openScope,
        status: 'running',
        cascadeAbort: (reason) => {
          cascadeAbort(reason)
        },
        signal: pushRootSignal((reason) => {
          cascadeAbort(reason)
        }),
        deliver: rootDeliver ? (message) => rootDeliver(message) !== false : () => false,
      })
    }
    let controlRoute: SupervisorControlRoute | undefined
    try {
      if (opts.controlDir && opts.controlCapabilityToken) {
        controlRoute = startSupervisorControlRouteForScope({
          runDir: opts.controlDir,
          runId: opts.runId,
          capabilityToken: opts.controlCapabilityToken,
          scope: openScope,
          abort: cascadeAbort,
          now,
        })
        controlRoute.rebind()
      }
    } catch (error) {
      if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort)
      try {
        controlRoute?.close('failed')
      } catch {
        // Keep the route-start failure and still release ownership.
      }
      rootLease?.release()
      throw error
    }
    let deadlineExceeded = false
    const rootDeadlineAtMs = pool.readout().deadlineMs
    if (rootDeadlineAtMs > 0 && now() >= rootDeadlineAtMs) {
      deadlineExceeded = cascadeAbort('root budget deadline exceeded')
    }
    const clearRootDeadline =
      opts.budget.deadlineMs === undefined
        ? undefined
        : armDeadlineTimer(Math.max(0, rootDeadlineAtMs - now()), () => {
            deadlineExceeded = cascadeAbort('root budget deadline exceeded')
          })
    let actOutcome: { ok: true; out: Out } | { ok: false; error: unknown } = {
      ok: false,
      error: new RuntimeRunStateError('supervisor: root execution did not start'),
    }
    let executionAborted = controller.signal.aborted
    try {
      try {
        const out = await runAbortable(() => rootAct(task, scope), controller.signal)
        actOutcome = { ok: true, out }
      } catch (error) {
        actOutcome = { ok: false, error }
      }
    } finally {
      executionAborted = controller.signal.aborted
      if (!controller.signal.aborted && rootDeadlineAtMs > 0 && now() >= rootDeadlineAtMs) {
        deadlineExceeded = true
      }
      clearRootDeadline?.()
      try {
        await drainLiveChildren(openScope, controller)
      } catch (error) {
        if (actOutcome.ok) actOutcome = { ok: false, error }
      }
      try {
        await finalizeScopeOwnerMaterialization(openScope)
      } catch (error) {
        if (actOutcome.ok) actOutcome = { ok: false, error }
      }
      try {
        let terminalStatus: RootControlStatus = controller.signal.aborted
          ? 'cancelled'
          : actOutcome.ok
            ? 'completed'
            : 'failed'
        try {
          controlRoute?.close(terminalStatus)
        } catch (error) {
          if (actOutcome.ok) actOutcome = { ok: false, error }
          terminalStatus = 'failed'
        }
        rootLease?.retainTerminal({ status: terminalStatus, tree: openScope.view })
      } catch (error) {
        if (actOutcome.ok) actOutcome = { ok: false, error }
      }
      if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort)
      rootLease?.release()
    }
    const tree = runTree(scope)
    pool.assertNoOpenTickets()
    if (actOutcome.ok) {
      if (executionAborted) return noWinner()
      if (actOutcome.out !== undefined) {
        const outRef = contentAddress(actOutcome.out)
        await opts.blobs.put(outRef, actOutcome.out)
        const { childWork, driverInference } = await spentFromJournal(journal, opts.runId)
        return {
          kind: 'winner',
          out: actOutcome.out,
          outRef,
          tree,
          spentTotal: addSpend(childWork, driverInference),
          ...(isNonEmptySpend(driverInference)
            ? { spentBreakdown: { driverInference, childWork } }
            : {}),
        }
      }
      return noWinner()
    }
    return noWinner({ error: actOutcome.error })

    async function noWinner(rejection?: DriverRejection): Promise<SupervisedResult<Out>> {
      const { childWork, driverInference } = await spentFromJournal(journal, opts.runId)
      const common = {
        kind: 'no-winner' as const,
        tree,
        downCount: breaker.downCount(),
        spentTotal: addSpend(childWork, driverInference),
      }
      const lifecycle = classifyNoWinner(controller, pool, opts, breaker, deadlineExceeded, tree)
      if (lifecycle !== undefined) return { ...common, reason: lifecycle }
      if (rejection !== undefined) {
        return { ...common, reason: 'driver-failed', error: describeRejection(rejection.error) }
      }
      return { ...common, reason: 'all-children-down' }
    }
  } finally {
    rootLease?.release()
  }
}
