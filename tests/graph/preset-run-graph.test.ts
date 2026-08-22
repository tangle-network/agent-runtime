/**
 * `graphFromRunGraph` is a COMPILER, not a runtime (agent-runtime#982): it lowers an `AgentGraph`
 * into the engine's vocabulary so a consumer can inspect it and author natively from there. These
 * tests pin what it produces, and that the product is a graph the engine actually accepts.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  agentKind,
  compileGraph,
  createGraphEngine,
  graphFromRunGraph,
  RUN_GRAPH_ROOT_KIND,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from '../../src/runtime/graph'
import type { AgentGraph } from '../../src/runtime/supervise/graph'

const engine = () =>
  createGraphEngine({
    coreKinds: [
      agentKind({}),
      supervisorKind({
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => ({ name: 'x', act: async () => 1 }),
      }),
      scriptKind(),
      subgraphKind(),
    ],
  })

const budget = { maxIterations: 20, maxTokens: 50_000 }

const agentGraph = (): AgentGraph =>
  ({
    nodes: [
      { id: 'lead', profile: { name: 'lead', harness: 'cli-base' } },
      { id: 'worker', profile: { name: 'worker', harness: 'cli-base' } },
      { id: 'auditor', profile: { name: 'auditor', harness: 'cli-base' } },
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'lead',
        to: 'worker',
        directive: { surface: 'graph/delegate', version: 1 },
        maxTraversals: 3,
      },
      {
        kind: 'analyzes',
        analyst: 'auditor',
        over: ['worker', 'lead'],
        to: 'lead',
        directive: { surface: 'graph/findings', version: 1 },
      },
    ],
    deliverable: { check: () => true },
    budget,
  }) as unknown as AgentGraph

describe('graphFromRunGraph — the migration compiler', () => {
  it('lowers the root to a supervisor and every worker to a pinned, non-entry agent node', () => {
    const spec = graphFromRunGraph(agentGraph(), { budget } as never)
    expect(spec.root).toBe('lead')
    expect(spec.nodes.map((node) => [node.id, node.kind])).toEqual([
      ['lead', RUN_GRAPH_ROOT_KIND],
      ['worker', 'agent/v1'],
      ['auditor', 'agent/v1'],
    ])
    // A delegation target is spawned by its supervisor, so the scheduler must never enter it.
    expect(spec.nodes.filter((node) => node.entry === false).map((node) => node.id)).toEqual([
      'worker',
      'auditor',
    ])
    expect(spec.nodes[0]?.terminal).toBe(true)
    expect(spec.nodes[0]?.deliverable).toBeDefined()
  })

  it('keeps a delegates edge as authored and fans an analyzes edge out one-per-source', () => {
    const spec = graphFromRunGraph(agentGraph(), { budget } as never)
    expect(spec.edges).toEqual([
      {
        kind: 'delegates',
        from: { node: 'lead' },
        to: { node: 'worker' },
        directive: { surface: 'graph/delegate', version: 1 },
        maxTraversals: 3,
      },
      // `over: ['worker', 'lead']` becomes two 1:1 engine edges, each reading the trace port.
      {
        kind: 'analyzes',
        from: { node: 'worker', port: 'trace' },
        to: { node: 'lead' },
        directive: { surface: 'graph/findings', version: 1 },
      },
      {
        kind: 'analyzes',
        from: { node: 'lead', port: 'trace' },
        to: { node: 'lead' },
        directive: { surface: 'graph/findings', version: 1 },
      },
    ])
  })

  it('produces a graph the ENGINE accepts — the compile is the proof, not the prose', () => {
    const compiled = compileGraph(engine(), graphFromRunGraph(agentGraph(), { budget } as never))
    expect(compiled.root).toBe('lead')
    expect(compiled.entries).toEqual(['lead'])
    expect(compiled.terminals).toEqual(['lead'])
    // Model-fired inbound, so the workers are neither scheduled nor awaited.
    expect(compiled.nodes.get('worker')?.modelFired).toBe(true)
    expect(compiled.nodes.get('worker')?.terminal).toBe(false)
  })

  it('refuses a graph with no root node, by name', () => {
    expect(() => graphFromRunGraph({ nodes: [] } as unknown as AgentGraph, {} as never)).toThrow(
      /graphFromRunGraph: a graph needs a root node/,
    )
  })
})
