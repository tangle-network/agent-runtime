import type { TraceStore } from '@tangle-network/agent-eval'
import type { CandidateExperimentExecutionInput } from '@tangle-network/agent-eval/contract'
import type { CandidateExecutionEvidence } from '@tangle-network/agent-interface'
import type { AgentExactProcessResources } from '@tangle-network/agent-interface/environment-provider'

import type { AgentCandidateExecutionClaimStore } from '../candidate-execution/claim'
import { exactProcessProviderAsCandidateExecutor } from '../candidate-execution/exact-process-executor'
import type { PrepareAgentCandidateExecutionOptions } from '../candidate-execution/prepare'
import type {
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateExecutionPorts,
  AgentCandidateExecutorPort,
  AgentCandidateOutputArtifactPort,
} from '../candidate-execution/types'
import { AGENT_CANDIDATE_EXECUTION_SUPPORT } from '../candidate-execution/verify'
import type {
  AgentEnvironmentProviderRef,
  AgentEnvironmentProviderRegistry,
} from '../runtime/environment-provider'
import { resolveAgentEnvironmentProvider } from '../runtime/environment-provider'
import {
  type AgentCandidateExperimentCellPlacement,
  executeAgentCandidateExperimentCell,
} from './improvement-cycle'

/** Candidate surfaces implemented by the neutral exact-process executor. */
export const exactProcessCandidateExperimentExecutionSupport = Object.freeze({
  outcomes: Object.freeze(['output'] as const),
  outputMediaTypes: Object.freeze(['text/*', 'application/json', '*+json'] as const),
  code: Object.freeze(['disabled'] as const),
  memory: Object.freeze(['disabled'] as const),
  knowledge: true,
  profile: AGENT_CANDIDATE_EXECUTION_SUPPORT.profile,
  isolation: Object.freeze({
    freshEnvironment: true,
    exactProcess: true,
    egress: Object.freeze(['blocked', 'strict'] as const),
  }),
})

export interface CreateExactProcessCandidateExperimentExecutorOptions {
  provider: AgentEnvironmentProviderRef
  providerRegistry?: AgentEnvironmentProviderRegistry
  resources: AgentExactProcessResources
  providerOptions?: Record<string, unknown>
  provisionTimeoutMs?: number
  recoveryRetentionMs?: number
  ports: AgentCandidateExecutionPorts
  grader: AgentCandidateBenchmarkGraderPort
  outputArtifacts: AgentCandidateOutputArtifactPort
  traceStore: TraceStore
  claimStore: AgentCandidateExecutionClaimStore
  cleanupTimeoutMs?: number
  resultTimeoutMs?: number
}

export interface ExactProcessCandidateExperimentExecution
  extends CandidateExperimentExecutionInput {
  executionId: string
  attempt?: number
  executionRoots: AgentCandidateExperimentCellPlacement['executionRoots']
  stagingRoots: AgentCandidateExperimentCellPlacement['stagingRoots']
  preparation?: PrepareAgentCandidateExecutionOptions
}

export interface ExactProcessCandidateExperimentExecutor {
  /** Runtime's expired-attempt path reuses this port only to stop and dispose. */
  readonly executor: AgentCandidateExecutorPort
  execute(input: ExactProcessCandidateExperimentExecution): Promise<CandidateExecutionEvidence>
}

/** Execute one signed experiment cell through any declared exact-process provider. */
export function createExactProcessCandidateExperimentExecutor(
  options: CreateExactProcessCandidateExperimentExecutorOptions,
): ExactProcessCandidateExperimentExecutor {
  const provider = resolveAgentEnvironmentProvider(options.provider, options.providerRegistry)
  const executor = exactProcessProviderAsCandidateExecutor({
    provider,
    resources: options.resources,
    ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
    ...(options.provisionTimeoutMs === undefined
      ? {}
      : { provisionTimeoutMs: options.provisionTimeoutMs }),
    ...(options.recoveryRetentionMs === undefined
      ? {}
      : { recoveryRetentionMs: options.recoveryRetentionMs }),
  })
  return Object.freeze({
    executor,
    async execute(
      input: ExactProcessCandidateExperimentExecution,
    ): Promise<CandidateExecutionEvidence> {
      return await executeAgentCandidateExperimentCell({
        ...input,
        attempt: input.attempt ?? 1,
        executionId: input.executionId,
        executionRoots: input.executionRoots,
        stagingRoots: input.stagingRoots,
        ports: options.ports,
        ...(input.preparation ? { preparation: input.preparation } : {}),
        execution: {
          executor,
          grader: options.grader,
          outputArtifacts: options.outputArtifacts,
          traceStore: options.traceStore,
          claimStore: options.claimStore,
          ...(options.cleanupTimeoutMs === undefined
            ? {}
            : { cleanupTimeoutMs: options.cleanupTimeoutMs }),
          ...(options.resultTimeoutMs === undefined
            ? {}
            : { resultTimeoutMs: options.resultTimeoutMs }),
        },
      })
    },
  })
}
