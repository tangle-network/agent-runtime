/**
 * arm-comparison — P22: the same task under three graphs, each run recorded, the best one picked.
 *
 * Two scripts in the corpus run one task under different arms and compare. Here the arms are three
 * graphs for one task shape: `solo` (one worker), `reviewed` (a builder plus a reviewer analyst
 * node) and `best-of-3` (three builders). Each runs offline, and each run is recorded in the graph
 * registry with its terminal accounting, exactly as the designer does it
 * (`recordGraphRun`). `pickBestGraph` then chooses by the registry's documented rule: delivered
 * beats failed, then fewer tokens. The solo arm fails the shared deliverable, `best-of-3` delivers
 * at the highest cost, and `reviewed` is the cheapest delivery, so its digest wins; `lookupGraph`
 * on the same task shape then replays that graph.
 *
 * Fully offline (scripted brains + leaf seam, registry in a temp directory).
 * Run:  pnpm tsx examples/graphs/arm-comparison.ts
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  digestOfGraph,
  type GraphRunRecord,
  graphRegistry,
  listGraphRuns,
  lookupGraph,
  pickBestGraph,
  promptHandle,
  recordGraphRun,
  taskShapeDigest,
} from '@tangle-network/agent-runtime/kernel'
import { type RunGraphTestOptions, runGraphWithTestBrain } from '../../src/testing'
import { driverNode, leafSeam, scriptedBrain, seen, workerNode } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

/** The one task every arm runs: the stable routing key a designer looks records up by. */
export const TASK_SHAPE = { kind: 'fix-bug', repo: 'parser' }

const fixed = {
  describe: 'a fix that passes its tests',
  check: (out: unknown) => (out as { fixed?: boolean } | undefined)?.fixed === true,
}
const budget = { maxIterations: 40, maxTokens: 100_000 }

export interface Arm {
  readonly name: string
  readonly graph: AgentGraph
  readonly opts: RunGraphTestOptions
}

const spawn = (node: string) => ({
  name: 'spawn_worker',
  arguments: { profile: { name: node }, task: 'fix the bug' },
})

/** The three arms. Each has its own graph and its own scripted run of the same task. */
export function arms(): Arm[] {
  const received: AgentProfile[] = []
  const pass = { shots: [{ out: { fixed: true }, valid: true }] }
  const fail = { shots: [{ out: { fixed: false }, valid: false }] }
  const root = driverNode('lead', 'Fix the bug with the workers you have.')
  return [
    {
      name: 'solo',
      graph: {
        nodes: [root, workerNode('solo', 'Fix it alone.')],
        edges: [
          { kind: 'delegates', from: 'lead', to: 'solo', directive: brief, maxTraversals: 1 },
        ],
        deliverable: fixed,
        budget,
      },
      opts: {
        runId: 'arm-solo',
        makeLeafAgent: leafSeam(received, { solo: fail }),
        brain: scriptedBrain([
          { toolCalls: [spawn('solo')] },
          { content: 'waiting' },
          { content: 'done' },
        ]),
      },
    },
    {
      name: 'reviewed',
      graph: {
        nodes: [root, workerNode('builder', 'Fix it.'), workerNode('reviewer', 'Review the fix.')],
        edges: [
          { kind: 'delegates', from: 'lead', to: 'builder', directive: brief, maxTraversals: 1 },
          {
            kind: 'analyzes',
            analyst: 'reviewer',
            over: ['builder'],
            to: 'lead',
            directive: report,
          },
        ],
        deliverable: fixed,
        budget,
      },
      opts: {
        runId: 'arm-reviewed',
        makeLeafAgent: leafSeam(received, {
          builder: { ...pass, withTrace: true },
          reviewer: pass,
        }),
        brain: scriptedBrain([
          { toolCalls: [spawn('builder')] },
          { content: 'waiting for the review', until: seen('"type":"finding"') },
          { content: 'done' },
        ]),
      },
    },
    {
      name: 'best-of-3',
      graph: {
        nodes: [
          root,
          ...['cand-a', 'cand-b', 'cand-c'].map((c) => workerNode(c, 'Fix it your way.')),
        ],
        edges: ['cand-a', 'cand-b', 'cand-c'].map((to) => ({
          kind: 'delegates' as const,
          from: 'lead',
          to,
          directive: brief,
          maxTraversals: 1,
        })),
        deliverable: fixed,
        budget,
      },
      opts: {
        runId: 'arm-best-of-3',
        workerSlots: 3,
        makeLeafAgent: leafSeam(received, { 'cand-a': pass, 'cand-b': pass, 'cand-c': pass }),
        brain: scriptedBrain([
          { toolCalls: ['cand-a', 'cand-b', 'cand-c'].map(spawn) },
          { content: 'waiting for the candidates', until: seen('"type":"settled"', 3) },
          { content: 'done' },
        ]),
      },
    },
  ]
}

export interface ArmComparison {
  readonly records: GraphRunRecord[]
  readonly winner: GraphRunRecord | undefined
  readonly winnerArm: string | undefined
  readonly arms: Arm[]
  /** What `lookupGraph` answers for the task shape afterwards. */
  readonly replay: Awaited<ReturnType<typeof lookupGraph>>
}

/** Run every arm, record each run in a registry under `registryDir`, and pick the best. */
export async function compareArms(registryDir: string): Promise<ArmComparison> {
  const registry = graphRegistry(registryDir)
  const taskDigest = taskShapeDigest(TASK_SHAPE)
  const all = arms()
  for (const arm of all) {
    const startedAt = new Date().toISOString()
    const res = await runGraphWithTestBrain(arm.graph, arm.opts)
    const delivered = res.result.kind === 'winner'
    const spent = res.result.spentTotal
    await recordGraphRun(registry, arm.graph, {
      graphDigest: digestOfGraph(arm.graph),
      taskDigest,
      startedAt,
      finishedAt: new Date().toISOString(),
      outcome: delivered ? { kind: 'delivered' } : { kind: 'no-winner', reason: res.result.kind },
      cost: {
        iterations: spent.iterations,
        tokens: spent.tokens.input + spent.tokens.output,
      },
      traversals: res.ledger.length,
    })
  }
  const records = await listGraphRuns(registry)
  const winner = pickBestGraph(records)
  return {
    records,
    winner,
    winnerArm: all.find((a) => digestOfGraph(a.graph) === winner?.graphDigest)?.name,
    arms: all,
    replay: await lookupGraph(registry, taskDigest),
  }
}

export async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'arm-comparison-'))
  const out = await compareArms(dir)
  console.log('\narm-comparison — registry records:')
  for (const r of out.records) {
    const arm = out.arms.find((a) => digestOfGraph(a.graph) === r.graphDigest)?.name
    console.log(`  ${arm}: ${r.outcome.kind}, ${r.cost.tokens} tokens, ${r.traversals} traversals`)
  }
  console.log(`winner: ${out.winnerArm} (digest ${out.winner?.graphDigest})`)
  console.log(`lookup for the task shape: ${out.replay.kind}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
