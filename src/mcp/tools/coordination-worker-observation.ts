import type { Scope } from '../../runtime'
import { watchTrace } from '../../runtime/supervise/detector-monitor'
import type { EventBus } from '../../runtime/supervise/event-bus'
import { isLiveNodeStatus } from '../../runtime/supervise/node-status'
import type { WorkerProgress } from '../../runtime/supervise/progress'
import { canonicalFindingEvent } from './coordination-analysts'
import type { CoordinationToolsOptions, SettledWorker } from './coordination-contracts'
import { eventWorker } from './coordination-event-projection'
import type { CoordinationEvent } from './coordination-events'
import { modelSubstitutionReport } from './coordination-model-attribution'

export function createWorkerObservation({
  opts,
  ledger,
  flushedAnalystRuns,
  bus,
  deadlineNoticeDelivered,
  leadPublishing,
}: {
  readonly opts: CoordinationToolsOptions
  readonly ledger: ReadonlyArray<SettledWorker>
  readonly flushedAnalystRuns: ReadonlySet<string>
  readonly bus: EventBus<CoordinationEvent>
  readonly deadlineNoticeDelivered: () => boolean
  readonly leadPublishing: () => number
}) {
  // This manager's own children that have not settled, and those of them still waiting for a
  // worker slot. The slot allocator is shared by the whole tree, so its reading is read live.
  const liveWorkerCount = (): number =>
    opts.scope.view.nodes.filter((n) => isLiveNodeStatus(n.status)).length
  const queuedWorkerCount = (): number =>
    opts.scope.view.nodes.filter((n) => n.status === 'queued').length

  // A snapshot of every still-in-flight worker — the liveness signal a wake
  // returns when its wait elapses, so the supervisor can tell "worker still running, keep waiting"
  // apart from "nothing is happening" (the distinction it lost when the unbounded await erred out).
  const projectNodeEvidence = (
    node: Scope<unknown>['view']['nodes'][number],
    resumed = false,
  ): Record<string, unknown> => ({
    id: node.id,
    status: node.status,
    ...(node.failure === undefined ? {} : { failure: node.failure }),
    ...(node.assignmentId === undefined ? {} : { assignmentId: node.assignmentId }),
    ...(node.identity === undefined ? {} : { identity: node.identity }),
    ...(node.modelSubstitution === undefined
      ? {}
      : modelSubstitutionReport(node.modelSubstitution)),
    ...(node.materialization === undefined ? {} : { materialization: node.materialization }),
    ...(node.executionBindings === undefined ? {} : { executionBindings: node.executionBindings }),
    spent: node.spent,
    ...(node.settledAt === undefined ? {} : { settledAt: node.settledAt }),
    ...(node.outRef === undefined ? {} : { outRef: node.outRef }),
    ...(node.trace === undefined ? {} : { trace: node.trace }),
    ...(resumed ? { resumed: true } : {}),
  })

  const liveSnapshot = (): Array<Record<string, unknown>> =>
    opts.scope.view.nodes
      .filter((n) => isLiveNodeStatus(n.status))
      .map((n) => projectNodeEvidence(n))

  // ── closure ──────────────────────────────────────────────────────────────────
  //
  // A manager may not close its run while work it commissioned is unread: a worker still running,
  // a settlement or finding queued for the next wake, or a settlement the coordinator holds and
  // has not queued yet. Measured in Autopsy C: a root stopped 15 to 45 s after its
  // children returned without reading them, and the verification it had commissioned sat
  // unclaimed. The refusal names the open work so the manager can go and read it.
  const openWork = () => {
    const received = new Set(ledger.map((worker) => worker.id))
    // A hand-built scope may expose no view at all; it then has no children to wait for.
    const nodes = (opts.scope as Partial<Scope<unknown>>).view?.nodes ?? []
    const running = nodes.filter((node) => isLiveNodeStatus(node.status))
    const unqueued = nodes.filter(
      (node) =>
        !isLiveNodeStatus(node.status) &&
        !received.has(node.id) &&
        !flushedAnalystRuns.has(node.id),
    )
    // Questions have their own closure rule (`questionPolicy`), so only results count here.
    // A steer the manager has not read is as unread as a result. The outcome of its own earlier tool
    // call is not work it commissioned, so it never refuses a submission.
    const queued = bus.queued(['settled', 'finding', 'lead-message', 'map'])
    return { running, unqueued, queued }
  }
  const openWorkRefusal = (verb: 'submit_result' | 'stop'): Record<string, unknown> | undefined => {
    if (deadlineNoticeDelivered()) return undefined
    const { running, unqueued, queued } = openWork()
    if (
      running.length === 0 &&
      unqueued.length === 0 &&
      queued.length === 0 &&
      leadPublishing() === 0
    )
      return undefined
    const parts: string[] = []
    if (running.length > 0)
      parts.push(
        `${running.length} worker${running.length === 1 ? ' is' : 's are'} still running (${running.map((node) => node.id).join(', ')})`,
      )
    const waiting = unqueued.length + queued.length
    if (waiting > 0)
      parts.push(`${waiting} event${waiting === 1 ? ' is' : 's are'} waiting for you`)
    if (leadPublishing() > 0)
      parts.push(
        `${leadPublishing()} lead message${leadPublishing() === 1 ? ' is' : 's are'} still being published`,
      )
    return {
      error: 'open-work' as const,
      reason:
        `${parts.join(' and ')}. End your turn to wait: you will be woken with each result. Read each settled ` +
        `worker's output, and then call ${verb} again. Nothing was ${verb === 'stop' ? 'stopped' : 'checked'}.`,
      running: running.map((node) => ({ id: node.id, label: node.label, status: node.status })),
      waiting: [
        ...queued.map((record) => ({
          type: record.event.type,
          ...(eventWorker(record.event) === undefined ? {} : { worker: eventWorker(record.event) }),
        })),
        ...unqueued.map((node) => ({ type: 'settled', worker: node.id })),
      ],
    }
  }

  // How many more workers could start working RIGHT NOW, or `null` when no bound is set (the
  // conserved pool is then the only fence, so there is no finite slot count). A spawn past the
  // bound is queued rather than refused; this reading tells the driver whether a new worker starts
  // at once or waits behind the queue. Policy (whether to spawn) stays with the driver.
  const freeWorkerSlots = (): number | null =>
    (opts.scope as Partial<Scope<unknown>>).workerCapacity?.freeSlots ?? null

  // The LIVE read of one worker. Guarded because `createCoordinationTools` is bound to a `Scope`
  // it did not construct — an older or hand-rolled scope may not implement `progress` at all, and
  // an observation must degrade to "no progress available", never throw at the driver.
  const readProgress = (id: string): WorkerProgress | undefined => {
    const scope = opts.scope as Partial<Scope<unknown>>
    if (typeof scope.progress !== 'function') return undefined
    try {
      return scope.progress(
        id,
        opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {},
      )
    } catch {
      return undefined
    }
  }

  // ONLINE detection: subscribe the streaming detector panel to a freshly-spawned worker's live
  // tool trace, and turn each signal into a `finding` the driver receives in its next wake. The
  // unsubscribe fires on the worker's settle (its trace source is dead from then on) and the
  // per-worker cap stops one looping worker from flooding the bus.
  const watchers = new Map<string, () => void>()
  const watchWorker = (id: string): void => {
    const watch = opts.watchWorkers
    if (!watch) return
    const scope = opts.scope as Partial<Scope<unknown>>
    if (typeof scope.traceSource !== 'function') return
    let source: ReturnType<NonNullable<Scope<unknown>['traceSource']>>
    try {
      source = scope.traceSource(id)
    } catch {
      return
    }
    if (!source) return
    const cap = watch.maxFindingsPerWorker ?? 3
    let raised = 0
    const unsub = watchTrace(source, {
      ...(watch.detectors ? { detectors: watch.detectors } : {}),
      onSignal: async (signal, span) => {
        if (cap > 0 && raised >= cap) return
        raised += 1
        await bus.publish({
          type: 'finding',
          // canonicalFindingEvent: `span.toolName` is optional — an undefined value anywhere in
          // the payload would throw in the digesting subscriber and vanish the event.
          finding: canonicalFindingEvent({
            fromWorker: id,
            analyst: `online:${signal.detector}`,
            findings: {
              detector: signal.detector,
              severity: signal.severity,
              reason: signal.reason,
              streak: signal.streak,
              ...(signal.failureClass ? { failureClass: signal.failureClass } : {}),
              toolName: span.toolName,
              at: span.endedAt,
              progress: readProgress(id),
            },
          }),
        })
      },
    })
    watchers.set(id, unsub)
  }
  const unwatchWorker = (id: string): void => {
    const unsub = watchers.get(id)
    if (!unsub) return
    watchers.delete(id)
    try {
      unsub()
    } catch {
      // an unsubscribe that throws must never break the settle path
    }
  }

  return {
    liveWorkerCount,
    queuedWorkerCount,
    projectNodeEvidence,
    liveSnapshot,
    openWork,
    openWorkRefusal,
    freeWorkerSlots,
    readProgress,
    watchWorker,
    unwatchWorker,
  }
}
