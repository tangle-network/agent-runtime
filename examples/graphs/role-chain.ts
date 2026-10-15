/**
 * role-chain — P02: a sequential role chain, each stage briefed with the previous stage's output.
 *
 * 94 of the 660 scripts are a straight chain of roles (scout, build, review). The topology is
 * three worker nodes under one root, one `delegates` edge apiece, each capped at one traversal.
 * The ORDER lives in the driver: it spawns a stage only after the previous one settles and folds
 * that output into the next task, so the edge ledger shows scout, builder, reviewer in sequence
 * with the byte count growing as each directive carries more of what came before.
 *
 * Fully offline (scripted brain + leaf seam). Run:  pnpm tsx examples/graphs/role-chain.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, leafSeam, printLedger, scriptedBrain, seen, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

export const SCOUT_OUT = 'the failing path is src/parse.ts: it drops a trailing comma'
export const BUILDER_OUT =
  'patched src/parse.ts to keep the trailing comma, added a regression test'

export function roleChain(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Run scout, builder, reviewer in order.'),
      workerNode('scout', 'Find where the bug is.'),
      workerNode('builder', 'Fix what the scout found.'),
      workerNode('reviewer', 'Review the builder fix.'),
    ],
    edges: ['scout', 'builder', 'reviewer'].map((to) => ({
      kind: 'delegates' as const,
      from: 'lead',
      to,
      directive: brief,
      maxTraversals: 1,
    })),
    deliverable: { describe: 'a reviewed fix', check: (out) => out !== undefined },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const spawn = (node: string, task: string) => ({
    toolCalls: [{ name: 'spawn_worker', arguments: { profile: { name: node }, task } }],
  })
  const opts: RunGraphTestOptions = {
    runId: 'chain',
    makeLeafAgent: leafSeam(received, {
      scout: { shots: [{ out: SCOUT_OUT, valid: true }] },
      builder: { shots: [{ out: BUILDER_OUT, valid: true }] },
      reviewer: { shots: [{ out: 'approved', valid: true }] },
    }),
    brain: scriptedBrain([
      spawn('scout', 'locate the bug'),
      { content: 'waiting for the scout', until: seen('"settled":"chain:s0"') },
      spawn('builder', `fix it. The scout reported: ${SCOUT_OUT}`),
      { content: 'waiting for the builder', until: seen('"settled":"chain:s1"') },
      spawn('reviewer', `review the fix. The builder reported: ${BUILDER_OUT}`),
      { content: 'waiting for the reviewer', until: seen('"settled":"chain:s2"') },
      { content: 'done' },
    ]),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = roleChain()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('role-chain', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
