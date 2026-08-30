/**
 * shot-loop-resumed — the VB shot shape with session CONTINUITY as data.
 *
 * A 'reviewer' root drives one 'coder' worker under a 3-shot cap, exactly like `shot-loop` —
 * except the delegates edge declares `continuity: 'resume'`, so every shot after the first is a
 * RESUME of the coder's prior session instead of a fresh respawn: the kernel spawns a NEW live
 * worker bound to the SAME node whose spawn context carries `resume: { ofWorker, sequence }`,
 * and the executor seam owns the actual re-attachment (e.g. a backend session id). The kernel
 * keeps identity, ordering, ledger truth, and spend continuity — every shot's spend draws from
 * the one conserved pool, and the ledger stamps how each hop continued: traversal 1 `fresh`
 * (the effective first spawn), traversals 2+ `resume`. Caps count resumes exactly like fresh
 * spawns.
 *
 * Fully offline (scripted brain + leaf seam). Run:  pnpm tsx examples/graphs/shot-loop-resumed.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  promptHandle,
  type WorkerSpawnContext,
} from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { leafSeam, offlineProfile, printLedger, scriptedBrain } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

export function shotLoopResumed(): {
  graph: AgentGraph
  opts: RunGraphTestOptions
  contexts: Array<WorkerSpawnContext | undefined>
} {
  // ── The topology: plain data — continuity is one field on the edge ──
  const graph: AgentGraph = {
    nodes: [
      { id: 'reviewer', profile: offlineProfile('reviewer', 'Verify.') },
      { id: 'coder', profile: offlineProfile('coder', 'Make tests pass.') },
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'reviewer',
        to: 'coder',
        directive: brief,
        maxTraversals: 3,
        continuity: 'resume',
      },
    ],
    deliverable: {
      describe: 'coder output whose tests pass',
      check: (out) => (out as { tests?: string } | undefined)?.tests === 'pass',
    },
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }

  const received: AgentProfile[] = []
  const contexts: Array<WorkerSpawnContext | undefined> = []
  const opts: RunGraphTestOptions = {
    runId: 'rshots',
    makeLeafAgent: leafSeam(
      received,
      {
        // Shots 1 and 2 fail their tests; shot 3 — resumed twice from the same session — passes.
        coder: {
          shots: [
            { out: { tests: 'fail' }, valid: false },
            { out: { tests: 'fail' }, valid: false },
            { out: { tests: 'pass' }, valid: true },
          ],
        },
      },
      { onSpawnContext: (_nodeId, context) => contexts.push(context) },
    ),
    brain: scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { name: 'coder' }, task: 'shot 1: make the tests pass' },
          },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { name: 'coder' }, task: 'shot 2: continue — fix the failures' },
          },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      {
        toolCalls: [
          {
            name: 'spawn_worker',
            arguments: { profile: { name: 'coder' }, task: 'shot 3: finish the failing suite' },
          },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'done' },
    ]),
  }
  return { graph, opts, contexts }
}

export async function main(): Promise<void> {
  const { graph, opts, contexts } = shotLoopResumed()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('shot-loop-resumed', res)
  console.log('SPAWN CONTINUITY (what the executor seam received):')
  for (const context of contexts) {
    const lineage =
      context?.resume === undefined
        ? ''
        : ` resume.ofWorker=${context.resume.ofWorker} sequence=${context.resume.sequence}`
    console.log(`  ${context?.assignmentId}: ${context?.continuity ?? 'fresh'}${lineage}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
