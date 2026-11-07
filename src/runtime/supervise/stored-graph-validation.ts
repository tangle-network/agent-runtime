import { agentProfileSchema } from '@tangle-network/agent-interface'
import { z } from 'zod'
import { ValidationError } from '../../errors'
import { assertJsonData } from '../../json-data'
import type { AnalystRegistry } from '../../mcp/tools/coordination-analysts'
import type { GraphEdge, GraphTopology } from './graph'
import { graphCheckNodeSchema, graphFileSchema, graphRouteWhenSchema } from './graph-file-schema'
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
    nodes: z.array(node.extend({ check: graphCheckNodeSchema.optional() })).min(1),
    workspace: graphFileSchema.shape.workspace,
    continuation: graphFileSchema.shape.continuation,
    edges: z.array(edge),
    entry: entry.optional(),
    gates: gates.optional(),
  })

function refuse(message: string): never {
  throw new ValidationError(`validateStoredGraph: ${message}`)
}

function assertExecutableNodes(graph: GraphTopology): void {
  for (const item of graph.nodes)
    if (item.check === undefined)
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
  assertJsonData(value, 'validateStoredGraph')
  const parsed = storedGraphSchema.safeParse(value)
  if (!parsed.success) refuse(parsed.error.message)
  const graph = parsed.data
  if (graph.entry && graph.continuation) refuse('continuation with entry has no root manager')
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
  for (const item of graph.nodes) {
    if (item.check === undefined) continue
    if (!graph.entry || check.command)
      refuse('check nodes need a flow graph without a command check')
    if (item.profile.name !== item.id || Object.keys(item.profile).length !== 1)
      refuse(`check node ${item.id} carries a profile; its profile is { name: id }`)
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
