/**
 * The authored form of an engine graph (agent-runtime#971, #973, #968): typed-port nodes over
 * three edge kinds, each guardable by the one predicate tree; `data` edges may carry one pure
 * projection. ADC's `${steps.<id>.field}` strings are an AUTHORING surface that compiles down to
 * these port references — this is the runtime form, checked before any spend.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { DeliverableSpec } from '../supervise/completion-gate'
import type { PromptHandle } from '../supervise/prompt-registry'
import type { Budget } from '../supervise/types'
import { type Condition, validateCondition } from './condition'
import type { NodeFlags, PortSpec } from './kind'
import { type Projection, validateProjection } from './projection'
import { parseRegistryHandle, type RegistryHandle } from './registry'

/** Which gating-edge outcomes release a node (adopted from ADC, agent-runtime#968). */
export const JOIN_RULES = ['all', 'any', 'any_failed', 'all_done'] as const
export type JoinRule = (typeof JOIN_RULES)[number]

/** ADC-compatible visit backstop: nothing may be ENTERED more than this many times. */
export const DEFAULT_MAX_NODE_VISITS = 25
/** The hard ceiling an author's `maxVisits`/`maxNodeVisits` override may reach. */
export const MAX_MAX_NODE_VISITS = 100

export type GraphEdgeKind = 'delegates' | 'analyzes' | 'data'

export interface EngineGraphNode {
  readonly id: string
  /** `<id>/v<n>` into the engine's kind registry. */
  readonly kind: string
  /** This node's config, validated by its kind's `validateConfig` at compile. */
  readonly config?: unknown
  /** Per-node flags — properties of the node, never of its kind (agent-runtime#970). */
  readonly flags?: NodeFlags
  /** Node-level port declarations, merged OVER the kind's. A kind whose surface depends on its
   *  config (a script) declares ports here; a typed kind's declared ports stay authoritative. */
  readonly ports?: {
    readonly inputs?: ReadonlyArray<PortSpec>
    readonly outputs?: ReadonlyArray<PortSpec>
  }
  /** Which inbound gating-edge outcomes release this node. Default `all`. */
  readonly join?: JoinRule
  /** Entered more than this many times fails the run `cycle-budget-exceeded`. */
  readonly maxVisits?: number
  /** This node's completion check; a terminal without one (or a kind/graph default) refuses. */
  readonly deliverable?: DeliverableSpec<unknown>
  /** Force-mark a terminal. Absent, a node with no outbound gating edge is terminal. */
  readonly terminal?: boolean
  /** Profile fields merged over the engine-authored `{ name: id }` for this node's spawns. */
  readonly profile?: Readonly<Partial<AgentProfile>>
  /** Per-instance reservation for this node's spawns; falls back to the run's `perNode`. */
  readonly budget?: Budget
}

export interface EngineGraphEdge {
  /** Stable id for the ledger; defaults to `<from>-><to>#<ordinal>`. */
  readonly id?: string
  readonly kind: GraphEdgeKind
  readonly from: { readonly node: string; readonly port?: string }
  readonly to: { readonly node: string; readonly port?: string }
  /** Evaluated over the source's settle context; absent = satisfied by completion. */
  readonly guard?: Condition
  /** `data` edges only: ONE pure reshape of the admitted payload. */
  readonly projection?: Projection
  /** Refuses the traversal past this many firings (ledgered `unpropagated`). */
  readonly maxTraversals?: number
  /** `delegates`/`analyzes`: the versioned directive appended to the target's task. */
  readonly directive?: PromptHandle
}

export interface EngineGraphSpec {
  readonly nodes: ReadonlyArray<EngineGraphNode>
  readonly edges: ReadonlyArray<EngineGraphEdge>
  /** Root node for the graph-level completion check. Defaults to the single entry node. */
  readonly root?: string
  /** Becomes the ROOT node's completion check when the root declares none (#973). */
  readonly deliverable?: DeliverableSpec<unknown>
  readonly maxNodeVisits?: number
}

export interface ParsedGraphNode extends EngineGraphNode {
  readonly kindHandle: RegistryHandle
  readonly join: JoinRule
  readonly maxVisits: number
}

/** Structural validation only — everything a registry is not needed for. */
export function validateEngineGraphSpec(spec: EngineGraphSpec, context = 'compileGraph'): void {
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    throw new ValidationError(`${context}: a graph needs at least one node`)
  }
  const ids = new Set<string>()
  for (const node of spec.nodes) {
    if (typeof node.id !== 'string' || node.id.length === 0) {
      throw new ValidationError(`${context}: every node needs a non-empty id`)
    }
    if (ids.has(node.id))
      throw new ValidationError(`${context}: duplicate node id ${JSON.stringify(node.id)}`)
    ids.add(node.id)
    parseRegistryHandle(node.kind, `${context}: node ${node.id} kind`)
    if (node.join !== undefined && !(JOIN_RULES as ReadonlyArray<string>).includes(node.join)) {
      throw new ValidationError(
        `${context}: node ${node.id} join ${JSON.stringify(node.join)}; known: ${JOIN_RULES.join(', ')}`,
      )
    }
    if (node.maxVisits !== undefined) {
      if (
        !Number.isSafeInteger(node.maxVisits) ||
        node.maxVisits < 1 ||
        node.maxVisits > MAX_MAX_NODE_VISITS
      ) {
        throw new ValidationError(
          `${context}: node ${node.id} maxVisits must be an integer in [1, ${MAX_MAX_NODE_VISITS}]`,
        )
      }
    }
  }
  if (!Array.isArray(spec.edges)) throw new ValidationError(`${context}: edges must be an array`)
  for (const [index, edge] of spec.edges.entries()) {
    const who = `${context}: edge[${index}]`
    if (edge.kind !== 'delegates' && edge.kind !== 'analyzes' && edge.kind !== 'data') {
      throw new ValidationError(`${who}: kind must be delegates | analyzes | data`)
    }
    for (const end of ['from', 'to'] as const) {
      const ref = edge[end]
      if (
        typeof ref !== 'object' ||
        ref === null ||
        typeof ref.node !== 'string' ||
        !ids.has(ref.node)
      ) {
        throw new ValidationError(`${who}: ${end}.node must name a node in this graph`)
      }
    }
    if (edge.guard !== undefined) validateCondition(edge.guard, `${who} guard`)
    if (edge.projection !== undefined) {
      if (edge.kind !== 'data') {
        throw new ValidationError(`${who}: only a data edge carries a projection`)
      }
      validateProjection(edge.projection, `${who} projection`)
    }
    if (edge.maxTraversals !== undefined) {
      if (!Number.isSafeInteger(edge.maxTraversals) || edge.maxTraversals < 1) {
        throw new ValidationError(`${who}: maxTraversals must be a positive integer`)
      }
    }
    if (edge.kind === 'data' && edge.directive !== undefined) {
      throw new ValidationError(`${who}: a data edge carries a port binding, never a directive`)
    }
  }
  if (spec.root !== undefined && !ids.has(spec.root)) {
    throw new ValidationError(`${context}: root ${JSON.stringify(spec.root)} names no node`)
  }
  if (spec.maxNodeVisits !== undefined) {
    if (
      !Number.isSafeInteger(spec.maxNodeVisits) ||
      spec.maxNodeVisits < 1 ||
      spec.maxNodeVisits > MAX_MAX_NODE_VISITS
    ) {
      throw new ValidationError(
        `${context}: maxNodeVisits must be an integer in [1, ${MAX_MAX_NODE_VISITS}]`,
      )
    }
  }
}
