import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { workerTokenFloor } from './budget-floor'
import { armDeadlineTimer, boundedChildDeadlineAt } from './deadline'
import {
  authoredProfileDigest,
  knownExecutionBindingReceipt,
  knownMaterializationReceipt,
  newExecutionAttemptId,
  runtimeOwnedDeferredExecutorRuntime,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
  unknownExecutionBindingReceipt,
  unknownMaterializationReceipt,
} from './materialization'
import { appendNodeMaterialization, runChild } from './scope-settlement'
import {
  deriveNodeExecutionIdentity,
  isAgentSpec,
  isCompleteIdentity,
  sameNodeExecutionIdentity,
  snapshotAgentSpec,
  zeroSpend,
} from './scope-support'
import {
  type KeyState,
  type LiveChild,
  nestedScopeSeamKey,
  type PreSeqSettled,
  type SpawnContext,
} from './scope-types'
import { detachedSnapshot } from './snapshot'
import { runtimeOwnedNestedDriverTreeRoot } from './tree-key'
import type {
  Agent,
  AgentSpec,
  ExecutionBindingReceipt,
  Executor,
  ExecutorContext,
  Handle,
  NodeExecutionIdentity,
  NodeId,
  NodeStatus,
  ProfileMaterializationReceipt,
  Settled,
  SpawnOpts,
  SpawnPrior,
  SpawnRejection,
} from './types'
import { workerTraceSeamKey } from './worker-trace'

export function createSpawn<Out>(context: SpawnContext<Out>) {
  const { args, children, keyed, liveWorkerCapacity, now } = context
  return function spawn<C extends Out>(
    agentOrFactory: Agent<unknown, C> | (() => Agent<unknown, C>),
    rawTask: unknown,
    rawOpts: SpawnOpts,
  ):
    | { ok: true; handle: Handle<C>; prior?: SpawnPrior<C> }
    | { ok: false; reason: SpawnRejection } {
    if (args.signal.aborted) return { ok: false, reason: 'scope-aborted' }
    const task = detachedSnapshot(rawTask, 'scope.spawn task')
    const opts = detachedSnapshot(rawOpts, 'scope.spawn options')
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
      const spec = snapshotAgentSpec(rawSpec)
      return { agent, spec, identity: deriveNodeExecutionIdentity(spec, task) }
    }
    if (opts.key !== undefined) {
      const existing = keyed.get(opts.key)
      if (existing !== undefined) {
        prepared = prepare()
        if (!isCompleteIdentity(prepared.identity)) return { ok: false, reason: 'invalid-identity' }
        if (!sameNodeExecutionIdentity(existing.identity, prepared.identity)) {
          return { ok: false, reason: 'key-conflict' }
        }
      }
      if (existing?.state === 'live') return { ok: false, reason: 'duplicate-key' }
      if (existing?.state === 'done') {
        return {
          ok: true,
          handle: existing.settled.handle as Handle<C>,
          prior: {
            state: 'completed',
            settled: existing.settled as Settled<C> & { kind: 'done' },
          },
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
    const permit = acquireLiveWorker(liveWorkerCapacity)
    if (!permit.ok) return { ok: false, reason: 'max-live-workers' }
    let reservation: ReturnType<typeof args.pool.reserve>
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
      const floor = workerTokenFloor(spec.harness ?? spec.profile.harness ?? null)
      if (floor !== null && opts.budget.maxTokens < floor) {
        args.pool.reconcile(reservation.ticket, zeroSpend())
        permit.release()
        return { ok: false, reason: 'below-runtime-floor' }
      }
      const outcome = args.executors.resolve<C>(spec)
      if (!outcome.succeeded) throw new ValidationError(`scope.spawn: ${outcome.error}`)
      resolved = outcome
    } catch (error) {
      args.pool.reconcile(reservation.ticket, zeroSpend())
      permit.release()
      throw error
    }
    let cascadeAbort: (() => void) | undefined
    let clearChildDeadline: (() => void) | undefined
    try {
      const ordinal = context.nextOrdinal()
      const id: NodeId = `${args.parentId}:s${ordinal}`
      const attemptId = newExecutionAttemptId(id)
      const startedAt = now()
      const childDeadlineAtMs = boundedChildDeadlineAt(
        args.pool.readout().deadlineMs,
        opts.budget.deadlineMs,
        startedAt,
      )
      const controller = new AbortController()
      cascadeAbort = () => controller.abort(args.signal.reason)
      if (args.signal.aborted) controller.abort(args.signal.reason)
      else args.signal.addEventListener('abort', cascadeAbort, { once: true })
      if (childDeadlineAtMs !== undefined) {
        clearChildDeadline = armDeadlineTimer(Math.max(0, childDeadlineAtMs - now()), () =>
          controller.abort('child deadline exceeded'),
        )
      }
      const deferredOwner: import('./scope-types').DeferredOwnerSlot = {}
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
          [nestedScopeSeamKey]: context.makeNestedScopeSeam(
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
        abort: (reason?: string) => controller.abort(reason),
        isAborted: () => controller.signal.aborted,
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
        } as KeyState<Out>)
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
      const materializationCommitted = spawnCommitted.then(async () => {
        const profileDigest = identity?.profileDigest ?? authoredProfileDigest(spec.profile)
        let receipt: ProfileMaterializationReceipt
        let binding: ExecutionBindingReceipt
        const declaration = runtimeOwnedExecutorMaterialization(executor)
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
        childDeadlineAtMs,
      )
        .then((settlement) => {
          live.resolved = settlement
          return settlement
        })
        .finally(() => {
          if (live.cleanupConfirmed) permit.release()
          clearChildDeadline?.()
          if (cascadeAbort) args.signal.removeEventListener('abort', cascadeAbort)
        })
      ;(live as { settled: Promise<PreSeqSettled> }).settled = settled
      return { ok: true, handle, ...(prior ? { prior } : {}) }
    } catch (error) {
      permit.release()
      clearChildDeadline?.()
      if (cascadeAbort) args.signal.removeEventListener('abort', cascadeAbort)
      args.pool.reconcile(reservation.ticket, zeroSpend())
      throw error
    }
  }
}

function acquireLiveWorker(capacity: { max: number | undefined; live: number }) {
  if (capacity.max !== undefined && capacity.live >= capacity.max) return { ok: false as const }
  capacity.live += 1
  let released = false
  return {
    ok: true as const,
    release(): void {
      if (released) return
      released = true
      capacity.live -= 1
    },
  }
}
