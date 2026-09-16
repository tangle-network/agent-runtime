/**
 * A refused spawn says which budget channels fell short and by how much.
 *
 * Measured 2026-09-16 on a Discovery director placed on the Tangle sandbox: its first research
 * child asked for 100 iterations against a 60-iteration pool and got back "the conserved pool
 * refused this spawn (budget-exhausted); the run has no allocation left to give this worker".
 * Nothing in that told it the pool still admitted 60, so it spent a throwaway probe worker with 3
 * iterations to find out, then moved its research to local processes.
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

const pinned = {
  usdUnbudgeted: 'usd-unbudgeted text',
  inDoubt: 'in-doubt text',
  scopeSettled: 'scope-settled text',
}

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

describe('budget pool refusal', () => {
  it('names the channel, the request, and what is still free', () => {
    const pool = createBudgetPool({ maxIterations: 60, maxTokens: 3_000_000 }, 0)
    expect(pool.reserve({ maxIterations: 100, maxTokens: 800_000 })).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfalls: [{ channel: 'iterations', requested: 100, free: 60 }],
    })
    // A request sized from `free` on iterations is admitted.
    expect(pool.reserve({ maxIterations: 60, maxTokens: 800_000 }).ok).toBe(true)
    // With the pool fully reserved, the free balance reads 0, never negative.
    expect(pool.reserve({ maxIterations: 1, maxTokens: 1 })).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfalls: [{ channel: 'iterations', requested: 1, free: 0 }],
    })
  })

  it('lists every channel that does not fit, not only the first', () => {
    const pool = createBudgetPool({ maxIterations: 60, maxTokens: 3_000_000, maxUsd: 2 }, 0)
    expect(pool.reserve({ maxIterations: 100, maxTokens: 4_000_000, maxUsd: 5 })).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfalls: [
        { channel: 'tokens', requested: 4_000_000, free: 3_000_000 },
        { channel: 'iterations', requested: 100, free: 60 },
        { channel: 'usd', requested: 5, free: 2 },
      ],
    })
  })

  it('keeps usd-unbudgeted for a dollar request against an uncapped root', () => {
    const uncapped = createBudgetPool({ maxIterations: 10, maxTokens: 1_000 }, 0)
    expect(uncapped.reserve({ maxIterations: 1, maxTokens: 10, maxUsd: 1 })).toEqual({
      ok: false,
      reason: 'usd-unbudgeted',
    })
  })
})

describe('spawn refusal reaches the driver', () => {
  it('carries the shortfalls from the pool through scope.spawn', async () => {
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
    expect(settled.fleetYield?.spawned ?? 0).toBe(0)
    expect(refusal).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfalls: [{ channel: 'iterations', requested: 100, free: 60 }],
    })
  })

  it('tells the driver the exact iteration ceiling', () => {
    expect(
      spawnRefusalReason(
        'budget-exhausted',
        [{ channel: 'iterations', requested: 100, free: 58 }],
        pinned,
      ),
    ).toBe(
      'the run pool refused this spawn: iterations has 58 free (this spawn asked for budget.maxIterations 100); budget.maxIterations at most 58 fits; or ask the caller for a larger root budget',
    )
  })

  it('does not promise tokens or dollars a driver turn will spend first', () => {
    // A driver's own turn is metered from the same pool before its retry reaches admission, so a
    // retry at exactly `free` is refused again (reproduced in review of #1271). The advice must
    // not name that number as a request that fits.
    for (const channel of ['tokens', 'usd'] as const) {
      const text = spawnRefusalReason(
        'budget-exhausted',
        [{ channel, requested: 20_000, free: 9_850 }],
        pinned,
      )
      expect(text, channel).toMatch(/ask for well under 9850/u)
      expect(text, channel).not.toMatch(/at most 9850 fits/u)
    }
  })

  it('names every short channel, and a closed channel as closed for the run', () => {
    const both = spawnRefusalReason(
      'budget-exhausted',
      [
        { channel: 'tokens', requested: 900, free: 0 },
        { channel: 'resource:gpuSeconds', requested: 30, free: 12 },
      ],
      pinned,
    )
    expect(both).toMatch(/tokens has nothing free \(this spawn asked for budget\.maxTokens 900\)/u)
    expect(both).toMatch(/budget\.resources\.gpuSeconds\.limit at most 12 fits/u)
    expect(
      spawnRefusalReason(
        'budget-exhausted',
        [{ channel: 'usd', requested: 0, free: 0, closedByUnknownSpend: true }],
        pinned,
      ),
    ).toMatch(/admits no further spawn at any budget/u)
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
    expect(spawnRefusalReason('max-live-workers', undefined, pinned)).not.toMatch(/cancel/u)
    expect(spawnRefusalReason('invalid-identity', undefined, pinned)).toMatch(/without a key/u)
    expect(spawnRefusalReason('usd-unbudgeted', undefined, pinned)).toBe('usd-unbudgeted text')
    expect(spawnRefusalReason('in-doubt', undefined, pinned)).toBe('in-doubt text')
    expect(spawnRefusalReason('scope-settled', undefined, pinned)).toBe('scope-settled text')
  })
})
