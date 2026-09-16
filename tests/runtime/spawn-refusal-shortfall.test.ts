/**
 * A refused spawn says which budget channel fell short and by how much.
 *
 * Measured 2026-09-16 on a Discovery director placed on the Tangle sandbox: its first research
 * child asked for 100 iterations against a 60-iteration pool and got back "the conserved pool
 * refused this spawn (budget-exhausted); the run has no allocation left to give this worker".
 * Nothing in that told it the pool still admitted 60, so it spent a throwaway probe worker with 3
 * iterations to find out. The shortfall makes the next request sizeable in one step.
 */

import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { spawnRefusalReason } from '../../src/mcp/tools/coordination'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
  SpawnRejection,
} from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

/** A child that would run if admitted. The refusal must come before its executor is touched. */
function childThatMustNotRun(): Agent<unknown, string | undefined> {
  const executor: Executor<string> = {
    runtime: 'router',
    execute: async (): Promise<ExecutorResult<string>> => {
      throw new Error('a refused child must not execute')
    },
    teardown: async () => ({ destroyed: true }),
  }
  const executorSpec: AgentSpec = {
    profile: testAgentProfile('child'),
    harness: null,
    executor: executor as Executor<unknown>,
  }
  return { name: 'child', act: async () => 'never', executorSpec } as Agent<
    unknown,
    string | undefined
  >
}

const pinned = {
  usdUnbudgeted: 'usd-unbudgeted text',
  inDoubt: 'in-doubt text',
  scopeSettled: 'scope-settled text',
}

describe('budget pool refusal', () => {
  it('names the channel, the request, and what is still free', () => {
    const pool = createBudgetPool({ maxIterations: 60, maxTokens: 3_000_000 }, 0)
    expect(pool.reserve({ maxIterations: 100, maxTokens: 800_000 })).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfall: { channel: 'iterations', requested: 100, free: 60 },
    })
    expect(pool.reserve({ maxIterations: 10, maxTokens: 4_000_000 })).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfall: { channel: 'tokens', requested: 4_000_000, free: 3_000_000 },
    })
    // A request sized from `free` is admitted: the shortfall is enough to succeed next time.
    const admitted = pool.reserve({ maxIterations: 60, maxTokens: 800_000 })
    expect(admitted.ok).toBe(true)
    // With the pool fully reserved, the free balance reads 0, never negative.
    expect(pool.reserve({ maxIterations: 1, maxTokens: 1 })).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfall: { channel: 'iterations', requested: 1, free: 0 },
    })
  })

  it('reports a dollar shortfall against a capped root', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1_000, maxUsd: 2 }, 0)
    expect(pool.reserve({ maxIterations: 1, maxTokens: 10, maxUsd: 5 })).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfall: { channel: 'usd', requested: 5, free: 2 },
    })
    // Without a root dollar cap the rejection stays `usd-unbudgeted`, with no shortfall to size.
    const uncapped = createBudgetPool({ maxIterations: 10, maxTokens: 1_000 }, 0)
    expect(uncapped.reserve({ maxIterations: 1, maxTokens: 10, maxUsd: 1 })).toEqual({
      ok: false,
      reason: 'usd-unbudgeted',
    })
  })
})

describe('spawn refusal reaches the driver', () => {
  it('carries the shortfall from the pool through scope.spawn', async () => {
    let refusal: ReturnType<Scope<string | undefined>['spawn']> | undefined
    const settled = await createSupervisor<unknown, string | undefined>().run(
      {
        name: 'root',
        act: async (_task: unknown, scope: Scope<string | undefined>) => {
          refusal = scope.spawn(childThatMustNotRun(), 'go', {
            budget: { maxIterations: 100, maxTokens: 10_000 },
            label: 'too-big',
          })
          return undefined
        },
      } as Agent<unknown, string | undefined>,
      'task',
      {
        budget: { maxIterations: 60, maxTokens: 100_000 },
        runId: 'spawn-refusal-shortfall',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
        now: () => 0,
      },
    )
    // The root returned normally after the refusal; nothing was spawned.
    expect(settled.fleetYield?.spawned ?? 0).toBe(0)
    expect(refusal).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfall: { channel: 'iterations', requested: 100, free: 60 },
    })
  })

  it('tells the driver the largest request that fits', () => {
    expect(
      spawnRefusalReason(
        'budget-exhausted',
        { channel: 'iterations', requested: 100, free: 58 },
        pinned,
      ),
    ).toBe(
      'the run pool has 58 iterations free and this spawn asked for budget.maxIterations 100; spawn again with budget.maxIterations at most 58, or ask the caller for a larger root budget',
    )
    expect(
      spawnRefusalReason(
        'budget-exhausted',
        { channel: 'tokens', requested: 900, free: 0 },
        pinned,
      ),
    ).toMatch(/no tokens left to reserve \(this spawn asked for budget\.maxTokens 900\)/u)
    expect(
      spawnRefusalReason(
        'budget-exhausted',
        { channel: 'resource:gpuSeconds', requested: 30, free: 12 },
        pinned,
      ),
    ).toMatch(/budget\.resources\.gpuSeconds\.limit at most 12/u)
    expect(
      spawnRefusalReason(
        'budget-exhausted',
        { channel: 'usd', requested: 1, free: 0, closedByUnknownSpend: true },
        pinned,
      ),
    ).toMatch(/no smaller request fits/u)
  })

  it('does not call a non-budget refusal an empty pool', () => {
    const kinds: SpawnRejection[] = [
      'depth-exceeded',
      'duplicate-key',
      'invalid-identity',
      'key-conflict',
      'max-live-workers',
      'scope-aborted',
    ]
    for (const kind of kinds) {
      const text = spawnRefusalReason(kind, undefined, pinned)
      expect(text, kind).not.toMatch(/pool|allocation/u)
      expect(text.length, kind).toBeGreaterThan(20)
    }
    expect(spawnRefusalReason('usd-unbudgeted', undefined, pinned)).toBe('usd-unbudgeted text')
    expect(spawnRefusalReason('in-doubt', undefined, pinned)).toBe('in-doubt text')
    expect(spawnRefusalReason('scope-settled', undefined, pinned)).toBe('scope-settled text')
  })
})
