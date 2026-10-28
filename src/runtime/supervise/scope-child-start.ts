/**
 * The records one admitted child starts with: its executor context, its handle, its live-child
 * row, its spawn journal record and hook, and the settlement chain that closes it. `scope-spawn`
 * sequences them; each builder here owns one record.
 */

import { contentAddress } from '../../durable/content-address'
import { appendSpawnEvents } from '../../durable/spawn-journal/journal-store'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { persistHarnessTranscript, readHarnessTranscript } from '../harness-transcript'
import type {
  RetainedInteractiveAdmission,
  RetainedRunEnvironmentAdmission,
} from '../retained-run-types'
import { zeroSpend } from '../util'
import { RunCancellationReason } from './abortable'
import { singleFlightTeardown, teardownExecutor } from './deadline'
import {
  interactiveAdmissionSeamKey,
  writeWorkerInteractiveAdmission,
} from './interactive-admission'
import { authoredAgentIdentity } from './materialization'
import { type RetainedChildRecovery, retainedExecutorSeamKey } from './retained-executor'
import { nestedTeardownScopes } from './scope-capabilities'
import type { createChildRetention } from './scope-child-retention'
import {
  type DeferredOwnerSlot,
  type LiveChild,
  nestedScopeSeamKey,
  type PreSeqSettled,
  type ScopeArgs,
} from './scope-contract'
import { downRecord } from './scope-execution'
import { makeNestedScopeSeam } from './scope-nesting'
import { readInteractiveReadyUntilWorkerEnds, readInteractiveSession } from './scope-observation'
import type { TraceRootWriter } from './trace-root'
import type {
  AgentSpec,
  ExecutionBindingReceipt,
  Executor,
  ExecutorContext,
  Handle,
  HeldRelease,
  NodeExecutionIdentity,
  NodeId,
  NodeStatus,
  ProfileMaterializationReceipt,
  SpawnEvent,
  SpawnOpts,
  WorkerInteractiveSession,
} from './types'
import { WorkerEvents } from './worker-events'
import { writeWorkerInteractiveBinding } from './worker-interactive'
import type { SlotPermit, WorkerSlots } from './worker-slots'
import { type TraceContext, workerTraceSeamKey } from './worker-trace'

type ChildRetention = ReturnType<typeof createChildRetention>

/** A budget-stopped node's held environment and session, continued by a same-key spawn. */
export interface HeldContinuation {
  readonly from: LiveChild
  readonly admission: RetainedRunEnvironmentAdmission
  readonly held: NonNullable<LiveChild['held']>
}

/** A child past every admission refusal: its node, its clocks, and what it runs. */
export interface AdmittedChild {
  readonly id: NodeId
  readonly ordinal: number
  readonly attemptId: string
  readonly startedAt: number
  readonly childDeadlineAtMs: number | undefined
  readonly successorOf: NodeId | undefined
  readonly task: unknown
  readonly opts: SpawnOpts
  readonly spec: AgentSpec
  readonly identity: NodeExecutionIdentity | undefined
  /** A recovered node keeps the substitution its spawn record journaled. */
  readonly modelSubstitution: AgentSpec['modelSubstitution']
  readonly recovery: RetainedChildRecovery | undefined
  readonly continuing: HeldContinuation | undefined
}

/**
 * Seed THIS scope's keystone deps into the child's `ExecutorContext.seams`, so a DRIVER child can
 * mount a nested `Scope` at `depth+1` over a pool backed by THIS reservation. Leaves ignore it.
 */
export function childExecutorContext(
  args: ScopeArgs,
  child: AdmittedChild,
  controller: AbortController,
  seams: {
    readonly workerSlots: WorkerSlots
    readonly permit: SlotPermit
    readonly deferredOwner: DeferredOwnerSlot
    readonly workerTrace: TraceContext | undefined
    readonly retainedContext: ChildRetention['retainedContext']
    readonly now: () => number
  },
): ExecutorContext {
  const { id, identity, recovery, continuing, opts } = child
  const interactiveBindingDir = args.interactiveBindingDir
  return {
    signal: controller.signal,
    node: {
      rootId: args.root,
      parentId: args.parentId,
      nodeId: id,
      depth: args.depth + 1,
      attemptId: child.attemptId,
      ...(identity ? { identity } : {}),
    },
    seams: {
      ...args.seams,
      [retainedExecutorSeamKey]: seams.retainedContext(
        recovery?.continuation !== undefined
          ? {
              executionId: recovery.continuation.executionId,
              priorSession: recovery.continuation.priorSession,
              priorSpent: recovery.continuation.priorSpent,
            }
          : continuing !== undefined
            ? // The successor's first invocation runs in the held environment and session.
              { executionId: id, priorSession: continuing.admission }
            : undefined,
      ),
      [nestedScopeSeamKey]: makeNestedScopeSeam(
        args,
        seams.workerSlots,
        seams.permit,
        id,
        opts.budget,
        child.childDeadlineAtMs,
        seams.deferredOwner,
      ),
      ...(seams.workerTrace ? { [workerTraceSeamKey]: seams.workerTrace } : {}),
      ...(interactiveBindingDir
        ? {
            [interactiveAdmissionSeamKey]: (admission: RetainedInteractiveAdmission) =>
              Promise.resolve(
                writeWorkerInteractiveAdmission(interactiveBindingDir, id, admission, seams.now),
              ).then(() => undefined),
          }
        : {}),
    },
  }
}

/** The caller's handle: live reads of the child's row, and its own abort. */
export function childHandle<C>(
  child: AdmittedChild,
  children: Map<NodeId, LiveChild>,
  controller: AbortController,
): Handle<C> {
  const { id, opts, identity, modelSubstitution } = child
  return {
    id,
    label: opts.label,
    ...(opts.assignmentId === undefined ? {} : { assignmentId: opts.assignmentId }),
    ...(identity ? { identity } : {}),
    ...(modelSubstitution === undefined ? {} : { modelSubstitution }),
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
}

/** The scope's row for a started child, reading the executor's optional capabilities. */
export function liveChildRecord<C>(
  args: ScopeArgs,
  child: AdmittedChild,
  executor: Executor<C>,
  start: {
    readonly granted: boolean
    readonly controller: AbortController
    readonly ownedTreeRoot: NodeId | undefined
    readonly traceRoots: TraceRootWriter
    readonly recoveryReady: Promise<void> | undefined
    readonly readEnvironmentAdmission: LiveChild['readEnvironmentAdmission']
    readonly now: () => number
  },
): LiveChild {
  const { id, identity, modelSubstitution, opts, recovery, startedAt } = child
  const { ownedTreeRoot, recoveryReady, controller, now } = start
  const askTeardown = singleFlightTeardown(executor, () => {
    live.teardownAttempts += 1
  })
  const live: LiveChild = {
    events: new WorkerEvents(
      args.interactiveBindingDir === undefined
        ? undefined
        : { runDir: args.interactiveBindingDir, nodeId: id, now },
    ),
    id,
    status: start.granted ? 'acquiring' : 'queued',
    runtime: executor.runtime,
    ...(ownedTreeRoot === undefined ? {} : { ownedTreeRoot }),
    ...(identity ? { identity } : {}),
    ...(modelSubstitution === undefined ? {} : { modelSubstitution }),
    budget: opts.budget,
    label: opts.label,
    ...(opts.assignmentId === undefined ? {} : { assignmentId: opts.assignmentId }),
    ...(opts.key !== undefined ? { key: opts.key } : {}),
    spent: zeroSpend(),
    traceRoots: start.traceRoots,
    settled: undefined as unknown as Promise<PreSeqSettled>,
    delivered: false,
    executorDone: false,
    cleanupConfirmed: false,
    ...(recovery ? { recoveryPending: true } : {}),
    ...(recoveryReady ? { recoveryReady } : {}),
    ...(recovery?.priorMaterialization ? { materialization: recovery.priorMaterialization } : {}),
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
          confirmTeardown: () =>
            teardownExecutor(executor, 'brutalKill', undefined, now, askTeardown),
        }
      : {}),
    askTeardown,
    ...(executor.heldEnvironments
      ? { readHeldEnvironments: executor.heldEnvironments.bind(executor) }
      : {}),
    ...(nestedTeardownScopes.has(executor)
      ? { readNestedScope: nestedTeardownScopes.get(executor)! }
      : {}),
    ...(executor.harnessTranscript
      ? {
          readTranscriptAtRelease: () =>
            persistHarnessTranscript(readHarnessTranscript(executor), args.blobs),
        }
      : {}),
    teardownAttempts: 0,
    abortChild: (reason?: unknown): void => controller.abort(reason),
    readEnvironmentAdmission: start.readEnvironmentAdmission,
  }
  return live
}

/** Keep the run-level cancellation reason that aborted a child before it produced a result. */
export function recordChildCancellation<C>(
  live: LiveChild,
  executor: Executor<C>,
  controller: AbortController,
): void {
  const recordCancellation = (): void => {
    if (
      !live.executorDone &&
      live.acceptedResult === undefined &&
      executor.resultAccepted?.() !== true &&
      controller.signal.reason instanceof RunCancellationReason
    ) {
      live.cancellationReason = controller.signal.reason
    }
  }
  if (controller.signal.aborted) recordCancellation()
  else controller.signal.addEventListener('abort', recordCancellation, { once: true })
}

/**
 * Journal the spawn with the authored child profile itself: `identity.profileDigest` is not a blob
 * key (`FileResultBlobStore.put` asserts the key IS `contentAddress(artifact)`), so the event
 * carries the digest that names the agent and the ref that retrieves its bytes. The blob lands
 * BEFORE the event that names it; N children sharing a profile store one body.
 */
export function commitSpawnRecord<C>(
  args: ScopeArgs,
  child: AdmittedChild,
  executor: Executor<C>,
  ownedTreeRoot: NodeId | undefined,
  workerTrace: TraceContext | undefined,
  now: () => number,
): Promise<void> {
  const { id, task, identity, ordinal, spec } = child
  const profileRef = contentAddress(spec.profile)
  const taskRef = identity?.taskDigest === undefined ? undefined : contentAddress(task)
  return args.blobs
    .put(profileRef, spec.profile)
    .then(() => (taskRef === undefined ? undefined : args.blobs.put(taskRef, task)))
    .then(async () => {
      // The spawn record and its execution input publish as ONE grouped record where supported, so
      // a crash never leaves a spawned node with unreferenced task bytes.
      const events: SpawnEvent[] = [
        spawnedEvent(args, child, executor, ownedTreeRoot, profileRef, now),
      ]
      if (taskRef !== undefined) {
        events.push({
          kind: 'execution-input',
          id,
          taskRef,
          seq: ordinal,
          at: new Date(now()).toISOString(),
        })
      }
      await appendSpawnEvents(args.journal, args.root, events)
    })
    .then(async () => {
      // The severed distributed-trace hop, journaled beside its spawn: the run records spans AND
      // resolved a context, but the backend has no channel to carry it, so the child's trace
      // surfaces as a disconnected root; this makes that a queryable fact.
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
}

function spawnedEvent<C>(
  args: ScopeArgs,
  child: AdmittedChild,
  executor: Executor<C>,
  ownedTreeRoot: NodeId | undefined,
  profileRef: string,
  now: () => number,
): SpawnEvent {
  const { id, opts, identity, successorOf, continuing, modelSubstitution } = child
  return {
    kind: 'spawned',
    id,
    parent: args.parentId,
    label: opts.label,
    ...(opts.key !== undefined ? { key: opts.key } : {}),
    ...(opts.assignmentId === undefined ? {} : { assignmentId: opts.assignmentId }),
    ...(successorOf === undefined ? {} : { successorOf }),
    ...(continuing === undefined
      ? {}
      : {
          continues: {
            ofWorker: continuing.from.id,
            environmentId: continuing.admission.environmentId,
          },
        }),
    budget: opts.budget,
    runtime: executor.runtime,
    ...(ownedTreeRoot === undefined ? {} : { ownedTreeRoot }),
    ...(identity ? { identity } : {}),
    profileRef,
    ...(modelSubstitution === undefined ? {} : { modelSubstitution }),
    seq: child.ordinal,
    at: new Date(now()).toISOString(),
  }
}

/** Announce a fresh child on the `agent.spawn` hook. */
export function notifyChildSpawned<C>(
  args: ScopeArgs,
  child: AdmittedChild,
  executor: Executor<C>,
  now: () => number,
): void {
  const { id, opts, successorOf, identity, spec } = child
  notifyRuntimeHookEvent(
    args.hooks,
    {
      id: `${id}:spawn`,
      runId: args.root,
      target: 'agent.spawn',
      phase: 'after',
      timestamp: now(),
      stepIndex: child.ordinal,
      parentId: args.parentId,
      payload: {
        childId: id,
        label: opts.label,
        ...(opts.assignmentId === undefined ? {} : { assignmentId: opts.assignmentId }),
        ...(opts.key === undefined ? {} : { key: opts.key }),
        ...(successorOf === undefined ? {} : { successorOf }),
        runtime: executor.runtime,
        ...(identity ? { identity } : {}),
        // Who acted, for span observers: the authored profile under the digest the
        // journal recorded for this node.
        agent: authoredAgentIdentity(spec.profile, identity?.profileDigest),
        budget: opts.budget,
        depth: args.depth,
        attemptId: child.attemptId,
        startedAt: child.startedAt,
      },
    },
    { signal: args.signal },
  )
}

/** Past every refusal: the held environment belongs to the successor now, and the node it came
 *  from holds nothing (its settlement and result stand). */
export function handOverContinuation(continuing: HeldContinuation): void {
  continuing.held.clearCeiling?.()
  continuing.held.continuation.handOver()
  continuing.from.held = undefined
  continuing.from.cleanupConfirmed = true
}

/** Persist the child's interactive-session binding once the spawn is committed and it is ready. */
export function bindInteractiveWorker(
  args: ScopeArgs,
  live: LiveChild,
  label: string,
  childRun: Promise<PreSeqSettled>,
  signal: AbortSignal,
  spawnCommitted: Promise<void>,
  now: () => number,
): Promise<void> {
  return spawnCommitted.then(async () => {
    if (args.interactiveBindingDir === undefined) return
    const notStarted = (session: WorkerInteractiveSession): boolean =>
      session.status !== 'available' && session.reason === 'interactive-session-not-started'
    let session = readInteractiveSession(live)
    if (notStarted(session) && live.readInteractiveReady !== undefined) {
      const ready = await readInteractiveReadyUntilWorkerEnds(
        live.readInteractiveReady,
        childRun,
        signal,
      )
      if (ready === undefined || notStarted(ready)) return
      session = ready
    }
    writeWorkerInteractiveBinding(
      args.interactiveBindingDir,
      live.id,
      label,
      args.root,
      session,
      now,
    )
  })
}

/**
 * The child's settlement as the cursor reads it: the run's record with its trace root, downgraded
 * when the interactive binding could not persist, with a held environment timed or released.
 */
export async function resolveChildSettlement(
  live: LiveChild,
  ran: PreSeqSettled,
  interactiveBindingCommitted: Promise<void>,
  holdMs: number,
  releaseHeld: (child: LiveChild, reason: HeldRelease) => Promise<boolean>,
): Promise<PreSeqSettled> {
  // Every settlement arm that cites an output this process stored cites its trace root.
  const traceRoot = await live.traceRoots.recorded(ran.outRef)
  const s: PreSeqSettled = traceRoot === undefined ? ran : { ...ran, traceRoot }
  let resolution = s
  try {
    await interactiveBindingCommitted
  } catch {
    resolution = {
      ...downRecord(
        'interactive worker binding persistence failed',
        true,
        s.trace,
        s.metered,
        s.providerModel,
        s.outRef,
        // Re-wrapping a record the child already settled: its transcript receipt is
        // established evidence and a persistence failure here does not unmake it.
        s.harnessTranscript,
      ),
      ...(s.traceRoot === undefined ? {} : { traceRoot: s.traceRoot }),
    }
  }
  live.resolved = resolution
  if (live.held !== undefined) {
    if (resolution.kind === 'done') {
      const timer = setTimeout(() => void releaseHeld(live, 'hold-ceiling'), holdMs)
      timer.unref?.()
      live.held.clearCeiling = () => clearTimeout(timer)
    } else {
      await releaseHeld(live, 'scope-join')
    }
  }
  return resolution
}
