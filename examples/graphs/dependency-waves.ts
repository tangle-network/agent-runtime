/**
 * dependency-waves — P23 + P24 (README catalog): nodes released in dependency order, in waves.
 *
 * Ordered waves and a dependency DAG are one shape: a node starts only when the nodes it needs
 * have settled. A flow graph holds the DAG as data: `entry` starts `schema`; a fork starts `api`,
 * `ui` and `docs` together once `schema` settles; a join starts `e2e` once `api` and `ui` have both
 * settled. No root or driver releases anything, and the ledger records the order Runtime applied.
 * `docs` and `e2e` have no outgoing edge, so they are terminal and their results are the output.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/dependency-waves.ts
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

/** Each node and the nodes that must settle before it may start. */
export const DAG: Readonly<Record<string, readonly string[]>> = {
  schema: [],
  api: ['schema'],
  ui: ['schema'],
  docs: ['schema'],
  e2e: ['api', 'ui'],
}

export function dependencyWaves(): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data, and the dependencies are part of it ──
  const graph: AgentGraph = {
    nodes: Object.keys(DAG).map((id) => workerNode(id, `Build the ${id} part.`)),
    entry: [{ node: 'schema', task: 'build schema' }],
    edges: [
      {
        kind: 'routes',
        from: 'schema',
        to: ['api', 'ui', 'docs'],
        directive: brief,
        evidence: ['schema'],
      },
      { kind: 'routes', from: ['api', 'ui'], to: 'e2e', directive: brief },
    ],
    deliverable: {
      describe: 'the end-to-end suite passing',
      check: (out) => (out as { e2e?: { built?: string } } | undefined)?.e2e?.built === 'e2e',
    },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'dag',
    workerSlots: 3,
    makeLeafAgent: leafSeam(received),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = dependencyWaves()
  const res = await runGraph(graph, opts)
  printLedger('dependency-waves', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
