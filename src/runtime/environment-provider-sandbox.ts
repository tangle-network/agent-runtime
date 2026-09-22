import type {
  AgentProfileValidationResult,
  AgentRunControlRef,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
  AgentEnvironmentQuery,
  AgentEnvironmentSummary,
  AgentProfileRef,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { BackendType, CreateSandboxOptions } from '@tangle-network/sandbox'
import {
  type ResolveSandboxProfile,
  sandboxOptionsFromCreateInput,
} from './environment-provider-input'
import { sandboxInstanceAsEnvironment } from './sandbox-to-environment'
import {
  defaultTangleSandboxCapabilities,
  downgradeSandboxCapabilities,
  hasGet,
  hasList,
  readBoxMetadata,
  readBoxStatus,
  statusFromUnknown,
} from './environment-provider-support'
import type { SandboxClient } from './types'

/** Options for wrapping a current Sandbox client as an environment provider. @experimental */
export interface SandboxClientProviderOptions {
  name?: string
  defaultBackend?: BackendType
  capabilities?:
    | AgentEnvironmentCapabilities
    | (() => AgentEnvironmentCapabilities | Promise<AgentEnvironmentCapabilities>)
  validateProfile?: (
    profile: AgentProfileRef,
  ) => AgentProfileValidationResult | Promise<AgentProfileValidationResult>
  /** Resolve a named profile before calling Sandbox, which accepts inline profiles only. */
  resolveProfile?: ResolveSandboxProfile
  mapCreateInput?: (input: CreateAgentEnvironmentInput) => CreateSandboxOptions
  stableEventIdentity?: boolean
  exactControlRef?: boolean
}

/** Adapt a Sandbox client into the shared agent environment provider contract. @experimental */
export function sandboxClientAsProvider(
  client: SandboxClient,
  options: SandboxClientProviderOptions = {},
): AgentEnvironmentProvider {
  const providerName = options.name ?? 'tangle-sandbox'
  const knownControlRefs = new Map<string, AgentRunControlRef>()
  const exactControlRef = options.exactControlRef === true
  const provider: AgentEnvironmentProvider & {
    readonly supportsPortableContextTransfer: false
    readonly supportsStableEventIdentity: boolean
  } = {
    name: providerName,
    supportsPortableContextTransfer: false,
    supportsStableEventIdentity: options.stableEventIdentity === true,
    capabilities: async () => {
      const declared = options.capabilities
        ? typeof options.capabilities === 'function'
          ? options.capabilities()
          : options.capabilities
        : defaultTangleSandboxCapabilities({
            namedProfiles: options.resolveProfile !== undefined,
            reconstructable: hasGet(client),
          })
      return downgradeSandboxCapabilities(await declared)
    },
    ...(options.validateProfile ? { validateProfile: options.validateProfile } : {}),
    async create(input): Promise<AgentEnvironment> {
      const createOptions =
        options.mapCreateInput?.(input) ??
        (await sandboxOptionsFromCreateInput(
          input,
          options.defaultBackend ?? 'opencode',
          options.resolveProfile,
        ))
      const box = await client.create(createOptions)
      return sandboxInstanceAsEnvironment(
        box,
        providerName,
        client,
        knownControlRefs,
        exactControlRef,
      )
    },
    ...(hasGet(client)
      ? {
          async get(id: string): Promise<AgentEnvironment | null> {
            const box = await client.get(id)
            return box
              ? sandboxInstanceAsEnvironment(
                  box,
                  providerName,
                  client,
                  knownControlRefs,
                  exactControlRef,
                )
              : null
          },
        }
      : {}),
    ...(hasList(client)
      ? {
          async list(query?: AgentEnvironmentQuery): Promise<AgentEnvironmentSummary[]> {
            const boxes = await client.list(query?.providerOptions)
            return boxes.map((box) => ({
              id: String(box.id),
              provider: providerName,
              name: typeof box.name === 'string' ? box.name : undefined,
              status: statusFromUnknown(readBoxStatus(box)),
              metadata: readBoxMetadata(box),
            }))
          },
        }
      : {}),
  }
  return provider
}
