import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { refreshBudgetLease } from './budget'
import { checkInIdleMs } from './deadline'
import { freeSlots } from './dispatch'
import { errorText } from './error-message'
import { isTerminalNodeStatus } from './node-status'
import { owners } from './retained-owner-state'
import { registerScopeRetainedOwner } from './retained-scope-owner'
import {
  admissionSeals,
  barrenPauseRecorders,
  childDrains,
  driverAttemptRecorders,
  heldReleasers,
  liveTeamReaders,
  pauseRecorders,
  recoveryStarters,
  releasingScopes,
  runtimeOwnedProviderMeters,
  subtreeReaders,
  unconfirmedTeardownOf,
  waitForScopeChildren,
} from './scope-capabilities'
import type { LiveChild, ScopeArgs } from './scope-contract'
import { assertRecursiveReservationPolicy } from './scope-identity'
import { makeTreeView, readLiveTeam, reenteredWorkers, summarizeTeam } from './scope-observation'
import {
  bindScopeOwnerMaterialization,
  ownerMaterializationStates,
} from './scope-owner-materialization'
import { ScopeOwnerMeter } from './scope-owner-meter'
import { ScopeSettlementCursor } from './scope-settlement-cursor'
import { createScopeSpawner } from './scope-spawn'
import { bindChildTeardown, createHeldChildRelease } from './scope-teardown'
import { ScopeWorkers } from './scope-workers'
import { detachedSnapshot } from './snapshot'
import type {
  NodeId,
  ResumedKeyState,
  ResumedWork,
  Scope,
  Settled,
  SpawnEvent,
  TreeView,
} from './types'
import { createWorkerSlots, openSlotGroup } from './worker-slots'

/** Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay. */
export function createScope<Out>(args: ScopeArgs): Scope<Out> {
  if (args.depth === 0) args = { ...args, rootDeadlineAtMs: args.pool.readout().deadlineMs }
  checkInIdleMs(args.deadlineCheckIn)
  const children = new Map<NodeId, LiveChild>()
  let admissionClosed = false
  const workerSlots = args.workerSlots ?? createWorkerSlots()
  const slotGroup = openSlotGroup(workerSlots, args.slotOwner)
  const ownerFloor = reservationOwnerFloor(args)
  const now = args.now ?? Date.now
  const workers = new ScopeWorkers(args, children, now)
  const meter = new ScopeOwnerMeter(
    args,
    now,
    () => ownerMaterializationStates.get(scope)?.attemptId,
  )
  const { releaseHeld, heldReleases } = createHeldChildRelease(args, now)
  const { spawn, recordKeyedSettlement } = createScopeSpawner<Out>({
    args,
    children,
    slotGroup,
    workerSlots,
    ownerFloor,
    now,
    isAdmissionClosed: () => admissionClosed,
    checkInAtTimeBox: workers.checkInAtTimeBox,
    releaseHeld,
    publishSettlement: async (child, settlement): Promise<unknown> => {
      const published = await cursor.publish(child, settlement)
      await refreshBudgetLease(args.pool)
      return published
    },
  })
  const cursor = new ScopeSettlementCursor<Out>(args, children, now, recordKeyedSettlement)

  // Replayed committed work, frozen at construction: a resume-aware `act` skips settled children.
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
    next: cursor.next,
    nextResolved: cursor.nextResolved,
    send: workers.send,
    releaseHeld: (nodeId, reason) => {
      const child = children.get(nodeId)
      return child === undefined ? Promise.resolve(false) : releaseHeld(child, reason)
    },
    progress: workers.progress,
    observeTree: workers.observeTree,
    observeEvents: workers.observeEvents,
    traceSource: workers.traceSource,
    interactive: workers.interactive,
    cancel: workers.cancel,
    signal: args.signal,
    rootDeadlineAtMs: args.rootDeadlineAtMs || undefined,
    meter: (spend, detail) => meter.record(spend, detail),
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
        // Settled nodes whose teardown was never acknowledged, each scope naming its OWN children.
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
    await Promise.allSettled([...cursor.writes])
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
    readLiveTeam(children.values(), meter.ownerTurns, meter.ownerLastTurnAt),
  )
  runtimeOwnedProviderMeters.set(
    scope as Scope<unknown>,
    async (spend, providerModel, detail, accountingOnly, alreadySpent) =>
      // A provider attempt already started before abort can finish without a usage receipt.
      // Its unknown-cost marker still belongs in the durable journal after the scope aborts.
      meter.record(spend, detail, providerModel, accountingOnly, true, alreadySpent),
  )
  bindOwnerJournalRecorders(scope as Scope<unknown>, args, now)
  bindScopeOwnerMaterialization(scope, args, now)
  if (args.resumeFrom?.recoveries?.length) {
    recoveryStarters.set(scope, () => recoverRetainedChildren(args, children, spawn, cursor.next))
  }
  bindChildTeardown(scope, args, children, now)
  registerScopeRetainedOwner(scope as Scope<unknown>, {
    ...(args.hooks ? { hooks: args.hooks } : {}),
    rootId: args.root,
    executionRootId: args.ownerMaterialization?.journalRoot ?? args.root,
    nodeId: args.parentId,
    depth: args.depth,
    journal: args.journal,
    blobs: args.blobs,
    priorEvents: args.resumeFrom?.events ?? [],
    now,
  })
  return scope
}

/** The owner's reserved share of its own budget, which child admission must leave free. */
function reservationOwnerFloor(
  args: ScopeArgs,
): { tokens: number; iterations: number; usd?: number } | undefined {
  const reservationPolicy = args.reservationPolicy
  assertRecursiveReservationPolicy(reservationPolicy)
  if (reservationPolicy && !args.ownerBudget) {
    throw new ValidationError('reservationPolicy requires the owning scope budget')
  }
  const ownerBudget = args.ownerBudget
  return reservationPolicy && ownerBudget
    ? {
        tokens: Math.ceil((ownerBudget.maxTokens ?? 0) * reservationPolicy.ownerShare),
        iterations: Math.ceil((ownerBudget.maxIterations ?? 0) * reservationPolicy.ownerShare),
        ...(ownerBudget.maxUsd === undefined
          ? {}
          : { usd: ownerBudget.maxUsd * reservationPolicy.ownerShare }),
      }
    : undefined
}

/** Journal the owner's driver attempts, pauses and barren pauses, each in its own monotonic `seq` namespace. */
function bindOwnerJournalRecorders(scope: Scope<unknown>, args: ScopeArgs, now: () => number) {
  let driverAttemptSeq: number | undefined
  driverAttemptRecorders.set(scope, async (record) => {
    if (driverAttemptSeq === undefined) {
      const events = (await args.journal.loadTree(args.root)) ?? []
      const prior = events.filter((e) => e.kind === 'driver-attempt' && e.id === args.parentId)
      driverAttemptSeq = prior.reduce((next, event) => Math.max(next, event.seq + 1), 0)
    }
    const attemptId = ownerMaterializationStates.get(scope)?.attemptId
    // A retained owner's read position rides on its record, where a restarted owner finds it.
    const observed = owners.get(scope)?.context.observed
    const event: Extract<SpawnEvent, { kind: 'driver-attempt' }> = {
      kind: 'driver-attempt',
      id: args.parentId,
      record: detachedSnapshot(
        {
          ...record,
          ...(record.error === undefined ? {} : { error: errorText(record.error) }),
          ...(observed === undefined ? {} : { observed }),
        },
        'driver attempt record',
      ),
      ...(attemptId === undefined ? {} : { attemptId }),
      seq: driverAttemptSeq++,
      at: new Date(now()).toISOString(),
    }
    await args.journal.appendEvent(args.root, event)
    notifyRuntimeHookEvent(
      args.hooks,
      {
        id: `${event.id}:driver-attempt:${event.seq}`,
        runId: args.root,
        parentId: event.id,
        target: 'agent.execution',
        phase: 'event',
        timestamp: Date.parse(event.at),
        payload: {
          nodeId: event.id,
          ...(event.attemptId === undefined ? {} : { attemptId: event.attemptId }),
          record: event.record,
        },
      },
      { signal: args.signal },
    )
  })
  let pauseSeq = 0
  pauseRecorders.set(scope, async (pause) => {
    await args.journal.appendEvent(args.root, {
      kind: 'paused',
      id: args.parentId,
      ...pause,
      seq: pauseSeq++,
      at: new Date(now()).toISOString(),
    })
  })
  // Counted from the journal, like the driver records, so a resumed run continues the sequence.
  let barrenPauseSeq: number | undefined
  barrenPauseRecorders.set(scope, async (pause) => {
    if (barrenPauseSeq === undefined) {
      const events = (await args.journal.loadTree(args.root)) ?? []
      barrenPauseSeq = events.filter(
        (event) => event.kind === 'barren-pause' && event.id === args.parentId,
      ).length
    }
    await args.journal.appendEvent(args.root, {
      kind: 'barren-pause',
      id: args.parentId,
      ...pause,
      seq: barrenPauseSeq++,
      at: new Date(now()).toISOString(),
    })
  })
}

/** Re-admit every retained child the resume recovered, each through its recovered executor. */
async function recoverRetainedChildren<Out>(
  args: ScopeArgs,
  children: Map<NodeId, LiveChild>,
  spawn: ReturnType<typeof createScopeSpawner<Out>>['spawn'],
  next: () => Promise<Settled<Out> | null>,
): Promise<void> {
  const adopted: LiveChild[] = []
  try {
    for (const recovery of args.resumeFrom!.recoveries!) {
      // Terminal recovery adopts only original leaves for teardown. Nested owners need their
      // original driver binding; keep those explicitly unconfirmed instead of a vacuous release.
      if (args.signal.aborted && recovery.spawned.ownedTreeRoot !== undefined) continue
      const node = recovery.spawned
      const agent = Object.assign(
        {
          name: recovery.spec.profile.name ?? node.label,
          act: async () => {
            throw new ValidationError('retained children execute through their recovered executor')
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
        throw new ValidationError(`scope recovery admission refused '${node.id}': ${result.reason}`)
      adopted.push(children.get(node.id)!)
    }
    // A recovered child can reach its deadline before mounting its descendants; its outcome
    // belongs to next(), not to this barrier, which rejected settlement or storage still fails.
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
}
