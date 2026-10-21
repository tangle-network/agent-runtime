import type { Settled } from '../../runtime'
import type { EventBus } from '../../runtime/supervise/event-bus'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { createCoordinationAnalysis } from './coordination-analysis'
import type { CoordinationToolsOptions, SettledWorker } from './coordination-contracts'
import type { CoordinationEvent } from './coordination-events'

/**
 * Seed the settled ledger from a resumed scope and own the replay of its events onto the bus.
 * Replayed reviews remain findings. They cannot enter the completion pool or recursively
 * trigger another analyst, even when the resumed configuration changes its analyst routes.
 */
export function createResumeReplay({
  opts,
  bus,
  ledger,
  analysis,
  projectSettled,
}: {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly ledger: SettledWorker[]
  readonly analysis: ReturnType<typeof createCoordinationAnalysis>
  readonly projectSettled: (settled: Settled<unknown>, resumed?: boolean) => SettledWorker
}): () => Promise<void> {
  const { analystRuns, flushedAnalystRuns, analystRunFinding } = analysis
  const resumedWorkers: SettledWorker[] = []
  const resumedFindings: CoordinationEvent[] = []
  for (const s of opts.scope.resume?.settled ?? []) {
    const analyst = analystRuns.get(s.handle.id)
    if (analyst) {
      resumedFindings.push(analystRunFinding(analyst, s))
      analystRuns.delete(s.handle.id)
      flushedAnalystRuns.add(s.handle.id)
      continue
    }
    const worker = projectSettled(s, true)
    resumedWorkers.push(worker)
    ledger.push(worker)
  }
  // A settlement can be durable in the spawn journal while the process dies before the product
  // observer acknowledges it. Opted-in high-level callers replay those events at least once. Keep
  // each frozen event object across an in-process retry so EventBus reuses its exact BusRecord.
  const resumeEvents = opts.replaySettlements
    ? [
        ...resumedWorkers.map((worker) =>
          detachedFrozen<CoordinationEvent>({ type: 'settled', worker }),
        ),
        ...resumedFindings,
      ]
    : []
  let resumeEventIndex = 0
  let readyInFlight: Promise<void> | undefined
  return (): Promise<void> => {
    if (resumeEventIndex >= resumeEvents.length) return Promise.resolve()
    if (readyInFlight) return readyInFlight
    readyInFlight = (async () => {
      while (resumeEventIndex < resumeEvents.length) {
        const event = resumeEvents[resumeEventIndex]
        if (!event) break
        await bus.publish(event)
        resumeEventIndex += 1
      }
    })().finally(() => {
      readyInFlight = undefined
    })
    return readyInFlight
  }
}
