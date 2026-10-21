import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { replaySpawnTree } from '../../src/durable/spawn-journal/replay'
import { FileResultBlobStore } from '../../src/durable/spawn-journal/result-blob-store'
import { materializeTreeView } from '../../src/durable/spawn-journal/tree-view'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { prepareScopeResume } from '../../src/runtime/supervise/recover-executors'

import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'

import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, Budget, Executor, Spend, UsageEvent } from '../../src/runtime/supervise/types'
import { cloneSpend, zeroSpend } from '../../src/runtime/util'
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
  it.each([false, true])(
    'retains exact component receipts through durable replay (overflow=%s)',
    async (overflow) => {
      const dir = await mkdtemp(join(tmpdir(), 'named-resource-overflow-'))
      try {
        const maximum = Number.MAX_SAFE_INTEGER
        const allocations = overflow
          ? [
              [maximum - 1, maximum - 1],
              [2, 1],
            ]
          : Array.from({ length: 100 }, () => [1, 2])
        const total = overflow ? maximum : 100
        const journal = new FileSpawnJournal(join(dir, 'journal.jsonl'))
        const blobs = new FileResultBlobStore(join(dir, 'blobs'))
        const root: Budget = {
          maxTokens: 200,
          maxIterations: 200,
          resources: { gpu: { unit: 'milliseconds', limit: overflow ? maximum : 200 } },
        }
        let release!: () => void
        const barrier = new Promise<void>((resolve) => {
          release = resolve
        })
        const leaf = (amount: number): Agent<unknown, string> => ({
          name: `leaf-${amount}`,
          act: async () => 'done',
          executorSpec: {
            profile: testAgentProfile(`leaf-${amount}`),
            harness: null,
            executor: {
              runtime: 'named-resource-test',
              async execute() {
                await barrier
                return this.resultArtifact()
              },
              resultArtifact: () => ({
                outRef: 'done',
                out: 'done',
                spent: {
                  ...zeroSpend(),
                  resources: { gpu: { unit: 'milliseconds', amount, known: true } },
                },
              }),
              teardown: async () => ({ destroyed: true }),
            },
          },
        })
        const result = await createSupervisor<unknown, string>().run(
          {
            name: 'root',
            async act(task, scope) {
              for (const [amount, limit] of allocations) {
                expect(
                  scope.spawn(leaf(amount), task, {
                    label: `leaf-${amount}`,
                    budget: {
                      maxTokens: 1,
                      maxIterations: 1,
                      resources: { gpu: { unit: 'milliseconds', limit } },
                    },
                  }).ok,
                ).toBe(true)
              }
              release()
              for (let index = 0; index < allocations.length; index += 1) await scope.next()
              expect(scope.budget.resources?.gpu.known).toBe(!overflow)
              return 'done'
            },
          },
          'task',
          { budget: root, runId: 'overflow', journal, blobs, executors: createExecutorRegistry() },
        )
        expect(result.spentTotal.resources?.gpu).toEqual({
          unit: 'milliseconds',
          amount: total,
          known: !overflow,
        })
        const events = await new FileSpawnJournal(join(dir, 'journal.jsonl')).loadTree('overflow')
        if (!events) throw new Error('journal absent')
        const receipts = events.flatMap((event) =>
          event.kind === 'settled' || event.kind === 'cancelled'
            ? [event.spent?.resources?.gpu]
            : [],
        )
        expect(receipts).toHaveLength(allocations.length)
        expect(receipts).toEqual(
          expect.arrayContaining(
            allocations.map(([amount]) => ({ unit: 'milliseconds', amount, known: true })),
          ),
        )
        const restored = await prepareScopeResume(
          { runId: 'overflow', journal, blobs },
          events,
          new AbortController().signal,
          () => Date.now(),
        )
        expect(
          createBudgetPool(root, 0, restored.poolRestore).readout().resources?.gpu,
        ).toMatchObject({ known: !overflow, remaining: overflow ? 0 : 100 })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    // The non-overflow case settles 100 children through a file journal. At a host load average
    // near 200 on 2026-09-13, unmodified main took 11.3 s to 19.9 s across three isolated runs,
    // against the 20 s default. That wall time is contention, not a hang.
    60_000,
  )

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
