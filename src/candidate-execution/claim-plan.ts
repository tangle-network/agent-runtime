import type { Sha256Digest } from '@tangle-network/agent-interface'

import { type AgentCandidateExecutionClaim, candidateClaimFileInternals } from './claim'
import { canonicalCandidateDigest } from './digest'
import { candidateExecutionOwnerWindowMs } from './execution-window'
import { assertPreparedCandidateIntegrity } from './prepared-state'
import type { PreparedAgentCandidateExecution } from './types'

/** Extract the complete durable claim from a prepared execution. */
export function candidateExecutionClaim(
  prepared: PreparedAgentCandidateExecution,
): AgentCandidateExecutionClaim {
  const state = assertPreparedCandidateIntegrity(prepared)
  const material = prepared.executionPlan.value.material
  const attempt = material.attempt
  const nowMs = Date.now()
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('candidate execution claim-store clock returned an invalid timestamp')
  }
  const leaseExpiresAtMs =
    nowMs +
    candidateExecutionOwnerWindowMs(
      material.limits.timeoutMs,
      state.cleanupTimeoutMs,
      state.resultTimeoutMs,
    )
  if (!Number.isSafeInteger(leaseExpiresAtMs) || leaseExpiresAtMs <= 0) {
    throw new Error('candidate execution leaseExpiresAtMs must be a positive safe timestamp')
  }
  if (leaseExpiresAtMs > state.reservationExpiresAtMs) {
    throw new Error(
      'candidate preparation expires before its full execution and cleanup owner window',
    )
  }
  return candidateClaimFileInternals.sealClaim({
    executionId: prepared.executionId,
    attempt: attempt.number,
    maxAttempts: attempt.maxAttempts,
    retryPolicy: attempt.retryPolicy,
    bundleDigest: prepared.bundle.digest,
    executionPlanDigest: prepared.executionPlan.value.digest,
    retryLineageDigest: retryLineageDigest(prepared, state.resultTimeoutMs),
    leaseExpiresAtMs,
    resultTimeoutMs: state.resultTimeoutMs,
    cleanup: {
      preparationId: state.preparationId,
      modelGrantDigest: state.modelReservation.digest,
      resolvedModel: state.resolvedModel,
      traceRunId: state.trace.runId,
      cleanupTimeoutMs: state.cleanupTimeoutMs,
      ...(state.memoryReservation
        ? {
            memory: {
              accessDigest: state.memoryReservation.accessDigest,
              effectiveNamespace: state.memoryReservation.effectiveNamespace,
            },
          }
        : {}),
    },
  })
}

function retryLineageDigest(
  prepared: PreparedAgentCandidateExecution,
  resultTimeoutMs: number,
): Sha256Digest {
  const material = prepared.executionPlan.value.material
  return canonicalCandidateDigest({
    resultTimeoutMs,
    executionPlan: {
      ...material,
      attempt: { ...material.attempt, number: 0 },
      model: {
        ...material.model,
        access: {
          ...material.model.access,
          grantDigest: `sha256:${'0'.repeat(64)}`,
        },
      },
      memory:
        material.memory.mode === 'disabled'
          ? material.memory
          : {
              mode: 'isolated',
              scope: 'task',
              effectiveNamespace: 'candidate/retry-lineage-normalized',
              reset: {
                kind: 'fresh',
                emptyStateDigest: material.memory.reset.emptyStateDigest,
              },
              beforeState: {
                digest: material.memory.beforeState.digest,
                material: material.memory.beforeState.material,
                manifest: {
                  sha256: material.memory.beforeState.manifest.sha256,
                  byteLength: material.memory.beforeState.manifest.byteLength,
                },
                archive: {
                  sha256: material.memory.beforeState.archive.sha256,
                  byteLength: material.memory.beforeState.archive.byteLength,
                },
              },
              ...(material.memory.seedDigest ? { seedDigest: material.memory.seedDigest } : {}),
            },
    },
  })
}
