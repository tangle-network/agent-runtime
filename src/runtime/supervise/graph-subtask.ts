/**
 * `run_graph`: a graph a manager starts as one subtask. The topology is read from model-written
 * data or a stored graph, validated exactly as `runGraph` validates a root graph, and carried on
 * the root profile so the kernel rebuilds the same graph layer on a fresh spawn and on recovery.
 */

import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { AnalystRegistry } from '../../mcp/tools/coordination-analysts'
import { isRecord } from '../../record-value'
import type { GraphEdge, GraphNode } from './graph'
import { graphRootProfile, validateGraphTopology } from './graph-overlay'
import { type PromptHandle, type PromptRegistry, promptHandle } from './prompt-registry'
import { runtimeGraphMetadataKey } from './provider-visible-profile'
import type { NodeId } from './types'

type DelegatesEdge = Extract<GraphEdge, { kind: 'delegates' }>
type AnalyzesEdge = Extract<GraphEdge, { kind: 'analyzes' }>
type MapsEdge = Extract<GraphEdge, { kind: 'maps' }>

/** A graph as a manager hands it to `run_graph`: the topology only. The tool's own arguments
 *  carry the budget (the subtask's reservation from the caller's pool) and the deliverable (the
 *  root node's task). */
export interface GraphSubtaskTopology {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
}

/** A validated `run_graph` graph, ready to spawn. */
export interface PreparedGraphSubtask {
  /** The root node's pinned profile with the graph brief, carrying the topology as Runtime-only
   *  metadata so the kernel rebuilds the same graph layer on a fresh spawn and on recovery. */
  readonly profile: AgentProfile
  readonly root: NodeId
  readonly nodes: ReadonlyArray<NodeId>
}

function parseDirective(raw: unknown, where: string): PromptHandle {
  if (typeof raw === 'string') return promptHandle(raw)
  if (isRecord(raw) && typeof raw.surface === 'string' && typeof raw.version === 'number') {
    return { surface: raw.surface, version: raw.version }
  }
  throw new ValidationError(
    `run_graph: ${where}.directive must be a versioned directive reference such as ` +
      "'delegates/worker-brief/v1'",
  )
}

/**
 * Read graph data a model wrote, or a stored graph's topology. Edge directives may be written as
 * `'<surface>/v<n>'` strings. The budget and deliverable are the tool's arguments, so a graph that
 * carries its own is refused rather than one of the two silently ignored.
 */
export function parseGraphSubtaskTopology(raw: unknown): GraphSubtaskTopology {
  if (!isRecord(raw)) {
    throw new ValidationError('run_graph: graph must be an object { nodes, edges }')
  }
  for (const key of Object.keys(raw)) {
    if (key === 'nodes' || key === 'edges') continue
    if (key === 'budget' || key === 'deliverable') {
      throw new ValidationError(
        `run_graph: graph.${key} is not read — pass ${key} as run_graph's own argument`,
      )
    }
    throw new ValidationError(`run_graph: graph.${key} is not part of a graph; use nodes and edges`)
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new ValidationError('run_graph: graph.nodes and graph.edges must be arrays')
  }
  const nodes = raw.nodes.map((node, index): GraphNode => {
    if (!isRecord(node) || typeof node.id !== 'string' || !isRecord(node.profile)) {
      throw new ValidationError(`run_graph: graph.nodes[${index}] must be { id, profile }`)
    }
    return { id: node.id, profile: node.profile as AgentProfile }
  })
  const edges = raw.edges.map((edge, index): GraphEdge => {
    const where = `graph.edges[${index}]`
    if (!isRecord(edge)) throw new ValidationError(`run_graph: ${where} must be an object`)
    const directive = parseDirective(edge.directive, where)
    if (edge.kind === 'delegates') {
      return { ...(edge as unknown as DelegatesEdge), directive }
    }
    if (edge.kind === 'analyzes') {
      return { ...(edge as unknown as AnalyzesEdge), directive }
    }
    if (edge.kind === 'maps') {
      return { ...(edge as unknown as MapsEdge), directive }
    }
    throw new ValidationError(`run_graph: ${where}.kind must be 'delegates', 'analyzes' or 'maps'`)
  })
  return { nodes, edges }
}

/**
 * Validate a `run_graph` graph and compose the profile its spawn runs: the root node's canonical
 * profile, the driver brief, and the topology under `metadata.agentRuntimeGraph`. That metadata is
 * part of the profile's identity, so a keyed `run_graph` that resumes runs the same graph, and the
 * provider-visible projection removes it before any provider sees the profile.
 */
export function prepareGraphSubtask(
  topology: GraphSubtaskTopology,
  opts: {
    readonly registry: PromptRegistry
    readonly analysts?: AnalystRegistry
    readonly guidance?: (profile: AgentProfile) => AgentProfile
  },
): PreparedGraphSubtask {
  const validated = validateGraphTopology(
    topology.nodes,
    topology.edges,
    opts.registry,
    opts.analysts,
  )
  const brief = graphRootProfile(validated, opts.registry)
  const marked: AgentProfile = {
    ...brief,
    metadata: {
      ...(brief.metadata ?? {}),
      [runtimeGraphMetadataKey]: { nodes: topology.nodes, edges: topology.edges },
    },
  }
  const parsed = agentProfileSchema.safeParse(opts.guidance ? opts.guidance(marked) : marked)
  if (!parsed.success) {
    throw new ValidationError(
      `run_graph: the graph's root profile is not a valid AgentProfile: ${parsed.error.message}`,
    )
  }
  return {
    profile: parsed.data,
    root: validated.root.id,
    nodes: topology.nodes.map((node) => node.id),
  }
}

/** The topology a `run_graph` root profile carries, or `undefined` for any other profile. */
export function graphSubtaskOf(profile: AgentProfile): GraphSubtaskTopology | undefined {
  const raw = profile.metadata?.[runtimeGraphMetadataKey]
  return raw === undefined ? undefined : parseGraphSubtaskTopology(raw)
}
