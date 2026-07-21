import {
  type AgentCandidateArtifactRef,
  agentCandidateArtifactRefSchema,
  type Sha256Digest,
} from '@tangle-network/agent-interface'

import type { AgentCandidateExecutionClaim, AgentCandidateExecutionTerminalRecord } from './claim'
import { immutableCandidateValue } from './digest'
import { assertExactObjectKeys } from './exact-object'

export interface AgentCandidatePreparationEvidence {
  readonly executionPlan: AgentCandidateArtifactRef
  readonly materializationReceipt: AgentCandidateArtifactRef
}

export function sealCandidatePreparationEvidence(
  value: unknown,
  executionPlanDigest: Sha256Digest,
): AgentCandidatePreparationEvidence {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('candidate execution preparation evidence must be an object')
  }
  const record = value as Record<string, unknown>
  assertExactObjectKeys(
    record,
    ['executionPlan', 'materializationReceipt'],
    'candidate execution preparation evidence',
  )
  const executionPlan = immutableCandidateValue(
    agentCandidateArtifactRefSchema.parse(record.executionPlan),
  )
  const materializationReceipt = immutableCandidateValue(
    agentCandidateArtifactRefSchema.parse(record.materializationReceipt),
  )
  if (executionPlan.sha256 !== executionPlanDigest) {
    throw new Error('candidate execution plan artifact digest does not match its claim')
  }
  return Object.freeze({ executionPlan, materializationReceipt })
}

export interface PersistedAgentCandidateExecutionClaim extends AgentCandidateExecutionClaim {
  phase: 'claimed'
  leaseDigest: Sha256Digest
}

export interface PersistedAgentCandidateExecutionPending {
  kind: 'candidate-execution-pending-terminal'
  terminal: AgentCandidateExecutionTerminalRecord
}

export interface PersistedAgentCandidateExecutionPhase {
  kind: 'candidate-execution-phase'
  executionId: string
  attempt: number
  executionPlanDigest: Sha256Digest
  phase: 'candidate-may-run'
}

export interface PersistedAgentCandidateExecutionTerminal {
  terminal: AgentCandidateExecutionTerminalRecord
}
