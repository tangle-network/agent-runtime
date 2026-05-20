/**
 * Durable-run substrate tests — crash recovery, lease semantics, event races,
 * divergence detection. The tests run identically against the in-memory store
 * and the file-system store (same `DurableRunStore` contract), so a single
 * matrix proves both implementations.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  D1DurableRunStore,
  DurableAwaitEventTimeoutError,
  DurableRunDivergenceError,
  DurableRunInputMismatchError,
  DurableRunLeaseHeldError,
  type DurableRunManifest,
  type DurableRunStore,
  FileSystemDurableRunStore,
  InMemoryDurableRunStore,
  manifestHash,
  runDurable,
} from '../index'
import { createSqliteD1 } from './sqlite-d1-adapter'

const SCHEMA_SQL = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')

function makeManifest(overrides?: Partial<DurableRunManifest>): DurableRunManifest {
  return {
    projectId: 'test-project',
    scenarioId: 'scenario-1',
    task: {
      id: 'task-1',
      intent: 'unit-test',
      domain: 'test',
      requiredKnowledge: [],
      metadata: {},
    },
    input: { x: 1 },
    ...overrides,
  }
}

const storeKinds = [
  {
    name: 'InMemoryDurableRunStore',
    factory: () => ({ store: new InMemoryDurableRunStore(), cleanup: () => undefined }),
  },
  {
    name: 'FileSystemDurableRunStore',
    factory: () => {
      const dir = mkdtempSync(join(tmpdir(), 'durable-runs-test-'))
      return {
        store: new FileSystemDurableRunStore(dir),
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
      }
    },
  },
  {
    name: 'D1DurableRunStore (better-sqlite3)',
    factory: () => {
      const handle = createSqliteD1()
      handle.raw.exec(SCHEMA_SQL)
      return {
        store: new D1DurableRunStore(handle.db),
        cleanup: () => handle.close(),
      }
    },
  },
] as const

for (const kind of storeKinds) {
  describe(`durable-runs / ${kind.name}`, () => {
    let store: DurableRunStore
    let cleanup: () => void

    beforeEach(() => {
      const made = kind.factory()
      store = made.store
      cleanup = made.cleanup
    })

    afterEach(async () => {
      await store.close()
      cleanup()
    })

    it('executes a fresh run end-to-end and returns the result', async () => {
      const { result, record, steps } = await runDurable({
        runId: 'r1',
        manifest: makeManifest(),
        store,
        taskFn: async (ctx) => {
          const a = await ctx.step('add', async () => 1 + 1)
          const b = await ctx.step('multiply', async () => a * 5)
          return b
        },
      })
      expect(result).toBe(10)
      expect(record.status).toBe('completed')
      expect(steps.map((s) => ({ idx: s.stepIndex, intent: s.intent, status: s.status }))).toEqual([
        { idx: 0, intent: 'add', status: 'completed' },
        { idx: 1, intent: 'multiply', status: 'completed' },
      ])
    })

    it('replays completed steps without re-executing fn', async () => {
      let calls = 0
      // First run — abort mid-stream.
      try {
        await runDurable({
          runId: 'r2',
          manifest: makeManifest(),
          store,
          taskFn: async (ctx) => {
            await ctx.step('first', async () => {
              calls += 1
              return 'one'
            })
            await ctx.step('boom', async () => {
              throw new Error('forced failure')
            })
            return 'never'
          },
        })
      } catch (e) {
        expect((e as Error).message).toBe('forced failure')
      }
      expect(calls).toBe(1)

      // Second run — fix the failing step. Verify 'first' is NOT re-executed.
      const { result } = await runDurable({
        runId: 'r2',
        manifest: makeManifest(),
        store,
        taskFn: async (ctx) => {
          const a = await ctx.step('first', async () => {
            calls += 1
            return 'one'
          })
          const b = await ctx.step('boom', async () => 'fixed')
          return `${a}-${b}`
        },
      })
      expect(result).toBe('one-fixed')
      // First-step callback called exactly once across the two runs.
      expect(calls).toBe(1)
    })

    it('rejects manifest mismatch on resume', async () => {
      await runDurable({
        runId: 'r3',
        manifest: makeManifest({ input: { x: 1 } }),
        store,
        taskFn: async (ctx) => ctx.step('s', async () => 'ok'),
      })
      await expect(
        runDurable({
          runId: 'r3',
          manifest: makeManifest({ input: { x: 2 } }),
          store,
          taskFn: async () => 'noop',
        }),
      ).rejects.toBeInstanceOf(DurableRunInputMismatchError)
    })

    it('rejects step divergence (intent change at same position)', async () => {
      try {
        await runDurable({
          runId: 'r4',
          manifest: makeManifest(),
          store,
          taskFn: async (ctx) => {
            await ctx.step('first', async () => 1)
            await ctx.step('second', async () => {
              throw new Error('boom')
            })
            return 'never'
          },
        })
      } catch {
        /* expected */
      }
      await expect(
        runDurable({
          runId: 'r4',
          manifest: makeManifest(),
          store,
          taskFn: async (ctx) => {
            await ctx.step('first', async () => 1)
            await ctx.step('DIFFERENT', async () => 2) // diverges at idx 1
            return 'noop'
          },
        }),
      ).rejects.toBeInstanceOf(DurableRunDivergenceError)
    })

    it('refuses concurrent acquisition while lease is live', async () => {
      const { run } = await store.startOrResume({
        runId: 'r5',
        manifest: makeManifest(),
        workerId: 'workerA',
        leaseMs: 60_000,
      })
      expect(run.leaseHolderId).toBe('workerA')
      await expect(
        store.startOrResume({
          runId: 'r5',
          manifest: makeManifest(),
          workerId: 'workerB',
          leaseMs: 60_000,
        }),
      ).rejects.toBeInstanceOf(DurableRunLeaseHeldError)
    })

    it('allows takeover after lease expires', async () => {
      const { run } = await store.startOrResume({
        runId: 'r6',
        manifest: makeManifest(),
        workerId: 'workerA',
        leaseMs: 50,
      })
      expect(run.leaseHolderId).toBe('workerA')
      // Wait past lease expiry.
      await new Promise((r) => setTimeout(r, 80))
      const taken = await store.startOrResume({
        runId: 'r6',
        manifest: makeManifest(),
        workerId: 'workerB',
        leaseMs: 60_000,
      })
      expect(taken.run.leaseHolderId).toBe('workerB')
    })

    it('awaitEvent receives the first emit and is replayed thereafter', async () => {
      // Concurrently emit the event while runDurable is awaiting it — this
      // mirrors the production pattern (external system fires a webhook /
      // tool callback while the agent task is suspended).
      const emitSoon = new Promise<void>((resolve) => {
        setTimeout(() => {
          void store
            .emitEvent({ runId: 'r7', key: 'shipment', payload: { tracking: 'X1' } })
            .then(() => resolve())
        }, 40)
      })

      const { result } = await runDurable({
        runId: 'r7',
        manifest: makeManifest(),
        store,
        taskFn: async (ctx) => {
          const ev = await ctx.awaitEvent<{ tracking: string }>('shipment', {
            timeoutMs: 2_000,
            pollMs: 10,
          })
          return ev.tracking
        },
      })
      await emitSoon
      expect(result).toBe('X1')

      // Replay the same run — awaitEvent returns from cache.
      const replay = await runDurable({
        runId: 'r7',
        manifest: makeManifest(),
        store,
        taskFn: async (ctx) => {
          const ev = await ctx.awaitEvent<{ tracking: string }>('shipment', { timeoutMs: 1_000 })
          return ev.tracking
        },
      })
      expect(replay.result).toBe('X1')
    })

    it('awaitEvent times out cleanly', async () => {
      await expect(
        runDurable({
          runId: 'r8',
          manifest: makeManifest(),
          store,
          taskFn: async (ctx) => ctx.awaitEvent('never', { timeoutMs: 50, pollMs: 10 }),
        }),
      ).rejects.toBeInstanceOf(DurableAwaitEventTimeoutError)
    })

    it('emitEvent enforces first-emit-wins', async () => {
      await store.startOrResume({ runId: 'r9', manifest: makeManifest(), workerId: 'w1' })
      const first = await store.emitEvent({ runId: 'r9', key: 'k', payload: { v: 1 } })
      expect(first.accepted).toBe(true)
      const second = await store.emitEvent({ runId: 'r9', key: 'k', payload: { v: 2 } })
      expect(second.accepted).toBe(false)
      expect((second.record.payload as { v: number }).v).toBe(1)
    })

    it('ctx.now and ctx.uuid are stable across replay', async () => {
      const first = await runDurable({
        runId: 'r10',
        manifest: makeManifest(),
        store,
        taskFn: async (ctx) => {
          const t = await ctx.now()
          const id = await ctx.uuid()
          return { t: t.toISOString(), id }
        },
      })
      // Force a "fresh" replay by manually re-running. The fact that the
      // run is already 'completed' shouldn't matter for cached step replay.
      const replay = await runDurable({
        runId: 'r10',
        manifest: makeManifest(),
        store,
        taskFn: async (ctx) => {
          const t = await ctx.now()
          const id = await ctx.uuid()
          return { t: t.toISOString(), id }
        },
      })
      expect(replay.result).toEqual(first.result)
    })
  })
}

describe('manifestHash', () => {
  it('is stable across object insertion order', () => {
    const a = makeManifest({ input: { a: 1, b: 2 } })
    const b = makeManifest({ input: { b: 2, a: 1 } })
    expect(manifestHash(a)).toBe(manifestHash(b))
  })
})
