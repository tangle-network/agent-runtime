import { candidateCleanupDeadline, withinCandidateCleanupDeadline } from './cleanup'
import { sealAgentCandidateModelSettlement } from './model-settlement'
import {
  assertPreparedCandidateIntegrity,
  beginPreparedCandidateDisposal,
  consumePreparedCandidateExecution,
} from './prepared-state'
import type { PreparedAgentCandidateExecution } from './types'

export interface DisposePreparedAgentCandidateOptions {
  cleanupTimeoutMs?: number
}

/** Revoke reservations held by a prepared candidate that will not be executed. */
export async function disposePreparedAgentCandidateExecution(
  prepared: PreparedAgentCandidateExecution,
  options: DisposePreparedAgentCandidateOptions = {},
): Promise<{ disposed: true }> {
  const initialState = assertPreparedCandidateIntegrity(prepared)
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? initialState.cleanupTimeoutMs
  if (cleanupTimeoutMs > initialState.cleanupTimeoutMs) {
    throw new Error('disposal cleanup timeout exceeds the frozen preparation bound')
  }
  const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs)
  const state = beginPreparedCandidateDisposal(prepared)
  const cleanup: Array<Promise<unknown>> = []

  if (state.memory.mode === 'isolated') {
    const reservation = state.memoryReservation
    if (!reservation) throw new Error('isolated memory reservation is missing')
    cleanup.push(
      withinCandidateCleanupDeadline(
        async () => {
          const closed = await state.ports.memory.close({
            executionId: state.executionId,
            preparationId: reservation.preparationId,
            accessDigest: reservation.accessDigest,
            effectiveNamespace: reservation.effectiveNamespace,
            reason: 'abandoned',
          })
          if (closed.closed !== true || Object.keys(closed).some((key) => key !== 'closed')) {
            throw new Error('abandoned isolated memory access did not acknowledge closure')
          }
        },
        cleanupDeadlineAtMs,
        'isolated memory disposal',
      ),
    )
  }

  cleanup.push(
    withinCandidateCleanupDeadline(
      async () => {
        const settlement = sealAgentCandidateModelSettlement(
          await state.ports.models.settleGrant({
            executionId: state.executionId,
            preparationId: state.preparationId,
            grantDigest: state.modelReservation.digest,
            resolved: state.resolvedModel,
            reason: 'abandoned',
          }),
          {
            preparationId: state.preparationId,
            grantDigest: state.modelReservation.digest,
            model: state.resolvedModel.model,
          },
        )
        if (settlement.usage.modelCalls !== 0) {
          throw new Error('unexecuted model reservation unexpectedly contains calls')
        }
      },
      cleanupDeadlineAtMs,
      'model reservation disposal',
    ),
  )

  const results = await Promise.allSettled(cleanup)
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (failures.length > 0) {
    consumePreparedCandidateExecution(prepared, 'disposal-failed')
    throw new AggregateError(failures, 'candidate preparation disposal failed')
  }

  consumePreparedCandidateExecution(prepared, 'disposed')
  return Object.freeze({ disposed: true as const })
}
