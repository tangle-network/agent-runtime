import type { ProviderModelAttemptEvidence } from './supervise/types'

/** Detach provider attempt observations into their immutable journal evidence shape. */
export function snapshotProviderObservations(
  attempts: ReadonlyArray<ProviderModelAttemptEvidence>,
): ReadonlyArray<ProviderModelAttemptEvidence> {
  return Object.freeze(
    attempts.map((attempt) =>
      Object.freeze({
        observations: Object.freeze([...attempt.observations]),
        ...(attempt.identityConflict ? { identityConflict: true } : {}),
        ...(attempt.providerDispatch === 'not_started'
          ? { providerDispatch: 'not_started' as const }
          : {}),
      }),
    ),
  )
}
