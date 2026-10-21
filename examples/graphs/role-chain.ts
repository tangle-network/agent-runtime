/**
 * role-chain — P02 (README catalog): a sequential role chain, each stage briefed with the previous
 * stage's output.
 *
 * A flow graph: `entry` starts the scout, and two `routes` edges carry each settled result to the
 * next stage, so the ORDER is graph data and no root or driver decides it. Each edge lists its
 * source as evidence, so the builder's task holds the scout's exact result and the reviewer's task
 * holds the builder's: a different scout finding changes the builder's brief. The reviewer has no
 * outgoing edge, so it is terminal and its result is the run's output.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/role-chain.ts
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

const STAGES = ['scout', 'builder', 'reviewer'] as const
type Stage = (typeof STAGES)[number]

/** What each stage's worker produces. */
export const STAGE_OUT: Readonly<Record<Stage, unknown>> = {
  scout: { file: 'src/parse.ts', defect: 'drops a trailing comma' },
  builder: { patch: 'keep the trailing comma in src/parse.ts', test: 'parse.trailing-comma' },
  reviewer: { approved: true },
}

export function roleChain(outputs: Readonly<Record<Stage, unknown>> = STAGE_OUT): {
  graph: AgentGraph
  opts: RunGraphOptions
  /** The task each stage's worker received, by node. */
  tasks: () => Readonly<Partial<Record<Stage, unknown>>>
} {
  // ── The topology: plain data, and the order is part of it ──
  const graph: AgentGraph = {
    nodes: [
      workerNode('scout', 'Find where the bug is.'),
      workerNode('builder', 'Fix what the scout found.'),
      workerNode('reviewer', 'Review the builder fix.'),
    ],
    entry: [{ node: 'scout', task: 'locate the bug' }],
    edges: [
      { kind: 'routes', from: 'scout', to: 'builder', directive: brief, evidence: ['scout'] },
      { kind: 'routes', from: 'builder', to: 'reviewer', directive: brief, evidence: ['builder'] },
    ],
    deliverable: {
      describe: 'the reviewer verdict on the builder fix',
      check: (out) => (out as { reviewer?: unknown } | undefined)?.reviewer !== undefined,
    },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const tasks: Partial<Record<Stage, unknown>> = {}
  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'chain',
    makeLeafAgent: leafSeam(
      received,
      Object.fromEntries(STAGES.map((s) => [s, { shots: [{ out: outputs[s], valid: true }] }])),
      {
        onSpawnContext: (node, context) => {
          tasks[node as Stage] = context?.task
        },
      },
    ),
  }
  return { graph, opts, tasks: () => tasks }
}

export async function main(): Promise<void> {
  const { graph, opts, tasks } = roleChain()
  const res = await runGraph(graph, opts)
  printLedger('role-chain', res)
  for (const [stage, task] of Object.entries(tasks())) {
    console.log(`  ${stage} task: ${JSON.stringify(task)}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
