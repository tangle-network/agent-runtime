/**
 * The one builder of a down child's terminal record and of the evidence an observer sees beside
 * it, shared by every writer: the settle path at the reconcile, the release sweep closing a
 * retained slot at root settlement, and `healReleasedSlots` closing that slot on the next resume
 * when the settling process died between the last `environment-teardown` receipt and the record.
 *
 * This is its own module rather than a corner of scope.ts because scope.ts value-imports
 * recover-executors.ts, so a value import in the other direction would be a runtime ESM cycle
 * that biome does not flag. Every import of './scope' here is type-only and erased.
 *
 * Two hand-written literals for one record shape is how a field lands on one path and not the
 * other (#1244 was exactly that for `harnessTranscript`), so the subject is a structural type a
 * live `LiveChild` satisfies unchanged and a journaled `reconciled` record can be projected onto.
 */

import type { PreSeqSettled } from './scope'
import { detachedSnapshot } from './snapshot'
import type {
  BudgetViolation,
  ExecutionBindingReceipt,
  NodeId,
  NodeSnapshot,
  ProfileMaterializationReceipt,
  ProviderModelExecutionEvidence,
  SpawnEvent,
  Spend,
} from './types'

export type DownSettlement = Extract<PreSeqSettled, { kind: 'down' }>

/** What the terminal record needs from the node beyond its settlement. `RunCancellationReason`
 *  has `readonly source: string`, so a live child's `cancellationReason` fits as it is. */
export type TerminalDownSubject = {
  readonly id: NodeId
  readonly spent: Spend
  readonly budgetViolation?: BudgetViolation
  readonly cancellationReason?: { readonly source: string }
}

/** The settlement fields every writer copies, in the terminal record's key order. The
 *  `reconciled` record is built from this same spread so it and the terminal record can never
 *  disagree on a field. */
export function settlementFields(
  subject: TerminalDownSubject,
  settlement: DownSettlement,
): {
  spent: Spend
  infra?: boolean
  reason: string
  outRef?: string
  providerModel?: ProviderModelExecutionEvidence
  budgetViolation?: BudgetViolation
  trace: DownSettlement['trace']
  harnessTranscript?: DownSettlement['harnessTranscript']
  retainedPendingCause?: DownSettlement['retainedPendingCause']
} {
  return {
    spent: subject.spent,
    ...(settlement.infra === undefined ? {} : { infra: settlement.infra }),
    reason: settlement.reason,
    ...(settlement.retainedPendingCause === undefined
      ? {}
      : { retainedPendingCause: settlement.retainedPendingCause }),
    ...(settlement.outRef ? { outRef: settlement.outRef } : {}),
    ...(settlement.providerModel ? { providerModel: settlement.providerModel } : {}),
    ...(subject.budgetViolation ? { budgetViolation: subject.budgetViolation } : {}),
    trace: settlement.trace,
    ...(settlement.harnessTranscript ? { harnessTranscript: settlement.harnessTranscript } : {}),
  }
}

/** `cancelled` keeps its `source` from the subject's own cancellation reason, so a released
 *  cancelled child records the same source it settled with. */
export function terminalDownEvent(
  subject: TerminalDownSubject,
  settlement: DownSettlement,
  seq: number,
  at: string,
  retainedExecution?: 'released',
): Extract<SpawnEvent, { kind: 'settled' | 'cancelled' }> {
  const cancellation = subject.cancellationReason
  return {
    ...(cancellation === undefined
      ? { kind: 'settled' as const, status: 'down' as const }
      : { kind: 'cancelled' as const, source: cancellation.source }),
    id: subject.id,
    ...settlementFields(subject, settlement),
    ...(retainedExecution === undefined ? {} : { retainedExecution }),
    seq,
    at,
  }
}

/** What the observer evidence needs from the node beyond its settlement. */
export type SettledEvidenceSubject = {
  readonly runtime: NodeSnapshot['runtime']
  readonly startedAt: number
  readonly providerModel?: ProviderModelExecutionEvidence
  readonly materialization?: ProfileMaterializationReceipt
  readonly executionBindings: ReadonlyArray<ExecutionBindingReceipt>
  readonly budgetViolation?: BudgetViolation
}

/**
 * The evidence a settled node carries beyond its status: the receipts that name what actually
 * ran, the own-inference spend the parent tree re-homes as a `metered` event, and the wall-clock
 * window. One builder feeds BOTH terminal paths, so an observer never sees a `down` node
 * described in different terms from a `done` one. Every field is omitted when the fact is
 * absent — an unreported receipt must not read as an empty one. Snapshots are detached because
 * an observer may serialize them after the live child has moved on.
 */
export function settledNodeEvidence(
  subject: SettledEvidenceSubject,
  settlement: PreSeqSettled,
  settledAt: number,
): Record<string, unknown> {
  return {
    runtime: subject.runtime,
    startedAt: subject.startedAt,
    settledAt,
    ...(settlement.metered ? { metered: detachedSnapshot(settlement.metered, 'metered') } : {}),
    ...(subject.providerModel
      ? { providerModel: detachedSnapshot(subject.providerModel, 'provider model evidence') }
      : {}),
    ...(subject.materialization
      ? { materialization: detachedSnapshot(subject.materialization, 'materialization receipt') }
      : {}),
    ...(subject.executionBindings.length > 0
      ? {
          executionBindings: detachedSnapshot(
            [...subject.executionBindings],
            'execution binding receipts',
          ),
        }
      : {}),
    ...(subject.budgetViolation
      ? { budgetViolation: detachedSnapshot(subject.budgetViolation, 'budget violation') }
      : {}),
    trace: detachedSnapshot(settlement.trace, 'worker trace evidence'),
  }
}

/** The `agent.child` payload of the release: the settlement restated as released, `settledAt`
 *  kept at the settlement instant and `metered` omitted so the driver's inference is not summed
 *  twice. The sweep and the resume heal emit it from the same builder. */
export function releasedChildPayload(
  subject: TerminalDownSubject & SettledEvidenceSubject,
  settlement: DownSettlement,
  settledAt: number,
  releasedAt: number,
): Record<string, unknown> {
  return {
    childId: subject.id,
    status: 'down',
    retainedExecution: 'released',
    ...(settlement.retainedPendingCause === undefined
      ? {}
      : { retainedPendingCause: settlement.retainedPendingCause }),
    releasedAt,
    ...(settlement.outRef === undefined ? {} : { outRef: settlement.outRef }),
    reason: settlement.reason,
    ...(settlement.infra === undefined ? {} : { infra: settlement.infra }),
    spent: subject.spent,
    ...settledNodeEvidence(subject, { ...settlement, metered: undefined }, settledAt),
  }
}
