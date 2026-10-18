import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { ValidationError } from '../../src/errors'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { Agent, Budget } from '../../src/runtime/supervise/types'
import { zeroSpend } from '../../src/runtime/util'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

/**
 * Discovery, 2026-10-17: five team runs set perWorker.maxIterations = Number.MAX_SAFE_INTEGER,
 * equal to the root's pool. With no owner share the first child took every iteration and the
 * root's next turn was refused as budget-exhausted; with ownerShare 0.5 every spawn was refused.
 * Both surfaced hours in. supervise now refuses such a perWorker when the run starts.
 */
const root: Budget = { maxIterations: Number.MAX_SAFE_INTEGER, maxTokens: 20_000_000 }
const discoveryPerWorker: Budget = { maxIterations: Number.MAX_SAFE_INTEGER, maxTokens: 4_000_000 }
// The floor scope admission keeps for the owner at ownerShare 0.5.
const keep = {
  tokens: Math.ceil(root.maxTokens * 0.5),
  iterations: Math.ceil(root.maxIterations * 0.5),
}

const rootProfile = testAgentProfile('root', {
  harness: 'cli-base',
  tools: runtimeToolDeclarations('spawn_worker'),
})

function rootRun(perWorker: Budget, ownerShare?: number) {
  let calls = 0
  let entered = 0
  const leaf: Agent<unknown, unknown> = {
    name: 'leaf',
    act: async () => 'unused',
    executorSpec: {
      profile: testAgentProfile('leaf'),
      harness: null,
      executor: {
        runtime: 'admission-probe',
        execute: async () => {
          entered++
          return { outRef: 'leaf', out: 'done', spent: { ...zeroSpend(), iterations: 1 } }
        },
        teardown: async () => ({ destroyed: true }),
      },
    },
  }
  const start = () =>
    supervise(rootProfile, 'work', {
      budget: root,
      perWorker,
      ...(ownerShare === undefined ? {} : { reservationPolicy: { ownerShare } }),
      journal: new InMemorySpawnJournal(),
      makeWorkerAgent: () => leaf,
      router: {
        routerBaseUrl: 'http://unused.invalid/v1',
        routerKey: 'offline',
        complete: async (body) => ({
          model: body.model,
          choices: [
            {
              message: {
                content: calls === 0 ? '' : 'done',
                tool_calls:
                  calls++ === 0
                    ? [
                        {
                          id: 'spawn',
                          type: 'function',
                          function: {
                            name: 'spawn_worker',
                            arguments: JSON.stringify({
                              profile: testAgentProfile('leaf'),
                              task: 'work',
                            }),
                          },
                        },
                      ]
                    : [],
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      },
    })
  return { start, entered: () => entered }
}

describe('supervise refuses a perWorker no child can be admitted under', () => {
  it('ownerShare 0.5: the pool refuses the child, so supervise refuses the run at start', () => {
    const pool = createBudgetPool(root, 0)
    const refused = pool.reserve(discoveryPerWorker, undefined, { keep })
    expect(refused).toMatchObject({ ok: false, reason: 'budget-exhausted' })
    expect(refused.ok ? [] : refused.shortfalls?.map((s) => s.channel)).toEqual(['iterations'])

    const run = rootRun(discoveryPerWorker, 0.5)
    expect(run.start).toThrow(ValidationError)
    expect(run.start).toThrow(
      /perWorker\.maxIterations \(9007199254740991\) exceeds the reservable budget\.maxIterations \(4503599627370495: 9007199254740991 less the owner's kept 4503599627370496/,
    )
    expect(run.entered()).toBe(0)
  })

  it('no owner share: a whole-pool child leaves the owner no next turn, so supervise refuses it', () => {
    const pool = createBudgetPool(root, 0)
    const granted = pool.reserve(discoveryPerWorker)
    expect(granted.ok).toBe(true)
    pool.observe({ ...zeroSpend(), iterations: 1 })
    expect(pool.readout().iterationsLeft).toBe(-1)

    const run = rootRun(discoveryPerWorker)
    expect(run.start).toThrow(ValidationError)
    expect(run.start).toThrow(
      /perWorker\.maxIterations \(9007199254740991\) equals the whole budget\.maxIterations/,
    )
  })

  it('accepts the reservable bound and runs a child within it', async () => {
    const reservable: Budget = {
      maxIterations: root.maxIterations - keep.iterations,
      maxTokens: root.maxTokens - keep.tokens,
    }
    // A fresh pool admits exactly the reservable amount beside the kept share, so the bound is
    // the true "never admitted" line. Once the owner has spent a turn, the free balance less the
    // kept share is smaller, so a run that spawns after its first turn needs a margin below it.
    const fresh = createBudgetPool(root, 0)
    expect(fresh.reserve(reservable, undefined, { keep }).ok).toBe(true)
    const spent = createBudgetPool(root, 0)
    spent.observe({ ...zeroSpend(), iterations: 1 })
    expect(spent.reserve(reservable, undefined, { keep }).ok).toBe(false)
    // supervise accepts the bound itself at start; the run settles rather than throwing.
    await rootRun(reservable, 0.5).start()

    const half: Budget = {
      maxIterations: Math.floor(reservable.maxIterations / 2),
      maxTokens: Math.floor(reservable.maxTokens / 2),
    }
    const run = rootRun(half, 0.5)
    const result = await run.start()
    expect(run.entered()).toBe(1)
    expect(result.spentTotal.iterations).toBeGreaterThanOrEqual(2)
  })
})
