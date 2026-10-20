import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { RunCancellationReason } from './abortable'
import { CHILD_DEADLINE_REASON, DEADLINE_CHECK_IN_MESSAGE, checkInIdleMs } from './deadline'
import { freeSlots } from './dispatch'
import { errorText } from './error-message'
import { isTerminalNodeStatus } from './node-status'
import { DEFAULT_STALL_AFTER_MS, type ExecutorProgress, type WorkerProgress, readWorkerProgress } from './progress'
import { addResourceSpend, withBudgetResources } from './resources'
import { bindScopeRetainedOwnerWorkspaceRetention, registerScopeRetainedOwner, retainedOwnerWorkspaceRetentionSeamKey } from './retained-scope-owner'
import { admissionSeals, childDrains, driverAttemptRecorders, heldReleasers, liveTeamReaders, pauseRecorders, recoveryStarters, releasingScopes, runtimeOwnedProviderMeters, subtreeReaders, unconfirmedTeardownOf, waitForScopeChildren } from './scope-capabilities'
import { type LiveChild, type PreSeqSettled, type ScopeArgs } from './scope-contract'
import { assertRecursiveReservationPolicy } from './scope-identity'
import { liveTeamOf, makeTreeView, noInteractiveSession, readInteractiveSession, readLiveTeam, reenteredWorkers, summarizeTeam, teamProgress } from './scope-observation'
import { bindScopeOwnerMaterialization, ownerMaterializationStates } from './scope-owner-materialization'
import { finalizeSettlement, raceFirstSettled } from './scope-settlement'
import { createScopeSpawner } from './scope-spawn'
import { bindChildTeardown, createHeldChildRelease } from './scope-teardown'
import { detachedSnapshot } from './snapshot'
import { type TraceSource } from './trace-source'
import { type ExecutorCancellation, type ExecutorCancellationRequest, type NodeId, type ProviderModelExecutionEvidence, type ResumedKeyState, type ResumedWork, type Scope, type Settled, type Spend, type TreeView, type WorkerInteractiveSession } from './types'
import { type WorkerEventCursor, type WorkerEventPage } from './worker-events'
import { writeWorkerInteractiveBinding } from './worker-interactive'
import { createWorkerSlots, openSlotGroup } from './worker-slots'

/** Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. */
export function createScope<Out>(args: ScopeArgs): Scope<Out> {
  // Refuse a malformed check-in policy now, never inside a child's deadline timer.
  checkInIdleMs(args.deadlineCheckIn)
  const children = new Map<NodeId, LiveChild>()
  const settlementWrites = new Set<Promise<Settled<Out>>>()
  // Set once by `closeScopeAdmission` at the join barrier; never cleared.
  let admissionClosed = false
  const workerSlots = args.workerSlots ?? createWorkerSlots()
  const slotGroup = openSlotGroup(workerSlots, args.slotOwner)
  const reservationPolicy = args.reservationPolicy
  assertRecursiveReservationPolicy(reservationPolicy)
  if (reservationPolicy && !args.ownerBudget) {
    throw new ValidationError('reservationPolicy requires the owning scope budget')
  }
  const ownerBudget = args.ownerBudget
  const ownerFloor =
    reservationPolicy && ownerBudget
      ? {
          tokens: Math.ceil(ownerBudget.maxTokens * reservationPolicy.ownerShare),
          iterations: Math.ceil(ownerBudget.maxIterations * reservationPolicy.ownerShare),
          ...(ownerBudget.maxUsd === undefined
            ? {}
            : { usd: ownerBudget.maxUsd * reservationPolicy.ownerShare }),
        }
      : undefined
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
  let cursorSeq = args.resumeFrom ? args.resumeFrom.maxCursorSeq + 1 : 0
  let meterSeq = 0
  // The owner's own turns, so its lead reads a manager that takes turns as active.
  let ownerTurns = 0
  let ownerLastTurnAt = 0
  const now = args.now ?? Date.now
  const { releaseHeld, heldReleases } = createHeldChildRelease(args, now)
  const { spawn, recordKeyedSettlement } = createScopeSpawner<Out>({ args, children,
    slotGroup, workerSlots, ownerFloor, now,
    isAdmissionClosed: () => admissionClosed, checkInAtTimeBox, releaseHeld,
  })

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

  /**
   * A child's own time box: tell it to save its state and submit what it has, and keep it running
   * while it makes progress (`deadline.ts` `DeadlineCheckIn`). Returns the watch's stop, or
   * undefined when the child cannot be told (no inbox, already settled, or check-ins are off), in
   * which case the caller stops it as before.
   */
  function checkInAtTimeBox(nodeId: NodeId, controller: AbortController): (() => void) | undefined {
    const idleMs = checkInIdleMs(args.deadlineCheckIn)
    if (idleMs === undefined || controller.signal.aborted) return undefined
    if (!send(nodeId, { steer: DEADLINE_CHECK_IN_MESSAGE, interrupt: false })) return undefined
    const watch = setInterval(
      () => {
        const read = progress(nodeId, { stallAfterMs: idleMs })
        if (read === undefined || !read.live || controller.signal.aborted) {
          clearInterval(watch)
          return
        }
        if (read.stalled) {
          clearInterval(watch)
          controller.abort(CHILD_DEADLINE_REASON)
        }
      },
      Math.min(idleMs, 60_000),
    )
    if (typeof watch.unref === 'function') watch.unref()
    return () => clearInterval(watch)
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
    // A manager child reports no usage of its own until it settles, so without its team the lead
    // would read a manager whose workers are busy as idle and, after `stallAfterMs`, as stalled.
    const team = liveTeamOf(child)
    return readWorkerProgress(
      {
        id: child.id,
        status: child.status,
        steerable: child.deliver !== undefined && !child.delivered,
        startedAt: child.startedAt,
        lastActivityAt: Math.max(child.lastActivityAt, team?.lastActivityAt ?? 0),
        ...addResourceSpend(child.spent.resources),
        turns: Math.max(child.spent.iterations, team?.ownerTurns ?? 0),
        ...(team && team.agents > 0 ? { team: teamProgress(team) } : {}),
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
    // A settled child holds no process.
    if (child.executorDone || isTerminalNodeStatus(child.status)) {
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
    runtimeOwned = false,
    alreadySpent = false,
  ): Promise<void> {
    if (args.signal.aborted && !runtimeOwned) {
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
      args.pool.observe(spend, { partial, ...(alreadySpent ? { alreadySpent } : {}) })
    } catch (error) {
      observeError = error
    }
    ownerLastTurnAt = now()
    if (!accountingOnly) ownerTurns += 1
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
        keys: args.resumeFrom.keys as ReadonlyMap<string, ResumedKeyState<Out>>,
        priorSpend: args.resumeFrom.priorSpend,
        reentered: reenteredWorkers(args.resumeFrom, args.parentId),
      }
    : undefined

  const scope: Scope<Out> = {
    spawn,
    next,
    nextResolved,
    send,
    releaseHeld: (nodeId, reason) => {
      const child = children.get(nodeId)
      return child === undefined ? Promise.resolve(false) : releaseHeld(child, reason)
    },
    progress,
    observeTree: () => {
      const view = makeTreeView(args.parentId, children)
      const nodes = new Map((args.resumeFrom?.view.nodes ?? []).map((node) => [node.id, node]))
      for (const node of view.nodes) nodes.set(node.id, node)
      for (const child of children.values()) {
        const nested = child.readNestedScope?.()
        if (nested)
          for (const node of (nested.observeTree?.() ?? nested.view).nodes) nodes.set(node.id, node)
      }
      const all = [...nodes.values()]
      return {
        root: view.root,
        nodes: all,
        inFlight: all.filter((node) => ['queued', 'acquiring', 'running'].includes(node.status))
          .length,
      }
    },
    observeEvents: (nodeId: NodeId, cursor?: WorkerEventCursor): WorkerEventPage => {
      const child = children.get(nodeId)
      if (child) return child.events.read(cursor)
      for (const candidate of children.values()) {
        const nested = candidate.readNestedScope?.()
        const page = nested?.observeEvents?.(nodeId, cursor)
        if (page && (page.status === 'available' || page.reason !== 'unknown-worker')) return page
      }
      return {
        status: 'unavailable',
        reason: args.resumeFrom?.view.nodes.some((node) => node.id === nodeId)
          ? 'not-captured'
          : 'unknown-worker',
      }
    },
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
        working: workerSlots.working,
        queued: workerSlots.queued,
        freeSlots: freeSlots(workerSlots.working, workerSlots.max),
        // The nodes behind a charged-but-idle slot: settled, yet their executor never
        // acknowledged teardown. This scope names its OWN children; a nested manager names its
        // own, so a leak is attributable rather than an integer.
        unconfirmed: Object.freeze(
          [...children.values()]
            .filter((child) => isTerminalNodeStatus(child.status) && !child.cleanupConfirmed)
            .map((child) => unconfirmedTeardownOf(child, releasingScopes.has(scope))),
        ),
      }
    },
  }
  childDrains.set(scope, async () => {
    await Promise.allSettled([...children.values()].map((child) => child.settled))
    await Promise.allSettled([...settlementWrites])
    await Promise.all(
      [...children.values()].map(async (child) => {
        const nested = child.readNestedScope?.()
        if (nested !== undefined) await waitForScopeChildren(nested)
      }),
    )
  })
  admissionSeals.set(scope as Scope<unknown>, () => {
    admissionClosed = true
  })
  heldReleasers.set(scope, async () => {
    await Promise.all([...children.values()].map((child) => releaseHeld(child, 'scope-join')))
    await Promise.allSettled([...heldReleases])
  })
  subtreeReaders.set(scope as Scope<unknown>, () => summarizeTeam(children.values()))
  liveTeamReaders.set(scope as Scope<unknown>, () =>
    readLiveTeam(children.values(), ownerTurns, ownerLastTurnAt),
  )
  runtimeOwnedProviderMeters.set(
    scope as Scope<unknown>,
    async (spend, providerModel, detail, accountingOnly, alreadySpent) =>
      // A provider attempt already started before abort can finish without a usage receipt.
      // Its unknown-cost marker still belongs in the durable journal after the scope aborts.
      meterInternal(spend, detail, providerModel, accountingOnly, true, alreadySpent),
  )
  let driverAttemptSeq: number | undefined
  driverAttemptRecorders.set(scope as Scope<unknown>, async (record) => {
    if (driverAttemptSeq === undefined) {
      const events = (await args.journal.loadTree(args.root)) ?? []
      driverAttemptSeq = events.reduce(
        (next, event) =>
          event.kind === 'driver-attempt' && event.id === args.parentId
            ? Math.max(next, event.seq + 1)
            : next,
        0,
      )
    }
    const attemptId = ownerMaterializationStates.get(scope as Scope<unknown>)?.attemptId
    await args.journal.appendEvent(args.root, {
      kind: 'driver-attempt',
      id: args.parentId,
      record: {
        ...record,
        ...(record.error === undefined ? {} : { error: errorText(record.error) }),
      },
      ...(attemptId === undefined ? {} : { attemptId }),
      seq: driverAttemptSeq++,
      at: new Date(now()).toISOString(),
    })
  })
  let pauseSeq = 0
  pauseRecorders.set(scope as Scope<unknown>, async (pause) => {
    await args.journal.appendEvent(args.root, {
      kind: 'paused',
      id: args.parentId,
      ...pause,
      seq: pauseSeq++,
      at: new Date(now()).toISOString(),
    })
  })
  bindScopeOwnerMaterialization(scope, args, now)
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
        // A recovered child can reach its original deadline before mounting its descendants.
        // Its resolved outcome belongs to next(); it must not prevent its parent or siblings
        // from recovering. Rejected settlement/storage operations still fail this barrier.
        await Promise.all(
          adopted.map((child) =>
            child.recoveryReady === undefined
              ? undefined
              : Promise.race([child.recoveryReady, child.settled]),
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
  bindChildTeardown(scope, args, children, now)
  registerScopeRetainedOwner(scope as Scope<unknown>, {
    rootId: args.root,
    executionRootId: args.ownerMaterialization?.journalRoot ?? args.root,
    nodeId: args.parentId,
    depth: args.depth,
    journal: args.journal,
    blobs: args.blobs,
    priorEvents: args.resumeFrom?.events ?? [],
    now,
  })
  bindScopeRetainedOwnerWorkspaceRetention(
    scope as Scope<unknown>,
    args.seams[retainedOwnerWorkspaceRetentionSeamKey] === true,
  )
  return scope
}
