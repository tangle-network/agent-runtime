import type { CheckVerdict } from '../../runtime/supervise/completion-gate'
import type { CheckRead } from '../../runtime/supervise/continuation'
import type { BusRecord, EventBus } from '../../runtime/supervise/event-bus'
import type { InboxReceipt } from '../../runtime/supervise/inbox'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { BlockedToolReport, CoordinationToolsOptions } from './coordination-contracts'
import type { CoordinationEvent, Delivery, EventAcknowledgement } from './coordination-events'

/**
 * What one manager's stop, submission, delivery and driver-attempt functions share. Each module
 * that reads or writes these takes this object, never a copied value.
 */
export interface ManagerState {
  stopped: boolean
  reason: string | undefined
  stopNotified: boolean
  submitted: { readonly result: unknown } | undefined
  submissionInFlight: Promise<void> | undefined
  /** Every `report_blocked` whose probe failed too. */
  readonly blockedReports: BlockedToolReport[]
  readonly deliveries: Delivery[]
  driverAttempt: number | undefined
  lastRejection: { readonly at: number; readonly reason: string } | undefined
  readonly checkReads: CheckRead[]
  /**
   * The blocking `scope.next()` (via `drainSettlement`) waits on a LIVE worker for its whole run.
   * At most ONE such drain is in flight, so a wake that ends on its heartbeat never starts a
   * second block, and the one drain still delivers the settlement (exactly-once via the scope
   * cursor) whenever it lands.
   */
  inFlightDrain: Promise<boolean> | null
  /** Set once a wake has told this manager the deadline is near. From then on open work does not
   *  refuse its `submit_result` or `stop`: the notice asks for the best result now, and the workers
   *  still running are torn down when the manager settles. */
  deadlineNoticeDelivered: boolean
}

export function createManagerState(opts: CoordinationToolsOptions): ManagerState {
  // An accepted direct result is a terminal fact, not an in-process callback. A durable observer
  // appends the `submission` record before the tool responds, so a fresh manager can restore it
  // after a crash in the response-to-driver window.
  const priorSubmission =
    opts.deliverable === undefined
      ? undefined
      : opts.priorJournal?.find(
          (
            record,
          ): record is BusRecord<Extract<CoordinationEvent, { readonly type: 'submission' }>> =>
            record.event.type === 'submission',
        )
  return {
    stopped: priorSubmission !== undefined,
    reason: priorSubmission === undefined ? undefined : 'result-accepted',
    stopNotified: false,
    submitted:
      priorSubmission === undefined
        ? undefined
        : detachedFrozen({ result: priorSubmission.event.result }),
    submissionInFlight: undefined,
    blockedReports: [],
    deliveries: [],
    driverAttempt: undefined,
    lastRejection: undefined,
    checkReads: [],
    inFlightDrain: null,
    deadlineNoticeDelivered: false,
  }
}

export function notifyManagerStop(state: ManagerState, opts: CoordinationToolsOptions): void {
  if (state.stopNotified) return
  state.stopNotified = true
  opts.onStop?.(state.reason)
}

export function appendCheckRead(
  state: ManagerState,
  read: {
    readonly source: CheckRead['source']
    readonly verdict?: CheckVerdict
    readonly unavailable?: string
  },
): CheckRead {
  const entry = detachedFrozen<CheckRead>({
    read: state.checkReads.length + 1,
    attempt: state.driverAttempt ?? 1,
    at: Date.now(),
    source: read.source,
    ...(read.verdict === undefined ? {} : { verdict: read.verdict }),
    ...(read.unavailable === undefined ? {} : { unavailable: read.unavailable }),
  })
  state.checkReads.push(entry)
  return entry
}

/** What the acknowledgement of a delivery reads and writes beyond the shared state. */
export type AcknowledgementEnv = {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
  readonly state: ManagerState
  readonly leadReceipts: Map<string, (receipt: InboxReceipt) => void>
}

export async function acknowledgeDeliveries(
  { opts, bus, state, leadReceipts }: AcknowledgementEnv,
  targets: ReadonlyArray<Delivery>,
  by: EventAcknowledgement['by'],
): Promise<number[]> {
  const fresh = targets.filter((delivery) => !delivery.acknowledged)
  if (fresh.length === 0) return []
  // A lead's steer or answer was read by the turn that processed it: answer its sender.
  for (const delivery of fresh) {
    const event = delivery.record.event
    const messageId = event.type === 'lead-message' ? event.message.messageId : undefined
    const receipt = messageId === undefined ? undefined : leadReceipts.get(messageId)
    if (messageId === undefined || receipt === undefined) continue
    leadReceipts.delete(messageId)
    try {
      receipt({
        status: 'consumed',
        messageId,
        attemptId: `${opts.scope.view.root}#attempt-${delivery.attempt ?? state.driverAttempt ?? 1}`,
      })
    } catch {
      // A sender's receipt handler cannot change what this manager processed.
    }
  }
  const seqs = fresh.map((delivery) => delivery.record.seq)
  await bus.publish(
    {
      type: 'acknowledgement',
      acknowledgement: detachedFrozen<EventAcknowledgement>({
        seqs,
        by,
        ...(state.driverAttempt === undefined ? {} : { attempt: state.driverAttempt }),
      }),
    },
    { queue: false },
  )
  for (const delivery of fresh) delivery.acknowledged = true
  return seqs
}
