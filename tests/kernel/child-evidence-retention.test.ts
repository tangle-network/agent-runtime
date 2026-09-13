import { describe, expect, it, vi } from 'vitest'
import {
  contentAddress,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import { createBudgetPool, spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope, settledToIteration } from '../../src/runtime/supervise/scope'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { cloneSpend, zeroSpend } from '../../src/runtime/util'
import { testAgentProfile } from './test-agent-profile'

async function fixture() {
  const root = 'retained-evidence'
  const pool = createBudgetPool({ maxIterations: 100, maxTokens: 100_000 }, 0)
  const journal = new InMemorySpawnJournal()
  const blobs = new InMemoryResultBlobStore()
  await journal.beginTree(root, new Date(0).toISOString())
  const scope = createScope<unknown>({
    parentId: root,
    root,
    pool,
    journal,
    blobs,
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: new AbortController().signal,
    now: () => 0,
  })
  return { root, pool, journal, blobs, scope }
}

function worker(shape: 'promise' | 'stream', input = 20, teardownFails = false) {
  const out = { patch: 'paid-for-result', measurements: [1, 2] }
  const events: UsageEvent[] = [{ kind: 'iteration' }, { kind: 'tokens', input, output: 2 }]
  const spent = spendFromUsageEvents(events)
  const result: ExecutorResult<unknown> = { outRef: 'executor:noncanonical', out, spent }
  const execute = vi.fn(() =>
    shape === 'promise'
      ? Promise.resolve(result)
      : (async function* () {
          yield* events
        })(),
  )
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute,
    resultArtifact: () => result,
    teardown: async () => {
      if (teardownFails) throw new Error('cleanup failed after execution')
      return { destroyed: true }
    },
  }
  const name = 'worker'
  const agent: Agent<unknown, unknown> & { executorSpec: AgentSpec } = {
    name,
    act: async () => out,
    executorSpec: { profile: testAgentProfile(name), harness: null, executor },
  }
  return { agent, execute, out, result }
}

for (const shape of ['promise', 'stream'] as const) {
  describe(`${shape} child evidence`, () => {
    it('retains an over-budget result in live state, the journal, replay, and parent tools', async () => {
      const { root, scope, pool, journal, blobs } = await fixture()
      const { agent, execute, out } = worker(shape)
      const spawned = await scope.spawn(agent, 'task', {
        label: 'paid work',
        budget: { maxIterations: 2, maxTokens: 10 },
      })
      expect(spawned.ok).toBe(true)
      const settled = await scope.next()
      expect(settled?.kind).toBe('down')
      if (settled?.kind !== 'down') throw new Error('expected a failed settlement')
      expect(settled.reason).toMatch(/spent .* tokens > reserved/)
      expect(settled.outRef).toBe(contentAddress(out))
      expect(await blobs.get(settled.outRef!)).toEqual(out)
      expect(
        scope.view.nodes.find((node) => node.id === settled.handle.id)?.spent.tokens,
      ).toMatchObject({ input: 20, output: 2 })
      expect(pool.readout().tokensLeft).toBe(100_000 - 22)
      expect(pool.readout().reservedTokens).toBe(0)
      expect(() => settledToIteration(settled)).toThrow(/cannot adapt a 'down'/)
      expect(scope.view.nodes.find((node) => node.id === settled.handle.id)?.outRef).toBe(
        settled.outRef,
      )
      const events = await journal.loadTree(root)
      expect(events?.find((event) => event.kind === 'settled')).toMatchObject({
        status: 'down',
        outRef: settled.outRef,
      })
      const replayed = await replaySpawnTree(journal, blobs, root)
      expect(replayed[0]).toMatchObject({ kind: 'down', outRef: settled.outRef })
      expect(
        materializeTreeView(events!).nodes.find((node) => node.id === settled.handle.id)?.outRef,
      ).toBe(settled.outRef)
      expect(execute).toHaveBeenCalledTimes(1)
      const tools = createCoordinationTools({
        scope,
        blobs,
        makeWorkerAgent: () => agent,
        perWorker: { maxIterations: 2, maxTokens: 10 },
      })
      const observed = await tools.tools
        .find((tool) => tool.name === 'observe_agent')!
        .handler({ workerId: settled.handle.id })
      expect(observed).toMatchObject({ output: out })
    })

    it('retains the result if teardown fails without marking the failed settlement successful', async () => {
      const { scope, blobs } = await fixture()
      const { agent, out } = worker(shape, 2, true)
      await scope.spawn(agent, 'task', {
        label: 'cleanup failure',
        budget: { maxIterations: 2, maxTokens: 100 },
      })
      const settled = await scope.next()
      expect(settled).toMatchObject({
        kind: 'down',
        reason: expect.stringContaining('cleanup failed'),
        outRef: contentAddress(out),
      })
      expect(await blobs.get(contentAddress(out))).toEqual(out)
    })

    it('charges the terminal usage even when output storage fails', async () => {
      const { scope, blobs, pool } = await fixture()
      const { agent, out } = worker(shape)
      const put = blobs.put.bind(blobs)
      vi.spyOn(blobs, 'put').mockImplementation(async (ref, value) => {
        if (ref === contentAddress(out)) throw new Error('output store unavailable')
        await put(ref, value)
      })
      await scope.spawn(agent, 'task', {
        label: 'storage failure',
        budget: { maxIterations: 2, maxTokens: 100 },
      })
      const settled = await scope.next()
      expect(settled).toMatchObject({
        kind: 'down',
        reason: expect.stringContaining('output store unavailable'),
      })
      expect(settled).not.toHaveProperty('outRef')
      expect(pool.readout().tokensLeft).toBe(100_000 - 22)
      expect(pool.readout().tokensKnown).toBe(true)
    })

    it('retains explicit failed execution output without accepting it', async () => {
      const { scope, blobs } = await fixture()
      const { agent, out, result } = worker(shape)
      Object.assign(result, {
        outcome: { success: false, error: 'task failed with useful evidence' },
      })
      await scope.spawn(agent, 'task', {
        label: 'failed execution',
        budget: { maxIterations: 2, maxTokens: 100 },
      })
      const settled = await scope.next()
      expect(settled).toMatchObject({ kind: 'down', infra: false, outRef: contentAddress(out) })
      expect(await blobs.get(contentAddress(out))).toEqual(out)
    })

    it('retains returned evidence when cancellation arrives during its write', async () => {
      const { scope, blobs, journal, root } = await fixture()
      const { agent, out } = worker(shape)
      const put = blobs.put.bind(blobs)
      let abort: () => void = () => {
        throw new Error('child not admitted')
      }
      vi.spyOn(blobs, 'put').mockImplementation(async (ref, value) => {
        await put(ref, value)
        if (ref === contentAddress(out)) abort()
      })
      const spawned = scope.spawn(agent, 'task', {
        label: 'cancelled result',
        budget: { maxIterations: 2, maxTokens: 100 },
      })
      if (!spawned.ok) throw new Error('expected admission')
      abort = () => spawned.handle.abort('cancel after output')
      const settled = await scope.next()
      expect(settled).toMatchObject({ kind: 'down', outRef: contentAddress(out) })
      expect(await blobs.get(contentAddress(out))).toEqual(out)
      expect(await replaySpawnTree(journal, blobs, root)).toEqual([
        expect.objectContaining({ kind: 'down', outRef: contentAddress(out) }),
      ])
    })

    it('keeps successful results unchanged', async () => {
      const { scope, blobs } = await fixture()
      const { agent, out } = worker(shape, 2)
      await scope.spawn(agent, 'task', {
        label: 'success',
        budget: { maxIterations: 2, maxTokens: 100 },
      })
      const settled = await scope.next()
      expect(settled).toMatchObject({ kind: 'done', out, outRef: contentAddress(out) })
      expect(await blobs.get(contentAddress(out))).toEqual(out)
    })
  })
}

describe('spend evidence copies', () => {
  it.each(['harness-store', 'mixed'] as const)(
    'preserves %s provenance without aliasing counters',
    (provenance) => {
      const spend = { ...zeroSpend(), tokensProvenance: provenance }
      const cloned = cloneSpend(spend)
      expect(cloned.tokensProvenance).toBe(provenance)
      expect(cloned.tokens).not.toBe(spend.tokens)
    },
  )
  it('does not invent provenance for a stream-only receipt', () => {
    expect(cloneSpend(zeroSpend())).not.toHaveProperty('tokensProvenance')
  })
})
