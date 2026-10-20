import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { McpToolDescriptor } from '../server'
import { spawnBudgetArg } from './coordination-budget'
import type { CoordinationToolsOptions, SpawnAdmission } from './coordination-contracts'
import { obj, str } from './coordination-input'
export function mountGraphsTools({
  opts,
  tools,
  admitSpawn,
}: {
  readonly opts: CoordinationToolsOptions
  readonly tools: McpToolDescriptor[]
  readonly admitSpawn: (input: SpawnAdmission) => Promise<unknown>
}): void {
  if (opts.graphs) {
    const graphs = opts.graphs
    tools.push({
      name: 'run_graph',
      description:
        'Run an agent graph as ONE subtask instead of one worker: a fixed topology whose nodes are ' +
        'profiles and whose edges carry directives, driven by its root node. Pass `graph` ' +
        "({ nodes: [{ id, profile }], edges: [{ kind: 'delegates', from, to, directive: " +
        "'delegates/worker-brief/v1' }] }, where each profile.name equals its node id and the " +
        'root node grants agent_runtime_coordination_spawn_worker) or `graphDigest` (a graph ' +
        "stored in this run's graph registry). `deliverable` is what the graph must deliver; it " +
        "becomes the root node's task. The subtask reserves `budget` (merged over the per-worker " +
        'default, as for spawn_worker) from your conserved pool, and the whole graph spends only ' +
        'that. Every node runs its own pinned profile, and a node settles on its own ' +
        'submit_result: the run keeps its checks and graders, which judge your result and are ' +
        'never graph nodes. Returns a workerId as spawn_worker does; end your turn and ' +
        'you are woken when the graph settles. Its output is { deliverable, edges }: the root ' +
        "node's result and the edge ledger (every traversal, also recorded in the run journal).",
      inputSchema: {
        type: 'object',
        properties: {
          graph: {
            type: 'object',
            description:
              'The graph as data: { nodes: [{ id, profile }], edges: [...] }. Delegates edges ' +
              'run from the root to each worker node; an optional analyzes edge ' +
              "({ kind: 'analyzes', analyst, over, to, directive }) names an analyst node.",
            additionalProperties: true,
          },
          graphDigest: {
            type: 'string',
            description: "A stored graph's digest in this run's graph registry, instead of graph.",
          },
          deliverable: {
            type: 'string',
            description: "What the graph must deliver. It becomes the root node's task.",
          },
          budget: spawnBudgetArg,
          label: { type: 'string', description: 'Optional trace label.' },
          key: {
            type: 'string',
            description:
              'Optional semantic name for this subtask. The same key never runs twice, as for ' +
              'spawn_worker: a completed key returns its committed result.',
          },
        },
        required: ['deliverable'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const deliverable = typeof a.deliverable === 'string' ? a.deliverable.trim() : ''
        if (deliverable.length === 0) {
          return {
            error: 'invalid-graph' as const,
            reason: 'deliverable must be a non-empty string: what the graph must deliver',
          }
        }
        if ((a.graph === undefined) === (a.graphDigest === undefined)) {
          return {
            error: 'invalid-graph' as const,
            reason: 'pass exactly one of graph (the graph as data) or graphDigest (a stored graph)',
          }
        }
        if (a.graphDigest !== undefined && typeof a.graphDigest !== 'string') {
          return { error: 'invalid-graph' as const, reason: 'graphDigest must be a string' }
        }
        const key = a.key === undefined ? undefined : str(a.key, 'key')
        const prepared = await graphs.prepare(
          typeof a.graphDigest === 'string' ? { graphDigest: a.graphDigest } : { graph: a.graph },
        )
        if (!prepared.ok) return { error: 'invalid-graph' as const, reason: prepared.reason }
        const profile = detachedFrozen(prepared.profile)
        return admitSpawn({
          profile,
          args: a,
          task: deliverable,
          key,
          // A graph root starts fresh: its continuity is its nodes' edges, inside the graph.
          continuity: { continuity: 'fresh' },
          successorOf: undefined,
          // A graph root is canonical already; this manager's resolver still judges it.
          preflightProfile: () =>
            opts.resolveSpawnProfile ? detachedFrozen(opts.resolveSpawnProfile(profile)) : profile,
          resourcesFromPath: [],
          defaultLabel: `graph:${prepared.root}`,
          accepted: { graph: { root: prepared.root, nodes: prepared.nodes } },
        })
      },
    })
  }
}
