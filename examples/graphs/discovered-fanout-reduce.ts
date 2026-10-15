/**
 * discovered-fanout-reduce — P04: fan out over items found at run time, then reduce.
 *
 * 36 of the 660 scripts discover their work list first (files, tickets, URLs) and only then spawn
 * one worker per item, so the fan-out width is not in the graph. What the graph does carry is the
 * ONE `reader` edge with `maxTraversals: 4` (the ceiling on discovered work) and the run's
 * `workerSlots: 2` (the concurrency): the root queues one reader spawn per item, the runtime runs
 * two at a time, and the `reducer` is spawned once every reader has settled.
 *
 * The concurrency is measured, not claimed: `peakLive()` reports the most readers that were ever
 * live together, and the readers rendezvous in pairs, so a run that ignored the slot limit or
 * serialized the readers fails the example's test.
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
const SLOTS = 2

export function discoveredFanoutReduce(): {
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

  // Readers settle in pairs: each waits until two are live, so concurrency 2 is observable.
  let live = 0
  let peak = 0
  let release: (() => void)[] = []
  const rendezvous = async (): Promise<void> => {
    live += 1
    peak = Math.max(peak, live)
    if (live >= SLOTS) {
      for (const go of release) go()
      release = []
    } else {
      await new Promise<void>((resolve) => release.push(resolve))
    }
    live -= 1
  }
  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'fan',
    workerSlots: SLOTS,
    makeLeafAgent: leafSeam(received, {
      reader: { shots: [{ out: { read: true }, valid: true, after: rendezvous }] },
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
  const { graph, opts, peakLive } = discoveredFanoutReduce()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('discovered-fanout-reduce', res)
  console.log(`peak concurrent readers: ${peakLive()} (workerSlots ${SLOTS})`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
