import { agentProfileSchema } from '@tangle-network/agent-interface'
import { z } from 'zod'
import { ValidationError } from '../../errors'
import type { AnalystRegistry } from '../../mcp/tools/coordination-analysts'
import type { GraphEdge, GraphTopology } from './graph'
import { graphFileSchema, graphRouteWhenSchema } from './graph-file-schema'
import { validateFlowGraph } from './graph-flow'
import { assertGraphTriggerBindings, graphTriggerBindingsSchema } from './graph-parameters'
import { graphDigest, type StoredGraph } from './graph-registry'
import { validateGraphTopology } from './graph-topology'
import { assertExecutableAgentProfile } from './model-policy'
import { kernelPromptRegistry, type PromptRegistry } from './prompt-registry'
import { detachedSnapshot } from './snapshot'
import type { GraphFromStoredOptions } from './stored-graph-check'

export interface ValidateStoredGraphOptions {
  readonly registry?: PromptRegistry
  readonly analysts?: AnalystRegistry
  /** Environment-owned bindings only. A custom checkRef is refused without its own binding. */
  readonly checks?: GraphFromStoredOptions['checks']
}

const name = z.string().min(1)
const positiveInteger = z.number().int().positive()
const directive = z.strictObject({ surface: name, version: z.number().int().nonnegative() })
const node = z.strictObject({ id: name, profile: agentProfileSchema })
const entry = z
  .array(
    z.strictObject({
      node: name,
      task: z.unknown().refine((value) => value !== undefined, 'task must be explicit JSON data'),
    }),
  )
  .min(1)
const gates = z.array(z.strictObject({ id: name, question: name, choices: z.array(name).min(1) }))
const continuity = z.enum(['fresh', 'resume']).optional()
// These shapes close unknown structural keys; the existing topology owner below decides graph
// semantics, reachability, directives, analyst bindings, flow cycles and map restrictions.
const topology: z.ZodType<GraphTopology> = z.lazy(() =>
  z.strictObject({
    nodes: z.array(node).min(1),
    edges: z.array(edge),
    entry: entry.optional(),
    gates: gates.optional(),
  }),
)
const edge: z.ZodType<GraphEdge> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('delegates'),
      from: name,
      to: name,
      directive,
      maxTraversals: positiveInteger.optional(),
      continuity,
    }),
    z.strictObject({
      kind: z.literal('analyzes'),
      analyst: name,
      over: z.array(name).min(1),
      to: name,
      directive,
      maxTraversals: positiveInteger.optional(),
    }),
    z.strictObject({
      kind: z.literal('maps'),
      from: name,
      pointer: z.string(),
      to: name.optional(),
      graph: topology.optional(),
      join: name,
      directive,
      maxItems: positiveInteger,
      concurrency: positiveInteger,
      onItemFailure: z.enum(['all-or-refuse', 'settled-subset']),
      itemBudget: graphFileSchema.shape.budget.partial().optional(),
    }),
    z.strictObject({
      kind: z.literal('routes'),
      from: z.union([name, z.array(name).min(2)]),
      to: z.union([
        name,
        z.array(name).min(2),
        z.strictObject({ stop: name }),
        z.strictObject({ finish: name }),
      ]),
      directive,
      when: graphRouteWhenSchema.optional(),
      evidence: z.array(name).optional(),
      maxTraversals: positiveInteger.optional(),
      continuity,
    }),
  ]),
)
const storedGraphSchema = graphFileSchema
  .pick({ digest: true, budget: true, deliverable: true })
  .required()
  .extend({
    observed: z.literal(false).optional(),
    triggerBindings: graphTriggerBindingsSchema.optional(),
    nodes: z.array(node).min(1),
    edges: z.array(edge),
    entry: entry.optional(),
    gates: gates.optional(),
  })

function refuse(message: string): never {
  throw new ValidationError(`validateStoredGraph: ${message}`)
}

/** Inspect descriptors instead of invoking accessors; JSON has no getters, symbols, prototypes,
 * sparse arrays, undefined, closures or cycles. Repeated non-cyclic references remain JSON data. */
function assertJsonData(value: unknown, visiting = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || visiting.has(value))
    refuse('expected finite, acyclic JSON data without executable values')
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    refuse('expected plain JSON objects and arrays')
  visiting.add(value)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (array && keys.length !== value.length + 1) refuse('sparse arrays are not canonical JSON')
  for (const key of keys) {
    if (array && key === 'length') continue
    const property = typeof key === 'string' ? descriptors[key] : undefined
    if (!property || !property.enumerable || !('value' in property))
      refuse('JSON data cannot contain symbols, hidden properties or accessors')
    if (array && (!/^(0|[1-9]\d*)$/.test(key as string) || Number(key) >= value.length))
      refuse('arrays may contain only indexed JSON values')
    assertJsonData(property.value, visiting)
  }
  visiting.delete(value)
}

function assertExecutableNodes(graph: GraphTopology): void {
  for (const item of graph.nodes)
    assertExecutableAgentProfile(item.profile, `validateStoredGraph node ${item.id}`)
  for (const item of graph.edges)
    if (item.kind === 'maps' && item.graph) assertExecutableNodes(item.graph)
}

/** Validate compiled, runnable StoredGraph data. Authored params/seats/on envelopes belong to
 * loadGraphFile; observations belong to the registry's observation importer, never this entry.
 * No check function or model call is executed while validating environment-owned references. */
export function validateStoredGraph(
  value: unknown,
  options: ValidateStoredGraphOptions = {},
): StoredGraph {
  assertJsonData(value)
  const parsed = storedGraphSchema.safeParse(value)
  if (!parsed.success) refuse(parsed.error.message)
  const graph = parsed.data
  if (graph.triggerBindings !== undefined) assertGraphTriggerBindings(graph, graph.triggerBindings)
  const check = graph.deliverable
  if (check.checkRef === 'command') {
    if (!check.command?.command.trim() || check.when)
      refuse('command check requires only command data')
  } else if (check.checkRef === 'route') {
    if (!check.when || check.command) refuse('route check requires only when data')
  } else {
    if (check.command || check.when)
      refuse('custom checkRef cannot carry builtin command/route data')
    const selected =
      options.checks && Object.hasOwn(options.checks, check.checkRef)
        ? options.checks[check.checkRef]
        : undefined
    if (selected === undefined)
      refuse(`unknown checkRef ${check.checkRef}; supply an environment checks binding`)
    if (typeof selected !== 'function') {
      const command = graphFileSchema.shape.deliverable
        .unwrap()
        .shape.command.unwrap()
        .safeParse(selected)
      if (!command.success || !command.data.command.trim())
        refuse(`invalid checks binding ${check.checkRef}`)
    }
  }
  if (check.when) {
    const ids = new Set(graph.nodes.map((item) => item.id))
    for (const condition of 'all' in check.when ? check.when.all : [check.when])
      if (condition.node !== undefined && !ids.has(condition.node))
        refuse(`check references unknown node ${condition.node}`)
  }
  assertExecutableNodes(graph)
  const registry = options.registry ?? kernelPromptRegistry()
  if (graph.entry) validateFlowGraph(graph, registry, options.analysts)
  else validateGraphTopology(graph.nodes, graph.edges, registry, options.analysts)
  const { digest: provided, ...rawContent } = value as Record<string, unknown>
  if (graphDigest(rawContent as Omit<StoredGraph, 'digest'>) !== provided)
    refuse('supplied digest does not match the input graph')
  const { digest, ...content } = graph
  if (graphDigest(content) !== digest) refuse('supplied digest does not match the canonical graph')
  return detachedSnapshot(graph, 'validated stored graph')
}
