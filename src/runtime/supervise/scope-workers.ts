import { ValidationError } from '../../errors'
import { RunCancellationReason } from './abortable'
import { CHILD_DEADLINE_REASON, checkInIdleMs, DEADLINE_CHECK_IN_MESSAGE } from './deadline'
import { isTerminalNodeStatus } from './node-status'
import {
  DEFAULT_STALL_AFTER_MS,
  type ExecutorProgress,
  readWorkerProgress,
  type WorkerProgress,
} from './progress'
import { addResourceSpend } from './resources'
import type { LiveChild, ScopeArgs } from './scope-contract'
import {
  liveTeamOf,
  makeTreeView,
  noInteractiveSession,
  readInteractiveSession,
  teamProgress,
} from './scope-observation'
import type { TraceSource } from './trace-source'
import type {
  ExecutorCancellation,
  ExecutorCancellationRequest,
  NodeId,
  TreeView,
  WorkerInteractiveSession,
} from './types'
import type { WorkerEventCursor, WorkerEventPage } from './worker-events'
import { writeWorkerInteractiveBinding } from './worker-interactive'

/**
 * A scope's live children as its driver addresses them: steer, read progress, cancel, read the
 * trace and interactive session, and observe the tree and event streams, nested scopes included.
 */
export class ScopeWorkers {
  constructor(
    private readonly args: ScopeArgs,
    private readonly children: Map<NodeId, LiveChild>,
    private readonly now: () => number,
  ) {}

  /**
   * A child's own time box: tell it to save state and submit what it has, and keep it running
   * while it progresses (`deadline.ts` `DeadlineCheckIn`). Returns the watch's stop, or undefined
   * when the child cannot be told (no inbox, settled, or check-ins off), and the caller stops it.
   */
  readonly checkInAtTimeBox = (
    nodeId: NodeId,
    controller: AbortController,
  ): (() => void) | undefined => {
    const idleMs = checkInIdleMs(this.args.deadlineCheckIn)
    if (idleMs === undefined || controller.signal.aborted) return undefined
    if (!this.send(nodeId, { steer: DEADLINE_CHECK_IN_MESSAGE, interrupt: false })) return undefined
    const watch = setInterval(
      () => {
        const read = this.progress(nodeId, { stallAfterMs: idleMs })
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

  readonly send = (nodeId: NodeId, msg: unknown): boolean => {
    if (this.args.signal.aborted) return false
    const child = this.children.get(nodeId)
    // Only a LIVE child whose executor accepts an inbox can be steered.
    if (!child || child.delivered || !child.deliver) return false
    const accepted = child.deliver(msg) !== false
    if (!accepted) return false
    // A delivered steer IS activity: it resets the idle clock so the worker is not re-steered before it can act.
    child.lastActivityAt = this.now()
    return true
  }

  readonly progress = (
    nodeId: NodeId,
    opts: { now?: number; stallAfterMs?: number } = {},
  ): WorkerProgress | undefined => {
    const child = this.children.get(nodeId)
    if (!child) return undefined
    // Best-effort enrichment on a live path: a throwing progress implementation must not break observation.
    let fromExecutor: ExecutorProgress | undefined
    try {
      fromExecutor = child.readProgress?.()
    } catch {
      fromExecutor = undefined
    }
    // A manager child reports no usage until it settles; without its team the lead would read it idle, then stalled.
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
      opts.now ?? this.now(),
      opts.stallAfterMs ?? DEFAULT_STALL_AFTER_MS,
    )
  }

  readonly cancel = async (
    nodeId: NodeId,
    request: ExecutorCancellationRequest,
  ): Promise<ExecutorCancellation> => {
    const child = this.children.get(nodeId)
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

  readonly traceSource = (nodeId: NodeId): TraceSource | undefined => {
    const child = this.children.get(nodeId)
    if (!child) return undefined
    try {
      return child.readTraceSource?.()
    } catch {
      return undefined
    }
  }

  readonly interactive = (nodeId: NodeId): WorkerInteractiveSession => {
    const child = this.children.get(nodeId)
    if (!child) return noInteractiveSession('unknown-node')
    // A settled child holds no process.
    if (child.executorDone || isTerminalNodeStatus(child.status)) {
      return noInteractiveSession('not-live')
    }
    const session = readInteractiveSession(child)
    if (this.args.interactiveBindingDir !== undefined && session.status === 'available') {
      writeWorkerInteractiveBinding(
        this.args.interactiveBindingDir,
        child.id,
        child.label,
        this.args.root,
        session,
        this.now,
      )
    }
    return session
  }

  /** The whole subtree: replayed nodes, then this scope's children, then nested scopes' nodes. */
  readonly observeTree = (): TreeView => {
    const { args, children } = this
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
  }

  readonly observeEvents = (nodeId: NodeId, cursor?: WorkerEventCursor): WorkerEventPage => {
    const { args, children } = this
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
  }
}
