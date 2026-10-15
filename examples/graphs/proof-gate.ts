/**
 * proof-gate — P25 (README catalog): a destructive step is delegated only after an analyst verifies
 * its proof.
 *
 * Destructive stages (purge, drop, delete) must not run until a precondition is proven. The `purge`
 * node has its own `delegates` edge capped at one traversal, and a `proof` analyst NODE reads the
 * `backup` worker's settled output, as its task carried it, and reports the bytes that output says
 * were written. The proof has no input of its own: what it reports is derived from what it read.
 * The root spawns `purge` only on a positive byte count. With a real backup the ledger shows the
 * purge spawn; with an empty one the destructive edge has ZERO traversals, which is the gate
 * working, not a failure.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/proof-gate.ts
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

export function proofGate(backupBytes = 4096): { graph: AgentGraph; opts: RunGraphTestOptions } {
  // ── The topology: plain data — the destructive edge is capped at one traversal ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Purge only after the proof says the backup holds bytes.'),
      workerNode('backup', 'Back up the volume.'),
      workerNode('proof', 'Verify the backup: report the bytes it holds.'),
      workerNode('purge', 'Purge the volume.'),
    ],
    edges: [
      { kind: 'delegates', from: 'lead', to: 'backup', directive: brief, maxTraversals: 1 },
      { kind: 'delegates', from: 'lead', to: 'purge', directive: brief, maxTraversals: 1 },
      { kind: 'analyzes', analyst: 'proof', over: ['backup'], to: 'lead', directive: report },
    ],
    deliverable: {
      describe: 'a backed-up volume, purged only if the proof held',
      check: (out) => out !== undefined,
    },
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  let purging = false
  const opts: RunGraphTestOptions = {
    runId: 'gate',
    wake: { debounceMs: 0 },
    makeLeafAgent: leafSeam(received, {
      backup: {
        withTrace: true,
        shots: [{ out: { snapshot: 'snap-1', bytes: backupBytes }, valid: true }],
      },
      // The proof reads the backup's output from its own task, never from `backupBytes`.
      proof: {
        shots: [
          {
            fromSource: (backup: unknown) => {
              const { snapshot, bytes } = backup as { snapshot?: string; bytes?: number }
              return { snapshot, bytes: typeof bytes === 'number' ? bytes : 0 }
            },
            valid: true,
          },
        ],
      },
      purge: { shots: [{ out: { purged: true }, valid: true }] },
    }),
    brain: reactiveBrain((events, call) => {
      if (call === 0) {
        return {
          toolCalls: [
            {
              name: 'spawn_worker',
              arguments: { profile: { name: 'backup' }, task: 'back up the volume' },
            },
          ],
        }
      }
      const proof = findingsOf(events, 'proof')[0]
      if (proof === undefined) return { content: 'waiting for the proof' }
      if (Number(proof.findings.bytes) > 0 && !purging) {
        purging = true
        return {
          toolCalls: [
            {
              name: 'spawn_worker',
              arguments: { profile: { name: 'purge' }, task: 'purge the volume' },
            },
          ],
        }
      }
      if (purging && settledOf(events).length < 2) return { content: 'waiting for the purge' }
      return { content: 'done' }
    }),
  }
  return { graph, opts }
}

export async function main(): Promise<void> {
  for (const bytes of [4096, 0]) {
    const { graph, opts } = proofGate(bytes)
    const res = await runGraphWithTestBrain(graph, opts)
    printLedger(`proof-gate (backup holds ${bytes} bytes)`, res)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
