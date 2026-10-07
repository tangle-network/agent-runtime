import type { AgentProfile } from '@tangle-network/agent-interface'

/** Runtime-owned coordination is mounted under this MCP alias. */
export const coordinationMcpAlias = 'agent-runtime-coordination'

/** A profile declares Runtime-owned tools with this provider-neutral prefix. */
export const coordinationProfileToolPrefix = `${coordinationMcpAlias.replaceAll('-', '_')}_`

/** Remove Runtime-only grants and seat policy from the provider-facing profile. */
export function providerVisibleProfile(profile: AgentProfile): AgentProfile {
  const { seats: _seats, ...withoutSeats } = profile as AgentProfile & { seats?: unknown }
  if (profile.tools === undefined) return withoutSeats
  const providerTools = Object.fromEntries(
    Object.entries(profile.tools).filter(
      ([name]) => !name.startsWith(coordinationProfileToolPrefix),
    ),
  )
  if (Object.keys(providerTools).length === Object.keys(profile.tools).length) return withoutSeats
  if (Object.keys(providerTools).length > 0) return { ...withoutSeats, tools: providerTools }
  const { tools: _runtimeTools, ...withoutTools } = withoutSeats
  return withoutTools
}
