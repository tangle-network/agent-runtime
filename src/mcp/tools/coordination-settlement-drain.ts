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

export function createSettlementDrain({
  opts,
  ledger,
  unwatchWorker,
  bus,
  analysis,
  maps,
  workerRouteNames,
  projectSettled,
}: {
  readonly opts: CoordinationToolsOptions
  readonly ledger: SettledWorker[]
  readonly unwatchWorker: (id: string) => void
  readonly bus: EventBus<CoordinationEvent>
  readonly analysis: ReturnType<typeof createCoordinationAnalysis>
  readonly maps: ReturnType<typeof createMapRouting>
  readonly workerRouteNames: (workerId: string) => Set<string>
  readonly projectSettled: (settled: Settled<unknown>, resumed?: boolean) => SettledWorker
}) {
  const commitSettled = (w: SettledWorker): void => {
    ledger.push(w)
    // A settled worker's trace source is finished; drop the online subscription with it.
    unwatchWorker(w.id)
  }

  // `Scope.next()` is once-only, while an awaited observer may commit and lose its acknowledgement.
  // Retain the exact event until publication succeeds so the next await retries rather than losing
  // the settlement between the spawn journal and the product transaction. `analystRun` marks a
  // settlement that IS an analyst-agent's findings (see `analysis.analystRuns`), whose event is a `finding`.
  let pendingSettlement:
    | {
        readonly settled: Settled<unknown>
        readonly worker: SettledWorker
        readonly event: CoordinationEvent
        readonly analyze: boolean
        readonly analystRun?: AnalystRunInFlight
      }
    | undefined

  // Settlements being published with their analysis right now. The settled event is queued first
  // and the analysis it triggers follows, so a wake waits for both.
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
    // A map item's settlement is recorded but not queued: the manager is woken by the map's join,
    // or by the event that says the join could not run.
    if (maps.isItem(pending.worker.id)) {
      await bus.publish(pending.event, { queue: false })
    } else {
      await bus.publish(pending.event)
    }
    // An analyst-AGENT settlement IS its finding (just published): it never enters the settled
    // ledger or the finalizer, and it re-fires no analyst hook. Its routed delivery goes through
    // the exact machinery a registry-analyst finding uses — with no wrap directive, because the
    // route's directive was already consumed as the analyst's task.
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
      // Registry lenses run in-process over the trace store; agent analysts spawn as workers.
      const lensRoutes = applicable.filter((route) => route.agent === undefined)
      const agentRoutes = applicable.filter((route) => route.agent !== undefined)
      if (lensRoutes.length > 0 && opts.analysts && pending.worker.trace.status === 'available') {
        // A lens that throws, or a trace it cannot read, is a FAILED analyst run, published as
        // `{ analystRunFailed }` exactly like a failed agent analyst. Before this, the throw left
        // the drain that carried the settlement, so the driver waited on a finding that never
        // landed and every later lens and agent route on this settlement was skipped.
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
          // The finding ALWAYS lands on the bus — the audit trail and the driver's pullable copy —
          // whether or not the route also delivers it to a named worker.
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
    if (advance)
      await maps.runMapStep(() => maps.expandMaps(pending.settled, pending.worker), pending.worker)
    return true
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

  // Producer: drain exactly one settlement from the scope cursor onto the bus (a `settled` event),
  // then fire the analyst-on-settle hook — auto-run each configured lens over the worker's trace and
  // publish its result as a `finding`. Returns false when the cursor is idle (no live workers). The
  // cursor is a once-per-child source, so a settlement is produced at most once.
  // `next` blocks on a live worker; `nextResolved` takes only a child that already settled.
  const drainSettlement = async (source: 'next' | 'nextResolved' = 'next'): Promise<boolean> => {
    if (!pendingSettlement) {
      const settled = await (source === 'next' ? opts.scope.next() : opts.scope.nextResolved())
      if (!settled) return false
      pendingSettlement = prepareSettlement(settled, true)
    }
    return flushPendingSettlement()
  }

  // Post-loop drain: every ALREADY-settled, unpulled child enters the ledger + audit trail. No
  // analyst-on-settle here — the driver has stopped, so a finding has no reader and an analyst
  // spawn would spend real compute for nothing. An analyst-agent run ALREADY in flight is not a
  // new spawn: its settlement still becomes its finding (the audit trail must not lose paid-for
  // findings), though a routed delivery will usually record `delivered:false` this late.
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
    isFlushing: () => flushing > 0,
    isBusy: () => pendingSettlement !== undefined || flushing > 0,
  }
}
