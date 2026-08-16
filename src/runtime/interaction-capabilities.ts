import type { RequestedInteractions } from '@tangle-network/agent-interface'
import type { AgentEnvironmentCapabilities } from '@tangle-network/agent-interface/environment-provider'

/**
 * Check one turn's interaction request before the provider can dispatch it.
 *
 * A requested interaction is durable only when the provider can replay its
 * event and safely replay the response command. An unsupported request fails
 * before environment creation or dispatch begins.
 */
export function assertRequestedInteractionCapabilities(
  providerName: string,
  requested: RequestedInteractions | undefined,
  capabilities: AgentEnvironmentCapabilities,
): void {
  const requestedKinds = Object.entries(requested ?? {}).map(([kind]) => kind)
  if (requestedKinds.length === 0) return

  const interactions = capabilities.interactions
  if (!interactions) {
    throw new Error(
      `provider "${providerName}" does not support requested interactions: ${requestedKinds.join(', ')}`,
    )
  }
  const unsupportedKinds = requestedKinds.filter((kind) => !interactions.kinds.includes(kind))
  if (unsupportedKinds.length > 0) {
    throw new Error(
      `provider "${providerName}" does not support requested interaction kinds: ${unsupportedKinds.join(', ')}`,
    )
  }
  if (interactions.replay !== true || interactions.responseIdempotency !== true) {
    throw new Error(
      `provider "${providerName}" cannot safely dispatch requested interactions without replay and response idempotency`,
    )
  }
}
