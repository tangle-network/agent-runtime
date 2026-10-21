/**
 * isolated-writers-integrate — P12 (README catalog): parallel writers on isolated workspaces, then
 * one integrator.
 *
 * Workflows of this pattern give each parallel writer its own git worktree so edits cannot collide,
 * then merge. In agent-runtime the isolation is the NODE: each writer is its own worker with its
 * own execution environment (on the sandbox backend, its own box), so no worktree juggling is
 * needed. Each writer is an `entry` of a flow graph, and a join (`from` lists the three writers)
 * starts the integrator only after the last writer settles, with every writer's result as
 * evidence. The integrator merges what that evidence carries, so its `merged` count is the number
 * of slices it was handed.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/isolated-writers-integrate.ts
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

const WRITERS = ['writer-auth', 'writer-api', 'writer-ui'] as const

/** The integrator merges the slices the join handed it, one per writer that settled. */
function integrate(task: unknown): { merged: number } {
  const evidence = (task as { evidence?: Record<string, unknown> }).evidence ?? {}
  return { merged: WRITERS.filter((w) => evidence[w] !== undefined).length }
}

export function isolatedWritersIntegrate(): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data — three entries, one join ──
  const graph: AgentGraph = {
    nodes: [
      ...WRITERS.map((w) => workerNode(w, `Write your slice in your own workspace (${w}).`)),
      workerNode('integrator', 'Merge the three slices into one change.'),
    ],
    entry: WRITERS.map((w) => ({ node: w, task: 'write your slice' })),
    edges: [{ kind: 'routes', from: [...WRITERS], to: 'integrator', directive: brief }],
    deliverable: {
      describe: 'one merged change',
      check: (out) =>
        (out as { integrator?: { merged?: number } } | undefined)?.integrator?.merged === 3,
    },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'iso',
    workerSlots: 3,
    makeLeafAgent: leafSeam(received, {
      'writer-auth': { shots: [{ out: { files: ['auth.ts'] }, valid: true }] },
      'writer-api': { shots: [{ out: { files: ['api.ts'] }, valid: true }] },
      'writer-ui': { shots: [{ out: { files: ['ui.tsx'] }, valid: true }] },
      integrator: { shots: [{ fromTask: integrate, valid: true }] },
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = isolatedWritersIntegrate()
  const res = await runGraph(graph, opts)
  printLedger('isolated-writers-integrate', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
