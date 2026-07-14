import type { TraceStore } from '@tangle-network/agent-eval'
import type {
  AgentCandidateExecutionPlanMaterial,
  AgentCandidateMaterializationReceipt,
} from '@tangle-network/agent-interface'
import {
  agentCandidateExecutionPlanMaterialSchema,
  agentCandidateMaterializationReceiptSchema,
} from '@tangle-network/agent-interface'

import { readVerifiedArtifact } from './artifacts'
import type {
  AgentCandidateExecutionAttemptRef,
  AgentCandidateExecutionClaim,
  AgentCandidateExecutionClaimStore,
  AgentCandidateExecutionFinishResult,
} from './claim'
import {
  candidateCleanupDeadline,
  candidateCleanupTimeout,
  withinCandidateCleanupDeadline,
} from './cleanup'
import { canonicalCandidateBytes } from './digest'
import {
  sealAgentCandidateExecutorFinalCapture,
  sealAgentCandidateExecutorStopAcknowledgement,
} from './executor-capture'
import { persistAgentCandidateExecutorCapture } from './executor-capture-evidence'
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
  const recoveryTraceStore = new RecoveryAgentCandidateTraceStore(options.traceStore)
  const preparation = withinCandidateCleanupDeadline(
    () => readRecoveryPreparation(record.claim, options.outputArtifacts),
    cleanupDeadlineAtMs,
    'expired candidate preparation evidence read',
  )
  const processClosure = withinCandidateCleanupDeadline(
    async (cleanupSignal) => {
      const stopped = await options.executor.stop(
        {
          executionId: record.claim.executionId,
          executionPlanDigest: record.claim.executionPlanDigest,
        },
        {
          traceStore: recoveryTraceStore,
          reason: 'failed',
          signal: cleanupSignal,
          deadlineAtMs: cleanupDeadlineAtMs,
        },
      )
      sealAgentCandidateExecutorStopAcknowledgement(stopped)
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

  const closureOutcomes = Promise.allSettled([
    modelClosure,
    memoryClosure ?? Promise.resolve(undefined),
  ] as const)
  const [preparationOutcome, processOutcome] = await Promise.allSettled([
    preparation,
    processClosure,
  ] as const)
  const failures: unknown[] = [preparationOutcome, processOutcome]
    .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    .map((outcome) => outcome.reason)
  const recoveredPreparation =
    preparationOutcome.status === 'fulfilled' ? preparationOutcome.value : undefined
  const processStopped = processOutcome.status === 'fulfilled'
  let persistedCapture: Awaited<ReturnType<typeof persistAgentCandidateExecutorCapture>> | undefined
  if (recoveredPreparation && processStopped) {
    try {
      const capture = sealAgentCandidateExecutorFinalCapture(
        await withinCandidateCleanupDeadline(
          (cleanupSignal) =>
            options.executor.capture(
              {
                executionId: record.claim.executionId,
                executionPlanDigest: record.claim.executionPlanDigest,
              },
              {
                traceStore: recoveryTraceStore,
                signal: cleanupSignal,
              },
            ),
          cleanupDeadlineAtMs,
          'expired candidate evidence capture',
        ),
        recoveredPreparation.plan.task.outcome,
      )
      persistedCapture = await withinCandidateCleanupDeadline(
        () =>
          persistAgentCandidateExecutorCapture(
            {
              executionId: record.claim.executionId,
              executionPlanDigest: record.claim.executionPlanDigest,
            },
            recoveredPreparation.plan.task.outcome,
            capture,
            options.outputArtifacts,
          ),
        cleanupDeadlineAtMs,
        'expired candidate capture persistence',
      )
    } catch (error) {
      failures.push(error)
    }
  }
  const [modelOutcome, memoryOutcome] = await closureOutcomes
  for (const outcome of [modelOutcome, memoryOutcome]) {
    if (outcome.status === 'rejected') failures.push(outcome.reason)
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'expired candidate cleanup could not be proven')
  }
  if (!persistedCapture) throw new Error('expired candidate capture was not persisted')

  if (modelOutcome.status !== 'fulfilled') {
    throw new Error('expired candidate model settlement was not recovered')
  }
  const model = modelOutcome.value
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
      record.phase === 'claimed' && model.usage.modelCalls === 0
        ? 'pre-model-infrastructure'
        : 'unknown',
    usage: model.usage,
    modelSettlement: modelSettlement.artifact,
    failureEvidence: persistedCapture.evidence,
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

async function readRecoveryPreparation(
  claim: AgentCandidateExecutionClaim,
  artifacts: AgentCandidateOutputArtifactPort,
): Promise<{
  plan: AgentCandidateExecutionPlanMaterial
  receipt: AgentCandidateMaterializationReceipt
}> {
  const [planBytes, receiptBytes] = await Promise.all([
    readVerifiedArtifact(claim.preparationEvidence.executionPlan, artifacts),
    readVerifiedArtifact(claim.preparationEvidence.materializationReceipt, artifacts),
  ])
  const plan = agentCandidateExecutionPlanMaterialSchema.parse(
    parseCanonicalBytes(planBytes, 'plan'),
  )
  if (claim.preparationEvidence.executionPlan.sha256 !== claim.executionPlanDigest) {
    throw new Error('recovery execution plan artifact does not match the claimed digest')
  }
  const receiptMaterial = parseCanonicalBytes(receiptBytes, 'materialization receipt')
  const receipt = agentCandidateMaterializationReceiptSchema.parse({
    ...receiptMaterial,
    digest: claim.preparationEvidence.materializationReceipt.sha256,
  })
  if (
    receipt.bundleDigest !== claim.bundleDigest ||
    receipt.executionPlan.digest !== claim.executionPlanDigest ||
    plan.bundleDigest !== claim.bundleDigest ||
    plan.executionId !== claim.executionId
  ) {
    throw new Error('recovery preparation evidence does not match the durable claim')
  }
  return { plan, receipt }
}

function parseCanonicalBytes(bytes: Uint8Array, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    throw new Error(`candidate recovery ${label} is not JSON`, { cause: error })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`candidate recovery ${label} must be an object`)
  }
  if (!Buffer.from(canonicalCandidateBytes(parsed)).equals(Buffer.from(bytes))) {
    throw new Error(`candidate recovery ${label} bytes are not canonical`)
  }
  return parsed as Record<string, unknown>
}
