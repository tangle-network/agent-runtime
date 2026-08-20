import type { AgentRunOutcome } from '@tangle-network/sandbox/runtime'
import type { AgentTaskStatus, BackendErrorDetail } from '../types'
import type { DefaultVerdict } from './supervise/types'

/** The outcome carried by Runtime-owned Sandbox artifacts. */
export interface SandboxOutcomeCarrier {
  outcome?: AgentRunOutcome
}

/** Runtime's terminal projection of the public Sandbox outcome contract. */
export interface SandboxOutcomeProjection {
  status: AgentTaskStatus
  reason: string
  verdict: DefaultVerdict
  error?: BackendErrorDetail
}

/** Map the public Sandbox outcome to Runtime's stream and verdict vocabulary. */
export function projectSandboxOutcome(outcome: AgentRunOutcome): SandboxOutcomeProjection {
  if (outcome.status === 'success') {
    return {
      status: 'completed',
      reason: 'turn completed',
      verdict: { valid: true, score: 1 },
    }
  }

  const reason = outcome.error ?? 'Sandbox agent run failed'
  if (outcome.status === 'failed') {
    return {
      status: 'failed',
      reason,
      verdict: { valid: false, score: 0 },
      error: { kind: 'backend', message: reason },
    }
  }

  return {
    status: 'blocked',
    reason,
    verdict: { valid: false, score: 0 },
  }
}

/** Read an outcome that Runtime attached to one of its own executor artifacts. */
export function readSandboxOutcome(value: unknown): AgentRunOutcome | undefined {
  if (!value || typeof value !== 'object') return undefined
  const outcome = (value as SandboxOutcomeCarrier).outcome
  if (!outcome || typeof outcome !== 'object') return undefined
  return outcome
}
