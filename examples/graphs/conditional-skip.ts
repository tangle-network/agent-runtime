/**
 * conditional-skip — P13 (README catalog): a stage that runs only when the previous one found
 * something.
 *
 * Workflows often gate a later stage on an earlier result (no findings means no verification). In a
 * flow graph the gate is a routes edge with a condition: the finder's edge to the verifier fires
 * only when `/findings/0` exists in the finder's result, and the default edge finishes the run with
 * the finder's result instead. Run with zero findings and the verify edge has zero traversals, by
 * design, not by failure; run with two findings and the verify row appears.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/conditional-skip.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  promptHandle,
  type RunGraphOptions,
  runGraph,
} from '@tangle-network/agent-runtime/kernel'
import { leafSeam, printLedger, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

export function conditionalSkip(findings: readonly string[] = ['null deref', 'stale cache']): {
  graph: AgentGraph
  opts: RunGraphOptions
} {
  // ── The topology: plain data — the verify edge is always there, the traversal is not ──
  const graph: AgentGraph = {
    nodes: [
      workerNode('finder', 'List defects.'),
      workerNode('verifier', 'Confirm each defect the finder listed.'),
    ],
    entry: [{ node: 'finder', task: 'list the defects' }],
    edges: [
      {
        kind: 'routes',
        from: 'finder',
        to: 'verifier',
        directive: brief,
        when: { pointer: '/findings/0', exists: true },
        evidence: ['finder'],
      },
      { kind: 'routes', from: 'finder', to: { finish: 'nothing-found' }, directive: brief },
    ],
    deliverable: { describe: 'a defect report', check: (out) => out !== undefined },
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'skip',
    makeLeafAgent: leafSeam(received, {
      finder: { shots: [{ out: { findings }, valid: true }] },
      verifier: { shots: [{ out: { confirmed: findings.length }, valid: true }] },
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  for (const findings of [['null deref', 'stale cache'], []]) {
    const { graph, opts } = conditionalSkip(findings)
    const res = await runGraph(graph, opts)
    printLedger(`conditional-skip (${findings.length} findings)`, res)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
