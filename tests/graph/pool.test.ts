/**
 * The pool is the kernel's (agent-runtime#972, #980): a scheduler spawn that cannot reserve WAITS
 * for a settle instead of overcommitting, and the run's spend stays conserved by construction.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  agentKind,
  createGraphEngine,
  type EngineGraphSpec,
  runEngineGraph,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from '../../src/runtime/graph'

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

describe('scheduler admission against the conserved pool', () => {
  it('three ready nodes over a two-node pool: the third waits for a settle, then all three settle', async () => {
    const ran: string[] = []
    const branch = (id: string) => ({
      id,
      kind: 'script/v1',
      // Metered scripts (spent supplied) so each holds a REAL token reservation while live.
      config: {
        body: async () => {
          ran.push(id)
          return { id }
        },
        spent: { iterations: 1, tokens: { input: 100, output: 0 }, usd: 0, ms: 0 },
      },
      ports: { inputs: [{ name: 'go', schema: {} }] },
      deliverable: { check: () => true },
    })
    const spec: EngineGraphSpec = {
      nodes: [
        { id: 'seed', kind: 'script/v1', config: { body: () => ({ go: true }), pure: true } },
        branch('a'),
        branch('b'),
        branch('c'),
      ],
      edges: [
        { kind: 'data', from: { node: 'seed' }, to: { node: 'a', port: 'go' } },
        { kind: 'data', from: { node: 'seed' }, to: { node: 'b', port: 'go' } },
        { kind: 'data', from: { node: 'seed' }, to: { node: 'c', port: 'go' } },
      ],
    }
    // Pool covers TWO concurrent per-node reservations (2 × 1000 tokens); the third parks.
    const res = await runEngineGraph(engine(), spec, 'go', {
      budget: { maxIterations: 50, maxTokens: 2_000 },
      perNode: { maxIterations: 2, maxTokens: 1_000 },
      finalizer: 'collectDelivered',
    })
    expect(res.kind).toBe('winner')
    if (res.kind !== 'winner') return
    expect(ran.sort()).toEqual(['a', 'b', 'c'])
    expect(res.terminals.filter((t) => t.status === 'done')).toHaveLength(3)
  })
})
