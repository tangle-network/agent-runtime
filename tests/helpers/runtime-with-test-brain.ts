import type {
  AgentGraph,
  RunGraphOptions,
  RunGraphTestOptions,
} from '../../src/runtime/supervise/graph'
import {
  runGraphWithTestBrain,
  runGraph as runProfileGraph,
} from '../../src/runtime/supervise/graph'
import type { SuperviseOptions, SuperviseTestOptions } from '../../src/runtime/supervise/supervise'
import {
  supervise as superviseProfile,
  superviseWithTestBrain,
} from '../../src/runtime/supervise/supervise'
import type {
  SupervisorAgentDeps,
  SupervisorAgentTestDeps,
  SupervisorProfile,
} from '../../src/runtime/supervise/supervisor-agent'
import {
  supervisorAgent as profileSupervisorAgent,
  supervisorAgentWithTestBrain,
} from '../../src/runtime/supervise/supervisor-agent'

/** Route deterministic source tests through the explicit test-only brain entry. */
export function supervise(
  profile: SupervisorProfile,
  task: unknown,
  options: SuperviseOptions | SuperviseTestOptions,
) {
  return 'brain' in options
    ? superviseWithTestBrain(profile, task, options)
    : superviseProfile(profile, task, options)
}

/** Route deterministic graph tests through the explicit test-only brain entry. */
export function runGraph(graph: AgentGraph, options: RunGraphOptions | RunGraphTestOptions) {
  return 'brain' in options
    ? runGraphWithTestBrain(graph, options)
    : runProfileGraph(graph, options)
}

/** Route deterministic supervisor construction through the explicit test-only brain entry. */
export function supervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps | SupervisorAgentTestDeps,
) {
  return 'brain' in deps
    ? supervisorAgentWithTestBrain(profile, deps)
    : profileSupervisorAgent(profile, deps)
}
