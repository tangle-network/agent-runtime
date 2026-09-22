import type { SandboxClientLike } from '@tangle-network/agent-provider-tangle'
import { describe, expect, it } from 'vitest'
import { detectExecutor } from '../../src/mcp/bin-helpers'
import type { FleetHandle } from '../../src/mcp/executor'
import { inProcessEnvironmentProvider } from '../../src/runtime/in-process-environment-provider'

function stubProvider() {
  return inProcessEnvironmentProvider({
    name: 'test-provider',
    onTurn: () => [],
  })
}

function stubTangleClient(): SandboxClientLike {
  return {
    async create(): Promise<never> {
      throw new Error('not used')
    },
  }
}

function stubFleet(fleetId: string, ids: string[]): FleetHandle {
  return {
    fleetId,
    ids,
    async sandbox(): Promise<never> {
      throw new Error('not used')
    },
  }
}

describe('detectExecutor', () => {
  it('uses the configured provider when TANGLE_FLEET_ID is unset', async () => {
    const provider = stubProvider()
    const executor = await detectExecutor({ provider, env: {} })
    expect(executor.provider).toBe(provider)
    expect(executor.placement).toBe('provider')
    expect(executor.describe()).toBe('provider (test-provider)')
  })

  it('treats whitespace-only TANGLE_FLEET_ID as unset', async () => {
    const executor = await detectExecutor({
      provider: stubProvider(),
      env: { TANGLE_FLEET_ID: '   ' },
    })
    expect(executor.placement).toBe('provider')
  })

  it('picks the fleet executor when TANGLE_FLEET_ID is set and a handle resolves', async () => {
    const fleet = stubFleet('fl_42', ['coordinator', 'worker-1', 'worker-2'])
    const tangleClient = stubTangleClient()
    const executor = await detectExecutor({
      provider: stubProvider(),
      tangleClient,
      env: { TANGLE_FLEET_ID: 'fl_42' },
      resolveFleet: async (client, fleetId) => {
        expect(client).toBe(tangleClient)
        expect(fleetId).toBe('fl_42')
        return fleet
      },
    })
    expect(executor.placement).toBe('fleet')
    expect(executor.provider.name).toBe('tangle-fleet:fl_42')
    expect(executor.describe()).toMatch(/fleet \(id=fl_42/)
  })

  it('passes TANGLE_FLEET_EXCLUDE_MACHINES into the fleet executor', async () => {
    const fleet = stubFleet('fl_a', ['coordinator', 'worker-1'])
    const executor = await detectExecutor({
      provider: stubProvider(),
      tangleClient: stubTangleClient(),
      env: {
        TANGLE_FLEET_ID: 'fl_a',
        TANGLE_FLEET_EXCLUDE_MACHINES: 'coordinator,extra',
      },
      resolveFleet: async () => fleet,
    })
    expect(executor.describe()).toMatch(/excluded=\[coordinator,extra\]/)
  })

  it('uses the default fleet resolver against client.fleets.get', async () => {
    const fleet = stubFleet('fl_z', ['m1'])
    let observedFleetId: string | undefined
    const tangleClient: SandboxClientLike & {
      fleets: { get(id: string): Promise<FleetHandle> }
    } = {
      async create(): Promise<never> {
        throw new Error('not used')
      },
      fleets: {
        async get(id: string): Promise<FleetHandle> {
          observedFleetId = id
          return fleet
        },
      },
    }

    const executor = await detectExecutor({
      provider: stubProvider(),
      tangleClient,
      env: { TANGLE_FLEET_ID: 'fl_z' },
    })
    expect(observedFleetId).toBe('fl_z')
    expect(executor.describe()).toMatch(/fleet \(id=fl_z/)
  })

  it('throws when TANGLE_FLEET_ID is set without a Tangle client', async () => {
    await expect(
      detectExecutor({
        provider: stubProvider(),
        env: { TANGLE_FLEET_ID: 'fl_missing_client' },
      }),
    ).rejects.toThrow(/requires a Tangle Sandbox client/)
  })

  it('throws when the client lacks .fleets.get but TANGLE_FLEET_ID is set', async () => {
    await expect(
      detectExecutor({
        provider: stubProvider(),
        tangleClient: stubTangleClient(),
        env: { TANGLE_FLEET_ID: 'fl_missing' },
      }),
    ).rejects.toThrow(/does not expose `\.fleets\.get`/)
  })

  it('throws when the fleet handle is structurally incompatible', async () => {
    const tangleClient: SandboxClientLike & {
      fleets: { get(): Promise<unknown> }
    } = {
      async create(): Promise<never> {
        throw new Error('not used')
      },
      fleets: {
        async get(): Promise<unknown> {
          return { fleetId: 'fl_bad' /* missing ids + sandbox() */ }
        },
      },
    }

    await expect(
      detectExecutor({
        provider: stubProvider(),
        tangleClient,
        env: { TANGLE_FLEET_ID: 'fl_bad' },
      }),
    ).rejects.toThrow(/incompatible sandbox SDK shape/)
  })

  it('throws when fleets.get returns null', async () => {
    const tangleClient: SandboxClientLike & {
      fleets: { get(): Promise<unknown> }
    } = {
      async create(): Promise<never> {
        throw new Error('not used')
      },
      fleets: {
        async get(): Promise<unknown> {
          return null
        },
      },
    }

    await expect(
      detectExecutor({
        provider: stubProvider(),
        tangleClient,
        env: { TANGLE_FLEET_ID: 'fl_null' },
      }),
    ).rejects.toThrow(/returned no handle/)
  })
})
