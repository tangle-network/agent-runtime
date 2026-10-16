/**
 * discovered-fanout-reduce — P04 (README catalog): fan out over items found at run time, then
 * reduce.
 *
 * Some workflows discover their work list first (files, tickets, URLs) and only then spawn one
 * worker per item, so the fan-out width is not in the graph. What the graph does carry is the ONE
 * `reader` edge with `maxTraversals: 4` (the ceiling on discovered work) and the run's
 * `workerSlots` (the concurrency): the root queues one reader spawn per item, the runtime runs
 * `workerSlots` of them at a time, and the `reducer` is spawned once every reader has settled.
 *
 * The concurrency is measured, not claimed: each reader counts itself live from the start of its
 * execute to its settle and holds that across a macrotask, so every reader the runtime admitted
 * together overlaps. `peakLive()` reports the most readers ever live at once; with
 * `workerSlots: 2` it is 2 and with `workerSlots: 4` it is 4, so a run that ignored the slot limit
 * or serialized the readers fails the example's test.
 *
 * Fully offline (scripted brain + leaf seam). Run:  pnpm tsx examples/graphs/discovered-fanout-reduce.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, leafSeam, printLedger, scriptedBrain, seen, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

/** The work list the root discovered in its own first turn. */
const ITEMS = ['ticket-101', 'ticket-102', 'ticket-103', 'ticket-104']

export function discoveredFanoutReduce(slots = 2): {
  graph: AgentGraph
  opts: RunGraphTestOptions
  /** The most readers ever live at once. */
  peakLive: () => number
} {
  // ── The topology: plain data — the width is one edge cap, not one node per item ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Spawn one reader per discovered item, then reduce.'),
      workerNode('reader', 'Read one item and summarize it.'),
      workerNode('reducer', 'Reduce the summaries into one report.'),
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'lead',
        to: 'reader',
        directive: brief,
        maxTraversals: ITEMS.length,
      },
      { kind: 'delegates', from: 'lead', to: 'reducer', directive: brief, maxTraversals: 1 },
    ],
    deliverable: {
      describe: 'one report over every item',
      check: (out) => (out as { items?: number } | undefined)?.items === ITEMS.length,
    },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  // A reader is live from the start of its execute (`after` is the first thing a reader without a
  // trace or a steer gate awaits) to its settle, and stays live across one macrotask, so readers the
  // runtime admitted together are all counted together.
  let live = 0
  let peak = 0
  const occupy = async (): Promise<void> => {
    live += 1
    peak = Math.max(peak, live)
    await new Promise<void>((resolve) => setImmediate(resolve))
    live -= 1
  }
  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'fan',
    workerSlots: slots,
    makeLeafAgent: leafSeam(received, {
      reader: { shots: [{ out: { read: true }, valid: true, after: occupy }] },
      reducer: { shots: [{ out: { items: ITEMS.length }, valid: true }] },
    }),
    brain: scriptedBrain([
      {
        toolCalls: ITEMS.map((item) => ({
          name: 'spawn_worker',
          arguments: { profile: { name: 'reader' }, task: `read and summarize ${item}` },
        })),
      },
      { content: 'waiting for the readers', until: seen('"type":"settled"', ITEMS.length) },
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { name: 'reducer' }, task: 'reduce the four summaries' },
          },
        ],
      },
      { content: 'waiting for the reducer', until: seen('"type":"settled"', ITEMS.length + 1) },
      { content: 'done' },
    ]),
  }
  return { graph, opts, peakLive: () => peak }
}

export async function main(): Promise<void> {
  for (const slots of [2, 4]) {
    const { graph, opts, peakLive } = discoveredFanoutReduce(slots)
    const res = await runGraphWithTestBrain(graph, opts)
    printLedger(`discovered-fanout-reduce (workerSlots ${slots})`, res)
    console.log(`peak concurrent readers: ${peakLive()}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
