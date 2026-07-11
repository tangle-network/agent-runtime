import type { TraceStore } from '@tangle-network/agent-eval'

import type {
  AgentCandidateExecutionAttemptRef,
  AgentCandidateExecutionClaimStore,
  AgentCandidateExecutionFinishResult,
} from './claim'
import {
  candidateCleanupDeadline,
  candidateCleanupTimeout,
  withinCandidateCleanupDeadline,
} from './cleanup'
import { sealAgentCandidateExecutorFinalCapture } from './executor-capture'
import { sealAgentCandidateModelSettlement } from './model-settlement'
import { persistCandidateModelSettlementEvidence } from './outcome-evidence'
import { RecoveryAgentCandidateTraceStore } from './protected-trace-store'
import type {
  AgentCandidateExecutionPorts,
  AgentCandidateExecutorPort,
  AgentCandidateOutputArtifactPort,
} from './types'

export interface RecoverExpiredAgentCandidateOptions {
  attempt: AgentCandidateExecutionAttemptRef
  claimStore: AgentCandidateExecutionClaimStore
  executor: AgentCandidateExecutorPort
  traceStore: TraceStore
  ports: Pick<AgentCandidateExecutionPorts, 'models' | 'memory'>
  outputArtifacts: AgentCandidateOutputArtifactPort
  cleanupTimeoutMs?: number
  /** Evaluator clock; must be the same clock used by the claim store. */
  now?: () => number
}

/** Close an expired crashed attempt from persisted non-secret handles, then record failure. */
export async function recoverExpiredAgentCandidateExecution(
  options: RecoverExpiredAgentCandidateOptions,
): Promise<AgentCandidateExecutionFinishResult> {
  const record = await options.claimStore.getAttempt(options.attempt)
  if (!record) throw new Error('candidate execution recovery attempt is missing')
  if (record.terminal) {
    return Object.freeze({ finished: false, terminal: record.terminal, exactReplay: true })
  }
  const cleanupTimeoutMs = candidateCleanupTimeout(
    options.cleanupTimeoutMs ?? record.claim.cleanup.cleanupTimeoutMs,
  )
  if (cleanupTimeoutMs > record.claim.cleanup.cleanupTimeoutMs) {
    throw new Error('recovery cleanup timeout exceeds the frozen preparation bound')
  }

  const now = options.now ?? Date.now
  if (now() < record.claim.leaseExpiresAtMs) {
    throw new Error('candidate execution lease has not expired')
  }

  const cleanupDeadlineAtMs = candidateCleanupDeadline(cleanupTimeoutMs)
  const controller = new AbortController()
  controller.abort(new Error('recovering an expired candidate execution'))
  const recoveryTraceStore = new RecoveryAgentCandidateTraceStore(options.traceStore)
  const processClosure = withinCandidateCleanupDeadline(
    async () => {
      const stopped = await options.executor.stopAndCapture(
        {
          executionId: record.claim.executionId,
          executionPlanDigest: record.claim.executionPlanDigest,
        },
        {
          traceStore: recoveryTraceStore,
          reason: 'failed',
          signal: controller.signal,
          deadlineAtMs: record.claim.leaseExpiresAtMs,
        },
      )
      sealAgentCandidateExecutorFinalCapture(stopped)
      return { stopped: true as const }
    },
    cleanupDeadlineAtMs,
    'expired candidate process termination',
  )

  const modelClosure = withinCandidateCleanupDeadline(
    async () =>
      sealAgentCandidateModelSettlement(
        await options.ports.models.settleGrant({
          executionId: record.claim.executionId,
          preparationId: record.claim.cleanup.preparationId,
          grantDigest: record.claim.cleanup.modelGrantDigest,
          resolved: record.claim.cleanup.resolvedModel,
          reason: 'failed',
        }),
        {
          preparationId: record.claim.cleanup.preparationId,
          grantDigest: record.claim.cleanup.modelGrantDigest,
          model: record.claim.cleanup.resolvedModel.model,
        },
      ),
    cleanupDeadlineAtMs,
    'expired candidate model settlement',
  )

  const memoryClosure = record.claim.cleanup.memory
    ? withinCandidateCleanupDeadline(
        async () => {
          const memory = record.claim.cleanup.memory
          if (!memory) throw new Error('expired candidate memory handle is missing')
          const closed = await options.ports.memory.close({
            executionId: record.claim.executionId,
            preparationId: record.claim.cleanup.preparationId,
            accessDigest: memory.accessDigest,
            effectiveNamespace: memory.effectiveNamespace,
            reason: 'failed',
          })
          if (closed.closed !== true || Object.keys(closed).some((key) => key !== 'closed')) {
            throw new Error('expired candidate memory did not acknowledge closure')
          }
          return { closed: true as const }
        },
        cleanupDeadlineAtMs,
        'expired candidate memory closure',
      )
    : undefined

  const operations = [processClosure, modelClosure, ...(memoryClosure ? [memoryClosure] : [])]
  const outcomes = await Promise.allSettled(operations)
  const failures = outcomes
    .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    .map((outcome) => outcome.reason)
  if (failures.length > 0) {
    throw new AggregateError(failures, 'expired candidate cleanup could not be proven')
  }

  const model = await modelClosure
  const modelSettlement = await withinCandidateCleanupDeadline(
    () =>
      persistCandidateModelSettlementEvidence(
        {
          executionId: record.claim.executionId,
          executionPlanDigest: record.claim.executionPlanDigest,
          resolvedModel: record.claim.cleanup.resolvedModel,
        },
        model,
        options.outputArtifacts,
      ),
    cleanupDeadlineAtMs,
    'expired candidate model-settlement persistence',
  )
  const memory = record.claim.cleanup.memory
  return await options.claimStore.recoverExpired(options.attempt, {
    failureClass:
      record.phase === 'claimed' && model.fixedUsage.modelCalls === 0
        ? 'pre-model-infrastructure'
        : 'unknown',
    usage: model.fixedUsage,
    modelSettlement: modelSettlement.artifact,
    process: {
      stopped: true,
      executionPlanDigest: record.claim.executionPlanDigest,
    },
    model: {
      closed: true,
      preparationId: record.claim.cleanup.preparationId,
      grantDigest: record.claim.cleanup.modelGrantDigest,
    },
    ...(memory
      ? {
          memory: {
            closed: true,
            preparationId: record.claim.cleanup.preparationId,
            accessDigest: memory.accessDigest,
            effectiveNamespace: memory.effectiveNamespace,
          },
        }
      : {}),
  })
}
