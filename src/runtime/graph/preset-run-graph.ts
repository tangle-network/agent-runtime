/**
 * `runGraph` as an engine graph (agent-runtime#982, #975) — a COMPILER, not a second runtime.
 *
 * `graphFromRunGraph` lowers today's `AgentGraph` into the engine's vocabulary: one supervisor
 * root carrying the graph, one pinned `agent` node per worker, the authored `delegates`/`analyzes`
 * edges. That gives a `runGraph` consumer a first-class engine graph it can inspect, diff, and use
 * as the starting point for authoring one natively — the migration path #975 asked for.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: run it. `runGraph` executes through `superviseAgentGraph`,
 * exactly as it always has. An earlier version of this module wrapped that call in a one-node
 * engine run, which read as "runGraph runs on the engine" while changing nothing about execution
 * and costing a second journal tree, a second budget pool and a second `Scope`. A wrapper that
 * moves no behaviour is a second source of truth, so it is gone: the graph a consumer runs and the
 * graph they can inspect are produced from the same `AgentGraph`, and only one of them executes.
 *
 * The engine EXECUTES a graph a consumer authors directly (`runEngineGraph`), where nodes are
 * scheduled over `data` edges, guards decide traversal, and the fold makes it restartable.
 */
import { ValidationError } from '../../errors'
import type { AgentGraph, RunGraphOptions } from '../supervise/graph'
import type { EngineGraphEdge, EngineGraphNode, EngineGraphSpec } from './definition'

/** The kind id the root node carries: a supervisor holding the whole `AgentGraph`. */
export const RUN_GRAPH_ROOT_KIND = 'supervisor/v1'

/**
 * Compile an `AgentGraph` into the engine graph that describes it. Pure: nothing runs, nothing is
 * registered, no executor is built. A `delegates` edge is MODEL-fired (#971) — its target is
 * spawned by the supervisor through the coordination protocol — so every worker node is marked
 * `entry: false`, which is exactly what the engine's scheduler would honour if this graph were
 * handed to it.
 */
export function graphFromRunGraph(graph: AgentGraph, options: RunGraphOptions): EngineGraphSpec {
  const root = graph.nodes[0]
  if (root === undefined) throw new ValidationError('graphFromRunGraph: a graph needs a root node')
  const nodes: EngineGraphNode[] = graph.nodes.map((node, index) =>
    index === 0
      ? {
          id: node.id,
          kind: RUN_GRAPH_ROOT_KIND,
          config: {
            perWorker: options.perWorker ?? graph.budget,
            ...(options.maxLiveWorkers === undefined
              ? {}
              : { maxLiveWorkers: options.maxLiveWorkers }),
          },
          profile: node.profile,
          budget: graph.budget,
          terminal: true,
          deliverable: graph.deliverable,
        }
      : {
          id: node.id,
          kind: 'agent/v1',
          profile: node.profile,
          entry: false,
          terminal: false,
          budget: options.perWorker ?? graph.budget,
        },
  )
  const edges: EngineGraphEdge[] = graph.edges.flatMap((edge): EngineGraphEdge[] =>
    edge.kind === 'delegates'
      ? [
          {
            kind: 'delegates',
            from: { node: edge.from },
            to: { node: edge.to },
            directive: edge.directive,
            ...(edge.maxTraversals !== undefined ? { maxTraversals: edge.maxTraversals } : {}),
          },
        ]
      : // One engine edge per analysed source: engine edges are 1:1, the authored form fans in.
        edge.over.map((source) => ({
          kind: 'analyzes' as const,
          from: { node: source, port: 'trace' },
          to: { node: edge.to },
          directive: edge.directive,
          ...(edge.maxTraversals !== undefined ? { maxTraversals: edge.maxTraversals } : {}),
        })),
  )
  return { nodes, edges, root: root.id, deliverable: graph.deliverable }
}
