import type {
  AgentEnvironmentProvider,
  PlacementInfo,
} from '@tangle-network/agent-interface/environment-provider'
import {
  createTangleProvider,
  type SandboxClientLike,
  type SandboxInstanceLike,
} from '@tangle-network/agent-provider-tangle'

/** Provider plus diagnostics used by the delegation server. */
export interface DelegationExecutor {
  readonly provider: AgentEnvironmentProvider
  readonly placement?: PlacementInfo['kind']
  describe(): string
}

/** Wrap an official provider for delegated work. */
export function createDelegationExecutor(provider: AgentEnvironmentProvider): DelegationExecutor {
  return {
    provider,
    placement: 'provider',
    describe(): string {
      return `provider (${provider.name})`
    },
  }
}

/** Existing Tangle fleet surface used by the MCP entrypoint. */
export interface FleetHandle {
  readonly fleetId: string
  readonly ids: ReadonlyArray<string>
  sandbox(machineId: string): Promise<SandboxInstanceLike>
}

export interface FleetWorkspaceExecutorOptions {
  fleet: FleetHandle
  selectMachine?: (call: { callIndex: number; ids: ReadonlyArray<string> }) => string
  excludeMachineIds?: ReadonlyArray<string>
}

/**
 * Run delegated environments on existing Tangle fleet machines while relying
 * on the maintained Tangle provider for all Sandbox-to-environment mapping.
 */
export function createFleetWorkspaceExecutor(
  options: FleetWorkspaceExecutorOptions,
): DelegationExecutor {
  const fleet = options.fleet
  const excluded = new Set(options.excludeMachineIds ?? [])
  const placementByEnvironmentId = new Map<string, string>()
  let callIndex = 0

  const client: SandboxClientLike = {
    async create(): Promise<SandboxInstanceLike> {
      const ids = fleet.ids.filter((id) => !excluded.has(id))
      if (ids.length === 0) {
        throw new Error(
          `agent-runtime: fleet ${fleet.fleetId} has no eligible machines (ids=[${fleet.ids.join(',')}], excluded=[${[...excluded].join(',')}])`,
        )
      }
      const machineId = options.selectMachine
        ? options.selectMachine({ callIndex, ids })
        : ids[callIndex % ids.length]
      callIndex += 1
      if (!machineId) {
        throw new Error('agent-runtime: fleet selectMachine returned an empty machine id')
      }
      const environment = await fleet.sandbox(machineId)
      placementByEnvironmentId.set(String(environment.id), machineId)
      return environment
    },
    describePlacement(environment): PlacementInfo {
      const environmentId = String(environment.id)
      return {
        kind: 'fleet',
        sandboxId: environmentId,
        fleetId: fleet.fleetId,
        machineId: placementByEnvironmentId.get(environmentId),
      }
    },
  }

  return {
    provider: createTangleProvider({
      client,
      name: `tangle-fleet:${fleet.fleetId}`,
    }),
    placement: 'fleet',
    describe(): string {
      const suffix = excluded.size > 0 ? `, excluded=[${[...excluded].join(',')}]` : ''
      return `fleet (id=${fleet.fleetId}, machines=[${fleet.ids.join(',')}]${suffix})`
    },
  }
}
