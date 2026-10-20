import { ValidationError } from '../../errors'
import {
  type GraphOverlay,
  type GraphSubtaskTopology,
  parseGraphSubtaskTopology,
} from './graph-overlay'
import { graphRegistry, loadGraph } from './graph-registry'

/** A stored graph's topology, from the registry `SuperviseOptions.graphRegistry` names. */
export async function storedGraphTopology(
  dir: string | undefined,
  digest: string,
): Promise<GraphSubtaskTopology> {
  if (dir === undefined) {
    throw new ValidationError(
      'run_graph: this run names no graph registry (SuperviseOptions.graphRegistry), so a ' +
        'graphDigest cannot resolve; pass the graph as data',
    )
  }
  const stored = await loadGraph(graphRegistry(dir), digest)
  if (stored === undefined) {
    throw new ValidationError(`run_graph: the graph registry holds no graph ${digest}`)
  }
  return parseGraphSubtaskTopology({ nodes: stored.nodes, edges: stored.edges })
}

/**
 * What a `run_graph` subtask settles with once its root manager returned and its subtree closed:
 * the root's result and the graph's edge ledger. A delegates cap that refused work while the root
 * delivered nothing ended the graph, not the task, so that fails loud with the cap named, as
 * `runGraph` fails a root graph with `GraphEdgeCapError`.
 */
export async function graphSubtaskOutput(overlay: GraphOverlay, out: unknown): Promise<unknown> {
  const { ledger, exhaustedEdges, exhaustedDelegates } = await overlay.settle()
  if ((out === undefined || out === null) && exhaustedDelegates.length > 0) {
    throw new ValidationError(
      `run_graph: edge traversal cap exhausted on ${exhaustedDelegates.join(', ')} and the graph ` +
        'delivered nothing — the cap (the cyclic-graph backstop), not the task, ended it; the ' +
        'edge ledger is in the run journal',
    )
  }
  return {
    deliverable: out === undefined ? null : out,
    edges: ledger,
    ...(exhaustedEdges.length === 0 ? {} : { exhaustedEdges }),
  }
}
