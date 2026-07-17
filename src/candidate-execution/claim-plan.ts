import type { AgentCandidateArtifactRef, Sha256Digest } from '@tangle-network/agent-interface'

import { type AgentCandidateExecutionClaim, candidateClaimFileInternals } from './claim'
import { canonicalCandidateDigest } from './digest'
import { candidateExecutionOwnerWindowMs } from './execution-window'
import { assertPreparedCandidateIntegrity } from './prepared-state'
import type { PreparedAgentCandidateExecution } from './types'

/** Extract the complete durable claim from a prepared execution. */
export function candidateExecutionClaim(
  prepared: PreparedAgentCandidateExecution,
  preparationEvidence: {
    executionPlan: AgentCandidateArtifactRef
    materializationReceipt: AgentCandidateArtifactRef
  },
): AgentCandidateExecutionClaim {
  const state = assertPreparedCandidateIntegrity(prepared)
  const material = prepared.executionPlan.value.material
  const attempt = {
    number: material.runCell.attempt,
    maxAttempts: state.benchmarkTask.attempt.maxAttempts,
    retryPolicy: state.benchmarkTask.attempt.retryPolicy,
  } as const
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
  if (
    preparationEvidence.executionPlan.sha256 !== prepared.executionPlan.value.digest ||
    preparationEvidence.executionPlan.byteLength !== state.executionPlan.bytes.byteLength
  ) {
    throw new Error('persisted execution plan does not match its canonical preparation bytes')
  }
  if (
    preparationEvidence.materializationReceipt.sha256 !== state.materializationReceipt.digest ||
    preparationEvidence.materializationReceipt.byteLength !==
      state.materializationReceipt.bytes.byteLength
  ) {
    throw new Error(
      'persisted materialization receipt does not match its canonical preparation bytes',
    )
  }
  return candidateClaimFileInternals.sealClaim({
    executionId: prepared.executionId,
    attempt: attempt.number,
    maxAttempts: attempt.maxAttempts,
    retryPolicy: attempt.retryPolicy,
    bundleDigest: prepared.bundle.digest,
    executionPlanDigest: prepared.executionPlan.value.digest,
    preparationEvidence,
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
      runCell: {
        ...material.runCell,
        attempt: 0,
        digest: `sha256:${'0'.repeat(64)}`,
      },
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
