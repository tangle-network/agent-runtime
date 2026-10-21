import { ValidationError } from '../../errors'
import { guardRunPersistence } from './run-persistence'
import { assertRecursiveReservationPolicy } from './scope'
import { detachedSnapshot } from './snapshot'
import type { SupervisorOpts } from './types'
import { resolveWorkerSlots } from './worker-slots'

/** A run's caller-owned inputs, read once and detached before the run's first await. */
export interface SupervisorRunIntake<Task> {
  readonly task: Task
  /** Frozen: decision data detached, live collaborators by reference, persistence guarded. */
  readonly opts: SupervisorOpts
  readonly slots: ReturnType<typeof resolveWorkerSlots>
  /** The root scope's one abort source; a persistence failure aborts it. */
  readonly controller: AbortController
  readonly persistence: ReturnType<typeof guardRunPersistence>
  readonly ownerWorkspaceRetention: SupervisorOpts['ownerWorkspaceRetention']
  readonly deadlineCheckIn: SupervisorOpts['deadlineCheckIn']
  readonly budgetStopHoldMs: SupervisorOpts['budgetStopHoldMs']
}

/** Read every caller-owned field once, then detach and freeze all decision data before the first
 *  await; stateful collaborators stay live by reference, but later opts mutation cannot redirect the run. */
export function admitSupervisorRun<Task>(
  task: Task,
  opts: SupervisorOpts,
): SupervisorRunIntake<Task> {
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
  const admitted: SupervisorOpts = Object.freeze({
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
  return {
    task: input.task,
    opts: admitted,
    slots,
    controller,
    persistence,
    ownerWorkspaceRetention,
    deadlineCheckIn,
    budgetStopHoldMs,
  }
}
