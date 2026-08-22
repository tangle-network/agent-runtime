import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { assertExecutableAgentProfile } from './model-policy'
import { detachedSnapshot } from './snapshot'
import type { AgentSpec } from './types'

/**
 * Parse one untrusted profile into the exact immutable value execution may consume.
 *
 * Snapshotting before schema parsing reads caller-owned fields once. Snapshotting the parsed
 * result prevents downstream custom code from changing any identity or authority field.
 */
export function executableAgentProfileSnapshot(raw: unknown, context: string): AgentProfile {
  const profile = authoredAgentProfileSnapshot(raw, context)
  assertExecutableAgentProfile(profile, context)
  return profile
}

/**
 * Parse and seal a profile as authored, without requiring it to select a harness and model.
 *
 * This is the intake for a leaf whose behavior is code the caller already built: a verbatim
 * `AgentSpec.executor`. Such an executor receives only the task and a signal, so no registry,
 * harness, or backend reads the profile after intake, and there is no ambient fill to refuse. The
 * profile still parses and still digests into the node's identity; it is simply not obliged to
 * claim a model that nothing runs. A graph script node is the canonical case.
 */
export function authoredAgentProfileSnapshot(raw: unknown, context: string): AgentProfile {
  const input = detachedSnapshot(raw, `${context}: AgentProfile input`)
  const profile = agentProfileSchema.parse(input)
  return detachedSnapshot(profile, `${context}: parsed AgentProfile`)
}

/** Snapshot an executable spec while retaining trusted callbacks by reference. */
export function executableAgentSpecSnapshot(raw: AgentSpec, context: string): AgentSpec {
  const {
    profile: rawProfile,
    harness,
    execution: rawExecution,
    ...runtimeExtensions
  } = raw as AgentSpec & Readonly<Record<string, unknown>>
  // Only a spec the kernel must resolve (a factory, a harness, or the router) needs an executable
  // identity; see `authoredAgentProfileSnapshot` for why a verbatim executor does not.
  const profile =
    raw.executor === undefined
      ? executableAgentProfileSnapshot(rawProfile, context)
      : authoredAgentProfileSnapshot(rawProfile, context)
  const execution =
    rawExecution === undefined
      ? undefined
      : detachedSnapshot(rawExecution, `${context}: execution attribution`)
  return Object.freeze({
    ...runtimeExtensions,
    profile,
    harness,
    ...(execution === undefined ? {} : { execution }),
  }) as AgentSpec
}
