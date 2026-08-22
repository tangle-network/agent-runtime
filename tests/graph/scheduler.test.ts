/**
 * The scheduler acceptance from agent-runtime#980: fan-out, guarded unreachability, error routing,
 * the two cycle caps, and multi-terminal collection — every graph offline over script nodes, every
 * node hosted on a REAL kernel Scope by the scheduler itself.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  agentKind,
  createGraphEngine,
  type EngineGraphSpec,
  type GraphEngine,
  runEngineGraph,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from '../../src/runtime/graph'

// GraphEdgeCapError is exported from the kernel graph module, not ./graph — import it directly.
import { GraphEdgeCapError } from '../../src/runtime/supervise/graph'

const engine = (): GraphEngine =>
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

const budget = { maxIterations: 50, maxTokens: 100_000 }
const perNode = { maxIterations: 5, maxTokens: 5_000 }

type Body = (inputs: Record<string, unknown>) => unknown

const script = (id: string, body: Body, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'script/v1',
  config: { body, pure: true },
  ...over,
})

describe('runEngineGraph — the scheduler over guarded, typed edges', () => {
  it('a DAG fans out natively: two branches run, two terminals settle, collectDelivered collects both', async () => {
    const spec: EngineGraphSpec = {
      nodes: [
        script('seed', () => ({ n: 2 })),
        script(
          'double',
          (inputs) => ({
            result: Number((inputs.n as Record<string, unknown>)?.n ?? (inputs.n as number)) * 2,
          }),
          {
            ports: { inputs: [{ name: 'n', schema: { type: 'object' } }] },
            deliverable: { check: (out: unknown) => (out as { result: number }).result === 4 },
          },
        ),
        script(
          'triple',
          (inputs) => ({
            result: Number((inputs.n as Record<string, unknown>)?.n ?? (inputs.n as number)) * 3,
          }),
          {
            ports: { inputs: [{ name: 'n', schema: { type: 'object' } }] },
            deliverable: { check: (out: unknown) => (out as { result: number }).result === 6 },
          },
        ),
      ],
      edges: [
        { kind: 'data', from: { node: 'seed' }, to: { node: 'double', port: 'n' } },
        { kind: 'data', from: { node: 'seed' }, to: { node: 'triple', port: 'n' } },
      ],
    }
    const res = await runEngineGraph(engine(), spec, 'go', {
      budget,
      perNode,
      finalizer: 'collectDelivered',
    })
    expect(res.kind).toBe('winner')
    if (res.kind !== 'winner') return
    expect(res.terminals).toHaveLength(2)
    const outs = (res.out as Array<{ out: { result: number } }>).map((w) => w.out.result).sort()
    expect(outs).toEqual([4, 6])
    // Both data edges fired exactly once and delivered.
    expect(res.ledger.filter((t) => t.outcome === 'delivered')).toHaveLength(2)
  })

  it('a guarded edge that never fires marks its downstream unreachable and names the reason', async () => {
    const spec: EngineGraphSpec = {
      nodes: [
        script('probe', () => ({ severity: 'low' })),
        script('escalate', () => ({ escalated: true }), {
          ports: { inputs: [{ name: 'finding', schema: {} }] },
          deliverable: { check: () => true },
        }),
      ],
      edges: [
        {
          kind: 'data',
          from: { node: 'probe' },
          to: { node: 'escalate', port: 'finding' },
          guard: { path: 'out.severity', op: 'eq', value: 'high' },
        },
      ],
    }
    const res = await runEngineGraph(engine(), spec, 'go', { budget, perNode })
    expect(res.kind).toBe('no-winner')
    if (res.kind !== 'no-winner') return
    expect(res.reason).toBe('unreachable-terminal')
    expect(res.unreachable).toContain('escalate')
  })

  it('any_failed routes a failure: the handler runs exactly when its source goes down', async () => {
    const spec: EngineGraphSpec = {
      nodes: [
        script('risky', () => {
          throw new Error('boom')
        }),
        script('handler', () => ({ handled: true }), {
          join: 'any_failed',
          deliverable: { check: (out: unknown) => (out as { handled: boolean }).handled },
        }),
      ],
      edges: [{ kind: 'data', from: { node: 'risky' }, to: { node: 'handler', port: 'finding' } }],
    }
    // The handler declares the port so the data edge compiles; a failed source delivers no payload.
    ;(spec.nodes[1] as { ports?: unknown }).ports = { inputs: [{ name: 'finding', schema: {} }] }
    const res = await runEngineGraph(engine(), spec, 'go', { budget, perNode })
    expect(res.kind).toBe('winner')
    if (res.kind !== 'winner') return
    expect(res.out).toEqual({ handled: true })
  })

  it('a cycle hits the edge cap: the refusal is ledgered unpropagated and a winnerless run throws GraphEdgeCapError', async () => {
    const spec: EngineGraphSpec = {
      root: 'entry',
      nodes: [
        script('entry', () => ({ round: 0 })),
        script(
          'worker',
          (inputs) => ({ round: Number((inputs.round as { round?: number })?.round ?? 0) + 1 }),
          {
            join: 'any',
            ports: { inputs: [{ name: 'round', schema: {} }] },
          },
        ),
        script('loop', (inputs) => inputs.round, {
          ports: { inputs: [{ name: 'round', schema: {} }] },
          terminal: false,
        }),
        script('goal', () => ({ done: true }), {
          deliverable: { check: () => false },
          ports: { inputs: [{ name: 'x', schema: {} }] },
        }),
      ],
      edges: [
        { kind: 'data', from: { node: 'entry' }, to: { node: 'worker', port: 'round' } },
        { kind: 'data', from: { node: 'worker' }, to: { node: 'loop', port: 'round' } },
        {
          kind: 'data',
          from: { node: 'loop' },
          to: { node: 'worker', port: 'round' },
          maxTraversals: 2,
        },
        {
          kind: 'data',
          from: { node: 'worker' },
          to: { node: 'goal', port: 'x' },
          guard: { path: 'out.round', op: 'gte', value: 99 },
        },
      ],
    }
    let thrown: unknown
    try {
      await runEngineGraph(engine(), spec, 'go', { budget, perNode })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(GraphEdgeCapError)
    const capped = thrown as InstanceType<typeof GraphEdgeCapError>
    expect(capped.exhaustedEdges).toEqual(['loop->worker#2'])
    const refusals = (capped.ledger as ReadonlyArray<{ outcome: string }>).filter(
      (t) => t.outcome === 'unpropagated',
    )
    expect(refusals).toHaveLength(1)
  })

  it('with the edge cap out of the way, the node visit cap fails the run cycle-budget-exceeded', async () => {
    const spec: EngineGraphSpec = {
      root: 'entry',
      nodes: [
        script('entry', () => ({ round: 0 })),
        script(
          'worker',
          (inputs) => ({ round: Number((inputs.round as { round?: number })?.round ?? 0) + 1 }),
          {
            join: 'any',
            maxVisits: 3,
            ports: { inputs: [{ name: 'round', schema: {} }] },
          },
        ),
        script('loop', (inputs) => inputs.round, {
          ports: { inputs: [{ name: 'round', schema: {} }] },
          terminal: false,
        }),
        script('goal', () => ({ done: true }), {
          deliverable: { check: () => false },
          ports: { inputs: [{ name: 'x', schema: {} }] },
        }),
      ],
      edges: [
        { kind: 'data', from: { node: 'entry' }, to: { node: 'worker', port: 'round' } },
        { kind: 'data', from: { node: 'worker' }, to: { node: 'loop', port: 'round' } },
        { kind: 'data', from: { node: 'loop' }, to: { node: 'worker', port: 'round' } },
        {
          kind: 'data',
          from: { node: 'worker' },
          to: { node: 'goal', port: 'x' },
          guard: { path: 'out.round', op: 'gte', value: 99 },
        },
      ],
    }
    const res = await runEngineGraph(engine(), spec, 'go', { budget, perNode })
    expect(res.kind).toBe('no-winner')
    if (res.kind !== 'no-winner') return
    expect(res.reason).toBe('cycle-budget-exceeded')
    expect(res.error?.message).toMatch(/worker entered 4 times; maxVisits 3/)
  })

  it('compile refuses a delegates edge into an oracle node, naming the rule', async () => {
    const spec: EngineGraphSpec = {
      nodes: [
        script('work', () => 1),
        script('grader', () => ({ score: 1 }), {
          flags: { oracle: true },
          deliverable: { check: () => true },
        }),
      ],
      edges: [{ kind: 'data', from: { node: 'work' }, to: { node: 'grader', port: 'x' } }],
    }
    ;(spec.nodes[1] as { ports?: unknown }).ports = { inputs: [{ name: 'x', schema: {} }] }
    await expect(runEngineGraph(engine(), spec, 'go', { budget, perNode })).rejects.toThrow(
      /a data edge may not target oracle node grader; use analyzes/,
    )
  })
})
