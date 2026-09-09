import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FileResultBlobStore,
  FileSpawnJournal,
  materializeTreeView,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import { createBudgetPool, spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { prepareScopeResume } from '../../src/runtime/supervise/recover-executors'
import { withBudgetResources } from '../../src/runtime/supervise/resources'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, Budget, Executor, Spend, UsageEvent } from '../../src/runtime/supervise/types'
import { addSpend, cloneSpend, zeroSpend } from '../../src/runtime/util'
import { testAgentProfile } from './test-agent-profile'

const budget = (limit = 10): Budget => ({
  maxTokens: limit * 10,
  maxIterations: limit,
  resources: { gpu: { unit: 'seconds', limit }, io: { unit: 'bytes', limit: limit * 10 } },
})
const measured = (gpu = 2, io = 20): Spend => ({
  ...zeroSpend(),
  resources: {
    gpu: { unit: 'seconds', amount: gpu, known: true },
    io: { unit: 'bytes', amount: io, known: true },
  },
})

function conserved(pool: ReturnType<typeof createBudgetPool>) {
  for (const value of Object.values(pool.readout().resources ?? {})) {
    expect(value.remaining + value.reserved + value.committed).toBe(value.limit)
  }
}

describe('caller-named resource conservation', () => {
  it('admits fractional capacity and reconciles rounded sums without changing receipts', () => {
    const fractional = (limit: number): Budget => ({
      maxTokens: 10,
      maxIterations: 1,
      resources: { gpu: { unit: 'seconds', limit } },
    })
    const pool = createBudgetPool({ ...fractional(0.3), maxIterations: 3 }, 0)
    const first = pool.reserve(fractional(0.1))
    const second = pool.reserve({ ...fractional(0.2), maxTokens: 0 })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const spend = (amount: number): Spend => ({
      ...zeroSpend(),
      resources: { gpu: { unit: 'seconds', amount, known: true } },
    })
    if (!first.ok || !second.ok) throw new Error('reservation failed')
    pool.reconcile(first.ticket, spend(0.1))
    pool.reconcile(second.ticket, spend(0.2))
    expect(pool.readout().resources?.gpu.committed).toBe(0.1 + 0.2)
    expect(pool.reserve({ ...fractional(0.000001), maxTokens: 0 }).ok).toBe(false)
    const single = createBudgetPool(fractional(0.3), 0)
    const ticket = single.reserve(fractional(0.3))
    if (!ticket.ok) throw new Error('reservation failed')
    single.reconcile(ticket.ticket, spend(0.1 + 0.2))
    const over = createBudgetPool(fractional(0.3), 0)
    const overTicket = over.reserve(fractional(0.3))
    if (!overTicket.ok) throw new Error('reservation failed')
    expect(() => over.reconcile(overTicket.ticket, spend(0.300001))).toThrow('spent')
    const large = createBudgetPool(fractional(Number.MAX_SAFE_INTEGER - 1), 0)
    expect(large.reserve(fractional(Number.MAX_SAFE_INTEGER)).ok).toBe(false)
    const tiny = createBudgetPool(fractional(1e-30), 0)
    expect(tiny.reserve(fractional(2e-30)).ok).toBe(false)
  })

  it('reserves all channels atomically and refunds only known unused capacity', () => {
    const pool = createBudgetPool(budget(), 0)
    const first = pool.reserve(budget(6))
    expect(first.ok).toBe(true)
    const before = pool.readout()
    expect(pool.reserve(budget(5)).ok).toBe(false)
    expect(pool.readout()).toEqual(before)
    expect(pool.reserve({ ...budget(1), maxTokens: 101 }).ok).toBe(false)
    expect(pool.readout()).toEqual(before)
    if (!first.ok) throw new Error('reservation failed')
    pool.reconcile(first.ticket, measured())
    expect(pool.readout().resources?.gpu).toMatchObject({
      remaining: 8,
      reserved: 0,
      committed: 2,
      known: true,
    })
    conserved(pool)
  })

  it('rejects malformed units, negative/nonfinite values, and unbudgeted dimensions before mutation', () => {
    for (const limit of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createBudgetPool(budget(limit), 0)).toThrow()
    }
    const pool = createBudgetPool(budget(), 0)
    const before = pool.readout()
    expect(() =>
      pool.reserve({
        ...budget(),
        resources: { gpu: { unit: 'minutes', limit: 1 }, io: { unit: 'bytes', limit: 1 } },
      }),
    ).toThrow('unit mismatch')
    expect(() => pool.reserve({ maxTokens: 1, maxIterations: 1 })).toThrow('must declare')
    expect(() =>
      createBudgetPool({ maxTokens: 1, maxIterations: 1 }, 0).reserve(budget(1)),
    ).toThrow('root must declare')
    expect(pool.readout()).toEqual(before)
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        spendFromUsageEvents([
          { kind: 'resource', name: 'gpu', unit: 'seconds', amount, known: true },
        ]),
      ).toThrow()
    }
    expect(() =>
      addSpend(measured(), {
        ...zeroSpend(),
        resources: { gpu: { unit: 'minutes', amount: 1, known: true } },
      }),
    ).toThrow('unit mismatch')
  })

  it('records overrun before refusing and preserves unknowns through restart', () => {
    const pool = createBudgetPool(budget(), 0)
    const reservation = pool.reserve(budget(4))
    if (!reservation.ok) throw new Error('reservation failed')
    expect(() => pool.reconcile(reservation.ticket, measured(5, 20))).toThrow(
      'spent 5 > reserved 4',
    )
    expect(pool.readout().resources?.gpu).toMatchObject({ remaining: 5, committed: 5, reserved: 0 })
    pool.assertNoOpenTickets()
    conserved(pool)

    const unknown = {
      ...zeroSpend(),
      resources: {
        gpu: { unit: 'seconds', amount: 1, known: false },
        io: { unit: 'bytes', amount: 2, known: true },
      },
    }
    const next = pool.reserve(budget(2))
    if (!next.ok) throw new Error('reservation failed')
    expect(() => pool.reconcile(next.ticket, unknown)).toThrow('unknown usage')
    expect(pool.reserve(budget(0)).ok).toBe(false)
    conserved(pool)
    const restored = createBudgetPool(budget(), 0, {
      committed: addSpend(measured(5, 20), unknown),
    })
    expect(restored.readout().resources?.gpu).toMatchObject({ remaining: 0, known: false })
    expect(restored.reserve(budget(0)).ok).toBe(false)
    conserved(restored)
  })

  it('treats explicit restored spend with omitted dimensions as unknown, including zero amounts', () => {
    const restored = createBudgetPool(budget(), 0, { committed: zeroSpend() })
    expect(restored.readout().resources?.gpu.known).toBe(false)
    expect(restored.reserve(budget(1)).ok).toBe(false)
    conserved(restored)
    expect(createBudgetPool(budget(), 0, {}).reserve(budget(1)).ok).toBe(true)
  })

  it('distinguishes a complete omission from a partial increment and a proven predispatch refusal', () => {
    const pool = createBudgetPool(budget(), 0)
    pool.observe(zeroSpend(), { partial: true })
    expect(pool.readout().resources?.gpu.known).toBe(true)
    expect(() => pool.observe(zeroSpend())).toThrow('unknown usage')
    expect(pool.readout().resources?.gpu.known).toBe(false)
    const fresh = createBudgetPool(budget(), 0)
    const reservation = fresh.reserve(budget(4))
    if (!reservation.ok) throw new Error('reservation failed')
    fresh.reconcile(reservation.ticket, withBudgetResources(zeroSpend(), budget(4), true))
    expect(fresh.readout().resources?.gpu.remaining).toBe(10)
    const missing = fresh.reserve(budget(4))
    if (!missing.ok) throw new Error('reservation failed')
    expect(() => fresh.reconcile(missing.ticket, zeroSpend())).toThrow('unknown usage')
    fresh.assertNoOpenTickets()
    conserved(fresh)
  })

  it('retains two concurrent children, their names/units/unknowns, and admission refusal in durable replay', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'named-resource-budget-'))
    try {
      const journal = new FileSpawnJournal(join(dir, 'journal.jsonl'))
      const blobs = new FileResultBlobStore(join(dir, 'blobs'))
      let entered = 0
      let release!: () => void
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      const leaf = (name: string, unknown: boolean): Agent<unknown, string> => {
        const spent = measured()
        if (unknown)
          spent.resources = {
            ...spent.resources,
            gpu: { unit: 'seconds', amount: 1, known: false },
          }
        const executor: Executor<string> = {
          runtime: 'named-resource-test',
          execute() {
            return (async function* (): AsyncGenerator<UsageEvent> {
              entered += 1
              if (entered === 2) release()
              await barrier
              for (const [resourceName, value] of Object.entries(spent.resources ?? {})) {
                yield { kind: 'resource', name: resourceName, ...value }
              }
            })()
          },
          resultArtifact: () => ({ outRef: name, out: name, spent }),
          teardown: async () => ({ destroyed: true }),
        }
        return {
          name,
          act: async () => name,
          executorSpec: { profile: testAgentProfile(name), harness: null, executor },
        }
      }
      const runId = 'named-resources'
      const result = await createSupervisor<unknown, string>().run(
        {
          name: 'root',
          async act(task, scope) {
            expect(
              scope.spawn(leaf('known', false), task, { label: 'known', budget: budget(4) }).ok,
            ).toBe(true)
            expect(
              scope.spawn(leaf('unknown', true), task, { label: 'unknown', budget: budget(4) }).ok,
            ).toBe(true)
            expect(scope.budget.resources?.gpu.reserved).toBe(8)
            await scope.next()
            await scope.next()
            expect(scope.budget.resources?.gpu.known).toBe(false)
            expect(
              scope.spawn(leaf('denied', false), task, { label: 'denied', budget: budget(1) }).ok,
            ).toBe(false)
            return 'completed'
          },
        },
        'task',
        { budget: budget(), runId, journal, blobs, executors: createExecutorRegistry() },
      )
      expect(entered).toBe(2)
      expect(result.spentTotal.resources).toEqual({
        gpu: { unit: 'seconds', amount: 3, known: false },
        io: { unit: 'bytes', amount: 40, known: true },
      })
      const reopened = new FileSpawnJournal(join(dir, 'journal.jsonl'))
      const replayed = await replaySpawnTree(
        reopened,
        new FileResultBlobStore(join(dir, 'blobs')),
        runId,
      )
      expect(replayed).toHaveLength(2)
      expect(replayed.map((row) => row.kind).sort()).toEqual(['done', 'down'])
      const events = await reopened.loadTree(runId)
      if (!events) throw new Error('journal absent')
      expect(
        materializeTreeView(events)
          .nodes.filter((node) => node.parent !== undefined)
          .map((node) => node.spent.resources?.gpu.known)
          .sort(),
      ).toEqual([false, true])
      const restored = await prepareScopeResume(
        { runId, journal: reopened, blobs },
        events,
        new AbortController().signal,
        () => Date.now(),
      )
      const pool = createBudgetPool(budget(), 0, restored.poolRestore)
      expect(pool.readout().resources?.gpu.known).toBe(false)
      expect(pool.reserve(budget(0)).ok).toBe(false)
      conserved(pool)
      const copy = cloneSpend(result.spentTotal)
      expect(copy.resources).toEqual(result.spentTotal.resources)
      expect(copy.resources).not.toBe(result.spentTotal.resources)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
