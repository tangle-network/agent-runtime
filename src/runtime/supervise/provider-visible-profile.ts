import type { AgentProfile } from '@tangle-network/agent-interface'

/** Runtime-owned coordination is mounted under this MCP alias. */
export const coordinationMcpAlias = 'agent-runtime-coordination'

/** A profile declares Runtime-owned tools with this provider-neutral prefix. */
export const coordinationProfileToolPrefix = `${coordinationMcpAlias.replaceAll('-', '_')}_`

/** The metadata key under which the root of a `run_graph` subtask carries its graph's topology.
 *  Runtime writes it; `spawn_worker` refuses a profile that carries it. */
export const runtimeGraphMetadataKey = 'agentRuntimeGraph'

/** Remove Runtime-only grants, seat policy and graph topology from the provider-facing profile. */
export function providerVisibleProfile(profile: AgentProfile): AgentProfile {
  const { seats: _seats, ...withoutSeats } = profile as AgentProfile & { seats?: unknown }
  const visible = withoutRuntimeGraph(withoutSeats)
  if (profile.tools === undefined) return visible
  const providerTools = Object.fromEntries(
    Object.entries(profile.tools).filter(
      ([name]) => !name.startsWith(coordinationProfileToolPrefix),
    ),
  )
  if (Object.keys(providerTools).length === Object.keys(profile.tools).length) return visible
  if (Object.keys(providerTools).length > 0) return { ...visible, tools: providerTools }
  const { tools: _runtimeTools, ...withoutTools } = visible
  return withoutTools
}

function withoutRuntimeGraph(profile: AgentProfile): AgentProfile {
  const source = profile.metadata
  if (source === undefined || source[runtimeGraphMetadataKey] === undefined) return profile
  const { [runtimeGraphMetadataKey]: _graph, ...metadata } = source
  if (Object.keys(metadata).length > 0) return { ...profile, metadata }
  const { metadata: _metadata, ...withoutMetadata } = profile
  return withoutMetadata
}
