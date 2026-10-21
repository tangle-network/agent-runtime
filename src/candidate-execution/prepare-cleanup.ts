/** Release the protected access a failed preparation reserved. */

import type { AgentCandidateResolvedModel, Sha256Digest } from '@tangle-network/agent-interface'
import { errorMessage } from '../runtime/util'
import { candidateCleanupDeadline, withinCandidateCleanupDeadline } from './cleanup'
import { sealAgentCandidateModelSettlement } from './model-settlement'
import type { AgentCandidateExecutionPorts, AgentCandidateTaskExecution } from './types'

/** The reservations a preparation holds, as far as it got. */
export interface HeldPreparationAccess {
  readonly task: AgentCandidateTaskExecution
  readonly ports: AgentCandidateExecutionPorts
  readonly preparationId: string
  readonly cleanupTimeoutMs: number
  readonly modelGrantDigest: Sha256Digest
  readonly resolvedModel: AgentCandidateResolvedModel
  /** The isolated memory reservation, once prepared. */
  readonly memory?: { accessDigest: Sha256Digest | undefined; effectiveNamespace: string }
}

/**
 * Close the isolated memory and settle the model grant of a preparation that failed. Throws a
 * combined error, with `cause` set to the preparation's own, when a cleanup fails too.
 */
export async function cleanupFailedPreparation(
  held: HeldPreparationAccess,
  error: unknown,
): Promise<void> {
  const { task, ports, preparationId, resolvedModel } = held
  const cleanupDeadlineAtMs = candidateCleanupDeadline(held.cleanupTimeoutMs)
  const cleanup: Array<Promise<unknown>> = []
  if (held.memory !== undefined) {
    const { accessDigest, effectiveNamespace } = held.memory
    if (!accessDigest) throw new Error('isolated memory preparation is missing access identity')
    cleanup.push(
      withinCandidateCleanupDeadline(
        async () => {
          const closed = await ports.memory.close({
            executionId: task.executionId,
            preparationId,
            accessDigest,
            effectiveNamespace,
            reason: 'preparation-failed',
          })
          if (closed.closed !== true || Object.keys(closed).some((key) => key !== 'closed')) {
            throw new Error('failed preparation did not close isolated memory access')
          }
        },
        cleanupDeadlineAtMs,
        'failed preparation memory cleanup',
      ),
    )
  }
  cleanup.push(
    withinCandidateCleanupDeadline(
      async () => {
        const settlement = sealAgentCandidateModelSettlement(
          await ports.models.settleGrant({
            executionId: task.executionId,
            preparationId,
            grantDigest: held.modelGrantDigest,
            resolved: resolvedModel,
            reason: 'preparation-failed',
          }),
          {
            preparationId,
            grantDigest: held.modelGrantDigest,
            model: resolvedModel.model,
          },
        )
        if (settlement.usage.modelCalls !== 0) {
          throw new Error('failed preparation unexpectedly contains model calls')
        }
      },
      cleanupDeadlineAtMs,
      'failed preparation model cleanup',
    ),
  )
  const cleanupResults = await Promise.allSettled(cleanup)
  const cleanupErrors = cleanupResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (cleanupErrors.length > 0) {
    throw new Error(
      `candidate preparation failed and protected access cleanup failed: ${cleanupErrors.map(errorMessage).join('; ')}`,
      { cause: error },
    )
  }
}
