/**
 * dependency-waves — P23 + P24 (README catalog): nodes released in dependency order, in waves.
 *
 * Ordered waves and a dependency DAG are one shape: a
 * node starts only when the nodes it needs have settled. The graph holds the five workers (one
 * `delegates` edge each, one traversal apiece); the DAG itself (`schema` first; `api`, `ui`,
 * `docs` once `schema` settles; `e2e` once `api` and `ui` settle) is the driver's release rule,
 * and the ledger records the order it was applied in. Nodes in the same wave are spawned in one
 * turn and run together.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/dependency-waves.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, leafSeam, printLedger, reactiveBrain, settledOf, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

/** Each node and the nodes that must settle before it may start. */
export const DAG: Readonly<Record<string, readonly string[]>> = {
  schema: [],
  api: ['schema'],
  ui: ['schema'],
  docs: ['schema'],
  e2e: ['api', 'ui'],
}

export function dependencyWaves(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data — five workers; the dependencies are the release rule ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Release each node only after the nodes it needs have settled.'),
      ...Object.keys(DAG).map((id) => workerNode(id, `Build the ${id} part.`)),
    ],
    edges: Object.keys(DAG).map((to) => ({
      kind: 'delegates' as const,
      from: 'lead',
      to,
      directive: brief,
      maxTraversals: 1,
    })),
    deliverable: {
      describe: 'the end-to-end suite passing',
      check: (out) => (out as { built?: string } | undefined)?.built === 'e2e',
    },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const spawnedAs: string[] = [] // node of spawn ordinal k
  const opts: RunGraphTestOptions = {
    runId: 'dag',
    workerSlots: 3,
    wake: { debounceMs: 0 },
    makeLeafAgent: leafSeam(received),
    brain: reactiveBrain((events) => {
      const settled = new Set(
        settledOf(events).map((s) => spawnedAs[Number(s.id.split(':s')[1])] ?? ''),
      )
      const ready = Object.keys(DAG).filter(
        (node) => !spawnedAs.includes(node) && (DAG[node] ?? []).every((need) => settled.has(need)),
      )
      if (ready.length > 0) {
        spawnedAs.push(...ready)
        return {
          toolCalls: ready.map((node) => ({
            name: 'spawn_worker',
            arguments: { profile: { name: node }, task: `build ${node}` },
          })),
        }
      }
      return settled.size === Object.keys(DAG).length
        ? { content: 'done' }
        : { content: 'waiting for the next wave' }
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = dependencyWaves()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('dependency-waves', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
