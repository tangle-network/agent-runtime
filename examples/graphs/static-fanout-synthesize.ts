/**
 * static-fanout-synthesize — P03 (README catalog): fixed dimensions in parallel, one synthesis
 * over them.
 *
 * The author knows the dimensions up front — risk, cost, fit — so each is a differently-profiled
 * worker node, and each is an `entry` of a flow graph: Runtime starts all three at once. A join
 * (`from` lists the three dimensions) starts the `synthesis` node once every dimension has settled,
 * with each dimension's result as evidence, so one synthesis reads all three and its result is the
 * recommendation: one dimension that does not support shipping turns `ship` into `hold`. The
 * deliverable accepts only a recommendation whose basis covers every dimension, so a single
 * dimension's raw output can never be the result. No root joins anything.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/static-fanout-synthesize.ts
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

export const DIMENSIONS = ['risk', 'cost', 'fit'] as const
type Dimension = (typeof DIMENSIONS)[number]
type Level = 'low' | 'medium' | 'high'

/** One dimension's reading: its level, and whether that level supports shipping. */
export interface DimensionSynthesis {
  readonly dimension: Dimension
  readonly level: Level
  readonly supportsShipping: boolean
}

/** What the synthesis settles, and so what the run delivers under `synthesis`. */
export interface Recommendation {
  readonly recommendation: 'ship' | 'hold'
  readonly basis: ReadonlyArray<DimensionSynthesis>
}

/** The synthesis reads every dimension's result from the join's evidence in its own task. */
function synthesize(task: unknown): Recommendation {
  const evidence = (task as { evidence?: Partial<Record<Dimension, { level: Level }>> }).evidence
  const basis = DIMENSIONS.flatMap((dimension) => {
    const level = evidence?.[dimension]?.level
    return level === undefined ? [] : [{ dimension, level, supportsShipping: level !== 'high' }]
  })
  return { recommendation: basis.every((b) => b.supportsShipping) ? 'ship' : 'hold', basis }
}

export function staticFanoutSynthesize(
  levels: Readonly<Record<Dimension, Level>> = { risk: 'low', cost: 'medium', fit: 'low' },
): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data — three entries, one join ──
  const graph: AgentGraph = {
    nodes: [
      ...DIMENSIONS.map((d) => workerNode(d, `Assess the ${d} dimension.`)),
      workerNode('synthesis', 'Synthesize the dimension evidence into one recommendation.'),
    ],
    entry: DIMENSIONS.map((d) => ({ node: d, task: `assess ${d}` })),
    edges: [{ kind: 'routes', from: [...DIMENSIONS], to: 'synthesis', directive: brief }],
    deliverable: {
      describe: 'a recommendation whose basis covers every dimension',
      check: (out) => {
        const r = (out as { synthesis?: Partial<Recommendation> } | undefined)?.synthesis
        const covered = new Set((r?.basis ?? []).map((b) => b.dimension))
        return (
          (r?.recommendation === 'ship' || r?.recommendation === 'hold') &&
          DIMENSIONS.every((d) => covered.has(d))
        )
      },
    },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'fan',
    workerSlots: 3,
    makeLeafAgent: leafSeam(received, {
      ...Object.fromEntries(
        DIMENSIONS.map((d) => [
          d,
          { shots: [{ out: { dimension: d, level: levels[d] }, valid: true }] },
        ]),
      ),
      synthesis: { shots: [{ fromTask: synthesize, valid: true }] },
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = staticFanoutSynthesize()
  const res = await runGraph(graph, opts)
  printLedger('static-fanout-synthesize', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
