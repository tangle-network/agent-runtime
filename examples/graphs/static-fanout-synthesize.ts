/**
 * static-fanout-synthesize — P03: fixed dimensions in parallel, one synthesis over them.
 *
 * The most common Claude Workflow shape (148 of 660 scripts): the author knows the dimensions up
 * front — risk, cost, fit — so each is a differently-profiled worker node, one `delegates` edge
 * apiece, capped at one traversal. A `synthesis` analyst NODE watches all three and reports to the
 * root.
 *
 * An analyst fires on EACH matching settle, so the synthesis agent runs three times, once over each
 * dimension's trace, and the root joins the three findings. A single synthesis over all three
 * outputs needs a barrier first; that form is `isolated-writers-integrate.ts` (a delegated
 * integrator spawned after the last settle).
 *
 * Fully offline (scripted brain + leaf seam). Run:  pnpm tsx examples/graphs/static-fanout-synthesize.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, leafSeam, printLedger, scriptedBrain, seen, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

const DIMENSIONS = ['risk', 'cost', 'fit'] as const

export function staticFanoutSynthesize(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Fan out over the fixed dimensions, then answer from the synthesis.'),
      ...DIMENSIONS.map((d) => workerNode(d, `Assess the ${d} dimension.`)),
      workerNode('synthesis', 'Synthesize the dimension evidence into one recommendation.'),
    ],
    edges: [
      ...DIMENSIONS.map((d) => ({
        kind: 'delegates' as const,
        from: 'lead',
        to: d,
        directive: brief,
        maxTraversals: 1,
      })),
      {
        kind: 'analyzes',
        analyst: 'synthesis',
        over: [...DIMENSIONS],
        to: 'lead',
        directive: report,
      },
    ],
    deliverable: { describe: 'a recommendation', check: (out) => out !== undefined },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'fan',
    workerSlots: 3,
    makeLeafAgent: leafSeam(received, {
      risk: { withTrace: true },
      cost: { withTrace: true },
      fit: { withTrace: true },
      synthesis: {
        shots: [{ out: { recommendation: 'ship, with a rollback plan' }, valid: true }],
      },
    }),
    brain: scriptedBrain([
      {
        // All three dimensions in ONE driver turn — the fan-out is the data, not a helper.
        toolCalls: DIMENSIONS.map((d) => ({
          name: 'spawn_worker',
          arguments: { profile: { name: d }, task: `assess ${d}` },
        })),
      },
      // Three settles, then three synthesis findings (one per settle): the driver is woken with
      // them and answers once all three are in.
      { content: 'waiting for the synthesis', until: seen('"type":"finding"', 3) },
      { content: 'done' },
    ]),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = staticFanoutSynthesize()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('static-fanout-synthesize', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
