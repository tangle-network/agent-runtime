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
  const input = detachedSnapshot(raw, `${context}: AgentProfile input`)
  const profile = agentProfileSchema.parse(input)
  assertExecutableAgentProfile(profile, context)
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
  const profile = executableAgentProfileSnapshot(rawProfile, context)
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
