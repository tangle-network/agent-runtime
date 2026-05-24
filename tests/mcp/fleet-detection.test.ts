import type { SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import type { LoopSandboxClient } from '../../src/loops'
import { detectExecutor } from '../../src/mcp/bin-helpers'
import type { FleetHandle } from '../../src/mcp/executor'

function stubClient(): LoopSandboxClient {
  return {
    async create(): Promise<SandboxInstance> {
      return null as unknown as SandboxInstance
    },
  }
}

function stubFleet(fleetId: string, ids: string[]): FleetHandle {
  return {
    fleetId,
    ids,
    async sandbox() {
      return null as unknown as SandboxInstance
    },
  }
}

describe('detectExecutor', () => {
  it('picks the sibling executor when TANGLE_FLEET_ID is unset', async () => {
    const executor = await detectExecutor({ sandboxClient: stubClient(), env: {} })
    expect(executor.describe()).toMatch(/sibling-sandbox/)
  })

  it('treats whitespace-only TANGLE_FLEET_ID as unset', async () => {
    const executor = await detectExecutor({
      sandboxClient: stubClient(),
      env: { TANGLE_FLEET_ID: '   ' },
    })
    expect(executor.describe()).toMatch(/sibling-sandbox/)
  })

  it('picks the fleet executor when TANGLE_FLEET_ID is set and a handle resolves', async () => {
    const fleet = stubFleet('fl_42', ['coordinator', 'worker-1', 'worker-2'])
    const executor = await detectExecutor({
      sandboxClient: stubClient(),
      env: { TANGLE_FLEET_ID: 'fl_42' },
      resolveFleet: async (_client, fleetId) => {
        expect(fleetId).toBe('fl_42')
        return fleet
      },
    })
    expect(executor.describe()).toMatch(/fleet-workspace/)
    expect(executor.describe()).toMatch(/fleetId=fl_42/)
  })

  it('passes TANGLE_FLEET_EXCLUDE_MACHINES into the fleet executor', async () => {
    const fleet = stubFleet('fl_a', ['coordinator', 'worker-1'])
    const executor = await detectExecutor({
      sandboxClient: stubClient(),
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
    const client = {
      async create(): Promise<SandboxInstance> {
        return null as unknown as SandboxInstance
      },
      fleets: {
        async get(id: string): Promise<FleetHandle> {
          observedFleetId = id
          return fleet
        },
      },
    } as unknown as LoopSandboxClient

    const executor = await detectExecutor({
      sandboxClient: client,
      env: { TANGLE_FLEET_ID: 'fl_z' },
    })
    expect(observedFleetId).toBe('fl_z')
    expect(executor.describe()).toMatch(/fleetId=fl_z/)
  })

  it('throws when the client lacks .fleets.get but TANGLE_FLEET_ID is set', async () => {
    await expect(
      detectExecutor({
        sandboxClient: stubClient(),
        env: { TANGLE_FLEET_ID: 'fl_missing' },
      }),
    ).rejects.toThrow(/does not expose `\.fleets\.get`/)
  })

  it('throws when the fleet handle is structurally incompatible', async () => {
    const client = {
      async create(): Promise<SandboxInstance> {
        return null as unknown as SandboxInstance
      },
      fleets: {
        async get(): Promise<unknown> {
          return { fleetId: 'fl_bad' /* missing ids + sandbox() */ }
        },
      },
    } as unknown as LoopSandboxClient

    await expect(
      detectExecutor({
        sandboxClient: client,
        env: { TANGLE_FLEET_ID: 'fl_bad' },
      }),
    ).rejects.toThrow(/incompatible sandbox SDK shape/)
  })

  it('throws when fleets.get returns null', async () => {
    const client = {
      async create(): Promise<SandboxInstance> {
        return null as unknown as SandboxInstance
      },
      fleets: {
        async get(): Promise<unknown> {
          return null
        },
      },
    } as unknown as LoopSandboxClient

    await expect(
      detectExecutor({
        sandboxClient: client,
        env: { TANGLE_FLEET_ID: 'fl_null' },
      }),
    ).rejects.toThrow(/returned no handle/)
  })
})
