import { ValidationError } from '../../errors'
import type { GraphOverlay } from './graph-overlay'
import { graphRegistry, loadGraph } from './graph-registry'
import { type GraphSubtaskTopology, parseGraphSubtaskTopology } from './graph-topology'

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
  // The stored graph's topology keys exactly as the inline form passes them, so a flow graph keeps
  // its entry and a gated graph is refused as it is inline.
  return parseGraphSubtaskTopology({
    nodes: stored.nodes,
    edges: stored.edges,
    ...(stored.entry === undefined ? {} : { entry: stored.entry }),
    ...(stored.gates === undefined ? {} : { gates: stored.gates }),
  })
}

/**
 * What a `run_graph` subtask settles with once its root manager returned and its subtree closed:
 * the root's result and the graph's edge ledger. A delegates cap that refused work while the root
 * delivered nothing ended the graph, not the task, so that fails loud with the cap named, as
 * `runGraph` fails a root graph with `GraphEdgeCapError`. A flow subtask that stopped (a down
 * settle, a stop edge) or could not route fails the same way, so a maps item's `onItemFailure`
 * decides its join exactly as it does for a down item node.
 */
export async function graphSubtaskOutput(
  overlay: GraphOverlay,
  out: unknown,
  flowFailure?: () => string | undefined,
): Promise<unknown> {
  const { ledger, exhaustedEdges, exhaustedDelegates } = await overlay.settle()
  const ended = flowFailure?.()
  if (ended !== undefined) {
    throw new ValidationError(
      `run_graph: the flow graph ended without a result (${ended}); the edge ledger is in the ` +
        'run journal',
    )
  }
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
