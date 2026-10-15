/**
 * per-item-pipeline — P05 (README catalog): each item moves through the stages on its own, with no
 * barrier.
 *
 * Workflows of this pattern run a pipeline per item (find, verify, then act on it).
 * Here the `finder` node is spawned once per item (one `delegates` edge, `maxTraversals: 3`), a
 * `verifier` analyst NODE runs on EACH finder settle, and the root spawns the `publisher` for an
 * item the moment ITS verification lands, while later finders are still running.
 *
 * The no-barrier claim is enforced, not described: the third finder cannot settle until a
 * publisher has been spawned (`LeafShot.after`), so a pipeline that waited for every finder before
 * publishing would deadlock instead of passing. The third item fails verification and is never
 * published, so the ledger shows 3 finder spawns, 3 verify rows and 2 publisher spawns.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/per-item-pipeline.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import {
  driverNode,
  findingsOf,
  leafSeam,
  printLedger,
  reactiveBrain,
  settledOf,
  workerNode,
} from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

/** What each item's verification says, in settle order: the third item does not hold up. */
const VERIFIED = [true, true, false]

export function perItemPipeline(): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Move every item through find, verify, publish on its own.'),
      workerNode('finder', 'Find one item.'),
      workerNode('verifier', 'Verify the item the finder produced.'),
      workerNode('publisher', 'Publish one verified item.'),
    ],
    edges: [
      { kind: 'delegates', from: 'lead', to: 'finder', directive: brief, maxTraversals: 3 },
      { kind: 'delegates', from: 'lead', to: 'publisher', directive: brief, maxTraversals: 3 },
      { kind: 'analyzes', analyst: 'verifier', over: ['finder'], to: 'lead', directive: report },
    ],
    deliverable: { describe: 'the published items', check: (out) => out !== undefined },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  // The last finder holds its settle until a publisher exists: the pipeline has no barrier.
  let publisherSpawned: () => void = () => {}
  const firstPublisher = new Promise<void>((resolve) => {
    publisherSpawned = resolve
  })
  const received: AgentProfile[] = []
  const opts: RunGraphTestOptions = {
    runId: 'pipe',
    workerSlots: 4,
    wake: { debounceMs: 0 },
    makeLeafAgent: leafSeam(
      received,
      {
        finder: {
          withTrace: true,
          shots: [
            { out: { item: 'a' }, valid: true },
            { out: { item: 'b' }, valid: true },
            { out: { item: 'c' }, valid: true, after: () => firstPublisher },
          ],
        },
        verifier: { shots: VERIFIED.map((ok) => ({ out: { ok }, valid: true })) },
      },
      { onSpawnContext: (node) => node === 'publisher' && publisherSpawned() },
    ),
    brain: (() => {
      const published = new Set<string>()
      return reactiveBrain((events, call) => {
        if (call === 0) {
          return {
            toolCalls: ['a', 'b', 'c'].map((item) => ({
              name: 'spawn_worker',
              arguments: { profile: { name: 'finder' }, task: `find item ${item}` },
            })),
          }
        }
        const verified = findingsOf(events, 'verifier')
        const next = verified.filter((f) => f.findings.ok === true && !published.has(f.fromWorker))
        for (const f of next) published.add(f.fromWorker)
        if (next.length > 0) {
          return {
            toolCalls: next.map((f) => ({
              name: 'spawn_worker',
              arguments: {
                profile: { name: 'publisher' },
                task: `publish the item from ${f.fromWorker}`,
              },
            })),
          }
        }
        const settled = settledOf(events).length
        const finished = verified.length === 3 && settled >= 3 + published.size
        return finished ? { content: 'done' } : { content: 'waiting for the pipeline' }
      })
    })(),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  const { graph, opts } = perItemPipeline()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('per-item-pipeline', res)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
