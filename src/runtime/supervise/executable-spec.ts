import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { isRuntimeFlowAgent } from './flow-brain'
import { assertExecutableAgentProfile } from './model-policy'
import { detachedSnapshot } from './snapshot'
import type { AgentSpec } from './types'

/** Read untrusted fields once, then parse and seal the exact executable profile. */
export function executableAgentProfileSnapshot(raw: unknown, context: string): AgentProfile {
  const profile = authoredAgentProfileSnapshot(raw, context)
  assertExecutableAgentProfile(profile, context)
  return profile
}

/** Seal code-owned behavior without inventing a model: verbatim executors and owned flow drivers. */
function authoredAgentProfileSnapshot(raw: unknown, context: string): AgentProfile {
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
  // Only model-backed resolution requires an executable model identity.
  const profile =
    raw.executor === undefined && !isRuntimeFlowAgent(runtimeExtensions.driver)
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
