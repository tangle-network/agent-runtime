/**
 * loop-until-dry — P09 + P10 (README catalog): re-run the finder until a completeness critic finds
 * nothing new.
 *
 * Some workflows keep sweeping until a round turns up nothing new, often closing with a
 * completeness critic. In a flow graph the loop and its stop rule are both data. The finder's
 * result rides to a `critic` node, which counts the consecutive sweeps that added no new finding
 * and settles that count as `dryStreak`, reading the previous count from its own last result
 * (listed as evidence). The critic's first edge finishes the run as `dry` when `/dryStreak` equals
 * 2; its second sends the finder back with `continuity: 'resume'`, so every later sweep continues
 * the finder's own session; `maxTraversals: 6` bounds the loop and the default edge finishes it as
 * `cap`. The ledger shows the loop stopping at the dry rule with the cap unused.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/loop-until-dry.ts
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

/** New findings per sweep, as the finder reports them: dry on sweeps 3 and 4. */
const NEW_PER_SWEEP = [3, 1, 0, 0]

/** The critic's settle: the dry streak, from the sweep it was handed and its own last count. */
function countDryStreak(task: unknown): { new: number; dryStreak: number } {
  const t = task as {
    from?: { result?: { new?: unknown } }
    evidence?: { critic?: { dryStreak?: unknown } }
  }
  const found = Number(t.from?.result?.new ?? 0)
  const previous = Number(t.evidence?.critic?.dryStreak ?? 0)
  return { new: found, dryStreak: found === 0 ? previous + 1 : 0 }
}

export function loopUntilDry(): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data, the stop rule included ──
  const graph: AgentGraph = {
    nodes: [
      workerNode('finder', 'Find what earlier sweeps missed.'),
      workerNode('critic', 'Count the consecutive sweeps that found nothing new.'),
    ],
    entry: [{ node: 'finder', task: 'sweep 1: find everything you can' }],
    edges: [
      {
        kind: 'routes',
        from: 'finder',
        to: 'critic',
        directive: brief,
        evidence: ['finder', 'critic'],
      },
      {
        kind: 'routes',
        from: 'critic',
        to: { finish: 'dry' },
        directive: brief,
        when: { pointer: '/dryStreak', equals: 2 },
      },
      {
        kind: 'routes',
        from: 'critic',
        to: 'finder',
        directive: brief,
        when: { pointer: '/dryStreak', exists: true },
        evidence: ['finder'],
        maxTraversals: 6,
        continuity: 'resume',
      },
      { kind: 'routes', from: 'critic', to: { finish: 'cap' }, directive: brief },
    ],
    deliverable: {
      describe: 'every finding the sweeps could reach',
      check: (out) => out !== undefined,
    },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'dry',
    makeLeafAgent: leafSeam(received, {
      finder: {
        shots: NEW_PER_SWEEP.map((n, i) => ({ out: { sweep: i + 1, new: n }, valid: true })),
      },
      critic: { shots: [{ fromTask: countDryStreak, valid: true }] },
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = loopUntilDry()
  const res = await runGraph(graph, opts)
  printLedger('loop-until-dry', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
