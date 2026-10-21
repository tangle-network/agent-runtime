import { snapshotProviderObservations } from '../../runtime/provider-observation-snapshot'
import type { BudgetViolation, NodeSnapshot, SpawnEvent } from '../../runtime/supervise/types'

/** Copy a terminal record's overspend at the journal boundary; absent stays absent. */
export function budgetViolationOf(event: Extract<SpawnEvent, { kind: 'settled' | 'cancelled' }>): {
  readonly budgetViolation?: BudgetViolation
} {
  if (event.budgetViolation === undefined) return {}
  return {
    budgetViolation: Object.freeze({
      overspent: Object.freeze(
        event.budgetViolation.overspent.map((entry) =>
          Object.freeze({ channel: entry.channel, reserved: entry.reserved, spent: entry.spent }),
        ),
      ),
    }),
  }
}

/** Copy provider evidence at the journal boundary so replay never exposes mutable event state. */
export function copyProviderModelEvidence(
  evidence: NodeSnapshot['providerModel'],
): NodeSnapshot['providerModel'] {
  if (evidence === undefined) return undefined
  const attempts = snapshotProviderObservations(evidence.attempts)
  const models = Object.freeze([...evidence.models])
  return Object.freeze(
    evidence.status === 'unknown'
      ? { status: 'unknown' as const, attempts, models, reason: evidence.reason }
      : { status: 'known' as const, attempts, models },
  )
}

export function traceEvidenceFor(
  event: Extract<SpawnEvent, { kind: 'settled' }>,
): NonNullable<NodeSnapshot['trace']> {
  return (
    event.trace ?? {
      status: 'unavailable',
      reason: 'legacy-settlement-without-trace-evidence',
    }
  )
}
