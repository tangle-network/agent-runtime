/**
 * static-fanout-synthesize — P03 (README catalog): fixed dimensions in parallel, one synthesis
 * over them.
 *
 * The author knows the dimensions up front — risk, cost, fit — so each is a differently-profiled
 * worker node, one `delegates` edge apiece, capped at one traversal. A `synthesis` analyst NODE
 * watches all three and reports to the root.
 *
 * An analyst fires on EACH matching settle, so the synthesis agent runs three times, once over each
 * dimension's output, and the root joins the three findings into the recommendation it delivers
 * through `submit_result`: one dimension that does not support shipping turns `ship` into `hold`.
 * The deliverable accepts only a recommendation whose basis covers every dimension, so a single
 * dimension's raw output can never be the result. A single synthesis agent over all three outputs
 * needs a barrier first; that form is `isolated-writers-integrate.ts` (a delegated integrator
 * spawned after the last settle).
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/static-fanout-synthesize.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import {
  DECIDING_ROOT_TOOLS,
  driverNode,
  findingsOf,
  leafSeam,
  printLedger,
  reactiveBrain,
  submitTurn,
  workerNode,
} from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

export const DIMENSIONS = ['risk', 'cost', 'fit'] as const
type Dimension = (typeof DIMENSIONS)[number]
type Level = 'low' | 'medium' | 'high'

/** One synthesis finding: the dimension it read, and whether that dimension supports shipping. */
export interface DimensionSynthesis {
  readonly dimension: Dimension
  readonly level: Level
  readonly supportsShipping: boolean
}

/** What the root delivers: the joined synthesis. */
export interface Recommendation {
  readonly recommendation: 'ship' | 'hold'
  readonly basis: ReadonlyArray<DimensionSynthesis>
}

export function staticFanoutSynthesize(
  levels: Readonly<Record<Dimension, Level>> = { risk: 'low', cost: 'medium', fit: 'low' },
): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      driverNode(
        'lead',
        'Fan out over the fixed dimensions, then answer from the synthesis.',
        DECIDING_ROOT_TOOLS,
      ),
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
    deliverable: {
      describe: 'a recommendation whose basis covers every dimension',
      check: (out) => {
        const r = out as Partial<Recommendation> | undefined
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
  const opts: RunGraphTestOptions = {
    runId: 'fan',
    workerSlots: 3,
    wake: { debounceMs: 0 },
    makeLeafAgent: leafSeam(received, {
      ...Object.fromEntries(
        DIMENSIONS.map((d) => [
          d,
          { withTrace: true, shots: [{ out: { dimension: d, level: levels[d] }, valid: true }] },
        ]),
      ),
      // The synthesis reads the dimension output its task carried and judges that one dimension.
      synthesis: {
        shots: [
          {
            fromSource: (source: unknown): DimensionSynthesis => {
              const { dimension, level } = source as { dimension: Dimension; level: Level }
              return { dimension, level, supportsShipping: level !== 'high' }
            },
            valid: true,
          },
        ],
      },
    }),
    brain: reactiveBrain((events, call, results) => {
      if (call === 0) {
        // All three dimensions in ONE driver turn — the fan-out is the data, not a helper.
        return {
          toolCalls: DIMENSIONS.map((d) => ({
            name: 'spawn_worker',
            arguments: { profile: { name: d }, task: `assess ${d}` },
          })),
        }
      }
      const syntheses = findingsOf(events, 'synthesis').map(
        (f) => f.findings as unknown as DimensionSynthesis,
      )
      if (syntheses.length < DIMENSIONS.length) return { content: 'waiting for the synthesis' }
      const recommendation = syntheses.every((s) => s.supportsShipping) ? 'ship' : 'hold'
      return submitTurn(results, call, { recommendation, basis: syntheses })
    }),
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
