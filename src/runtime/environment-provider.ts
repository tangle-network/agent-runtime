import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { CreateSandboxOptions, SandboxInstance } from '@tangle-network/sandbox'
import { ValidationError } from './environment-provider-adapters'
import { createInputFromSandboxOptions } from './environment-provider-input'
import { environmentAsSandboxInstance } from './environment-provider-to-sandbox'
import type { SandboxClient } from './types'

export type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentQuery,
  AgentEnvironmentStatus,
  AgentEnvironmentSummary,
  AgentProfileRef,
  AgentSession,
  AgentSessionRef,
  AgentSessionStatus,
  AgentTurnInput,
  AgentTurnResult,
  CheckpointRef,
  CheckpointRequest,
  CreateAgentEnvironmentInput,
  ExecRequest,
  ExecResult,
  ForkRequest,
  PlacementInfo,
  ResourceRequest,
  WorkspaceRequest,
} from '@tangle-network/agent-interface/environment-provider'
export type { ResolveSandboxProfile } from './environment-provider-input'
export {
  type SandboxClientProviderOptions,
  sandboxClientAsProvider,
} from './environment-provider-sandbox'
export {
  type CreateTangleSandboxExactProcessProviderOptions,
  createTangleSandboxExactProcessProvider,
} from './tangle-sandbox-exact-process-provider'

/** Provider object or registry name accepted by runtime provider adapters. @experimental */
export type AgentEnvironmentProviderRef = AgentEnvironmentProvider | string

/** In-memory registry for named agent environment provider instances. @experimental */
export interface AgentEnvironmentProviderRegistry {
  register(provider: AgentEnvironmentProvider, options?: { replace?: boolean }): void
  has(name: string): boolean
  get(name: string): AgentEnvironmentProvider | undefined
  require(name: string): AgentEnvironmentProvider
  names(): string[]
  providers(): AgentEnvironmentProvider[]
  capabilities(name: string): Promise<AgentEnvironmentCapabilities>
}

/** Create a registry that resolves provider names to concrete provider instances. @experimental */
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
    has: (name) => entries.has(name),
    get: (name) => entries.get(name),
    require(name) {
      const provider = entries.get(name)
      if (provider) return provider
      const available = Array.from(entries.keys()).sort()
      const suffix = available.length > 0 ? `; available: ${available.join(', ')}` : ''
      throw new ValidationError(
        `agent environment provider registry: provider "${name}" is not registered${suffix}`,
      )
    },
    names: () => Array.from(entries.keys()).sort(),
    providers: () => registry.names().map((name) => registry.require(name)),
    async capabilities(name) {
      return registry.require(name).capabilities()
    },
  }
  for (const provider of providers) registry.register(provider)
  return registry
}

/** Resolve a provider instance or registry name, failing loudly when a name is unknown. @experimental */
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

/** Options for exposing an environment provider through the legacy Sandbox client port. @experimental */
export interface ProviderAsSandboxClientOptions {
  defaults?: Partial<CreateAgentEnvironmentInput>
  requireTerminalEvent?: boolean
  /** Require declared live continuation plus concrete session controls. */
  requireSession?: boolean
  mapCreateOptions?: (
    options: CreateSandboxOptions | undefined,
  ) => Partial<CreateAgentEnvironmentInput>
}

/** Adapt an environment provider to the Sandbox client shape used by existing loop paths. @experimental */
export function providerAsSandboxClient(
  provider: AgentEnvironmentProvider,
  options: ProviderAsSandboxClientOptions = {},
): SandboxClient {
  return {
    async create(createOptions?: CreateSandboxOptions): Promise<SandboxInstance> {
      const defaults = options.defaults ?? {}
      const sandboxInput = createInputFromSandboxOptions(createOptions)
      const customInput = options.mapCreateOptions?.(createOptions) ?? {}
      const mapped = {
        ...defaults,
        ...sandboxInput,
        ...customInput,
        providerOptions: {
          ...(defaults.providerOptions ?? {}),
          ...(sandboxInput.providerOptions ?? {}),
          ...(customInput.providerOptions ?? {}),
        },
      }
      if (mapped.backend === undefined) delete mapped.backend
      if (mapped.profile === undefined) {
        throw new ValidationError(
          `providerAsSandboxClient(${provider.name}): profile required in defaults or CreateSandboxOptions.backend.profile`,
        )
      }
      if (options.requireSession) {
        const capabilities = await provider.capabilities()
        if (!capabilities.streaming.live || !capabilities.sessions.continue) {
          throw new ValidationError(
            `providerAsSandboxClient(${provider.name}): live session continuation is required`,
          )
        }
      }
      const environment = await provider.create(mapped as CreateAgentEnvironmentInput)
      if (options.requireSession && !environment.session) {
        await environment.destroy?.()
        throw new ValidationError(
          `providerAsSandboxClient(${provider.name}): session() is required`,
        )
      }
      return environmentAsSandboxInstance(environment, {
        requireTerminalEvent: options.requireTerminalEvent ?? true,
      })
    },
  }
}

export { type ProviderExecutorOptions, providerAsExecutor } from './environment-provider-executor'
