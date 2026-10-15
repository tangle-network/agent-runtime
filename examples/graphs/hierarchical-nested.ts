/**
 * hierarchical-nested — P18 + P15 (README catalog): a planner, a team lead that runs its own
 * workers, an integrator.
 *
 * In a fixed graph the hierarchy is a node that
 * declares the spawn tool: `lead` carries `agent_runtime_coordination_spawn_worker`, so the graph
 * runs it as a NESTED SUPERVISOR with its own brain and its own scope instead of a leaf. The lead
 * spawns `impl-a` and `impl-b`, which are graph nodes like any other, so every delegation is
 * pinned and ledgered; the nested workers' ids sit UNDER the lead's (`h:s0:s0`, `h:s0:s1`). The
 * planner then spawns the `integrator` over the lead's result.
 *
 * Two honest limits. Every delegates edge names the root as `from` (the fixed graph form), so the
 * ledger cannot say which supervisor spawned a worker; the worker id path does. And the lead's
 * brain runs on the router transport, so the offline form scripts that HTTP peer
 * (`RouterTransportConfig.complete`) rather than a driver brain.
 *
 * Fully offline (scripted brain + scripted router peer + leaf seam).
 * Run:  pnpm tsx examples/graphs/hierarchical-nested.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import {
  driverNode,
  leafSeam,
  printLedger,
  scriptedBrain,
  scriptedRouter,
  seen,
  workerNode,
} from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

export function hierarchicalNested(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data — `lead` holds the spawn grant, so it is a nested supervisor ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('planner', 'Plan, delegate the build to the lead, then integrate.'),
      driverNode('lead', 'Run impl-a and impl-b, then report.'),
      workerNode('impl-a', 'Implement the first half.'),
      workerNode('impl-b', 'Implement the second half.'),
      workerNode('integrator', 'Integrate the lead result.'),
    ],
    edges: ['lead', 'impl-a', 'impl-b', 'integrator'].map((to) => ({
      kind: 'delegates' as const,
      from: 'planner',
      to,
      directive: brief,
      maxTraversals: 1,
    })),
    deliverable: { describe: 'an integrated build', check: (out) => out !== undefined },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const spawn = (node: string, task: string) => ({
    name: 'spawn_worker',
    arguments: { profile: { name: node }, task },
  })
  const opts: RunGraphTestOptions = {
    runId: 'h',
    workerSlots: 3,
    // The nested lead's brain: spawn its two workers, wait until BOTH have settled, finish.
    router: {
      routerBaseUrl: 'http://offline.invalid/v1',
      routerKey: 'offline',
      complete: scriptedRouter([
        { toolCalls: [spawn('impl-a', 'first half'), spawn('impl-b', 'second half')] },
        { content: 'waiting for the implementers', until: seen('"type":"settled"', 2) },
        { content: 'done' },
      ]),
    },
    makeLeafAgent: leafSeam(received),
    brain: scriptedBrain([
      { toolCalls: [spawn('lead', 'build the feature with your team')] },
      { content: 'waiting for the lead', until: seen('"settled":"h:s0"') },
      { toolCalls: [spawn('integrator', 'integrate what the lead built')] },
      { content: 'waiting for the integrator', until: seen('"settled":"h:s1"') },
      { content: 'done' },
    ]),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = hierarchicalNested()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('hierarchical-nested', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
