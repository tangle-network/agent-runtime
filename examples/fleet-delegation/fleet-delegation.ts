// TANGLE_FLEET_ID flips delegation from sibling-sandbox to fleet-workspace dispatch. See README.md.

import type { AgentProfile } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import {
  createDelegationExecutor,
  createFleetWorkspaceExecutor,
  type FleetHandle,
} from '@tangle-network/agent-runtime/mcp'

type FleetMachine = Awaited<ReturnType<FleetHandle['sandbox']>>
type TangleClient = Parameters<typeof createTangleProvider>[0]['client']
const demoProfile: AgentProfile = { name: 'placement-demo' }

// ── 1. ENV WIRING ─────────────────────────────────────────────────────────
//
// The shell that launches `agent-runtime-mcp` for a sandbox-side agent
// chooses the dispatch mode via env.
const siblingEnv = {
  TANGLE_API_KEY: 'sk_sb_demo_placeholder',
  SANDBOX_BASE_URL: 'https://sandbox.tangle.tools',
  // No TANGLE_FLEET_ID means each delegation creates a fresh environment.
}
const fleetEnv = {
  TANGLE_API_KEY: 'sk_sb_demo_placeholder',
  SANDBOX_BASE_URL: 'https://sandbox.tangle.tools',
  TANGLE_FLEET_ID: 'test-fleet',
  // Coordinator machine the MCP server itself runs on — skip during
  // worker round-robin so the coordinator doesn't compete with itself.
  TANGLE_FLEET_EXCLUDE_MACHINES: 'coordinator-0',
}

// ── 2. EXECUTOR DEMO ──────────────────────────────────────────────────────
//
// Structural stub for the `FleetHandle` surface. The real
// The Tangle fleet SDK satisfies this interface directly.
function makeFleetStub(): FleetHandle {
  const machines = ['coordinator-0', 'worker-a', 'worker-b', 'worker-c']
  return {
    fleetId: 'test-fleet',
    ids: machines,
    async sandbox(machineId: string): Promise<FleetMachine> {
      return syntheticMachine(`sandbox-${machineId}`)
    },
  }
}

async function demoSiblingMode(): Promise<void> {
  console.log('— SIBLING MODE ————————————————————————————————')
  console.log(`env: ${describeEnv(siblingEnv)}`)
  const client: TangleClient = {
    create: async () => syntheticMachine('sibling-sandbox-xyz'),
  }
  const executor = createDelegationExecutor(createTangleProvider({ client }))
  console.log(`describe: ${executor.describe()}`)
  const environment = await executor.provider.create({ profile: demoProfile })
  const placement = await environment.placement?.()
  console.log(`dispatch[0] → placement=${placement?.kind} sandboxId=${placement?.sandboxId}`)
  await environment.destroy?.()
  console.log()
}

async function demoFleetMode(): Promise<void> {
  console.log('— FLEET MODE ——————————————————————————————————')
  console.log(`env: ${describeEnv(fleetEnv)}`)
  const fleet = makeFleetStub()
  const executor = createFleetWorkspaceExecutor({
    fleet,
    excludeMachineIds: ['coordinator-0'],
  })
  console.log(`describe: ${executor.describe()}`)
  // Three delegations — show the round-robin across worker-a/b/c.
  for (let i = 0; i < 3; i++) {
    const environment = await executor.provider.create({ profile: demoProfile })
    const placement = await environment.placement?.()
    console.log(
      `dispatch[${i}] → placement=${placement?.kind} fleetId=${placement?.fleetId} ` +
        `machineId=${placement?.machineId} sandboxId=${placement?.sandboxId}`,
    )
    await environment.destroy?.()
  }
  console.log()
}

function syntheticMachine(id: string): FleetMachine {
  return {
    id,
    async *streamPrompt() {},
  }
}

function describeEnv(env: Record<string, string>): string {
  // Render in a single line, redacting secrets to a fingerprint.
  const entries = Object.entries(env).map(([k, v]) => {
    const display = k === 'TANGLE_API_KEY' ? `${v.slice(0, 8)}…` : v
    return `${k}=${display}`
  })
  return entries.join(' ')
}

async function main(): Promise<void> {
  await demoSiblingMode()
  await demoFleetMode()

  console.log('— TOPOLOGY ————————————————————————————————————')
  console.log(`
    Sibling                          Fleet
    ──────                           ─────
    parent sandbox                   coordinator-0  (excluded)
       │                                │
       │ delegate_*                     │ delegate_*
       ▼                                ▼
    fresh sibling                    worker-a  ←─┐
    fresh sibling                    worker-b  ←─┤  round-robin
    fresh sibling                    worker-c  ←─┘
                                       │
                                       └─ all three share the same
                                          fleet workspace; diffs land
                                          on the coordinator's FS in place
`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
