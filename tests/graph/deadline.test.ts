/**
 * The root deadline a graph run opens with is a wall-clock INSTANT (agent-runtime#995). A fresh run
 * and a resumed run must read the same instant, so a child spawned under a declared `deadlineMs`
 * is bounded by that instant instead of being aborted at spawn.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  compileGraph,
  createGraphEngine,
  type EngineGraphSpec,
  openGraphRun,
  runEngineGraph,
  scriptKind,
} from '../../src/runtime/graph'

const DEADLINE_MS = 10_800_000
const T0 = 1_787_420_924_772

const engine = () => createGraphEngine({ coreKinds: [scriptKind()] })

const twoScripts: EngineGraphSpec = {
  nodes: [
    { id: 'seed', kind: 'script/v1', config: { body: () => ({ go: true }), pure: true } },
    {
      id: 'leaf',
      kind: 'script/v1',
      config: { body: async () => ({ done: true }) },
      ports: { inputs: [{ name: 'go', schema: {} }] },
      deliverable: { check: () => true },
    },
  ],
  edges: [{ kind: 'data', from: { node: 'seed' }, to: { node: 'leaf', port: 'go' } }],
}

const open = (over: {
  readonly deadlineMs?: number
  readonly runId: string
  readonly now: () => number
  readonly journal?: InMemorySpawnJournal
  readonly resume?: boolean
}) =>
  openGraphRun({
    compiled: compileGraph(engine(), twoScripts),
    runId: over.runId,
    budget: {
      maxIterations: 8,
      maxTokens: 10_000,
      ...(over.deadlineMs !== undefined ? { deadlineMs: over.deadlineMs } : {}),
    },
    ...(over.journal !== undefined ? { journal: over.journal } : {}),
    blobs: new InMemoryResultBlobStore(),
    now: over.now,
    ...(over.resume !== undefined ? { resume: over.resume } : {}),
    onAbort: () => {},
  })

describe('graph root deadline', () => {
  it('a fresh run reads its deadline as now + deadlineMs, not as the duration', async () => {
    const context = await open({ runId: 'fresh', deadlineMs: DEADLINE_MS, now: () => T0 })
    expect(context.scope.budget.deadlineMs).toBe(T0 + DEADLINE_MS)
  })

  it('a run with no deadline reads zero', async () => {
    const context = await open({ runId: 'none', now: () => T0 })
    expect(context.scope.budget.deadlineMs).toBe(0)
  })

  it('a resumed run keeps the original anchor', async () => {
    const journal = new InMemorySpawnJournal()
    await open({ runId: 'r', deadlineMs: DEADLINE_MS, now: () => T0, journal })
    const resumed = await open({
      runId: 'r',
      deadlineMs: DEADLINE_MS,
      now: () => T0 + 60_000,
      journal,
      resume: true,
    })
    expect(resumed.scope.budget.deadlineMs).toBe(T0 + DEADLINE_MS)
  })

  it('a fresh run under a deadline does not settle its children at spawn', async () => {
    const ran: string[] = []
    const slow: EngineGraphSpec = {
      nodes: [
        { id: 'seed', kind: 'script/v1', config: { body: () => ({ go: true }), pure: true } },
        {
          id: 'leaf',
          kind: 'script/v1',
          config: {
            body: async () => {
              // Yield to the macrotask queue: a deadline armed at delay 0 fires before this returns.
              await new Promise((resolve) => setTimeout(resolve, 10))
              ran.push('leaf')
              return { done: true }
            },
          },
          ports: { inputs: [{ name: 'go', schema: {} }] },
          deliverable: { check: () => true },
        },
      ],
      edges: [{ kind: 'data', from: { node: 'seed' }, to: { node: 'leaf', port: 'go' } }],
    }
    const result = await runEngineGraph(engine(), slow, 'go', {
      budget: { maxIterations: 8, maxTokens: 10_000, deadlineMs: DEADLINE_MS },
      perNode: { maxIterations: 2, maxTokens: 1_000 },
    })
    expect(ran).toEqual(['leaf'])
    expect(result.kind).toBe('winner')
  })

  it('a deadline that really expires settles the child down and names the reason', async () => {
    const slow: EngineGraphSpec = {
      nodes: [
        { id: 'seed', kind: 'script/v1', config: { body: () => ({ go: true }), pure: true } },
        {
          id: 'leaf',
          kind: 'script/v1',
          config: { body: async () => new Promise((resolve) => setTimeout(resolve, 200)) },
          ports: { inputs: [{ name: 'go', schema: {} }] },
          deliverable: { check: () => true },
        },
      ],
      edges: [{ kind: 'data', from: { node: 'seed' }, to: { node: 'leaf', port: 'go' } }],
    }
    const result = await runEngineGraph(engine(), slow, 'go', {
      budget: { maxIterations: 8, maxTokens: 10_000, deadlineMs: 5 },
      perNode: { maxIterations: 2, maxTokens: 1_000 },
    })
    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    expect(result.reason).toBe('all-children-down')
    // The settlement is reported with the cause, not discarded (agent-runtime#996).
    expect(result.settles.find((settle) => settle.node === 'leaf')).toMatchObject({
      status: 'down',
      reason: 'child deadline exceeded',
    })
  })
})
