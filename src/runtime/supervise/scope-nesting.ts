import { createBudgetPool } from './budget'
import { prepareScopeResume } from './recover-executors'
import { createScope } from './scope-construction'
import type { DeferredOwnerSlot, NestedScopeSeam, ScopeArgs } from './scope-contract'
import type { Budget, NodeId, Scope } from './types'
import type { SlotPermit, WorkerSlots } from './worker-slots'

export function makeNestedScopeSeam(
  args: ScopeArgs,
  workerSlots: WorkerSlots,
  childSlot: SlotPermit,
  childNodeId: NodeId,
  childBudget: Budget,
  childDeadlineAtMs: number | undefined,
  deferredOwner: DeferredOwnerSlot,
): NestedScopeSeam {
  const now = args.now ?? Date.now
  const mountScope = (
    nestedRoot: NodeId,
    signal: AbortSignal,
    restored?: Awaited<ReturnType<typeof prepareScopeResume>>,
  ): Scope<unknown> => {
    // One clock read anchors both halves: the remaining duration is measured from the same
    // instant the nested pool derives its absolute deadline from.
    const mountedAtMs = now()
    const deadlineMs =
      childDeadlineAtMs === undefined ? undefined : Math.max(0, childDeadlineAtMs - mountedAtMs)
    const nestedBudget = {
      ...childBudget,
      ...(deadlineMs !== undefined ? { deadlineMs } : {}),
    }
    return createScope<unknown>({
      parentId: childNodeId,
      root: nestedRoot,
      pool: createBudgetPool(nestedBudget, mountedAtMs, restored?.poolRestore),
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
