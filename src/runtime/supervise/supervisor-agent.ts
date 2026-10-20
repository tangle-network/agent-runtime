import { ValidationError } from '../../errors'
import { buildSupervisorAgent } from './supervisor-agent-build'
import type { SupervisorAgentDeps, SupervisorAgentTestDeps } from './supervisor-agent-contracts'
import type { SupervisorProfile } from './supervisor-agent-profile'
import type { Agent } from './types'

/**
 * `supervisorAgent` — build a supervisor `Agent` FROM its profile. The brain is resolved from
 * `profile.harness` exactly as `createExecutor({ backend })` resolves a worker: backend-as-data,
 * no hand-built brain. The supervisor stops being special — it's one profile, materialized by the
 * same resolution rule as every other agent.
 *
 *  - `harness` omitted or `cli-base` → the in-process router tool-loop: `driverAgent` over the
 *    canonical `ToolLoopChat`, built by `routerBrain` from the profile's model + the router seam.
 *  - `harness` a coding CLI (`claude-code`/`opencode`/`codex`/…) → an EXTERNAL harness drives the
 *    coordination verbs: `serveCoordinationMcp` exposes spawn/await/steer/stop over the live scope,
 *    and the caller's `driveHarness` runs the harness with that MCP mounted. `supervise()` builds
 *    this automatically only for a local bridge; a remote sandbox needs an explicit reachable
 *    relay or tunnel. The harness IS the brain.
 *
 * Both arms spawn children through the SAME `makeWorkerAgent` seam and apply the SAME independent
 * deliverable check to direct submissions. Raw driver prose is never quality-accepted.
 */

export {
  coordinationMcpAlias,
  coordinationProfileToolPrefix,
  providerVisibleProfile,
} from './provider-visible-profile'
export type {
  CoordinationBinding,
  CoordinationToolFace,
  CoordinationVerbs,
  DriveHarness,
  DriveHarnessOwnerContext,
  ObserveSupervisorNodeEvent,
  ResolveDriveHarness,
  ResolveSupervisorTools,
  SupervisorAgentDeps,
  SupervisorAgentTestDeps,
  SupervisorNodeContext,
  SupervisorNodeContextSeed,
  SupervisorToolDescriptor,
  SupervisorToolInvocationContext,
} from './supervisor-agent-contracts'
export type { ResolvedSupervisorProfile, SupervisorProfile } from './supervisor-agent-profile'
export {
  assertNoReservedCoordinationMcpAlias,
  declaredRuntimeToolNames,
  ownSubmissionDeliverable,
  resolveSupervisorModelId,
  resolveSupervisorProfile,
  runtimeToolDeclarationError,
} from './supervisor-agent-profile'
export { assertCoordinationBinding } from './supervisor-router-config'

/** Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness`
 * (backend-as-data), the same resolution rule as every worker. */
export function supervisorAgent(
  profile: SupervisorProfile,
  deps: SupervisorAgentDeps,
): Agent<unknown, unknown> {
  if ('brain' in deps) {
    throw new ValidationError(
      'supervisorAgent: direct brain injection is test-only; production execution derives the model call from AgentProfile',
    )
  }
  return buildSupervisorAgent(profile, deps)
}

/** Scripted-brain construction for deterministic tests. Not exported from Runtime's main entry. */
export function supervisorAgentWithTestBrain(
  profile: SupervisorProfile,
  deps: SupervisorAgentTestDeps,
): Agent<unknown, unknown> {
  const { brain, ...runtimeDeps } = deps
  return buildSupervisorAgent(profile, runtimeDeps, brain)
}
