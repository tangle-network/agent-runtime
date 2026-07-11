import type { Sha256Digest } from '@tangle-network/agent-interface'

import type { AgentCandidateExecutionClaim, AgentCandidateExecutionTerminalRecord } from './claim'

export const CLAIM_FORMAT_VERSION = 7
export const PENDING_FORMAT_VERSION = 1
export const TERMINAL_FORMAT_VERSION = 3
export const PHASE_FORMAT_VERSION = 1

export interface PersistedAgentCandidateExecutionClaim extends AgentCandidateExecutionClaim {
  version: typeof CLAIM_FORMAT_VERSION
  phase: 'claimed'
  leaseDigest: Sha256Digest
}

export interface PersistedAgentCandidateExecutionPending {
  version: typeof PENDING_FORMAT_VERSION
  kind: 'candidate-execution-pending-terminal'
  terminal: AgentCandidateExecutionTerminalRecord
}

export interface PersistedAgentCandidateExecutionPhase {
  version: typeof PHASE_FORMAT_VERSION
  kind: 'candidate-execution-phase'
  executionId: string
  attempt: number
  executionPlanDigest: Sha256Digest
  phase: 'candidate-may-run'
}

export interface PersistedAgentCandidateExecutionTerminal {
  version: typeof TERMINAL_FORMAT_VERSION
  terminal: AgentCandidateExecutionTerminalRecord
}
