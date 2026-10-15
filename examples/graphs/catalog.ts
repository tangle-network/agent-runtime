/**
 * The catalog of graph examples, and the two fingerprints that keep them from repeating.
 *
 * Every graph an example in this directory builds is listed here ONCE, by name: an example that
 * compares arms lists each arm. The audit test (`tests/examples/graph-signature-audit.test.ts`)
 * compares graphs pairwise, in two steps.
 *
 *   1. `graphSignature` reduces a graph to its topology with the incidental numbers bucketed away:
 *      node count by role (one or many), each edge's kind, continuity and destination role, each
 *      analyst's form (node or lens), and whether an edge DECLARES repetition (an explicit cap
 *      above one) — not the exact cap, not the width, not the model provider, not the root's
 *      non-spawn grants, not any wording. Two graphs with equal signatures are the same topology.
 *   2. For graphs with equal signatures, `ledgerShape` runs each example's offline scenarios and
 *      fingerprints what the run DID: the driver's spawn waves in order (how many workers each
 *      turn spawned, one or many, with consecutive equal waves collapsed), the analyzes rows, the
 *      continuity stamps and the outcomes. Equal topology plus equal ledger shape is a duplicate.
 *
 * A graph that is another catalogued graph's topology on purpose says so with `reuses` (an arm of
 * a comparison, the live run of an offline example); the audit checks that the named graph really
 * has the same signature, so the claim cannot go stale. Prompts, directives and scripted outputs
 * are never part of either fingerprint: two graphs that differ only in wording are one example.
 */

import type { AgentGraph, GraphResult } from '@tangle-network/agent-runtime/kernel'
import {
  type RunGraphTestOptions,
  runGraphWithTestBrain,
  type ToolLoopChat,
} from '../../src/testing'
import { analystAgentReview } from './analyst-agent-review'
import { arms } from './arm-comparison'
import { bestOfN } from './best-of-n'
import { collaboratesReviewLoop } from './collaborates-review-loop'
import { conditionalSkip } from './conditional-skip'
import { dependencyWaves } from './dependency-waves'
import { discoveredFanoutReduce } from './discovered-fanout-reduce'
import { hierarchicalNested } from './hierarchical-nested'
import { isolatedWritersIntegrate } from './isolated-writers-integrate'
import { judgePanel } from './judge-panel'
import { loopUntilDry } from './loop-until-dry'
import { perItemPipeline } from './per-item-pipeline'
import { proofGate } from './proof-gate'
import { roleChain } from './role-chain'
import { sandboxE2eGraph } from './sandbox-e2e'
import { SPAWN_TOOL } from './shared'
import { shotLoop } from './shot-loop'
import { shotLoopResumed } from './shot-loop-resumed'
import { skepticMajority } from './skeptic-majority'
import { staticFanoutSynthesize } from './static-fanout-synthesize'
import { userSimConversation } from './user-sim-conversation'
import { watchdogSteer } from './watchdog-steer'

/** One run of a catalogued graph. `opts` is absent when the graph cannot run offline. */
export interface CatalogRun {
  readonly graph: AgentGraph
  readonly opts?: RunGraphTestOptions
}

export interface CatalogGraph {
  /** The example file, without the extension. */
  readonly file: string
  /** The graph's name: the file, or `file/arm` for an example that builds several graphs. */
  readonly name: string
  /** Every scenario the example runs this graph in (one graph, different scripted inputs). */
  readonly runs: () => CatalogRun[]
  /** This graph is the named graph's topology on purpose, and why. */
  readonly reuses?: { readonly name: string; readonly why: string }
}

const one = (file: string, run: () => CatalogRun, extra: Partial<CatalogGraph> = {}) => ({
  file,
  name: file,
  runs: () => [run()],
  ...extra,
})

export const catalog: readonly CatalogGraph[] = [
  one('analyst-agent-review', analystAgentReview),
  one('best-of-n', bestOfN),
  one('collaborates-review-loop', collaboratesReviewLoop),
  one('shot-loop', shotLoop),
  one('shot-loop-resumed', shotLoopResumed),
  one('user-sim-conversation', () => ({ graph: userSimConversation().graph }), {
    reuses: {
      name: 'shot-loop-resumed',
      why: 'the resumed loop again, run on chatTransportExecutor: what it adds is the executor and the wire-level history, not a topology',
    },
  }),
  one('watchdog-steer', watchdogSteer),
  {
    file: 'static-fanout-synthesize',
    name: 'static-fanout-synthesize',
    runs: () => [
      staticFanoutSynthesize(),
      staticFanoutSynthesize({ risk: 'high', cost: 'medium', fit: 'low' }),
    ],
  },
  one('per-item-pipeline', perItemPipeline),
  one('role-chain', roleChain),
  one('isolated-writers-integrate', isolatedWritersIntegrate),
  one('discovered-fanout-reduce', discoveredFanoutReduce),
  {
    file: 'skeptic-majority',
    name: 'skeptic-majority',
    runs: () => [
      skepticMajority(['holds', 'holds', 'refuted']),
      skepticMajority(['refuted', 'holds', 'refuted']),
    ],
  },
  {
    file: 'conditional-skip',
    name: 'conditional-skip',
    runs: () => [conditionalSkip(['null deref', 'stale cache']), conditionalSkip([])],
  },
  one('judge-panel', judgePanel),
  one('loop-until-dry', loopUntilDry),
  one('hierarchical-nested', hierarchicalNested),
  one('dependency-waves', dependencyWaves),
  { file: 'proof-gate', name: 'proof-gate', runs: () => [proofGate(4096), proofGate(0)] },
  ...['solo', 'reviewed', 'best-of-3'].map((arm) => ({
    file: 'arm-comparison',
    name: `arm-comparison/${arm}`,
    runs: () => arms().filter((a) => a.name === arm),
    ...(arm === 'reviewed'
      ? {
          reuses: {
            name: 'analyst-agent-review',
            why: 'an arm of the comparison: one builder reviewed by an analyst node, the existing shape',
          },
        }
      : arm === 'best-of-3'
        ? {
            reuses: {
              name: 'best-of-n',
              why: 'an arm of the comparison: parallel candidates under one root, the existing shape',
            },
          }
        : {}),
  })),
  one(
    'sandbox-e2e',
    () => ({ graph: sandboxE2eGraph({ root: 'r', worker: 'w', skepticA: 'a', skepticB: 'b' }) }),
    {
      reuses: {
        name: 'skeptic-majority',
        why: 'the live run of the skeptic panel on the sandbox backend; it cannot run offline',
      },
    },
  ),
]

/** Files here that are not a fixed-graph example, with the reason. */
export const NOT_GRAPH_FILES: Readonly<Record<string, string>> = {
  catalog: 'this file',
  shared: 'the offline seams every example imports',
  'designer-live': 'a live designer script that authors graphs at run time; it has no fixed graph',
}

type Role = 'root' | 'worker' | 'analyst-node' | 'nested-supervisor'

/** Who each node is in the graph: the root, a worker, an analyst node, or a nested supervisor. */
export function rolesOf(graph: AgentGraph): (id: string) => Role {
  const delegates = graph.edges.filter((e) => e.kind === 'delegates')
  const delegated = new Set(delegates.map((e) => e.to))
  const root = delegates.map((e) => e.from).find((id) => !delegated.has(id)) ?? ''
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  const analysts = new Set(
    graph.edges.flatMap((e) => (e.kind === 'analyzes' && nodes.has(e.analyst) ? [e.analyst] : [])),
  )
  return (id) => {
    if (id === root) return 'root'
    if (analysts.has(id)) return 'analyst-node'
    return nodes.get(id)?.profile.tools?.[SPAWN_TOOL] === true ? 'nested-supervisor' : 'worker'
  }
}

/** One or many: the width bucket. */
const width = (n: number): string => (n <= 1 ? String(n) : 'many')

/** A multiset of tokens, each with its count bucketed. */
function bucketed(tokens: ReadonlyArray<string>): string[] {
  const counts = new Map<string, number>()
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].map(([t, n]) => `${t}×${width(n)}`).sort()
}

/** An edge declares repetition only with an explicit cap above one. No cap is the cyclic-graph
 *  backstop, not a declared loop, so it buckets with a cap of one. */
const repeats = (e: { maxTraversals?: number }): string =>
  e.maxTraversals !== undefined && e.maxTraversals > 1 ? 'repeat' : 'once'

/** The topology of one graph as a string, incidental numbers bucketed away: equal strings mean
 *  the same shape. */
export function graphSignature(graph: AgentGraph): string {
  const role = rolesOf(graph)
  const nodes = new Set(graph.nodes.map((n) => n.id))
  return JSON.stringify({
    roles: bucketed(graph.nodes.map((n) => role(n.id))),
    delegates: bucketed(
      graph.edges.flatMap((e) =>
        e.kind === 'delegates' ? [`${role(e.to)}|${repeats(e)}|${e.continuity ?? 'fresh'}`] : [],
      ),
    ),
    analyzes: bucketed(
      graph.edges.flatMap((e) =>
        e.kind === 'analyzes'
          ? [
              `${nodes.has(e.analyst) ? 'node' : 'lens'}|over=${width(e.over.length)}|to=${role(e.to)}|${repeats(e)}`,
            ]
          : [],
      ),
    ),
  })
}

/** What one run DID, as a string: the driver's spawn waves in order (each wave the roles it
 *  spawned or steered, counts bucketed, consecutive equal waves collapsed to `…`), the analyzes
 *  rows by destination role, and the continuity stamps and outcomes the ledger recorded. */
export async function ledgerShape(run: Required<CatalogRun>): Promise<string> {
  const role = rolesOf(run.graph)
  const waves: string[] = []
  const inner = run.opts.brain
  const brain: ToolLoopChat = async (messages, tools, context) => {
    const turn = await inner(messages, tools, context)
    const wave = turn.toolCalls.flatMap((tc) => {
      if (tc.name === 'steer_agent') return ['steer']
      if (tc.name !== 'spawn_worker') return []
      const args = JSON.parse(tc.arguments) as { profile?: { name?: string } }
      return [role(args.profile?.name ?? '')]
    })
    if (wave.length > 0) waves.push(bucketed(wave).join('+'))
    return turn
  }
  const res: GraphResult = await runGraphWithTestBrain(run.graph, { ...run.opts, brain })
  const collapsed: string[] = []
  for (const wave of waves) {
    const last = collapsed.at(-1)
    if (last === wave || last === `${wave}…`) collapsed[collapsed.length - 1] = `${wave}…`
    else collapsed.push(wave)
  }
  const kinds = (pick: (row: GraphResult['ledger'][number]) => string) =>
    [...new Set(res.ledger.map(pick))].sort()
  return JSON.stringify({
    waves: collapsed,
    analyzes: bucketed(res.ledger.filter((r) => r.kind === 'analyzes').map((r) => role(r.to))),
    continuity: kinds((r) => r.continuity),
    outcomes: kinds((r) => r.outcome),
  })
}

/** The ledger shape of every offline scenario of a catalogued graph, deduplicated and sorted;
 *  `undefined` when the graph cannot run offline. */
export async function exampleShape(entry: CatalogGraph): Promise<string[] | undefined> {
  const runs = entry.runs()
  if (runs.some((r) => r.opts === undefined)) return undefined
  const shapes = []
  for (const run of runs) shapes.push(await ledgerShape(run as Required<CatalogRun>))
  return [...new Set(shapes)].sort()
}
