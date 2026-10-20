import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { ValidationError } from './validation-error'

/** Provider object or registry name accepted by runtime provider adapters.
 * @experimental */
export type AgentEnvironmentProviderRef = AgentEnvironmentProvider | string

/** In-memory registry for named `AgentEnvironmentProvider` instances.
 * @experimental */
export interface AgentEnvironmentProviderRegistry {
  register(provider: AgentEnvironmentProvider, options?: { replace?: boolean }): void
  has(name: string): boolean
  get(name: string): AgentEnvironmentProvider | undefined
  require(name: string): AgentEnvironmentProvider
  names(): string[]
  providers(): AgentEnvironmentProvider[]
  capabilities(name: string): Promise<AgentEnvironmentCapabilities>
}

/** Create a registry that resolves provider names to concrete provider instances.
 * @experimental */
export function createAgentEnvironmentProviderRegistry(
  providers: Iterable<AgentEnvironmentProvider> = [],
): AgentEnvironmentProviderRegistry {
  const entries = new Map<string, AgentEnvironmentProvider>()

  const registry: AgentEnvironmentProviderRegistry = {
    register(provider, options = {}): void {
      if (!provider.name) {
        throw new ValidationError('agent environment provider registry: provider.name required')
      }
      if (!options.replace && entries.has(provider.name)) {
        throw new ValidationError(
          `agent environment provider registry: provider "${provider.name}" already registered`,
        )
      }
      entries.set(provider.name, provider)
    },
    has(name): boolean {
      return entries.has(name)
    },
    get(name): AgentEnvironmentProvider | undefined {
      return entries.get(name)
    },
    require(name): AgentEnvironmentProvider {
      const provider = entries.get(name)
      if (!provider) {
        const available = Array.from(entries.keys()).sort()
        const suffix = available.length > 0 ? `; available: ${available.join(', ')}` : ''
        throw new ValidationError(
          `agent environment provider registry: provider "${name}" is not registered${suffix}`,
        )
      }
      return provider
    },
    names(): string[] {
      return Array.from(entries.keys()).sort()
    },
    providers(): AgentEnvironmentProvider[] {
      return registry.names().map((name) => registry.require(name))
    },
    async capabilities(name): Promise<AgentEnvironmentCapabilities> {
      return registry.require(name).capabilities()
    },
  }

  for (const provider of providers) registry.register(provider)
  return registry
}

/** Resolve a provider instance or registry name, failing loudly when a name is unknown.
 * @experimental */
export function resolveAgentEnvironmentProvider(
  provider: AgentEnvironmentProviderRef,
  registry?: AgentEnvironmentProviderRegistry,
): AgentEnvironmentProvider {
  if (typeof provider !== 'string') return provider
  if (!registry) {
    throw new ValidationError(
      `agent environment provider "${provider}" requires an AgentEnvironmentProviderRegistry`,
    )
  }
  return registry.require(provider)
}
