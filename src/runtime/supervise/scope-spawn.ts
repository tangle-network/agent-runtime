import { contentAddress } from '../../durable/content-address'
import { appendSpawnEvents } from '../../durable/spawn-journal/journal-store'
import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { persistHarnessTranscript, readHarnessTranscript } from '../harness-transcript'
import type {
  RetainedInteractiveAdmission,
  RetainedRunEnvironmentAdmission,
} from '../retained-run-types'
import { zeroSpend } from '../util'
import { RunCancellationReason } from './abortable'
import type { BudgetPool, ReservationShortfall } from './budget'
import {
  armDeadlineTimer,
  boundedChildDeadlineAt,
  CHILD_DEADLINE_REASON,
  singleFlightTeardown,
  teardownExecutor,
} from './deadline'
import { executableAgentSpecSnapshot } from './executable-spec'
import {
  interactiveAdmissionSeamKey,
  writeWorkerInteractiveAdmission,
} from './interactive-admission'
import { authoredAgentIdentity, newExecutionAttemptId } from './materialization'
import { withBudgetResources } from './resources'
import {
  BUDGET_CONTINUATION_TASK,
  type RetainedChildRecovery,
  retainedExecutorSeamKey,
} from './retained-executor'
import { nestedTeardownScopes } from './scope-capabilities'
import { createChildMaterialization } from './scope-child-materialization'
import { createChildRetention } from './scope-child-retention'
import {
  type DeferredOwnerSlot,
  type LiveChild,
  nestedScopeSeamKey,
  type PreSeqSettled,
  type ScopeArgs,
} from './scope-contract'
import { downRecord, runChild } from './scope-execution'
import {
  deriveNodeExecutionIdentity,
  isAgentSpec,
  isCompleteIdentity,
  sameNodeExecutionIdentity,
} from './scope-identity'
import { makeNestedScopeSeam } from './scope-nesting'
import { readInteractiveReadyUntilWorkerEnds, readInteractiveSession } from './scope-observation'
import { detachedSnapshot } from './snapshot'
import { traceRootWriter } from './trace-root'
import { runtimeOwnedNestedDriverTreeRoot } from './tree-key'
import type {
  Agent,
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
  Settled,
  SpawnEvent,
  SpawnOpts,
  SpawnPrior,
  SpawnRejection,
} from './types'
import { WorkerEvents } from './worker-events'
import { writeWorkerInteractiveBinding } from './worker-interactive'
import { deferSlot, type openSlotGroup, type WorkerSlots } from './worker-slots'
import { workerTraceSeamKey } from './worker-trace'

/** Own child admission, keyed identity and executor startup. */
export function createScopeSpawner<Out>({
  args,
  children,
  slotGroup,
  workerSlots,
  ownerFloor,
  now,
  isAdmissionClosed,
  checkInAtTimeBox,
  releaseHeld,
}: {
  args: ScopeArgs
  children: Map<NodeId, LiveChild>
  slotGroup: ReturnType<typeof openSlotGroup>
  workerSlots: WorkerSlots
  ownerFloor: { tokens: number; iterations: number; usd?: number } | undefined
  now: () => number
  isAdmissionClosed: () => boolean
  checkInAtTimeBox: (id: NodeId, controller: AbortController) => (() => void) | undefined
  releaseHeld: (child: LiveChild, reason: HeldRelease) => Promise<boolean>
}) {
  const interactiveBindingDir = args.interactiveBindingDir
  let spawnOrdinal = args.resumeFrom ? args.resumeFrom.maxSpawnOrdinal + 1 : 0
  let progressSeq = 0
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
    } else if (prior.state === 'down' && prior.settled === undefined) {
      // A derived `down`: the resume itself proved the attempt dead (an `inline` runtime cannot
      // outlive its process), so there is no settlement to fold — the derived reason is the
      // terminal evidence a same-key re-spawn reports as `resumed: "retried"`.
      if (prior.identity === undefined) continue
      keyed.set(key, {
        state: 'down',
        id: prior.id,
        identity: prior.identity,
        reason: prior.reason ?? 'interrupted: resume proved the prior attempt dead',
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
    | { ok: false; reason: SpawnRejection; shortfalls?: readonly ReservationShortfall[] } {
    if (args.signal.aborted) return { ok: false, reason: 'scope-aborted' }
    // The run reached its join barrier: no later child can be joined, released, or selected over.
    // Distinct from an abort — nothing cancelled this run (see `closeScopeAdmission`).
    if (isAdmissionClosed()) return { ok: false, reason: 'scope-settled' }
    const task = detachedSnapshot(rawTask, 'scope.spawn task')
    const opts = detachedSnapshot(rawOpts, 'scope.spawn options')

    // A key is an identity claim, not merely a cache label. An in-doubt start has no terminal
    // receipt, so it refuses before touching a lazy factory. Every other reuse prepares the
    // requested agent far enough to compare its authorized profile/task identity with the journal.
    // No executor is resolved, constructed, reserved, or run on the completed path.
    let prior: SpawnPrior<C> | undefined
    // Set when this spawn continues a budget-stopped node's held environment and session.
    let continuing:
      | {
          readonly from: LiveChild
          readonly admission: RetainedRunEnvironmentAdmission
          readonly held: NonNullable<LiveChild['held']>
        }
      | undefined
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
        // A result that ended over its budget, whose environment is still held, continues in a new
        // node when the caller asks for it; any other committed result is returned as it stands.
        const from = children.get(existing.id)
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
        continuing = { from, admission, held: from.held }
        prior = {
          state: 'continued',
          priorId: existing.id,
          environmentId: from.held.continuation.environmentId,
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

    // Reserve the child's whole ceiling atomically, never read-then-spawn overcommit, so Σk is
    // conserved by construction. A ceiling the pool cannot cover now, but could once this scope's
    // running children return what they hold, WAITS for it instead of failing: the child is
    // admitted as `queued` and starts when settlements free enough. It fails CLOSED when nothing
    // running could free enough. The manager's owner share stays free either way. This happens
    // before a fresh lazy agent factory is called: refused work constructs nothing.
    // The ticket is named from the moment it exists. A node id arrives only after admission, so
    // the holder is refined below; a leak caught before then still carries the assignment.
    const assignment = opts.assignmentId ?? opts.key
    let reservation: ReturnType<BudgetPool['reserve']>
    reservation = args.pool.reserve(
      opts.budget,
      {
        ...(assignment === undefined ? {} : { assignment }),
        label: opts.label,
        stage: 'admitted',
      },
      { wait: true, ...(!recovery && ownerFloor ? { keep: ownerFloor } : {}) },
    )
    if (!reservation.ok) {
      return {
        ok: false,
        reason: reservation.reason,
        ...(reservation.shortfalls === undefined ? {} : { shortfalls: reservation.shortfalls }),
      }
    }

    // Resolve the leaf executor through the open registry after budget admission.
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
      throw error
    }

    // The child keeps its budget slice and takes a worker slot now, or waits in the allocator's
    // queue and starts when one frees. A recovered execution already runs remotely, so it takes a
    // slot past the bound rather than waiting behind work that has not started. A child that
    // waits for budget asks for its slot only once the budget is granted, so it never holds a
    // slot that the children it waits on need.
    const budgetGranted = reservation.granted
    const permit =
      budgetGranted === undefined
        ? slotGroup.acquire(args.depth + 1, { force: recovery !== undefined })
        : deferSlot(budgetGranted, () =>
            slotGroup.acquire(args.depth + 1, { force: recovery !== undefined }),
          )

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
      const successorOf = opts.successorOf ?? continuing?.from.id
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
        // The run's own deadline (a root scope's pool cutoff) stops the child; any shorter cutoff
        // is a time box its lead set, which is a check-in for a child that can be told.
        const runDeadlineAtMs = args.depth === 0 ? args.pool.readout().deadlineMs : 0
        const timeBox = !(runDeadlineAtMs > 0 && childDeadlineAtMs >= runDeadlineAtMs)
        let clearCheckIn: (() => void) | undefined
        const clearTimer = armDeadlineTimer(Math.max(0, childDeadlineAtMs - now()), () => {
          clearCheckIn = timeBox ? checkInAtTimeBox(id, controller) : undefined
          if (clearCheckIn === undefined) controller.abort(CHILD_DEADLINE_REASON)
        })
        clearChildDeadline = () => {
          clearTimer()
          clearCheckIn?.()
        }
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
      // A budget-queued recovery is already represented by this scope's child handle.
      // Waiting for its nested mount here can deadlock a funded sibling that needs its parent.
      // Its executor still restores descendants before it acts, after the pool grants the ticket.
      let markRecoveryReady: (() => void) | undefined
      const recoveryReady =
        recovery?.spawned.ownedTreeRoot === undefined || budgetGranted !== undefined
          ? undefined
          : new Promise<void>((resolve) => {
              markRecoveryReady = resolve
            })
      // Built before the retained seam, which cites it before the live child exists.
      const traceRoots = traceRootWriter(args.blobs, id)
      const retention = createChildRetention({
        args,
        controller,
        id,
        ordinal,
        identity,
        recovery,
        opts,
        now,
        traceRoots,
        markRecoveryReady,
        childDeadlineAtMs,
        readLive: () => live,
        completeEvidence: async () => materialization.complete(),
      })
      const { retainedContext, closeRetainedWrites, holdMs } = retention
      const ctx: ExecutorContext = {
        signal: controller.signal,
        node: {
          rootId: args.root,
          parentId: args.parentId,
          nodeId: id,
          depth: args.depth + 1,
          attemptId,
          ...(identity ? { identity } : {}),
        },
        seams: {
          ...args.seams,
          [retainedExecutorSeamKey]: retainedContext(
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
            workerSlots,
            permit,
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

      // A recovered node keeps the substitution its spawn record journaled.
      const modelSubstitution = recovery
        ? recovery.spawned.modelSubstitution
        : spec.modelSubstitution
      const handle: Handle<C> = {
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

      const askTeardown = singleFlightTeardown(executor, () => {
        live.teardownAttempts += 1
      })
      const live: LiveChild = {
        events: new WorkerEvents(),
        id,
        status: permit.granted ? 'acquiring' : 'queued',
        runtime: executor.runtime,
        ...(ownedTreeRoot === undefined ? {} : { ownedTreeRoot }),
        ...(identity ? { identity } : {}),
        ...(modelSubstitution === undefined ? {} : { modelSubstitution }),
        budget: opts.budget,
        label: opts.label,
        ...(opts.assignmentId === undefined ? {} : { assignmentId: opts.assignmentId }),
        ...(opts.key !== undefined ? { key: opts.key } : {}),
        spent: zeroSpend(),
        traceRoots,
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
        readEnvironmentAdmission: retention.readEnvironmentAdmission,
      }
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
            .then(async () => {
              // The spawn record and its execution input publish as ONE grouped record where the
              // store supports it, so a SQL context's fenced head advances once per spawn — a crash
              // between the two can never leave a spawned node whose task bytes are unreferenced.
              const events: SpawnEvent[] = [
                {
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
                  seq: ordinal,
                  at: new Date(now()).toISOString(),
                },
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
      const materialization = createChildMaterialization({
        args,
        spawnCommitted,
        identity,
        spec,
        executor,
        deferredOwner,
        attemptId,
        id,
        recovery,
        live,
        ordinal,
        now,
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
              ...(opts.key === undefined ? {} : { key: opts.key }),
              ...(successorOf === undefined ? {} : { successorOf }),
              runtime: executor.runtime,
              ...(identity ? { identity } : {}),
              // Who acted, for span observers: the authored profile under the digest the
              // journal recorded for this node.
              agent: authoredAgentIdentity(spec.profile, identity?.profileDigest),
              budget: opts.budget,
              depth: args.depth,
              attemptId,
              startedAt,
            },
          },
          { signal: args.signal },
        )

      // Past every refusal: the held environment belongs to this node now, and the node it came
      // from holds nothing (its settlement and result stand).
      if (continuing !== undefined) {
        continuing.held.clearCeiling?.()
        continuing.held.continuation.handOver()
        continuing.from.held = undefined
        continuing.from.cleanupConfirmed = true
      }

      // Drive the executor to settlement off to the side; `next()` awaits the resulting
      // promise. A thrown executor (or a real abort) is TYPED into a `down` record by
      // `runChild` (never re-thrown) so a single failing child never rejects the cursor.
      const childRun = runChild(
        live,
        executor,
        controller,
        // A recovered continuation replays its own invocation's task, and a keyed continuation
        // tells the held session to go on; the spawn identity above stays the node's original task.
        recovery?.continuation?.task ??
          (continuing === undefined ? task : BUDGET_CONTINUATION_TASK),
        opts,
        args.pool,
        reservation.ticket,
        args.blobs,
        now,
        args.journal,
        args.root,
        () => progressSeq++,
        materialization.ready,
        {
          complete: async () => materialization.complete(),
          fail: async () => materialization.fail(),
        },
        childDeadlineAtMs,
        recovery !== undefined,
        closeRetainedWrites,
        budgetGranted,
        permit.ready,
        recovery?.continuation?.priorSpent,
        startedAt,
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
        .then(async (ran) => {
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
        })
        .finally(() => {
          // The worker slot bounds agents that are SIMULTANEOUSLY WORKING, and a terminally-settled
          // child is not working. Gating the release on proof of destruction conflated two questions:
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
      // Persistence may fail before a cursor starts awaiting this child.
      void settled.catch(() => undefined)
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

  return { spawn, recordKeyedSettlement }
}
