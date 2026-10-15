/**
 * The catalog of graph examples, and the structural signature that keeps them from repeating.
 *
 * Every example in this directory that builds a fixed `AgentGraph` is listed here with a factory
 * for its graph(s). `structuralSignature` reduces a graph to the facts that make one topology
 * different from another (node count by role, which tools the root holds, the model families,
 * each edge's kind, cap and continuity, where each analyst sits and where it reports). The audit
 * test (`tests/examples/graph-signature-audit.test.ts`) fails when two examples share a signature
 * or when a file in this directory is neither catalogued nor named in `NOT_GRAPH_FILES`, so a new
 * example cannot repeat an old shape and cannot dodge the check.
 *
 * Prompts, directives and scripted outputs are deliberately NOT part of the signature: two graphs
 * that differ only in wording are the same topology.
 */

import type { AgentGraph } from '@tangle-network/agent-runtime/kernel'
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

export interface CatalogEntry {
  /** The example file, without the extension. */
  readonly file: string
  /** The graph(s) it builds. An example that compares arms builds several. */
  readonly graphs: () => AgentGraph[]
}

export const catalog: readonly CatalogEntry[] = [
  { file: 'analyst-agent-review', graphs: () => [analystAgentReview().graph] },
  { file: 'best-of-n', graphs: () => [bestOfN().graph] },
  { file: 'collaborates-review-loop', graphs: () => [collaboratesReviewLoop().graph] },
  { file: 'shot-loop', graphs: () => [shotLoop().graph] },
  { file: 'shot-loop-resumed', graphs: () => [shotLoopResumed().graph] },
  { file: 'user-sim-conversation', graphs: () => [userSimConversation().graph] },
  { file: 'watchdog-steer', graphs: () => [watchdogSteer().graph] },
  { file: 'static-fanout-synthesize', graphs: () => [staticFanoutSynthesize().graph] },
  { file: 'per-item-pipeline', graphs: () => [perItemPipeline().graph] },
  { file: 'role-chain', graphs: () => [roleChain().graph] },
  { file: 'isolated-writers-integrate', graphs: () => [isolatedWritersIntegrate().graph] },
  { file: 'discovered-fanout-reduce', graphs: () => [discoveredFanoutReduce().graph] },
  { file: 'skeptic-majority', graphs: () => [skepticMajority().graph] },
  { file: 'conditional-skip', graphs: () => [conditionalSkip().graph] },
  { file: 'judge-panel', graphs: () => [judgePanel().graph] },
  { file: 'loop-until-dry', graphs: () => [loopUntilDry().graph] },
  { file: 'hierarchical-nested', graphs: () => [hierarchicalNested().graph] },
  { file: 'dependency-waves', graphs: () => [dependencyWaves().graph] },
  { file: 'proof-gate', graphs: () => [proofGate().graph] },
  { file: 'arm-comparison', graphs: () => arms().map((arm) => arm.graph) },
  {
    file: 'sandbox-e2e',
    graphs: () => [sandboxE2eGraph({ root: 'r', worker: 'w', skepticA: 'a', skepticB: 'b' })],
  },
]

/** Files here that are not a fixed-graph example, with the reason. */
export const NOT_GRAPH_FILES: Readonly<Record<string, string>> = {
  catalog: 'this file',
  shared: 'the offline seams every example imports',
  'designer-live': 'a live designer script that authors graphs at run time; it has no fixed graph',
}

/** The topology of one graph as a string: equal strings mean the same shape. */
export function structuralSignature(graph: AgentGraph): string {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  const delegates = graph.edges.filter((e) => e.kind === 'delegates')
  const analyzes = graph.edges.filter((e) => e.kind === 'analyzes')
  const delegated = new Set(delegates.map((e) => e.to))
  const root = delegates.map((e) => e.from).find((id) => !delegated.has(id)) ?? ''
  const analystNodes = new Set(analyzes.map((e) => e.analyst).filter((id) => nodes.has(id)))

  const roleOf = (id: string): string => {
    if (id === root) return 'root'
    if (analystNodes.has(id)) return 'analyst-node'
    return nodes.get(id)?.profile.tools?.[SPAWN_TOOL] === true ? 'nested-supervisor' : 'worker'
  }
  const roles: Record<string, number> = {}
  for (const n of graph.nodes) roles[roleOf(n.id)] = (roles[roleOf(n.id)] ?? 0) + 1

  const cap = (e: { maxTraversals?: number }) => e.maxTraversals ?? 'default'
  return JSON.stringify({
    roles: Object.fromEntries(Object.entries(roles).sort()),
    rootTools: Object.keys(nodes.get(root)?.profile.tools ?? {}).sort(),
    families: graph.nodes
      .filter((n) => n.id !== root)
      .map((n) => n.profile.model?.provider ?? '')
      .sort(),
    delegates: delegates
      .map((e) => `${roleOf(e.to)}|cap=${cap(e)}|${e.continuity ?? 'fresh'}`)
      .sort(),
    analyzes: analyzes
      .map(
        (e) =>
          `${nodes.has(e.analyst) ? 'node' : 'lens'}|over=${e.over.length}|to=${roleOf(e.to)}|cap=${cap(e)}`,
      )
      .sort(),
  })
}

/** The signature of a catalogued example: one graph's, or the sorted set of its arms'. */
export function exampleSignature(entry: CatalogEntry): string {
  return entry.graphs().map(structuralSignature).sort().join(' || ')
}
