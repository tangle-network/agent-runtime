import { ValidationError } from '../../errors'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { createBudgetPool } from './budget'
import { freeSlots } from './dispatch'
import type { WorkerProgress } from './progress'
import { DEFAULT_STALL_AFTER_MS, type ExecutorProgress, readWorkerProgress } from './progress'
import { initializeOwnerMaterializationState } from './scope-owner'
import { finalizeSettlement, raceFirstSettled } from './scope-settlement'
import { createSpawn } from './scope-spawn'
import { makeTreeView, normalizeLiveWorkerLimit } from './scope-support'
import type {
  KeyState,
  LiveChild,
  LiveWorkerCapacityState,
  NestedScopeSeam,
  ScopeArgs,
  SpawnContext,
  WaitContext,
} from './scope-types'
import { createWait } from './scope-wait'
import type { TraceSource } from './trace-source'
import type {
  Budget,
  NodeId,
  ResumedKeyState,
  ResumedWork,
  Scope,
  Settled,
  Spend,
  TreeView,
} from './types'

/** Create the reactive Scope that spawns children, settles results, and journals replay state. */
export function createScope<Out>(args: ScopeArgs): Scope<Out> {
  const children = new Map<NodeId, LiveChild>()
  const liveWorkerCapacity: LiveWorkerCapacityState = args.liveWorkerCapacity ?? {
    max: normalizeLiveWorkerLimit(args.maxLiveWorkers),
    live: 0,
  }
  let spawnOrdinal = args.resumeFrom ? args.resumeFrom.maxSpawnOrdinal + 1 : 0
  let cursorSeq = args.resumeFrom ? args.resumeFrom.maxCursorSeq + 1 : 0
  let waitOrdinal = args.resumeFrom ? args.resumeFrom.maxWaitOrdinal + 1 : 0
  let meterSeq = 0
  const now = args.now ?? Date.now
  const unclaimedWaits = new Map((args.resumeFrom?.waits ?? []).map((wait) => [wait.label, wait]))
  const keyed = new Map<string, KeyState<Out>>()
  for (const [key, prior] of args.resumeFrom?.keys ?? []) {
    if (prior.state === 'completed' && prior.settled?.kind === 'done') {
      if (prior.identity !== undefined) {
        keyed.set(key, {
          state: 'done',
          id: prior.id,
          identity: prior.identity,
          settled: prior.settled as Settled<Out> & { kind: 'done' },
        })
      }
    } else if (prior.state === 'down' && prior.settled?.kind === 'down') {
      if (prior.identity !== undefined) {
        keyed.set(key, {
          state: 'down',
          id: prior.id,
          identity: prior.identity,
          reason: prior.settled.reason,
        })
      }
    } else if (prior.identity !== undefined) {
      keyed.set(key, { state: 'in-doubt', id: prior.id, identity: prior.identity })
    }
  }
  const recordKeyedSettlement = (key: string, settled: Settled<Out>): void => {
    const identity = settled.handle.identity
    if (identity === undefined) {
      throw new ValidationError(`scope: keyed settlement '${key}' lost its execution identity`)
    }
    keyed.set(
      key,
      settled.kind === 'done'
        ? { state: 'done', id: settled.handle.id, identity, settled }
        : { state: 'down', id: settled.handle.id, identity, reason: settled.reason },
    )
  }
  const makeNestedScopeSeam = (
    childNodeId: NodeId,
    childBudget: Budget,
    childDeadlineAtMs: number | undefined,
    deferredOwner: import('./scope-types').DeferredOwnerSlot,
  ): NestedScopeSeam => ({
    nodeId: childNodeId,
    depth: args.depth,
    ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
    journalRoot: args.root,
    mount(nestedRoot, signal): Scope<unknown> {
      const deadlineMs =
        childDeadlineAtMs === undefined ? undefined : Math.max(0, childDeadlineAtMs - now())
      return createScope<unknown>({
        parentId: childNodeId,
        root: nestedRoot,
        pool: createBudgetPool(
          { ...childBudget, ...(deadlineMs !== undefined ? { deadlineMs } : {}) },
          now,
        ),
        journal: args.journal,
        blobs: args.blobs,
        executors: args.executors,
        seams: args.seams,
        depth: args.depth + 1,
        ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
        liveWorkerCapacity,
        signal,
        ...(args.now ? { now: args.now } : {}),
        ...(args.hooks ? { hooks: args.hooks } : {}),
        ...(args.workerTrace ? { workerTrace: args.workerTrace } : {}),
        ...(args.workerTraceUnpropagated
          ? { workerTraceUnpropagated: args.workerTraceUnpropagated }
          : {}),
        ...(deferredOwner.ownerMaterialization === undefined
          ? {}
          : { ownerMaterialization: deferredOwner.ownerMaterialization }),
      })
    },
  })
  const spawn = createSpawn<Out>({
    args,
    children,
    keyed,
    recordKeyedSettlement,
    liveWorkerCapacity,
    now,
    nextOrdinal: () => spawnOrdinal++,
    makeNestedScopeSeam,
  } as SpawnContext<Out>)
  const wait = createWait({
    args,
    children,
    unclaimedWaits,
    now,
    nextOrdinal: () => waitOrdinal++,
  } as WaitContext)

  async function next(): Promise<Settled<Out> | null> {
    const undelivered = () => [...children.values()].filter((child) => !child.delivered)
    if (undelivered().length === 0) return null
    for (;;) {
      const pending = undelivered()
      if (pending.length === 0) return null
      const ready = pending.find((child) => child.resolved !== undefined)
      const chosen = ready ?? (await raceFirstSettled(pending))
      if (chosen.delivered) continue
      chosen.delivered = true
      const settlement = chosen.resolved
      if (!settlement) {
        throw new ValidationError(
          `scope.next: child '${chosen.id}' won the settle race without a resolved value`,
        )
      }
      const delivered = await finalizeSettlement<Out>(chosen, settlement, cursorSeq++, args, now)
      if (chosen.key !== undefined) recordKeyedSettlement(chosen.key, delivered)
      return delivered
    }
  }

  async function nextResolved(): Promise<Settled<Out> | null> {
    for (;;) {
      const candidates = [...children.values()].filter((child) => !child.delivered)
      const pick =
        candidates.find((child) => child.resolved !== undefined) ??
        candidates.find((child) => child.executorDone)
      if (!pick) return null
      const settlement = await pick.settled
      if (pick.delivered) continue
      pick.delivered = true
      const delivered = await finalizeSettlement<Out>(pick, settlement, cursorSeq++, args, now)
      if (pick.key !== undefined) recordKeyedSettlement(pick.key, delivered)
      return delivered
    }
  }

  function send(nodeId: NodeId, msg: unknown): boolean {
    if (args.signal.aborted) return false
    const child = children.get(nodeId)
    if (!child || child.delivered || child.isAborted() || !child.deliver) return false
    if (child.deliver(msg) === false) return false
    child.lastActivityAt = now()
    return true
  }

  function cancel(nodeId: NodeId, reason?: string): boolean {
    if (args.signal.aborted) return false
    const child = children.get(nodeId)
    if (
      !child ||
      child.delivered ||
      child.isAborted() ||
      child.status === 'done' ||
      child.status === 'failed' ||
      child.status === 'cancelled'
    ) {
      return false
    }
    child.abort(reason ?? `scope cancelled worker ${nodeId}`)
    child.lastActivityAt = now()
    return true
  }

  function progress(
    nodeId: NodeId,
    options: { now?: number; stallAfterMs?: number } = {},
  ): WorkerProgress | undefined {
    const child = children.get(nodeId)
    if (!child) return undefined
    let fromExecutor: ExecutorProgress | undefined
    try {
      fromExecutor = child.readProgress?.()
    } catch {
      fromExecutor = undefined
    }
    return readWorkerProgress(
      {
        id: child.id,
        status: child.status,
        steerable: child.deliver !== undefined && !child.delivered,
        startedAt: child.startedAt,
        lastActivityAt: child.lastActivityAt,
        turns: child.spent.iterations,
        tokens: child.spent.tokens,
        ...(child.spent.tokensKnown === false ? { tokensKnown: false } : {}),
        usd: child.spent.usd,
        ...(child.spent.usdKnown === false ? { usdKnown: false } : {}),
      },
      fromExecutor,
      options.now ?? now(),
      options.stallAfterMs ?? DEFAULT_STALL_AFTER_MS,
    )
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

  async function meter(spend: Spend, detail?: Record<string, unknown>): Promise<void> {
    if (args.signal.aborted) {
      throw new ValidationError('scope.meter: cannot record new driver work after scope abort')
    }
    const seq = meterSeq++
    let observeError: unknown
    try {
      args.pool.observe(spend)
    } catch (error) {
      observeError = error
    }
    await args.journal.appendEvent(args.root, {
      kind: 'metered',
      id: args.parentId,
      spend,
      seq,
      at: new Date(now()).toISOString(),
    })
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

  const resume: ResumedWork<Out> | undefined = args.resumeFrom
    ? {
        settled: args.resumeFrom.settled as ReadonlyArray<Settled<Out>>,
        view: args.resumeFrom.view,
        waits: args.resumeFrom.waits,
        keys: args.resumeFrom.keys as ReadonlyMap<string, ResumedKeyState<Out>>,
        priorSpend: args.resumeFrom.priorSpend,
      }
    : undefined
  const scope: Scope<Out> = {
    spawn,
    next,
    nextResolved,
    send,
    cancel,
    wait,
    progress,
    traceSource,
    signal: args.signal,
    meter,
    ...(resume ? { resume } : {}),
    get view(): TreeView {
      return makeTreeView(args.parentId, children)
    },
    get budget() {
      return args.pool.readout()
    },
    get workerCapacity() {
      return {
        live: liveWorkerCapacity.live,
        freeSlots: freeSlots(liveWorkerCapacity.live, liveWorkerCapacity.max),
      }
    },
  }
  initializeOwnerMaterializationState(scope as Scope<unknown>, args, now)
  return scope
}
