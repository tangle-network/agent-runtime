import { contentAddress } from '../../durable/content-address'
import { addSpend, chargedTokens, unreportedSpend, zeroSpend } from '../util'
import { runAbortable } from './abortable'
import { budgetLeases, budgetLeaseUpdates, createBudgetPool, refreshBudgetLease } from './budget'
import { prepareScopeResume, sumMeasuredSpendFromEvents } from './recover-executors'
import { withBudgetResources } from './resources'
import { scopeOwnerLiabilities } from './retained-owner-state'
import { scopeSeatAccountingUpdates, seatAdmissionPauses } from './scope-capabilities'
import { createScope } from './scope-construction'
import type {
  ChildAdmission,
  DeferredOwnerSlot,
  NestedScopeSeam,
  ScopeArgs,
} from './scope-contract'
import { appendAcknowledged } from './scope-settlement'
import type { Budget, NodeId, Scope, SpawnEvent } from './types'
import {
  pauseWorkerSlot,
  resumeWorkerSlot,
  type SlotPermit,
  type WorkerSlots,
} from './worker-slots'

export function makeNestedScopeSeam(
  args: ScopeArgs,
  workerSlots: WorkerSlots,
  childSlot: SlotPermit,
  childNodeId: NodeId,
  childBudget: Budget,
  admission: ChildAdmission,
  deferredOwner: DeferredOwnerSlot,
): NestedScopeSeam {
  const now = args.now ?? Date.now
  const mountScope = (
    nestedRoot: NodeId,
    signal: AbortSignal,
    restored?: Awaited<ReturnType<typeof prepareScopeResume>>,
  ): Scope<unknown> => {
    // One clock anchors both the remaining duration and nested absolute deadline.
    const mountedAtMs = now()
    const childDeadlineAtMs = admission.deadlineAtMs
    const deadlineMs =
      childDeadlineAtMs === undefined ? undefined : Math.max(0, childDeadlineAtMs - mountedAtMs)
    const nestedBudget = {
      ...childBudget,
      ...(deadlineMs !== undefined ? { deadlineMs } : {}),
    }
    const pool = createBudgetPool(nestedBudget, mountedAtMs, restored?.poolRestore)
    const scope = createScope<unknown>({
      parentId: childNodeId,
      root: nestedRoot,
      rootDeadlineAtMs: args.rootDeadlineAtMs,
      pool,
      journal: args.journal,
      blobs: args.blobs,
      executors: args.executors,
      // Re-seed the parent's NON-recursion seams (sandbox/router for leaf grandchildren);
      // the nested scope adds its OWN nested-scope seam per child in `spawn`.
      seams: args.seams,
      depth: args.depth + 1,
      ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
      workerSlots,
      slotOwner: childSlot,
      ...(args.reservationPolicy
        ? { reservationPolicy: args.reservationPolicy, ownerBudget: nestedBudget }
        : {}),
      ...(args.deadlineCheckIn === undefined ? {} : { deadlineCheckIn: args.deadlineCheckIn }),
      ...(args.budgetStopHoldMs === undefined ? {} : { budgetStopHoldMs: args.budgetStopHoldMs }),
      signal,
      ...(restored ? { resumeFrom: restored.resumeFrom } : {}),
      ...(args.now ? { now: args.now } : {}),
      ...(args.hooks ? { hooks: args.hooks } : {}),
      // The nested scope resolves the trace context against ITS OWN `parentId` (this driver
      // child), so a grandchild worker joins under the middle node's span, not the run root's.
      ...(args.workerTrace ? { workerTrace: args.workerTrace } : {}),
      ...(args.workerTraceUnpropagated
        ? { workerTraceUnpropagated: args.workerTraceUnpropagated }
        : {}),
      ...(args.interactiveBindingDir ? { interactiveBindingDir: args.interactiveBindingDir } : {}),
      ...(deferredOwner.ownerMaterialization === undefined
        ? {}
        : { ownerMaterialization: deferredOwner.ownerMaterialization }),
    })
    bindSeatAdmission(scope, pool, nestedRoot)
    return scope
  }

  const bindSeatAdmission = (
    scope: Scope<unknown>,
    pool: ReturnType<typeof createBudgetPool>,
    nestedRoot: NodeId,
  ) => {
    const ownerLease = budgetLeases.get(args.pool)!
    const nestedLease = budgetLeases.get(pool)!
    if (!ownerLease || !nestedLease) return
    let activated = admission.reservation !== undefined
    let parked = false
    let queuedResumeAt: string | undefined
    let tail = Promise.resolve()
    const synchronize = (closing = false): Promise<void> => {
      const update = tail.then(async () => {
        if (closing) {
          activated = true
          parked = true
        }
        if (!activated || !ownerLease.isBacked(admission.ticket)) return
        const nested = (await args.journal.loadTree(nestedRoot)) ?? []
        const totals = sumMeasuredSpendFromEvents(nested, childNodeId)
        const childWork = withBudgetResources(totals.childWork, childBudget, true)
        const parent = ((await args.journal.loadTree(args.root)) ?? []).filter(
          (event) => event.id === childNodeId,
        )
        const reported = parent.reduce(
          (sum, event) => (event.kind === 'metered' ? addSpend(sum, event.spend) : sum),
          zeroSpend(),
        )
        const at = new Date(now()).toISOString()
        if (contentAddress(reported) !== contentAddress(totals.driverInference)) {
          const delta = unreportedSpend(totals.driverInference, reported)
          await appendAcknowledged(args.journal, args.root, {
            kind: 'metered',
            id: childNodeId,
            spend: delta,
            at,
            seq: parent.reduce(
              (seq, event) => (event.kind === 'metered' ? Math.max(seq, event.seq + 1) : seq),
              0,
            ),
          })
          admission.rehomed = addSpend(admission.rehomed ?? zeroSpend(), delta)
        }
        const spent = addSpend(childWork, totals.driverInference)
        let liabilities = nestedLease.liabilities(spent)
        const custody = scopeOwnerLiabilities(scope, nested)
        if (custody.environmentHeld || custody.invocationUnsettled) {
          if (childBudget.resources)
            liabilities = {
              ...liabilities,
              resources: Object.fromEntries(
                Object.entries(childBudget.resources).map(([name, value]) => [
                  name,
                  {
                    unit: value.unit,
                    limit: Math.max(
                      liabilities.resources?.[name]?.limit ?? 0,
                      custody.measuredResources.get(name) === value.unit
                        ? 0
                        : value.limit - (spent.resources?.[name]?.amount ?? 0),
                    ),
                  },
                ]),
              ),
            }
          if (custody.invocationUnsettled) {
            if (childBudget.maxTokens !== undefined)
              liabilities = {
                ...liabilities,
                maxTokens: Math.max(
                  liabilities.maxTokens ?? 0,
                  childBudget.maxTokens - chargedTokens(spent.tokens),
                ),
              }
            if (childBudget.maxIterations !== undefined)
              liabilities = {
                ...liabilities,
                maxIterations: Math.max(
                  liabilities.maxIterations ?? 0,
                  childBudget.maxIterations - spent.iterations,
                ),
              }
            if (childBudget.maxUsd !== undefined)
              liabilities = {
                ...liabilities,
                maxUsd: Math.max(liabilities.maxUsd ?? 0, childBudget.maxUsd - spent.usd),
              }
          }
        }
        const reservation = ownerLease.plannedHold(
          admission.ticket,
          childBudget,
          spent,
          liabilities,
          parked,
        )
        const floor = parent.filter((event) => event.kind === 'reconciled').at(-1)
        const floorSpend = floor?.settledSeq === undefined ? childWork : floor.spent
        if (
          floor?.kind !== 'reconciled' ||
          contentAddress(floor.spent) !== contentAddress(floorSpend) ||
          contentAddress(floor.reservation ?? null) !== contentAddress(reservation)
        ) {
          await appendAcknowledged(args.journal, args.root, {
            ...floor,
            kind: 'reconciled',
            id: childNodeId,
            spent: floorSpend,
            reservation,
            at,
            seq: parent.reduce(
              (seq, event) => (event.kind === 'reconciled' ? Math.max(seq, event.seq + 1) : seq),
              0,
            ),
          })
        }
        admission.reservation = reservation
        ownerLease.rebase(admission.ticket, childBudget, spent, liabilities, parked)
        await refreshBudgetLease(args.pool)
      })
      tail = update
      return update
    }
    budgetLeaseUpdates.set(pool, synchronize)
    scopeSeatAccountingUpdates.set(scope, synchronize)
    admission.prepareAccounting = synchronize
    const transition = async (gate?: 'seat' | 'budget' | 'slot', resumeAt?: string) => {
      const events = ((await args.journal.loadTree(args.root)) ?? []).filter(
        (event): event is Extract<SpawnEvent, { kind: 'admission-queued' | 'admission-granted' }> =>
          event.id === childNodeId &&
          (event.kind === 'admission-queued' || event.kind === 'admission-granted'),
      )
      const seq = events.reduce((max, event) => Math.max(max, event.seq + 1), 0)
      const prior = events.find((event) => event.kind === 'admission-granted')
      if (prior?.kind !== 'admission-granted')
        throw new Error('seat pause has no original execution grant')
      const attemptId = events.at(-1)!.attemptId
      await args.journal.appendEvent(
        args.root,
        gate
          ? {
              kind: 'admission-queued',
              id: childNodeId,
              attemptId,
              gate,
              ...(resumeAt === undefined ? {} : { resumeAt }),
              seq,
              at: new Date(now()).toISOString(),
            }
          : { ...prior, attemptId, seq, at: new Date(now()).toISOString() },
      )
    }
    const resume = async () => {
      scope.signal.throwIfAborted()
      parked = false
      const funded = ownerLease.resume(admission.ticket)
      if (ownerLease.isPaused(admission.ticket)) await transition('budget')
      await runAbortable(() => funded, scope.signal, 'seat reentry budget aborted')
      const ready = resumeWorkerSlot(childSlot)
      if (!childSlot.granted) await transition('slot')
      await runAbortable(() => ready, scope.signal, 'seat reentry slot aborted')
      await synchronize()
      await transition()
      scope.signal.throwIfAborted()
      nestedLease.blocked = false
      queuedResumeAt = undefined
      admission.onStatus?.('running')
    }
    seatAdmissionPauses.set(scope, async (resumeAt) => {
      scope.signal.throwIfAborted()
      activated = true
      parked = true
      nestedLease.blocked = true
      pauseWorkerSlot(childSlot)
      admission.onStatus?.('queued')
      if (queuedResumeAt !== resumeAt) {
        await transition('seat', resumeAt)
        queuedResumeAt = resumeAt
      }
      await synchronize()
      return resume
    })
  }
  return {
    nodeId: childNodeId,
    depth: args.depth,
    ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
    journalRoot: args.root,
    mount: mountScope,
    restore: async (nestedRoot, signal, events, recoverExecutor) => {
      const restored = await prepareScopeResume(
        {
          runId: nestedRoot,
          journal: args.journal,
          blobs: args.blobs,
          recoverExecutor,
        },
        events,
        signal,
        now,
        childNodeId,
      )
      signal.throwIfAborted()
      return mountScope(nestedRoot, signal, restored)
    },
  }
}
