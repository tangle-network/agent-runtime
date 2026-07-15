import type {
  AgentCandidateExecutionPlanMaterial,
  AgentCandidateTaskRepository,
} from '@tangle-network/agent-interface'

/** Narrow the runtime's workspace-only task contract after schema validation. */
export function workspaceTaskRepository(
  task: AgentCandidateExecutionPlanMaterial['task'],
): AgentCandidateTaskRepository {
  if (task.outcome.kind !== 'workspace' || !task.repository) {
    throw new Error('candidate runtime requires a workspace outcome with repository provenance')
  }
  return task.repository
}
