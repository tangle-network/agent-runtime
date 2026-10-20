import type { Scope } from '../../runtime'
import type { BusRecord, EventBus } from '../../runtime/supervise/event-bus'
import { isLiveNodeStatus } from '../../runtime/supervise/node-status'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { CoordinationToolsOptions, SettledWorker } from './coordination-contracts'
import { eventWorker, projectEvent } from './coordination-event-projection'
import type { CoordinationEvent, Delivery, ManagerReentryState } from './coordination-events'
import type { createJournalReader } from './coordination-journal-reader'
import type { createWorkerObservation } from './coordination-worker-observation'

export function managerReentryState({
  opts,
  ledger,
  deliveries,
  priorJournal,
  bus,
  journal,
  openWork,
  driverAttempt,
  lastRejection,
}: {
  readonly opts: CoordinationToolsOptions
  readonly ledger: ReadonlyArray<SettledWorker>
  readonly deliveries: ReadonlyArray<Delivery>
  readonly priorJournal: ReadonlyArray<BusRecord<CoordinationEvent>>
  readonly bus: EventBus<CoordinationEvent>
  readonly journal: ReturnType<typeof createJournalReader>
  readonly openWork: ReturnType<typeof createWorkerObservation>['openWork']
  readonly driverAttempt: number | undefined
  readonly lastRejection: { readonly at: number; readonly reason: string } | undefined
}): ManagerReentryState {
  const { unqueued, queued } = openWork()
  const deliveredSettled = new Set(
    deliveries.flatMap((delivery) =>
      delivery.record.event.type === 'settled' ? [delivery.record.event.worker.id] : [],
    ),
  )
  return detachedFrozen<ManagerReentryState>({
    journalRows: priorJournal.length + bus.history().length,
    journalReadTo: journal.readTo(),
    live: ((opts.scope as Partial<Scope<unknown>>).view?.nodes ?? [])
      .filter((node) => isLiveNodeStatus(node.status))
      .map((node) => ({ id: node.id, label: node.label, status: node.status })),
    settled: [
      ...ledger.map((worker) => ({
        id: worker.id,
        status: worker.status,
        ...(worker.status === 'done' && worker.valid !== undefined ? { valid: worker.valid } : {}),
        delivered: deliveredSettled.has(worker.id),
      })),
      ...unqueued.map((node) => ({
        id: node.id,
        status: node.status === 'done' ? ('done' as const) : ('down' as const),
        delivered: false,
      })),
    ],
    waiting: [
      ...queued.map((record) => ({
        type: record.event.type,
        ...(eventWorker(record.event) === undefined ? {} : { worker: eventWorker(record.event) }),
      })),
      ...unqueued.map((node) => ({ type: 'settled', worker: node.id })),
    ],
    // The current attempt's own deliveries are its wake's events, which its input already
    // shows; only an earlier attempt's unacknowledged deliveries are unread.
    unacknowledged: deliveries
      .filter((delivery) => !delivery.acknowledged && delivery.attempt !== driverAttempt)
      .map((delivery) => ({
        seq: delivery.record.seq,
        type: delivery.record.event.type,
        ...(eventWorker(delivery.record.event) === undefined
          ? {}
          : { worker: eventWorker(delivery.record.event) }),
        ...(delivery.attempt === undefined ? {} : { attempt: delivery.attempt }),
        event: { ...projectEvent(delivery.record.event), eventSeq: delivery.record.seq },
      })),
    ...(lastRejection === undefined ? {} : { lastRejection }),
  })
}
