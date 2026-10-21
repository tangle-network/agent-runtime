/**
 * proof-gate — P25 (README catalog): a destructive step runs only after a proof stage verifies its
 * precondition.
 *
 * Destructive stages (purge, drop, delete) must not run until a precondition is proven. In a flow
 * graph the gate is data: the `backup` result rides to a `proof` node as evidence, the proof
 * settles `{ bytes, ok }` derived from the backup result it was handed (`ok` is true for a
 * positive byte count, because a route condition compares scalars), and the edge to `purge` fires
 * only when `/ok` equals true. The default edge finishes the run as `no-backup`. With a real backup
 * the ledger shows the purge spawn; with an empty one the destructive edge has ZERO traversals,
 * which is the gate working, not a failure.
 *
 * Fully offline (leaf seam, no brain). Run:  pnpm tsx examples/graphs/proof-gate.ts
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

/** The backup result the proof was handed, read from its own task. */
function backupInTask(task: unknown): { snapshot?: string; bytes?: unknown } {
  return ((task as { evidence?: { backup?: unknown } } | undefined)?.evidence?.backup ?? {}) as {
    snapshot?: string
    bytes?: unknown
  }
}

export function proofGate(backupBytes = 4096): { graph: AgentGraph; opts: RunGraphOptions } {
  // ── The topology: plain data — the destructive edge fires only on a proven backup ──
  const graph: AgentGraph = {
    nodes: [
      workerNode('backup', 'Back up the volume.'),
      workerNode('proof', 'Verify the backup: report the bytes it holds.'),
      workerNode('purge', 'Purge the volume.'),
    ],
    entry: [{ node: 'backup', task: 'back up the volume' }],
    edges: [
      { kind: 'routes', from: 'backup', to: 'proof', directive: brief, evidence: ['backup'] },
      {
        kind: 'routes',
        from: 'proof',
        to: 'purge',
        directive: brief,
        when: { pointer: '/ok', equals: true },
        evidence: ['proof'],
      },
      { kind: 'routes', from: 'proof', to: { finish: 'no-backup' }, directive: brief },
    ],
    deliverable: {
      describe: 'a backed-up volume, purged only if the proof held',
      check: (out) => out !== undefined,
    },
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const opts: RunGraphOptions = {
    runId: 'gate',
    makeLeafAgent: leafSeam(received, {
      backup: { shots: [{ out: { snapshot: 'snap-1', bytes: backupBytes }, valid: true }] },
      // The proof reads the backup's result from its own task, never from `backupBytes`.
      proof: {
        shots: [
          {
            fromTask: (task: unknown) => {
              const { snapshot, bytes } = backupInTask(task)
              const counted = typeof bytes === 'number' ? bytes : 0
              return { snapshot, bytes: counted, ok: counted > 0 }
            },
            valid: true,
          },
        ],
      },
      purge: { shots: [{ out: { purged: true }, valid: true }] },
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  for (const bytes of [4096, 0]) {
    const { graph, opts } = proofGate(bytes)
    const res = await runGraph(graph, opts)
    printLedger(`proof-gate (backup holds ${bytes} bytes)`, res)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
