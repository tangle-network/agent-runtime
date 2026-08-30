/**
 * best-of-n — breadth as a topology: one delegates edge per candidate node.
 *
 * Two coder nodes with distinct ids and distinct profiles hang off one root. The driver spawns
 * BOTH in a single turn (`maxLiveWorkers: 2` admits them concurrently), awaits both settles, and
 * the run keeps the winner — the candidate whose settle passed the deliverable. The edge ledger
 * shows exactly two delivered spawn traversals, one per candidate edge: breadth is two edges in
 * the data, not a fan-out helper in code.
 *
 * Fully offline (scripted brain + leaf seam). Run:  pnpm tsx examples/graphs/best-of-n.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { leafSeam, offlineProfile, printLedger, scriptedBrain } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

export function bestOfN(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      { id: 'lead', profile: offlineProfile('lead', 'Keep the best.') },
      { id: 'coder-a', profile: offlineProfile('coder-a', 'Minimal diff.') },
      { id: 'coder-b', profile: offlineProfile('coder-b', 'Full rewrite.') },
    ],
    edges: [
      { kind: 'delegates', from: 'lead', to: 'coder-a', directive: brief },
      { kind: 'delegates', from: 'lead', to: 'coder-b', directive: brief },
    ],
    deliverable: {
      describe: 'a passing candidate',
      check: (out) => (out as { pass?: boolean } | undefined)?.pass === true,
    },
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'bon',
    maxLiveWorkers: 2,
    makeLeafAgent: leafSeam(received, {
      // Candidate A fails its check; candidate B passes — the pick is decided by outcome.
      'coder-a': { shots: [{ out: { candidate: 'a', pass: false }, valid: false }] },
      'coder-b': { shots: [{ out: { candidate: 'b', pass: true }, valid: true }] },
    }),
    brain: scriptedBrain([
      {
        // Both spawns in ONE driver turn — concurrent candidates under the conserved pool.
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { name: 'coder-a' }, task: 'attempt the fix' },
          },
          {
            name: 'spawn_worker',
            arguments: { profile: { name: 'coder-b' }, task: 'attempt the fix' },
          },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ]),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = bestOfN()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('best-of-n', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
