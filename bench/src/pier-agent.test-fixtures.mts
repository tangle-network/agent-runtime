import type { StagedPierCandidateExecution } from './pier-agent'

export function createStagedPierCandidateExecutionFixture(
  executionId: string,
): StagedPierCandidateExecution {
  const directory = `/tmp/agent-bench-pier-test/${encodeURIComponent(executionId)}`
  return {
    executionId,
    directory,
    taskDirectory: `${directory}/task`,
    candidateDirectory: `${directory}/candidate`,
    profileDirectory: `${directory}/profile`,
    planPath: `${directory}/execution-plan.json`,
    receiptPath: `${directory}/materialization-receipt.json`,
    agentArgs: ['--agent', 'pier_agents.tangle_candidate:TangleCandidateAgent'],
    evaluatorEnv: {},
    attemptArgs: ['--n-attempts', '1', '--max-retries', '0'],
  }
}
