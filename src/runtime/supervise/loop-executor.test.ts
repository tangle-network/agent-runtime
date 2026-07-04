import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../durable/spawn-journal'
import { defineLoop, loopChild, loopExecutorFactory } from './loop-executor'
import { createInMemoryRunContext } from './run-context'
import { nestedScopeSeamKey } from './scope'
import { createSupervisor } from './supervisor'
import type { Agent, AgentSpec, Budget, Executor, ExecutorResult, Scope, Settled } from './types'

// Nested budgets: the conserved pool reserves each spawn's full ceiling until it settles, so a
// child that itself spawns needs global headroom beyond its own reservation. Pool > child > leaf.
const POOL: Budget = { maxIterations: 1000, maxTokens: 10_000_000, maxUsd: 100 }
const CHILD: Budget = { maxIterations: 100, maxTokens: 1_000_000, maxUsd: 10 }
const LEAF: Budget = { maxIterations: 10, maxTokens: 100_000, maxUsd: 1 }

/** A root Agent that spawns ONE child, drains it, and RETURNS its `Settled` — so the run's
 *  winner `out` IS the child's settlement (the supervisor's winner is the root's return value). */
function rootReturningChild(child: Agent<unknown, unknown>): Agent<unknown, unknown> {
  return {
    name: 'root',
    async act(task, scope: Scope<unknown>) {
      const r = scope.spawn(child, task, { budget: CHILD, label: 'under-test' })
      if (!r.ok) throw new Error(`spawn failed: ${r.reason}`)
      return await scope.next()
    },
  }
}

/** Narrow a winner result to the child `Settled` the root returned. */
function settledOf(result: { kind: string; out?: unknown }): Settled<unknown> {
  expect(result.kind).toBe('winner')
  return (result as { out: Settled<unknown> }).out
}

describe('loop-executor: a coded loop as a spawnable atom', () => {
  it('runs bounded rounds, stops as soon as the gate passes, settles valid', async () => {
    const rounds: number[] = []
    const ctx = createInMemoryRunContext({ withLoop: true })
    const loop = defineLoop('gate-loop', {
      maxRounds: 5,
      round: async ({ round }) => {
        rounds.push(round)
        return { out: { hits: round } }
      },
      check: (out) => (out as { hits: number }).hits >= 3, // delivered at round 3
    })
    const result = await createSupervisor().run(
      rootReturningChild(loopChild(loop, ctx.journal)),
      'go',
      { budget: POOL, runId: 'test-gate', ...ctx },
    )
    expect(rounds).toEqual([1, 2, 3]) // stopped the instant the gate passed, not all 5
    const settled = settledOf(result)
    expect(settled.kind).toBe('done')
    if (settled.kind === 'done') {
      expect(settled.verdict?.valid).toBe(true)
      expect(settled.out).toMatchObject({ hits: 3 })
    }
  })

  it('exhausts maxRounds without the gate passing → settles NOT delivered (valid:false)', async () => {
    const rounds: number[] = []
    const ctx = createInMemoryRunContext({ withLoop: true })
    const loop = defineLoop('never-delivers', {
      maxRounds: 3,
      round: async ({ round }) => {
        rounds.push(round)
        return { out: { hits: round } }
      },
      check: () => false, // never delivered
    })
    const result = await createSupervisor().run(
      rootReturningChild(loopChild(loop, ctx.journal)),
      'go',
      { budget: POOL, runId: 'test-nodeliver', ...ctx },
    )
    expect(rounds).toEqual([1, 2, 3]) // ran the full ceiling
    const settled = settledOf(result)
    expect(settled.kind).toBe('done') // it ran and settled...
    if (settled.kind === 'done') expect(settled.verdict?.valid).toBe(false) // ...but did not DELIVER
  })

  it('folds a supervisor steer message into the NEXT round (queued semantics)', async () => {
    // Focused harness: drive the executor directly with a stubbed nested-scope seam so we can
    // deliver a steer WHILE round 1 is paused mid-body, then assert round 2 sees it — not round 1.
    const journal = new InMemorySpawnJournal()
    await journal.beginTree('root', new Date(0).toISOString())
    const stubScope = {
      signal: new AbortController().signal,
      budget: {
        tokensLeft: 1_000_000,
        usdLeft: 10,
        usdCapped: false,
        deadlineMs: 0,
        reservedTokens: 0,
      },
    } as unknown as Scope<unknown>
    const seam = { depth: 0, maxDepth: 4, journalRoot: 'root', mount: () => stubScope }
    const execCtx = { signal: new AbortController().signal, seams: { [nestedScopeSeamKey]: seam } }

    const seenSteer: string[][] = []
    let startRound1: () => void = () => {}
    let releaseRound1: () => void = () => {}
    const round1Running = new Promise<void>((r) => {
      startRound1 = r
    })
    const round1Gate = new Promise<void>((r) => {
      releaseRound1 = r
    })

    const loop = defineLoop('steer-loop', {
      maxRounds: 2,
      round: async ({ round, steer }) => {
        seenSteer.push([...steer]) // records what THIS round was handed
        if (round === 1) {
          startRound1()
          await round1Gate
        }
        return { out: round, done: round === 2 }
      },
    })
    const spec = (loopChild(loop, journal) as unknown as { executorSpec: AgentSpec }).executorSpec
    const executor = loopExecutorFactory(spec, execCtx)

    const done = executor.execute('task', new AbortController().signal) as Promise<
      ExecutorResult<unknown>
    >
    await round1Running // round 1 has drained (empty) and is paused mid-body
    executor.deliver?.({ steer: 'adjust course' }) // lands after round 1's drain
    releaseRound1()
    await done

    expect(seenSteer[0]).toEqual([]) // round 1 saw no steer
    expect(seenSteer[1]).toEqual(['adjust course']) // round 2 folded the queued steer in
  })

  it('a round that spawns a child rolls that child spend into the conserved total', async () => {
    const ctx = createInMemoryRunContext({ withLoop: true })
    // A trivial leaf worker (BYO executor) that reports a known spend when the loop spawns it.
    const leafSpend = { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0.01, ms: 1 }
    const leafResult: ExecutorResult<unknown> = {
      outRef: 'leaf:1',
      out: { ok: true },
      verdict: { valid: true, score: 1 },
      spent: leafSpend,
    }
    const leafExecutor: Executor<unknown> = {
      runtime: 'inline',
      execute: async () => leafResult,
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => leafResult,
    }
    const leaf: Agent<unknown, unknown> = {
      name: 'leaf',
      executorSpec: { profile: { name: 'leaf' }, harness: null, executor: leafExecutor },
      act: async () => '',
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }

    const loop = defineLoop('spawning-loop', {
      maxRounds: 1,
      round: async ({ scope }) => {
        const r = scope.spawn(leaf, 'do', { budget: LEAF, label: 'leaf' })
        if (r.ok) await scope.next()
        return { out: { spawned: r.ok }, done: true }
      },
      check: (out) => (out as { spawned: boolean }).spawned === true,
    })
    const result = await createSupervisor().run(
      rootReturningChild(loopChild(loop, ctx.journal)),
      'go',
      { budget: POOL, runId: 'test-conserve', ...ctx },
    )
    const settled = settledOf(result)
    expect(settled.kind).toBe('done')
    if (settled.kind === 'done') expect(settled.verdict?.valid).toBe(true) // the child spawned + delivered
    // The leaf's tokens surfaced in the run-wide conserved total via the loop's nested scope.
    const spent = (result as { spentTotal: { tokens: { input: number; output: number } } })
      .spentTotal
    expect(spent.tokens.input).toBeGreaterThanOrEqual(5)
    expect(spent.tokens.output).toBeGreaterThanOrEqual(5)
  })
})
