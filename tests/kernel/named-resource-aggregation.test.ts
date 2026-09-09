import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { budgetStop } from '../../src/runtime/supervise/driver-retry'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import type {
  Agent,
  AgentSpec,
  Executor,
  Spend,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

const resources = { compute: { unit: 'GPU-second', limit: 20 } }

async function runStream(terminal: Spend['resources'], interrupted = false) {
  const budget = { maxIterations: 3, maxTokens: 100, resources }
  const pool = createBudgetPool(budget, 0)
  const journal = new InMemorySpawnJournal()
  await journal.beginTree('resources', new Date(0).toISOString())
  const scope = createScope({
    parentId: 'resources',
    root: 'resources',
    pool,
    journal,
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: new AbortController().signal,
    now: () => 0,
  })
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute: async function* (): AsyncIterable<UsageEvent> {
      yield { kind: 'tokens', input: 1, output: 1 }
      yield { kind: 'resource', name: 'compute', unit: 'GPU-second', amount: 3, known: true }
      yield { kind: 'resource', name: 'compute', unit: 'GPU-second', amount: 2, known: true }
      if (interrupted) throw new Error('connection interrupted')
      yield { kind: 'iteration' }
    },
    resultArtifact: () => ({
      outRef: 'result',
      out: 'done',
      spent: {
        iterations: 1,
        tokens: { input: 1, output: 1 },
        usd: 0,
        ms: 0,
        ...(terminal === undefined ? {} : { resources: terminal }),
      },
    }),
    teardown: async () => ({ destroyed: true }),
  }
  const spec: AgentSpec = { profile: testAgentProfile('resource-worker'), harness: null, executor }
  const agent: Agent<unknown, unknown> & { executorSpec: AgentSpec } = {
    name: 'resource-worker',
    act: async () => 'done',
    executorSpec: spec,
  }
  const spawned = scope.spawn(agent, 'work', { label: 'resource-worker', budget })
  expect(spawned.ok).toBe(true)
  const settled = await scope.next()
  return { settled, pool, scope, id: spawned.ok ? spawned.handle.id : '' }
}

describe('named resource aggregation at execution boundaries', () => {
  it('charges streamed increments once when the terminal receipt repeats the total', async () => {
    const { settled, pool, scope, id } = await runStream({
      compute: { unit: 'GPU-second', amount: 5, known: true },
    })
    expect(settled?.spent.resources).toEqual({
      compute: { unit: 'GPU-second', amount: 5, known: true },
    })
    expect(pool.readout().resources?.compute).toMatchObject({
      committed: 5,
      remaining: 15,
      known: true,
    })
    expect(scope.progress(id)?.resources).toEqual(settled?.spent.resources)
  })

  it('preserves an unknown terminal total despite measured stream increments', async () => {
    const { settled, pool, scope, id } = await runStream({
      compute: { unit: 'GPU-second', amount: 5, known: false },
    })
    expect(settled?.kind).toBe('down')
    expect(scope.view.nodes.find((node) => node.id === id)?.spent.resources?.compute).toEqual({
      unit: 'GPU-second',
      amount: 5,
      known: false,
    })
    expect(pool.readout().resources?.compute).toMatchObject({ remaining: 0, known: false })
    expect(budgetStop(pool.readout(), 0)).toBe('budget-exhausted')
  })

  it('accepts complete streamed resource telemetry when the terminal artifact omits the map', async () => {
    const { settled, pool } = await runStream(undefined)
    expect(settled?.spent.resources?.compute).toEqual({
      unit: 'GPU-second',
      amount: 5,
      known: true,
    })
    expect(pool.readout().resources?.compute).toMatchObject({
      committed: 5,
      remaining: 15,
      known: true,
    })
  })
  it.each([
    { unit: 'minute', amount: 5, known: true },
    { unit: 'GPU-second', amount: -1, known: true },
    { unit: 'GPU-second', amount: Number.NaN, known: true },
  ])(
    'closes reservations and preserves unknown usage for malformed receipts: %j',
    async (receipt) => {
      const { settled, pool, scope, id } = await runStream({ compute: receipt })
      expect(settled?.kind).toBe('down')
      pool.assertNoOpenTickets()
      expect(pool.readout().resources?.compute.known).toBe(false)
      expect(scope.view.nodes.find((node) => node.id === id)?.spent.resources?.compute.known).toBe(
        false,
      )
      expect(budgetStop(pool.readout(), 0)).toBe('budget-exhausted')
    },
  )

  it('retains measured increments as an unknown lower bound when execution interrupts', async () => {
    const { settled, pool, scope, id } = await runStream(undefined, true)
    expect(settled?.kind).toBe('down')
    pool.assertNoOpenTickets()
    expect(scope.view.nodes.find((node) => node.id === id)?.spent.resources?.compute).toEqual({
      unit: 'GPU-second',
      amount: 5,
      known: false,
    })
    expect(budgetStop(pool.readout(), 0)).toBe('budget-exhausted')
  })
  it('retains the larger conflicting total and refuses to label inconsistent receipts known', async () => {
    const { settled, pool, scope, id } = await runStream({
      compute: { unit: 'GPU-second', amount: 10, known: true },
    })
    expect(settled?.kind).toBe('down')
    expect(scope.view.nodes.find((node) => node.id === id)?.spent.resources?.compute).toEqual({
      unit: 'GPU-second',
      amount: 10,
      known: false,
    })
    pool.assertNoOpenTickets()
    expect(budgetStop(pool.readout(), 0)).toBe('budget-exhausted')
  })
})
