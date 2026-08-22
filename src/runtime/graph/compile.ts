/**
 * Compile an authored graph against an engine's kind registry into the schedulable form. Every
 * refusal here happens before any spend: an unknown kind, a port that does not exist, a `data`
 * binding whose schemas cannot fit, a `delegates`/`data` edge into an oracle, a terminal with no
 * completion check (agent-runtime#971, #973).
 */
import { ValidationError } from '../../errors'
import type { DeliverableSpec } from '../supervise/completion-gate'
import {
  DEFAULT_MAX_NODE_VISITS,
  type EngineGraphEdge,
  type EngineGraphSpec,
  type JoinRule,
  validateEngineGraphSpec,
} from './definition'
import type { GraphEngine } from './engine'
import type { JsonSchema, NodeKind, PortSpec } from './kind'
import { formatRegistryHandle, parseRegistryHandle } from './registry'

/** A node's ports: its kind's declared outputs plus the two implicit ones every node has. */
export const IMPLICIT_OUTPUT_PORTS = ['out', 'trace'] as const

export interface CompiledEdge {
  readonly id: string
  readonly spec: EngineGraphEdge
  readonly fromPort: string
  readonly toPort: string
}

export interface CompiledNode {
  readonly id: string
  readonly kind: NodeKind
  readonly config: unknown
  readonly join: JoinRule
  readonly maxVisits: number
  readonly oracle: boolean
  readonly pure: boolean
  readonly terminal: boolean
  /** The check this node must pass to count DELIVERED; resolved per #973. */
  readonly deliverable?: DeliverableSpec<unknown>
  readonly inbound: ReadonlyArray<CompiledEdge>
  readonly outbound: ReadonlyArray<CompiledEdge>
  readonly spec: EngineGraphSpec['nodes'][number]
}

export interface CompiledGraph {
  readonly nodes: ReadonlyMap<string, CompiledNode>
  readonly edges: ReadonlyArray<CompiledEdge>
  readonly entries: ReadonlyArray<string>
  readonly terminals: ReadonlyArray<string>
  readonly root: string
  readonly maxNodeVisits: number
}

type NodePorts = {
  readonly inputs: ReadonlyArray<PortSpec>
  readonly outputs: ReadonlyArray<PortSpec>
}

/** A node's ports: node-level declarations merged OVER its kind's (the node wins on a name). */
function nodePorts(kind: NodeKind, node: EngineGraphSpec['nodes'][number]): NodePorts {
  const merge = (
    declared: ReadonlyArray<PortSpec>,
    own: ReadonlyArray<PortSpec> | undefined,
  ): ReadonlyArray<PortSpec> => {
    if (own === undefined || own.length === 0) return declared
    const names = new Set(own.map((port) => port.name))
    return [...own, ...declared.filter((port) => !names.has(port.name))]
  }
  return {
    inputs: merge(kind.inputs, node.ports?.inputs),
    outputs: merge(kind.outputs, node.ports?.outputs),
  }
}

function outputPort(ports: NodePorts, port: string): PortSpec | undefined {
  if ((IMPLICIT_OUTPUT_PORTS as ReadonlyArray<string>).includes(port)) {
    return { name: port, schema: {} }
  }
  return ports.outputs.find((candidate) => candidate.name === port)
}

function inputPort(ports: NodePorts, port: string): PortSpec | undefined {
  return ports.inputs.find((candidate) => candidate.name === port)
}

/**
 * Bounded structural acceptance: does a value of `source`'s shape fit `target`? Schemas with no
 * `type` accept anything; object targets require their `required` properties to be present and
 * accepted when the source declares properties. Depth-bounded — this is a compile-time tripwire,
 * not a full JSON Schema validator.
 */
export function schemaAccepts(source: JsonSchema, target: JsonSchema, depth = 0): boolean {
  if (depth > 6) return true
  const sourceType = source.type
  const targetType = target.type
  if (targetType === undefined || sourceType === undefined) return true
  const targets = Array.isArray(targetType) ? targetType : [targetType]
  const sources = Array.isArray(sourceType) ? sourceType : [sourceType]
  const overlap = sources.filter(
    (candidate) =>
      targets.includes(candidate === 'integer' ? 'number' : candidate) ||
      targets.includes(candidate),
  )
  if (overlap.length === 0) return false
  if (targets.includes('object') && sources.includes('object')) {
    const required = Array.isArray(target.required) ? (target.required as string[]) : []
    const sourceProps = source.properties as Record<string, JsonSchema> | undefined
    const targetProps = target.properties as Record<string, JsonSchema> | undefined
    if (sourceProps !== undefined) {
      for (const name of required) {
        const sourceProp = sourceProps[name]
        if (sourceProp === undefined) return false
        const targetProp = targetProps?.[name]
        if (targetProp !== undefined && !schemaAccepts(sourceProp, targetProp, depth + 1)) {
          return false
        }
      }
    }
  }
  if (targets.includes('array') && sources.includes('array')) {
    const sourceItems = source.items as JsonSchema | undefined
    const targetItems = target.items as JsonSchema | undefined
    if (sourceItems !== undefined && targetItems !== undefined) {
      return schemaAccepts(sourceItems, targetItems, depth + 1)
    }
  }
  return true
}

/**
 * Lower an authored graph against an engine's kind registry into the schedulable form, refusing
 * every structural defect before any spend.
 */
export function compileGraph(
  engine: GraphEngine,
  spec: EngineGraphSpec,
  context = 'compileGraph',
): CompiledGraph {
  validateEngineGraphSpec(spec, context)
  const kinds = new Map<string, NodeKind>()
  const configs = new Map<string, unknown>()
  for (const node of spec.nodes) {
    const handle = parseRegistryHandle(node.kind, `${context}: node ${node.id}`)
    const kind = engine.kinds.require(handle, `${context}: node ${node.id}`)
    kinds.set(node.id, kind)
    configs.set(node.id, kind.validateConfig(node.config ?? {}, `${context}: node ${node.id}`))
    if (node.flags?.pure && kind.id !== 'script') {
      throw new ValidationError(
        `${context}: node ${node.id} sets pure, which only a script node may claim`,
      )
    }
  }

  const compiledEdges: CompiledEdge[] = []
  const inbound = new Map<string, CompiledEdge[]>()
  const outbound = new Map<string, CompiledEdge[]>()
  for (const [index, edge] of spec.edges.entries()) {
    const who = `${context}: edge[${index}] ${edge.from.node}->${edge.to.node}`
    const fromKind = kinds.get(edge.from.node)
    const toKind = kinds.get(edge.to.node)
    if (!fromKind || !toKind) throw new ValidationError(`${who}: unresolved endpoint`)
    const toNode = spec.nodes.find((node) => node.id === edge.to.node)
    if (edge.kind !== 'analyzes' && toNode?.flags?.oracle) {
      // An edge to a grader leaks the rubric: an oracle is bound only by `analyzes`.
      throw new ValidationError(
        `${who}: a ${edge.kind} edge may not target oracle node ${edge.to.node}; use analyzes`,
      )
    }
    const fromPort = edge.from.port ?? (edge.kind === 'analyzes' ? 'trace' : 'out')
    if (edge.kind === 'analyzes' && fromPort !== 'trace') {
      throw new ValidationError(`${who}: an analyzes edge reads the trace port, got ${fromPort}`)
    }
    const fromNode = spec.nodes.find((node) => node.id === edge.from.node)
    const fromPorts = nodePorts(fromKind, fromNode as EngineGraphSpec['nodes'][number])
    const toPorts = nodePorts(toKind, toNode as EngineGraphSpec['nodes'][number])
    const sourcePort = outputPort(fromPorts, fromPort)
    if (!sourcePort) {
      const known = [...IMPLICIT_OUTPUT_PORTS, ...fromPorts.outputs.map((port) => port.name)]
      throw new ValidationError(
        `${who}: ${formatRegistryHandle(fromKind)} has no output port ${JSON.stringify(fromPort)}; known: ${known.join(', ')}`,
      )
    }
    let toPort = edge.to.port ?? ''
    if (edge.kind === 'data') {
      if (toPort === '') {
        if (toPorts.inputs.length === 1) toPort = toPorts.inputs[0]?.name ?? ''
        else {
          throw new ValidationError(
            `${who}: a data edge needs to.port; ${formatRegistryHandle(toKind)} declares ${toPorts.inputs.length} inputs`,
          )
        }
      }
      const targetPort = inputPort(toPorts, toPort)
      if (!targetPort) {
        throw new ValidationError(
          `${who}: ${formatRegistryHandle(toKind)} has no input port ${JSON.stringify(toPort)}; known: ${toPorts.inputs.map((port) => port.name).join(', ') || '(none)'}`,
        )
      }
      // A projection reshapes the payload, so the source schema no longer describes it; the
      // projected shape is checked at admission, not statically.
      if (edge.projection === undefined && !schemaAccepts(sourcePort.schema, targetPort.schema)) {
        throw new ValidationError(
          `${who}: output ${fromPort} (${JSON.stringify(sourcePort.schema.type ?? 'any')}) cannot fit input ${toPort} (${JSON.stringify(targetPort.schema.type ?? 'any')})`,
        )
      }
    }
    const compiled: CompiledEdge = {
      id: edge.id ?? `${edge.from.node}->${edge.to.node}#${index}`,
      spec: edge,
      fromPort,
      toPort: toPort === '' ? 'out' : toPort,
    }
    compiledEdges.push(compiled)
    outbound.set(edge.from.node, [...(outbound.get(edge.from.node) ?? []), compiled])
    inbound.set(edge.to.node, [...(inbound.get(edge.to.node) ?? []), compiled])
  }
  const dupes = new Set<string>()
  for (const edge of compiledEdges) {
    if (dupes.has(edge.id)) throw new ValidationError(`${context}: duplicate edge id ${edge.id}`)
    dupes.add(edge.id)
  }

  const entries = spec.nodes.filter((node) => (inbound.get(node.id) ?? []).length === 0)
  if (entries.length === 0) {
    throw new ValidationError(`${context}: no entry node — every node has an inbound edge`)
  }
  const root =
    spec.root ??
    (entries.length === 1
      ? (entries[0]?.id ?? '')
      : (() => {
          throw new ValidationError(
            `${context}: ${entries.length} entry nodes (${entries.map((node) => node.id).join(', ')}) — name spec.root`,
          )
        })())

  const nodes = new Map<string, CompiledNode>()
  const terminals: string[] = []
  for (const node of spec.nodes) {
    const kind = kinds.get(node.id)
    if (!kind) throw new ValidationError(`${context}: unresolved node ${node.id}`)
    const terminal = node.terminal ?? (outbound.get(node.id) ?? []).length === 0
    const deliverable = node.deliverable ?? (node.id === root ? spec.deliverable : undefined)
    if (terminal) terminals.push(node.id)
    nodes.set(node.id, {
      id: node.id,
      kind,
      config: configs.get(node.id),
      join: node.join ?? 'all',
      maxVisits: node.maxVisits ?? spec.maxNodeVisits ?? DEFAULT_MAX_NODE_VISITS,
      oracle: node.flags?.oracle ?? false,
      pure: node.flags?.pure ?? false,
      terminal,
      ...(deliverable === undefined ? {} : { deliverable }),
      inbound: inbound.get(node.id) ?? [],
      outbound: outbound.get(node.id) ?? [],
      spec: node,
    })
  }
  const unchecked = terminals.filter((id) => nodes.get(id)?.deliverable === undefined)
  if (unchecked.length === terminals.length) {
    // Termination is mandatory per terminal (#973): a graph none of whose terminals declares a
    // completion check (own, or the graph's on the root) can never prove it is done.
    throw new ValidationError(
      `${context}: no terminal declares a completion check (terminals: ${terminals.join(', ')}); give a node a deliverable or set spec.deliverable`,
    )
  }
  return {
    nodes,
    edges: compiledEdges,
    entries: entries.map((node) => node.id),
    terminals,
    root,
    maxNodeVisits: spec.maxNodeVisits ?? DEFAULT_MAX_NODE_VISITS,
  }
}
