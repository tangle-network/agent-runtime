import { readFile } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { parseDocument } from 'yaml'
import { ValidationError } from '../../errors'
import type { AnalystRegistry } from '../../mcp/tools/coordination-analysts'
import type { RouteWhen } from '../../mcp/tools/coordination-route-contracts'
import type { AgentGraph } from './graph'
import { graphFileSchema } from './graph-file-schema'
import { validateFlowGraph } from './graph-flow'
import {
  assertGraphTriggerBindings,
  bindGraphParameters,
  compileGraphParameters,
  type GraphTriggerBinding,
} from './graph-parameters'
import { graphDigest, type StoredGraph, type StoredGraphInput } from './graph-registry'
import { validateGraphTopology } from './graph-topology'
import { assertExecutableAgentProfile, concreteProfileModel } from './model-policy'
import { kernelPromptRegistry, type PromptRegistry } from './prompt-registry'

export type GraphFileSeat = NonNullable<AgentProfile['seats']>[number]

/** A provider name in authored data needs an environment-owned canonical connection binding. */
export class GraphFileResolutionError extends Error {
  readonly code = 'CONNECTION_REQUIRED' as const
  readonly fixCommand = 'tangle graph run --help'

  constructor(
    readonly provider: string,
    readonly node: string,
  ) {
    super(`loadGraphFile: node ${node} needs an environment binding for provider ${provider}`)
    this.name = 'GraphFileResolutionError'
  }
}

export interface LoadGraphFileOptions {
  /** Exact authored bytes. The file argument still names the format and default working directory. */
  readonly source?: string
  readonly cwd?: string
  readonly signal?: AbortSignal
  readonly params?: Readonly<Record<string, unknown>>
  readonly trigger?: Readonly<Record<string, unknown>>
  /** Concrete Bridge inventory defaults, in preference order. No authentication is performed here. */
  readonly seats?: readonly GraphFileSeat[]
  /** One CLI override for every node, ahead of per-node options and authored seats. */
  readonly seat?: string
  readonly nodeSeats?: Readonly<Record<string, string | readonly string[]>>
  /** Bridge-owned syntax, model and login resolution. Undefined marks an unavailable candidate;
   *  errors propagate unchanged. The loader does not parse aliases or reasoning effort. */
  readonly resolveSeat?: (
    seat: string | undefined,
    context: Pick<LoadGraphFileOptions, 'cwd' | 'signal'> & {
      readonly node: string
      readonly lastCandidate: boolean
    },
  ) => GraphFileSeat | undefined | Promise<GraphFileSeat | undefined>
  /** Environment-owned provider-name bindings; files never carry Hub credentials. */
  readonly needs?: Readonly<Record<string, NonNullable<AgentProfile['connections']>[number]>>
  /** Optional host resolution for providers without an own static binding. Calls may overlap;
   * the host owns coalescing, authentication and cancellation; errors propagate unchanged. */
  readonly resolveNeed?: (
    provider: string,
    context: Pick<LoadGraphFileOptions, 'cwd' | 'signal'> & { readonly node: string },
  ) =>
    | NonNullable<AgentProfile['connections']>[number]
    | undefined
    | Promise<NonNullable<AgentProfile['connections']>[number] | undefined>
  readonly registry?: PromptRegistry
  readonly analysts?: AnalystRegistry
}

export interface LoadedGraphFile {
  readonly graph: StoredGraph
  readonly params: Readonly<Record<string, unknown>>
  /** Deployment metadata is preserved separately and never contributes to the graph digest. */
  readonly on?: unknown
}

function refuse(message: string): never {
  throw new ValidationError(`loadGraphFile: ${message}`)
}

function jsonData(value: unknown, visiting = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || visiting.has(value))
    refuse('definition must be finite, acyclic JSON data')
  visiting.add(value)
  for (const child of Object.values(value)) jsonData(child, visiting)
  visiting.delete(value)
}

function bindParameters(
  raw: Record<string, unknown>,
  supplied: LoadGraphFileOptions['params'],
): Record<string, unknown> {
  const definitions = graphFileSchema.shape.params.parse(raw.params) ?? {}
  for (const key of Object.keys(supplied ?? {})) {
    if (!Object.hasOwn(definitions, key)) refuse(`unknown parameter ${key}`)
  }
  return Object.fromEntries(
    Object.entries(definitions).map(([key, definition]) => {
      let value = supplied && Object.hasOwn(supplied, key) ? supplied[key] : definition.default
      if (value === undefined) refuse(`missing parameter ${key}`)
      const type = definition.type
      // CLI --param values are strings; declarations alone authorize conversion.
      if (typeof value === 'string' && type && type !== 'string') {
        try {
          value = JSON.parse(value)
        } catch {
          refuse(`parameter ${key} must be ${type}`)
        }
      }
      if (type) {
        const valid =
          type === 'integer'
            ? Number.isSafeInteger(value)
            : type === 'null'
              ? value === null
              : type === 'array'
                ? Array.isArray(value)
                : type === 'object'
                  ? value !== null && typeof value === 'object' && !Array.isArray(value)
                  : typeof value === type
        if (!valid) refuse(`parameter ${key} must be ${type}`)
      }
      jsonData(value)
      return [key, value]
    }),
  )
}

async function expandProfile(
  node: {
    id: string
    profile?: Record<string, unknown>
    seat?: string | string[]
    needs?: string[]
  },
  options: LoadGraphFileOptions,
): Promise<AgentProfile> {
  if (node.id === 'params' || node.id === 'trigger') refuse(`reserved node id ${node.id}`)
  const authored = options.seat ?? options.nodeSeats?.[node.id] ?? node.seat
  const resolveSeat = options.resolveSeat
  const context = { node: node.id, cwd: options.cwd, signal: options.signal }
  let selected: GraphFileSeat | undefined
  if (authored !== undefined) {
    if (!resolveSeat)
      refuse(
        `node ${node.id} has unresolved seat shorthand; supply resolveSeat from Bridge login inventory or a canonical profile`,
      )
    const candidates = typeof authored === 'string' ? [authored] : authored
    if (!candidates.length) refuse(`node ${node.id} has an empty seat preference list`)
    for (const [index, candidate] of candidates.entries()) {
      selected = await resolveSeat(candidate, {
        ...context,
        lastCandidate: index === candidates.length - 1,
      })
      if (selected) break
    }
    if (!selected)
      refuse(
        `node ${node.id} has no available Bridge seat; sign in through Bridge or choose another seat`,
      )
  } else if (Array.isArray(node.profile?.seats)) {
    const parsed = agentProfileSchema.safeParse({ ...node.profile, name: node.id })
    if (!parsed.success) refuse(`node ${node.id} has an invalid profile: ${parsed.error.message}`)
  } else if (
    !node.profile?.harness ||
    !concreteProfileModel(node.profile as AgentProfile) ||
    !(node.profile.model as AgentProfile['model'])?.provider
  ) {
    selected =
      options.seats?.[0] ?? (await resolveSeat?.(undefined, { ...context, lastCandidate: true }))
    if (!selected)
      refuse(`node ${node.id} needs a canonical profile or resolveSeat from Bridge login inventory`)
  }
  const connections = await Promise.all(
    (node.needs ?? []).map(async (provider) => {
      if (options.needs && Object.hasOwn(options.needs, provider)) return options.needs[provider]!
      const connection = await options.resolveNeed?.(provider, context)
      if (connection === undefined) throw new GraphFileResolutionError(provider, node.id)
      return connection
    }),
  )
  const profile: Record<string, unknown> = { ...node.profile, name: node.id }
  if (selected) {
    delete profile.seats
    profile.harness = selected.harness
    profile.model = {
      ...(node.profile?.model as object | undefined),
      provider: selected.provider,
      default: selected.model,
      ...(selected.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: selected.reasoningEffort }),
    }
  }
  if (node.needs)
    profile.connections = [
      ...((node.profile?.connections as unknown[] | undefined) ?? []),
      ...connections,
    ]
  const parsed = agentProfileSchema.safeParse(profile)
  if (!parsed.success) refuse(`node ${node.id} has an invalid profile: ${parsed.error.message}`)
  assertExecutableAgentProfile(parsed.data, `loadGraphFile node ${node.id}`)
  return parsed.data
}

/** Compile canonical YAML/JSON to content-addressed graph data. Host resolvers may perform I/O. */
export async function loadGraphFile(
  file: string,
  options: LoadGraphFileOptions = {},
): Promise<LoadedGraphFile> {
  const format = extname(file).toLowerCase()
  if (!['.yaml', '.yml', '.json'].includes(format)) refuse('file must be YAML or JSON')
  const text = options.source ?? (await readFile(file, 'utf8'))
  const document = parseDocument(text, { uniqueKeys: true, strict: true })
  if (document.errors.length) refuse(document.errors.map((error) => error.message).join('; '))
  if (document.warnings.length)
    refuse(document.warnings.map((warning) => warning.message).join('; '))
  const raw: unknown = format === '.json' ? JSON.parse(text) : document.toJS({ maxAliasCount: 100 })
  jsonData(raw)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) refuse('definition must be an object')
  const source = raw as Record<string, unknown>
  if (
    Array.isArray(source.nodes) &&
    source.nodes.some((node) => node && typeof node === 'object' && 'call' in node)
  )
    refuse('call vertices are not supported by this loader')
  const params = bindParameters(source, options.params)
  const { params: _definitions, on, ...authored } = source
  const bindings = { params, trigger: options.trigger }
  const bindingOptions = options.trigger === undefined ? { defer: ['trigger'] as const } : {}
  const compiled = compileGraphParameters(authored, bindings, bindingOptions)
  const bound = graphFileSchema.parse(compiled.value)
  const boundOn = on === undefined ? undefined : bindGraphParameters(on, bindings, bindingOptions)
  if (bound.check && bound.deliverable) refuse('use check or deliverable, not both')
  let deliverable: StoredGraphInput['deliverable'] | undefined = bound.deliverable
  if (bound.check) {
    if ('command' in bound.check) {
      deliverable = {
        ...((bound.check.describe ?? bound.describe) === undefined
          ? {}
          : { describe: bound.check.describe ?? bound.describe }),
        checkRef: 'command',
        command: bound.check.command,
      }
    } else {
      const { describe, ...condition } =
        'describe' in bound.check ? bound.check : { ...bound.check, describe: undefined }
      deliverable = {
        ...((describe ?? bound.describe) === undefined
          ? {}
          : { describe: describe ?? bound.describe }),
        checkRef: 'route',
        when: condition as RouteWhen,
      }
    }
  }
  if (!deliverable) refuse('check or deliverable is required')
  if (deliverable.checkRef === 'route' && !deliverable.when)
    refuse('route deliverable requires when')
  if (deliverable.checkRef === 'command' && !deliverable.command)
    refuse('command deliverable requires command')
  const nodes = await Promise.all(
    bound.nodes.map(async (node) => ({
      id: node.id,
      profile: await expandProfile(node, { ...options, cwd: options.cwd ?? dirname(file) }),
    })),
  )
  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const id of Object.keys(options.nodeSeats ?? {})) {
    if (!nodeIds.has(id)) refuse(`seat override references unknown node ${id}`)
  }
  if (deliverable.when) {
    for (const condition of 'all' in deliverable.when ? deliverable.when.all : [deliverable.when]) {
      if (condition.node !== undefined && !nodeIds.has(condition.node))
        refuse(`check references unknown node ${condition.node}`)
    }
  }
  const topology: StoredGraphInput = {
    nodes,
    edges: bound.edges as unknown as AgentGraph['edges'],
    budget: bound.budget,
    deliverable,
    ...(bound.entry
      ? {
          entry: bound.entry.map((entry) =>
            typeof entry === 'string' ? { node: entry, task: {} } : entry,
          ),
        }
      : {}),
    ...(bound.gates ? { gates: bound.gates as AgentGraph['gates'] } : {}),
  }
  // Lower provenance alongside the authoring envelope: only these authored slots may bind later.
  const triggerBindings = compiled.triggerBindings.flatMap((slot): GraphTriggerBinding[] => {
    const [top, index, field, ...tail] = slot.path
    if (top === 'nodes') {
      if (field === 'id') return [slot, { ...slot, path: ['nodes', index!, 'profile', 'name'] }]
      if (field === 'profile') {
        if (tail[0] === 'name') return [] // Profile names come from node IDs, never this field.
        // Seat materialization owns these identity fields and can replace authored values.
        if (
          tail[0] === 'harness' ||
          (tail[0] === 'model' &&
            ['provider', 'default', 'reasoningEffort'].includes(String(tail[1])))
        ) {
          let before: unknown = bound.nodes[index as number]!.profile
          let after: unknown = nodes[index as number]!.profile
          for (const key of tail) {
            before = (before as Record<string | number, unknown> | undefined)?.[key]
            after = (after as Record<string | number, unknown> | undefined)?.[key]
          }
          if (before !== after) return []
        }
        return [slot]
      }
      refuse(
        'trigger slots in seat/needs must be supplied to loadGraphFile before profile resolution',
      )
    }
    if (top === 'check') {
      if (index === 'describe') return [{ ...slot, path: ['deliverable', 'describe'] }]
      return [
        {
          ...slot,
          path: [
            'deliverable',
            index === 'command' ? 'command' : 'when',
            ...(index === 'command' ? slot.path.slice(2) : slot.path.slice(1)),
          ],
        },
      ]
    }
    if (top === 'describe')
      return bound.check?.describe !== undefined || bound.deliverable
        ? []
        : [{ ...slot, path: ['deliverable', 'describe'] }]
    if (top === 'entry' && slot.path.length === 2)
      return [{ ...slot, path: ['entry', index!, 'node'] }]
    return ['edges', 'budget', 'gates', 'entry', 'deliverable'].includes(String(top)) ? [slot] : []
  })
  assertGraphTriggerBindings(topology, triggerBindings)
  const content: StoredGraphInput = { ...topology, triggerBindings }
  const registry = options.registry ?? kernelPromptRegistry()
  if (content.entry) validateFlowGraph(content, registry, options.analysts)
  else validateGraphTopology(content.nodes, content.edges, registry, options.analysts)
  const digest = graphDigest(content)
  if (bound.digest !== undefined && bound.digest !== digest)
    refuse('supplied digest does not match the materialized graph')
  return {
    graph: { ...content, digest } as StoredGraph,
    params,
    ...(boundOn === undefined ? {} : { on: boundOn }),
  }
}
