import type { AgentCandidateResolvedModel } from '@tangle-network/agent-interface'

import type {
  AgentCandidateModelGrantActivateInput,
  AgentCandidateModelGrantReserveInput,
  AgentCandidateModelGrantSettleInput,
} from './protected-model-port'
import type {
  AgentCandidateModelPort,
  AgentCandidateProtectedModelActivation,
  AgentCandidateProtectedModelReservation,
  AgentCandidateProtectedModelSettlement,
} from './types'

/** Reservation fields supplied by a caller before Runtime resolves the model. */
export type AgentCandidateModelGrantRunReservationInput = Omit<
  AgentCandidateModelGrantReserveInput,
  'resolved'
>

/** Values available only while one protected model grant is active. */
export interface ProtectedAgentCandidateModelGrantContext {
  readonly activation: AgentCandidateProtectedModelActivation
  readonly reservation: AgentCandidateProtectedModelReservation
  readonly resolved: AgentCandidateResolvedModel
}

/** Inputs for one protected grant scoped to one bounded caller unit. */
export interface RunProtectedAgentCandidateModelGrantOptions<TResult> {
  /** Runtime port that validates and settles the evaluator-owned grant. */
  readonly port: AgentCandidateModelPort
  /** Provider-neutral model request resolved before any grant is reserved. */
  readonly resolve: Parameters<AgentCandidateModelPort['resolve']>[0]
  /** One bounded unit's immutable identity, attempt, expiry, and limits. */
  readonly reserve: AgentCandidateModelGrantRunReservationInput
  /** Must be no later than the reservation expiry. */
  readonly deadlineAtMs: AgentCandidateModelGrantActivateInput['deadlineAtMs']
  /** Execute exactly one bounded unit while the activated environment is valid. */
  readonly execute: (context: ProtectedAgentCandidateModelGrantContext) => Promise<TResult>
}

/** Result and sealed settlement returned after one protected grant closes. */
export interface RunProtectedAgentCandidateModelGrantResult<TResult> {
  readonly value: TResult
  readonly resolved: AgentCandidateResolvedModel
  readonly reservation: AgentCandidateProtectedModelReservation
  readonly settlement: AgentCandidateProtectedModelSettlement
}

/**
 * Run one bounded unit under a protected model grant.
 *
 * Runtime owns the grant lifecycle; callers own the unit boundary and any
 * durable scheduling or accounting around it. A reserved grant is settled
 * after activation failure or callback failure, and the callback error is
 * preserved when settlement also fails.
 */
export async function runProtectedAgentCandidateModelGrant<TResult>(
  options: RunProtectedAgentCandidateModelGrantOptions<TResult>,
): Promise<RunProtectedAgentCandidateModelGrantResult<TResult>> {
  if (typeof options.execute !== 'function') {
    throw new TypeError('protected model grant execute callback is required')
  }

  const resolved = await options.port.resolve(options.resolve)
  const reservation = await options.port.reserveGrant({
    ...options.reserve,
    resolved,
  })

  let value!: TResult
  let executionError: unknown
  let executionFailed = false
  let activated = false
  let reason: AgentCandidateModelGrantSettleInput['reason'] = 'preparation-failed'

  try {
    const activation = await options.port.activateGrant({
      executionId: options.reserve.executionId,
      preparationId: options.reserve.preparationId,
      grantDigest: reservation.digest,
      resolved,
      deadlineAtMs: options.deadlineAtMs,
    })
    activated = true
    value = await options.execute({ activation, reservation, resolved })
    reason = 'completed'
  } catch (error) {
    executionError = error
    executionFailed = true
    if (activated) reason = 'failed'
  }

  let settlement: AgentCandidateProtectedModelSettlement
  try {
    settlement = await options.port.settleGrant({
      executionId: options.reserve.executionId,
      preparationId: options.reserve.preparationId,
      grantDigest: reservation.digest,
      resolved,
      reason,
    })
  } catch (settlementError) {
    if (executionFailed) {
      throw new AggregateError(
        [executionError, settlementError],
        'protected model execution failed and its grant did not settle',
      )
    }
    throw settlementError
  }

  if (executionFailed) throw executionError
  return { value, resolved, reservation, settlement }
}
