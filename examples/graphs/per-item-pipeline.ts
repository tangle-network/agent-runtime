/**
 * per-item-pipeline — P05 (README catalog): each item moves through the stages on its own, with no
 * barrier.
 *
 * Workflows of this pattern run a pipeline per item (find, verify, then act on it). Here the
 * pipeline is itself a flow graph that a `maps` edge runs once per item: the `lister` entry settles
 * the item list, and each item runs `finder` → `verifier` → `publisher`, where the edge to the
 * publisher fires only when the verification holds (`/ok` equals true) and the default edge
 * finishes the item as `unverified`. Items run at once (`concurrency: 3`), so an item is published
 * the moment ITS verification lands, while later finders are still running. The `report` node joins
 * the items and settles the published list.
 *
 * The no-barrier claim is enforced, not described: the third finder cannot settle until a
 * publisher has been spawned (`LeafShot.after`), so a pipeline that waited for every finder before
 * publishing would deadlock instead of passing. Item `c` fails verification and is never
 * published, so the run spawns 3 finders, 3 verifiers and 2 publishers.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/per-item-pipeline.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  type GraphTopology,
  promptHandle,
  type RunGraphOptions,
  runGraph,
} from '@tangle-network/agent-runtime/kernel'
import { leafSeam, printLedger, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

export const ITEMS = ['a', 'b', 'c'] as const

/** The item a finder found, as the route into the next stage carried it. */
const foundItem = (task: unknown): string =>
  (task as { evidence: { finder: { item: string } } }).evidence.finder.item

/** What each published item's flow delivered, as the join's task carries it. */
function publishedIn(task: unknown): { published: string[] } {
  const { results } = task as {
    results: Array<{ result: { deliverable?: { publisher?: { published?: string } } } }>
  }
  return {
    published: results.flatMap((r) => r.result.deliverable?.publisher?.published ?? []),
  }
}

export function perItemPipeline(): {
  graph: AgentGraph
  opts: RunGraphOptions
  spawns: () => readonly string[]
  settles: () => readonly string[]
} {
  // ── One item's pipeline: plain data ──
  const item: GraphTopology = {
    nodes: [
      workerNode('finder', 'Find one item.'),
      workerNode('verifier', 'Verify the item the finder produced.'),
      workerNode('publisher', 'Publish one verified item.'),
    ],
    entry: [{ node: 'finder', task: { item: true } }],
    edges: [
      { kind: 'routes', from: 'finder', to: 'verifier', directive: brief, evidence: ['finder'] },
      {
        kind: 'routes',
        from: 'verifier',
        to: 'publisher',
        directive: brief,
        when: { pointer: '/ok', equals: true },
        evidence: ['finder'],
      },
      { kind: 'routes', from: 'verifier', to: { finish: 'unverified' }, directive: brief },
    ],
  }
  // ── The topology: the item list, the pipeline per item, the join ──
  const graph: AgentGraph = {
    nodes: [
      workerNode('lister', 'List the items to move through the pipeline.'),
      workerNode('report', 'Report the published items.'),
    ],
    entry: [{ node: 'lister', task: 'list the items' }],
    edges: [
      {
        kind: 'maps',
        from: 'lister',
        pointer: '/items',
        graph: item,
        join: 'report',
        directive: brief,
        maxItems: 5,
        concurrency: ITEMS.length,
        onItemFailure: 'all-or-refuse',
      },
    ],
    deliverable: {
      describe: 'the published items',
      check: (out) =>
        Array.isArray((out as { report?: { published?: unknown } } | undefined)?.report?.published),
    },
    budget: { maxIterations: 60, maxTokens: 100_000 },
  }

  // The third finder holds its settle until a publisher exists: the pipeline has no barrier.
  let publisherSpawned: () => void = () => {}
  const firstPublisher = new Promise<void>((resolve) => {
    publisherSpawned = resolve
  })
  const spawns: string[] = []
  // Each stage settle as `node:item`, in settle order: what proves every item's own stage order.
  const settles: string[] = []
  const settle =
    (node: string, of: (task: unknown) => string, out: (task: unknown) => unknown) =>
    (task: unknown): unknown => {
      settles.push(`${node}:${of(task)}`)
      return out(task)
    }
  const received: AgentProfile[] = []
  const finds = settle('finder', String, (task) => ({ item: task }))
  const opts: RunGraphOptions = {
    runId: 'pipe',
    workerSlots: 4,
    makeLeafAgent: leafSeam(
      received,
      {
        lister: { shots: [{ out: { items: [...ITEMS] }, valid: true }] },
        // A finder's task is its item.
        finder: {
          shots: [
            { fromTask: finds, valid: true },
            { fromTask: finds, valid: true },
            { fromTask: finds, valid: true, after: () => firstPublisher },
          ],
        },
        // The third item does not hold up.
        verifier: {
          shots: [
            {
              fromTask: settle('verifier', foundItem, (task) => ({
                item: foundItem(task),
                ok: foundItem(task) !== 'c',
              })),
              valid: true,
            },
          ],
        },
        publisher: {
          shots: [
            {
              fromTask: settle('publisher', foundItem, (task) => ({ published: foundItem(task) })),
              valid: true,
            },
          ],
        },
        report: { shots: [{ fromTask: publishedIn, valid: true }] },
      },
      {
        onSpawnContext: (node) => {
          spawns.push(node)
          if (node === 'publisher') publisherSpawned()
        },
      },
    ),
  }
  return { graph, opts, spawns: () => spawns, settles: () => settles }
}

export async function main(): Promise<void> {
  const { graph, opts, spawns } = perItemPipeline()
  const res = await runGraph(graph, opts)
  printLedger('per-item-pipeline', res)
  console.log(`spawn order: ${spawns().join(', ')}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
