/**
 * Fleet-aware delegation — how `TANGLE_FLEET_ID` flips
 * `agent-runtime-mcp` from sibling-sandbox dispatch into
 * fleet-workspace dispatch.
 *
 * Two parts:
 *
 *   1. ENV WIRING — the shell that launches `agent-runtime-mcp` for a
 *      sandbox-side agent sets `TANGLE_FLEET_ID` to the parent fleet's id
 *      and (optionally) `TANGLE_FLEET_EXCLUDE_MACHINES=...` so workers don't
 *      land on the coordinator machine. With the env set, the bin's
 *      `detectExecutor` resolves to `createFleetWorkspaceExecutor` instead
 *      of `createSiblingSandboxExecutor`, and every `delegate_code` /
 *      `delegate_research` call dispatches to an existing machine in the
 *      fleet — worker diffs land on the caller's filesystem directly.
 *
 *   2. EXECUTOR DEMO — instantiate `createFleetWorkspaceExecutor` against
 *      a structural `FleetHandle` stub so the resolved `LoopSandboxClient`
 *      can be inspected without instantiating the real sandbox SDK. The
 *      demo round-robins three machine ids, records the placement tag the
 *      kernel reads, and prints the dispatch decisions.
 *
 * Source pointer: `src/mcp/executor.ts` — `createFleetWorkspaceExecutor`
 * is the production entry point; the bin (`src/mcp/bin.ts`) reads
 * `TANGLE_FLEET_ID` and calls it.
 *
 * Run with:
 *   pnpm tsx examples/fleet-delegation/fleet-delegation.ts
 */

import type { LoopSandboxClient } from '@tangle-network/agent-runtime/loops'
import {
  createFleetWorkspaceExecutor,
  createSiblingSandboxExecutor,
  type FleetHandle,
} from '@tangle-network/agent-runtime/mcp'
import type { SandboxInstance } from '@tangle-network/sandbox'

// ── 1. ENV WIRING ─────────────────────────────────────────────────────────
//
// The shell that launches `agent-runtime-mcp` for a sandbox-side agent
// chooses the dispatch mode via env.
const SIBLING_ENV = {
  TANGLE_API_KEY: 'sk_sb_demo_placeholder',
  SANDBOX_BASE_URL: 'https://sandbox.tangle.tools',
  // No TANGLE_FLEET_ID → sibling-sandbox mode. Each delegation spawns a
  // fresh sandbox via `sandboxClient.create()`.
}
const FLEET_ENV = {
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
// `@tangle-network/sandbox` `SandboxFleet` satisfies this interface
// one-for-one (`fleetId`, `ids`, `sandbox(id) → Promise<SandboxInstance>`).
function makeFleetStub(): FleetHandle {
  const machines = ['coordinator-0', 'worker-a', 'worker-b', 'worker-c']
  return {
    fleetId: 'test-fleet',
    ids: machines,
    async sandbox(machineId: string): Promise<SandboxInstance> {
      // The real implementation returns a SandboxInstance bound to the
      // shared workspace; here we synthesize one with just the fields the
      // executor reads (`id`).
      return { id: `sandbox-${machineId}` } as unknown as SandboxInstance
    },
  }
}

async function demoSiblingMode(): Promise<void> {
  console.log('— SIBLING MODE ————————————————————————————————')
  console.log(`env: ${describeEnv(SIBLING_ENV)}`)
  // Sibling mode wraps an existing LoopSandboxClient (the raw sandbox SDK).
  // We synthesise a tiny stub here just to show the tagging shape; in
  // production this is `new Sandbox({ apiKey })`.
  const underlying: LoopSandboxClient = {
    async create(): Promise<SandboxInstance> {
      return { id: 'sibling-sandbox-xyz' } as unknown as SandboxInstance
    },
  }
  const executor = createSiblingSandboxExecutor({ client: underlying })
  console.log(`describe: ${executor.describe()}`)
  const box = await executor.client.create()
  const placement = executor.client.describePlacement?.(box)
  console.log(`dispatch[0] → placement=${placement?.kind} sandboxId=${placement?.sandboxId}`)
  console.log()
}

async function demoFleetMode(): Promise<void> {
  console.log('— FLEET MODE ——————————————————————————————————')
  console.log(`env: ${describeEnv(FLEET_ENV)}`)
  const fleet = makeFleetStub()
  const executor = createFleetWorkspaceExecutor({
    fleet,
    excludeMachineIds: ['coordinator-0'],
  })
  console.log(`describe: ${executor.describe()}`)
  // Three delegations — show the round-robin across worker-a/b/c.
  for (let i = 0; i < 3; i++) {
    const box = await executor.client.create()
    const placement = executor.client.describePlacement?.(box)
    console.log(
      `dispatch[${i}] → placement=${placement?.kind} fleetId=${placement?.fleetId} ` +
        `machineId=${placement?.machineId} sandboxId=${placement?.sandboxId}`,
    )
  }
  console.log()
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
