import type { TraceAnalysisStore } from '@tangle-network/agent-eval'
import type { Settled } from '../../runtime'
import { errMessage } from '../../runtime/supervise/error-message'
import type { EventBus } from '../../runtime/supervise/event-bus'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import { workerTraceAnalysisStore } from '../../runtime/supervise/trace-evidence'
import type { createCoordinationAnalysis } from './coordination-analysis'
import { type AnalystRunInFlight, canonicalFindingEvent } from './coordination-analysts'
import type { CoordinationToolsOptions, SettledWorker } from './coordination-contracts'
import type { CoordinationEvent } from './coordination-events'
import type { createMapRouting } from './coordination-map-routing'
import type { createRouteRouting } from './coordination-route-routing'

export function createSettlementDrain({
  opts,
  ledger,
  unwatchWorker,
  bus,
  analysis,
  maps,
  routes,
  workerRouteNames,
  projectSettled,
}: {
  readonly opts: CoordinationToolsOptions
  readonly ledger: SettledWorker[]
  readonly unwatchWorker: (id: string) => void
  readonly bus: EventBus<CoordinationEvent>
  readonly analysis: ReturnType<typeof createCoordinationAnalysis>
  readonly maps: ReturnType<typeof createMapRouting>
  readonly routes: ReturnType<typeof createRouteRouting>
  readonly workerRouteNames: (workerId: string) => Set<string>
  readonly projectSettled: (settled: Settled<unknown>, resumed?: boolean) => SettledWorker
}) {
  const hooked = new Set<string>()
  const commitSettled = (w: SettledWorker): void => {
    ledger.push(w)
    unwatchWorker(w.id)
  }

  // Keep the once-only cursor event until the product transaction acknowledges publication.
  let pendingSettlement:
    | {
        readonly settled: Settled<unknown>
        readonly worker: SettledWorker
        readonly event: CoordinationEvent
        readonly analyze: boolean
        readonly analystRun?: AnalystRunInFlight
      }
    | undefined

  // A wake includes both the settlement and its triggered analysis.
  let flushing = 0
  const flushPendingSettlement = async (): Promise<boolean> => {
    flushing += 1
    try {
      return await flushPendingSettlementOnce()
    } finally {
      flushing -= 1
    }
  }
  const flushPendingSettlementOnce = async (): Promise<boolean> => {
    const pending = pendingSettlement
    if (!pending) return false
    // Map items wake the manager through their join or refusal, not individually.
    if (maps.isItem(pending.worker.id)) {
      await bus.publish(pending.event, { queue: false })
    } else {
      await bus.publish(pending.event)
    }
    // Analyst-agent settlements are findings, without another ledger entry or analyst hook.
    if (pending.analystRun) {
      analysis.analystRuns.delete(pending.worker.id)
      analysis.flushedAnalystRuns.add(pending.worker.id)
      unwatchWorker(pending.worker.id)
      pendingSettlement = undefined
      const { route } = pending.analystRun
      if (route.to !== undefined && pending.event.type === 'finding') {
        await analysis.deliverRoutedFinding(
          { kind: route.kind, to: route.to },
          pending.event.finding.findings,
        )
      }
      return true
    }
    commitSettled(pending.worker)
    pendingSettlement = undefined
    hooked.add(pending.worker.id)
    const advance = pending.analyze && !analysis.isFinishing()
    await maps.runMapStep(
      () => maps.settleMapMember(pending.settled, pending.worker, advance),
      pending.worker,
    )
    if (pending.analyze && !analysis.isFinishing() && analysis.analysisRoutes.length) {
      const sourceNames = workerRouteNames(pending.worker.id)
      const applicable = analysis.analysisRoutes.filter(
        (route) =>
          route.at !== 'manager-end' &&
          (route.statuses ?? ['done']).includes(pending.worker.status) &&
          (route.over === undefined || route.over.some((name) => sourceNames.has(name))),
      )
      const lensRoutes = applicable.filter((route) => route.agent === undefined)
      const agentRoutes = applicable.filter((route) => route.agent !== undefined)
      if (lensRoutes.length > 0 && opts.analysts && pending.worker.trace.status === 'available') {
        // Failed trace reads and lenses publish a finding without skipping later analysts.
        let trace: TraceAnalysisStore | undefined
        let traceFailure: unknown
        try {
          trace = await workerTraceAnalysisStore(pending.worker.trace, opts.blobs)
        } catch (error) {
          traceFailure = error
        }
        for (const route of lensRoutes) {
          let findings: unknown
          try {
            if (trace === undefined) throw traceFailure
            findings = await opts.analysts.run(
              route.kind,
              trace,
              analysis.analystRunContext(route.kind, pending.worker.id),
            )
          } catch (error) {
            findings = { analystRunFailed: errMessage(error) }
          }
          await bus.publish({
            type: 'finding',
            finding: canonicalFindingEvent({
              fromWorker: pending.worker.id,
              analyst: route.kind,
              findings,
            }),
          })
          if (route.to !== undefined) await analysis.deliverRoutedFinding(route, findings)
        }
      }
      for (const route of agentRoutes) await analysis.spawnAnalystRun(route, pending.worker)
    }
    if (advance) {
      await maps.runMapStep(() => maps.expandMaps(pending.settled, pending.worker), pending.worker)
      await routes.route(pending.settled, pending.worker)
    }
    return true
  }

  // Current-process completions still have one cursor delivery; replayed completions do not.
  const settleCommitted = async (workerId: string): Promise<void> => {
    if (hooked.has(workerId) || opts.scope.view.nodes.some((node) => node.id === workerId)) return
    const settled = opts.scope.resume?.settled.find((s) => s.handle.id === workerId)
    if (settled === undefined) {
      throw new Error(`committed worker ${workerId} has no settlement in the resumed journal`)
    }
    hooked.add(workerId)
    const worker = projectSettled(settled, true)
    const advance = !analysis.isFinishing()
    await maps.runMapStep(() => maps.settleMapMember(settled, worker, advance), worker)
    if (!advance) return
    await maps.runMapStep(() => maps.expandMaps(settled, worker), worker)
    await routes.route(settled, worker)
  }

  const prepareSettlement = (
    settled: Settled<unknown>,
    analyze: boolean,
  ): NonNullable<typeof pendingSettlement> => {
    const worker = projectSettled(settled)
    const run = analysis.analystRuns.get(settled.handle.id)
    return run
      ? {
          settled,
          worker,
          event: analysis.analystRunFinding(run, settled),
          analyze: false,
          analystRun: run,
        }
      : {
          settled,
          worker,
          event: detachedFrozen<CoordinationEvent>({ type: 'settled', worker }),
          analyze,
        }
  }

  const drainSettlement = async (source: 'next' | 'nextResolved' = 'next'): Promise<boolean> => {
    if (!pendingSettlement) {
      const settled = await (source === 'next' ? opts.scope.next() : opts.scope.nextResolved())
      if (!settled) return false
      pendingSettlement = prepareSettlement(settled, true)
    }
    return flushPendingSettlement()
  }

  const drainResolved = async (): Promise<number> => {
    let drained = 0
    for (;;) {
      if (!pendingSettlement) {
        const settled = await opts.scope.nextResolved()
        if (!settled) return drained
        pendingSettlement = prepareSettlement(settled, false)
      }
      await flushPendingSettlement()
      drained += 1
    }
  }

  return {
    drainSettlement,
    drainResolved,
    settleCommitted,
    isFlushing: () => flushing > 0,
    isBusy: () => pendingSettlement !== undefined || flushing > 0,
  }
}
