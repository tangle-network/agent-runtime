import type { AgentCandidateExecutionPorts, PreparedAgentCandidateExecution } from './types'

export interface PreparedCandidateState {
  ports: AgentCandidateExecutionPorts
}

const stateByExecution = new WeakMap<PreparedAgentCandidateExecution, PreparedCandidateState>()

export function recordPreparedCandidateState(
  prepared: PreparedAgentCandidateExecution,
  state: PreparedCandidateState,
): void {
  stateByExecution.set(prepared, state)
}

export function getPreparedCandidateState(
  prepared: PreparedAgentCandidateExecution,
): PreparedCandidateState {
  const state = stateByExecution.get(prepared)
  if (!state) throw new Error('execution must come from prepareAgentCandidateExecution')
  return state
}
