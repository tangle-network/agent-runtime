/**
 * conditional-skip — P13 (README catalog): a stage that runs only when the previous one found
 * something.
 *
 * Workflows often gate a later stage on an earlier result (no findings means no verification). In a
 * graph the gate is the absence of a traversal: the `verifier` edge exists in the data, and the
 * root spawns the verifier only when the finder's own verdict says it found something. Run with
 * zero findings and the ledger has ONE row (the finder) and the verify edge has zero traversals,
 * by design, not by failure; run with two findings and the verify row appears.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/conditional-skip.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, leafSeam, printLedger, reactiveBrain, settledOf, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

export function conditionalSkip(findings: readonly string[] = ['null deref', 'stale cache']): {
  graph: AgentGraph
  opts: RunGraphTestOptions
} {
  // ── The topology: plain data — the verify edge is always there, the traversal is not ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Verify only what the finder found.'),
      workerNode('finder', 'List defects.'),
      workerNode('verifier', 'Confirm each defect the finder listed.'),
    ],
    edges: [
      { kind: 'delegates', from: 'lead', to: 'finder', directive: brief, maxTraversals: 1 },
      { kind: 'delegates', from: 'lead', to: 'verifier', directive: brief, maxTraversals: 1 },
    ],
    deliverable: { describe: 'a defect report', check: (out) => out !== undefined },
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  let verifying = false
  const opts: RunGraphTestOptions = {
    runId: 'skip',
    makeLeafAgent: leafSeam(received, {
      // The finder's verdict carries the gate: score is how many defects it found.
      finder: { shots: [{ out: { findings }, valid: true, score: findings.length }] },
      verifier: { shots: [{ out: { confirmed: findings.length }, valid: true }] },
    }),
    brain: reactiveBrain((events, call) => {
      if (call === 0) {
        return {
          toolCalls: [
            {
              name: 'spawn_worker',
              arguments: { profile: { name: 'finder' }, task: 'list the defects' },
            },
          ],
        }
      }
      const settled = settledOf(events)
      const finder = settled.find((s) => s.id === 'skip:s0')
      if (finder === undefined) return { content: 'waiting for the finder' }
      if (finder.score > 0 && !verifying) {
        verifying = true
        return {
          toolCalls: [
            {
              name: 'spawn_worker',
              arguments: { profile: { name: 'verifier' }, task: 'confirm the listed defects' },
            },
          ],
        }
      }
      if (verifying && settled.length < 2) return { content: 'waiting for the verifier' }
      return { content: 'done' }
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  for (const findings of [['null deref', 'stale cache'], []]) {
    const { graph, opts } = conditionalSkip(findings)
    const res = await runGraphWithTestBrain(graph, opts)
    printLedger(`conditional-skip (${findings.length} findings)`, res)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
