/**
 * isolated-writers-integrate — P12 (README catalog): parallel writers on isolated workspaces, then
 * one integrator.
 *
 * Workflows of this pattern give each parallel writer its own git worktree so edits cannot collide,
 * then merge. In agent-runtime the isolation is the NODE: each writer is its own worker with its
 * own execution environment (on the sandbox backend, its own box), so no worktree juggling is
 * needed. The integrator is a fourth worker the root spawns only after the last writer settles,
 * with the writers' outputs in its task — a barrier, which is what separates this from the
 * per-settle analyst of `static-fanout-synthesize.ts`.
 *
 * Fully offline (scripted brain + leaf seam). Run:  pnpm tsx examples/graphs/isolated-writers-integrate.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, leafSeam, printLedger, scriptedBrain, seen, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

const WRITERS = ['writer-auth', 'writer-api', 'writer-ui'] as const

export function isolatedWritersIntegrate(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Run the writers in parallel, then the integrator.'),
      ...WRITERS.map((w) => workerNode(w, `Write your slice in your own workspace (${w}).`)),
      workerNode('integrator', 'Merge the three slices into one change.'),
    ],
    edges: [...WRITERS, 'integrator'].map((to) => ({
      kind: 'delegates' as const,
      from: 'lead',
      to,
      directive: brief,
      maxTraversals: 1,
    })),
    deliverable: {
      describe: 'one merged change',
      check: (out) => (out as { merged?: number } | undefined)?.merged === 3,
    },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'iso',
    workerSlots: 3,
    makeLeafAgent: leafSeam(received, {
      'writer-auth': { shots: [{ out: { files: ['auth.ts'] }, valid: true }] },
      'writer-api': { shots: [{ out: { files: ['api.ts'] }, valid: true }] },
      'writer-ui': { shots: [{ out: { files: ['ui.tsx'] }, valid: true }] },
      integrator: { shots: [{ out: { merged: 3 }, valid: true }] },
    }),
    brain: scriptedBrain([
      {
        toolCalls: WRITERS.map((w) => ({
          name: 'spawn_worker',
          arguments: { profile: { name: w }, task: 'write your slice' },
        })),
      },
      { content: 'waiting for the writers', until: seen('"type":"settled"', 3) },
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: {
              profile: { name: 'integrator' },
              task: 'merge auth.ts, api.ts and ui.tsx from the three writers',
            },
          },
        ],
      },
      { content: 'waiting for the integrator', until: seen('"type":"settled"', 4) },
      { content: 'done' },
    ]),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = isolatedWritersIntegrate()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('isolated-writers-integrate', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
