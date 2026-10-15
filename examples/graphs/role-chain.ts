/**
 * role-chain — P02 (README catalog): a sequential role chain, each stage briefed with the previous
 * stage's output.
 *
 * The topology is three worker nodes under one root, one `delegates` edge apiece, each capped at
 * one traversal. The ORDER lives in the driver: it spawns a stage only after the previous one
 * settles, reads that stage's output with `observe_agent`, and writes it into the next stage's
 * task. The root never holds the outputs itself: what crosses each edge is what the previous worker
 * actually produced, so a different scout finding changes the builder's brief. Once the reviewer
 * settles, the root delivers the reviewed fix through `submit_result`.
 *
 * Fully offline (reactive brain + leaf seam). Run:  pnpm tsx examples/graphs/role-chain.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle } from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import {
  DECIDING_ROOT_TOOLS,
  driverNode,
  leafSeam,
  observedOutput,
  printLedger,
  reactiveBrain,
  type ScriptedTurn,
  settledOf,
  spawnedId,
  submitTurn,
  workerNode,
} from './shared'

const brief = promptHandle('delegates/worker-brief/v1')

const STAGES = ['scout', 'builder', 'reviewer'] as const
type Stage = (typeof STAGES)[number]

/** What each stage's worker produces. The root never sees these values except through
 *  `observe_agent`. */
export const STAGE_OUT: Readonly<Record<Stage, unknown>> = {
  scout: { file: 'src/parse.ts', defect: 'drops a trailing comma' },
  builder: { patch: 'keep the trailing comma in src/parse.ts', test: 'parse.trailing-comma' },
  reviewer: { approved: true },
}

const TASK: Readonly<Record<Stage, string>> = {
  scout: 'locate the bug',
  builder: 'fix it. The scout reported:',
  reviewer: 'review the fix. The builder reported:',
}

export function roleChain(outputs: Readonly<Record<Stage, unknown>> = STAGE_OUT): {
  graph: AgentGraph
  opts: RunGraphTestOptions
  /** The task each stage's worker received, by node. */
  tasks: () => Readonly<Partial<Record<Stage, unknown>>>
} {
  // ── The topology: plain data ──
  const graph: AgentGraph = {
    nodes: [
      driverNode('lead', 'Run scout, builder, reviewer in order.', DECIDING_ROOT_TOOLS),
      workerNode('scout', 'Find where the bug is.'),
      workerNode('builder', 'Fix what the scout found.'),
      workerNode('reviewer', 'Review the builder fix.'),
    ],
    edges: STAGES.map((to) => ({
      kind: 'delegates' as const,
      from: 'lead',
      to,
      directive: brief,
      maxTraversals: 1,
    })),
    deliverable: {
      describe: 'the builder fix with the reviewer verdict on it',
      check: (out) => {
        const r = out as { fix?: unknown; review?: unknown } | undefined
        return r?.fix !== undefined && r.review !== undefined
      },
    },
    budget: { maxIterations: 40, maxTokens: 100_000 },
  }

  const tasks: Partial<Record<Stage, unknown>> = {}
  const received: AgentProfile[] = []
  const spawn = (stage: Stage, task: string): ScriptedTurn => ({
    toolCalls: [
      { id: `spawn-${stage}`, name: 'spawn_worker', arguments: { profile: { name: stage }, task } },
    ],
  })
  const read = (stage: Stage, workerId: string): ScriptedTurn => ({
    toolCalls: [{ id: `read-${stage}`, name: 'observe_agent', arguments: { workerId } }],
  })
  const opts: RunGraphTestOptions = {
    runId: 'chain',
    makeLeafAgent: leafSeam(
      received,
      Object.fromEntries(STAGES.map((s) => [s, { shots: [{ out: outputs[s], valid: true }] }])),
      {
        onSpawnContext: (node, context) => {
          tasks[node as Stage] = context?.task
        },
      },
    ),
    brain: reactiveBrain((events, call, results) => {
      const settled = new Set(settledOf(events).map((s) => s.id))
      // Walk the chain: the first stage not yet spawned, settled, or read decides the next move.
      let previous: unknown
      for (const [i, stage] of STAGES.entries()) {
        const workerId = spawnedId(results, `spawn-${stage}`)
        if (workerId === undefined) {
          const task = i === 0 ? TASK[stage] : `${TASK[stage]} ${JSON.stringify(previous)}`
          return spawn(stage, task)
        }
        if (!settled.has(workerId)) return { content: `waiting for the ${stage}` }
        previous = observedOutput(results, `read-${stage}`)
        if (previous === undefined) return read(stage, workerId)
      }
      return submitTurn(results, call, {
        fix: observedOutput(results, 'read-builder'),
        review: observedOutput(results, 'read-reviewer'),
      })
    }),
  }
  return { graph, opts, tasks: () => tasks }
}

export async function main(): Promise<void> {
  const { graph, opts, tasks } = roleChain()
  const res = await runGraphWithTestBrain(graph, opts)
  printLedger('role-chain', res)
  for (const [stage, task] of Object.entries(tasks())) console.log(`  ${stage} task: ${task}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
