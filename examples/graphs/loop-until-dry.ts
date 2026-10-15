/**
 * loop-until-dry — P09 + P10: re-run the finder until a completeness critic finds nothing new.
 *
 * The corpus has a handful of scripts (3 primary, plus the 33 that end with a completeness
 * critic) that keep sweeping until a round turns up nothing new. The graph is a `finder` on a
 * `continuity: 'resume'` delegates edge, so every later sweep continues the finder's own session,
 * and a `critic` analyst NODE that reports how many NEW findings each sweep added. The stop rule
 * lives in the driver: two dry rounds in a row end the loop. `maxTraversals: 6` is only the
 * backstop; the ledger shows the loop stopping at the dry rule with the cap unused.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/loop-until-dry.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, findingsOf, leafSeam, printLedger, reactiveBrain, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

/** New findings per sweep, as the critic reports them: dry on sweeps 3 and 4. */
const NEW_PER_SWEEP = [3, 1, 0, 0]
const DRY_ROUNDS = 2

export function loopUntilDry(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Sweep until the critic reports nothing new twice in a row.'),
      workerNode('finder', 'Find what earlier sweeps missed.'),
      workerNode('critic', 'Report how many findings in this sweep are new.'),
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'lead',
        to: 'finder',
        directive: brief,
        maxTraversals: 6,
        continuity: 'resume',
      },
      { kind: 'analyzes', analyst: 'critic', over: ['finder'], to: 'lead', directive: report },
    ],
    deliverable: {
      describe: 'every finding the sweeps could reach',
      check: (out) => out !== undefined,
    },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  let sweeps = 0
  const opts: RunGraphTestOptions = {
    runId: 'dry',
    wake: { debounceMs: 0 },
    makeLeafAgent: leafSeam(received, {
      finder: { withTrace: true },
      critic: { shots: NEW_PER_SWEEP.map((n) => ({ out: { new: n }, valid: true })) },
    }),
    brain: reactiveBrain((events, call) => {
      const sweep = (task: string) => {
        sweeps += 1
        return {
          toolCalls: [{ name: 'spawn_worker', arguments: { profile: { name: 'finder' }, task } }],
        }
      }
      if (call === 0) return sweep('sweep 1: find everything you can')
      const reports = findingsOf(events, 'critic')
      if (reports.length < sweeps) return { content: 'waiting for the critic' }
      const recent = reports.slice(-DRY_ROUNDS)
      const dry = recent.length === DRY_ROUNDS && recent.every((r) => Number(r.findings.new) === 0)
      return dry
        ? { content: 'done: dry twice' }
        : sweep(`sweep ${sweeps + 1}: find what is still missing`)
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = loopUntilDry()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('loop-until-dry', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
