import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'

export type * from '@tangle-network/agent-interface/environment-provider'

class ValidationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ValidationError'
  }
}

/** Provider object or registry name accepted by runtime APIs. */
export type AgentEnvironmentProviderRef = AgentEnvironmentProvider | string

/** Named provider registry for runtime composition and configuration. */
export interface AgentEnvironmentProviderRegistry {
  register(provider: AgentEnvironmentProvider, options?: { replace?: boolean }): void
  has(name: string): boolean
  get(name: string): AgentEnvironmentProvider | undefined
  require(name: string): AgentEnvironmentProvider
  names(): string[]
  providers(): AgentEnvironmentProvider[]
  capabilities(name: string): Promise<AgentEnvironmentCapabilities>
}

/** Create a named registry for agent environment providers. */
export function createAgentEnvironmentProviderRegistry(
  providers: Iterable<AgentEnvironmentProvider> = [],
): AgentEnvironmentProviderRegistry {
  const entries = new Map<string, AgentEnvironmentProvider>()

  const registry: AgentEnvironmentProviderRegistry = {
    register(provider, options = {}): void {
      if (!provider.name) {
        throw new ValidationError('environment provider registry: provider.name is required')
      }
      if (!options.replace && entries.has(provider.name)) {
        throw new ValidationError(
          `environment provider registry: provider "${provider.name}" is already registered`,
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
      if (provider) return provider
      const available = Array.from(entries.keys()).sort()
      const suffix = available.length > 0 ? `; available: ${available.join(', ')}` : ''
      throw new ValidationError(
        `environment provider registry: provider "${name}" is not registered${suffix}`,
      )
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

/** Resolve an inline provider or a provider name from a registry. */
export function resolveAgentEnvironmentProvider(
  provider: AgentEnvironmentProviderRef,
  registry?: AgentEnvironmentProviderRegistry,
): AgentEnvironmentProvider {
  if (typeof provider !== 'string') return provider
  if (!registry) {
    throw new ValidationError(
      `environment provider "${provider}" requires an AgentEnvironmentProviderRegistry`,
    )
  }
  return registry.require(provider)
}
