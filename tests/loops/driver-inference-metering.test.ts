import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { trajectoryReport } from '../../src/runtime/personify/trajectory'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import {
  type CoordinationDriverOptions,
  coordinationDriverAgent,
  type DriverChat,
  type DriverMessage,
  type DriverTurn,
} from '../../src/runtime/supervise/coordination-driver'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'

// ── A worker leaf with a known, fixed spend (no network/LLM) ─────────────────────
function workerLeaf(
  name: string,
  tokens: { input: number; output: number },
): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* (): AsyncGenerator<UsageEvent> {
        yield { kind: 'iteration' }
        yield { kind: 'tokens', input: tokens.input, output: tokens.output }
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef: `w:${name}`,
        out: { worker: name },
        verdict: { valid: true, score: 1 },
        spent: { iterations: 1, tokens: { ...tokens }, usd: 0, ms: 0 },
      }
    },
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor }
  return { name, act: async () => ({ worker: name }), executorSpec: spec } as Agent<
    unknown,
    unknown
  > & {
    executorSpec: AgentSpec
  }
}

// ── A scripted driver-LLM that reports per-turn usage (the production shape) ──────
function meteredChat(turns: DriverTurn[]): DriverChat {
  let i = 0
  return {
    next: async () => {
      // Past the script → a no-tool STOP turn (never silently repeat the last turn, which would
      // loop forever if that turn carried tool calls).
      const t = turns[i] ?? { content: 'stop' }
      i += 1
      return t
    },
  }
}

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

describe("driver inference metering — the driver's own tokens count against the conserved pool", () => {
  it('folds driver inference into spentTotal and exposes the driver-vs-child breakdown', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const worker = workerLeaf('w', { input: 10, output: 5 })

    // 3 driver turns, each with REAL usage: spawn → await → stop.
    const chat = meteredChat([
      {
        toolCalls: [{ name: 'spawn_worker', arguments: { profile: {}, task: 'go' } }],
        usage: { input: 100, output: 50 },
        costUsd: 0.01,
      },
      {
        toolCalls: [{ name: 'await_next', arguments: {} }],
        usage: { input: 80, output: 40 },
        costUsd: 0.008,
      },
      { content: 'delivered', usage: { input: 30, output: 10 }, costUsd: 0.002 },
    ])
    const opts: CoordinationDriverOptions = {
      name: 'root',
      chat,
      blobs,
      makeWorkerAgent: () => worker,
      perWorker,
      systemPrompt: 'drive',
      maxTurns: 8,
    }
    const result = await createSupervisor<unknown, unknown>().run(
      coordinationDriverAgent(opts),
      'task',
      {
        budget: { maxIterations: 100, maxTokens: 100_000, maxUsd: 10 },
        runId: 'meter',
        journal,
        blobs,
        executors: createExecutorRegistry(),
        maxDepth: 2,
        now: () => 0,
      },
    )

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return

    // childWork = the worker's reconciled spend; driverInference = the 3 metered turns.
    expect(result.spentBreakdown).toBeDefined()
    expect(result.spentBreakdown?.childWork.tokens).toEqual({ input: 10, output: 5 })
    // Driver TOKENS + usd are metered; driver turns are NOT charged to the iteration channel.
    expect(result.spentBreakdown?.driverInference.tokens).toEqual({ input: 210, output: 100 })
    expect(result.spentBreakdown?.driverInference.usd).toBeCloseTo(0.02, 6)
    expect(result.spentBreakdown?.driverInference.iterations).toBe(0)
    // spentTotal = child + driver — the driver's tokens are no longer invisible.
    expect(result.spentTotal.tokens).toEqual({ input: 220, output: 105 })
    expect(result.spentTotal.usd).toBeCloseTo(0.02, 6)
    expect(result.spentTotal.iterations).toBe(1) // the worker's 1 iteration; driver turns aren't charged here
  })

  it('maxTurns=0 is bounded by inference: a never-stopping driver halts when its OWN tokens drain the pool', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: DriverMessage[][] = []
    // A driver that NEVER stops — only the pool bound can halt it. Each turn spends 200 tokens of
    // its OWN inference on a no-spawn tool (list_questions reserves nothing), so only the metered
    // inference drains the pool.
    let n = 0
    const chat: DriverChat = {
      next: async (input) => {
        seen.push([...input.messages])
        n += 1
        return {
          toolCalls: [{ name: 'list_questions', arguments: {} }],
          usage: { input: 150, output: 50 },
        }
      },
    }
    const opts: CoordinationDriverOptions = {
      name: 'root',
      chat,
      blobs,
      makeWorkerAgent: () => workerLeaf('w', { input: 1, output: 1 }),
      perWorker: { maxIterations: 4, maxTokens: 500 },
      systemPrompt: 'drive',
      maxTurns: 0, // unlimited turn count — the pool is the only bound
    }
    const result = await createSupervisor<unknown, unknown>().run(
      coordinationDriverAgent(opts),
      'never-ending',
      {
        budget: { maxIterations: 100, maxTokens: 1000 }, // only ~5 turns of 200-token inference fit
        runId: 'meter-bound',
        journal,
        blobs,
        executors: createExecutorRegistry(),
        maxDepth: 2,
        now: () => 0,
      },
    )

    // free: 1000 → 800 → 600 → 400; the guard breaks at the top of turn 3 (free 400 < perWorker 500),
    // so the never-stopping driver halts at 3 turns — NOT the 2000 tripwire. Metering made maxTurns=0
    // genuinely bounded by the conserved pool.
    expect(seen.length).toBe(3)
    expect(result.kind).toBe('no-winner')
    expect(n).toBe(3)
  })

  it('emits an agent.turn observability event per metered driver turn (the live A++ view)', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const turnEvents: RuntimeHookEvent[] = []
    const chat = meteredChat([
      {
        toolCalls: [{ name: 'spawn_worker', arguments: { profile: {}, task: 'go' } }],
        usage: { input: 100, output: 50 },
        costUsd: 0.01,
      },
      { toolCalls: [{ name: 'await_next', arguments: {} }], usage: { input: 80, output: 40 } },
      { content: 'done', usage: { input: 30, output: 10 } },
    ])
    const opts: CoordinationDriverOptions = {
      name: 'root',
      chat,
      blobs,
      makeWorkerAgent: () => workerLeaf('w', { input: 10, output: 5 }),
      perWorker,
      systemPrompt: 'drive',
      maxTurns: 8,
    }
    await createSupervisor<unknown, unknown>().run(coordinationDriverAgent(opts), 'task', {
      budget: { maxIterations: 100, maxTokens: 100_000, maxUsd: 10 },
      runId: 'meter-obs',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
      hooks: {
        onEvent: (e) => {
          if (e.target === 'agent.turn') turnEvents.push(e)
        },
      },
    })

    // One agent.turn event per metered turn, carrying the driver-inference payload (turn index,
    // tool calls, spend) — what a topology/cost viewer renders live.
    expect(turnEvents.length).toBe(3)
    const first = turnEvents[0]!.payload as {
      kind: string
      driver: string
      turn: number
      toolCalls: string[]
      spend: { tokens: { input: number } }
    }
    expect(first.kind).toBe('driver-inference')
    expect(first.driver).toBe('root')
    expect(first.turn).toBe(0)
    expect(first.toolCalls).toEqual(['spawn_worker'])
    expect(first.spend.tokens.input).toBe(100)

    // ALL three events carry the right per-turn detail (turn index increments; the stop turn's
    // toolCalls are empty) — a typo in the detail spread would otherwise slip past.
    const at = (i: number) =>
      turnEvents[i]!.payload as {
        turn: number
        toolCalls: string[]
        spend: { tokens: { input: number } }
      }
    expect(at(1).turn).toBe(1)
    expect(at(1).toolCalls).toEqual(['await_next'])
    expect(at(1).spend.tokens.input).toBe(80)
    expect(at(2).turn).toBe(2)
    expect(at(2).toolCalls).toEqual([]) // the stop turn named no tool
    expect(at(2).spend.tokens.input).toBe(30)
  })

  it('maxTurns=0 is bounded by usd too: a usd-capped pool halts the driver when its inference drains the usd ceiling', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let n = 0
    // A never-stopping driver with a HUGE token ceiling but a small usd cap: only the usd channel
    // can bound it. Each turn costs $0.04 (and few tokens), so tokensLeft never trips poolStarved.
    const chat: DriverChat = {
      next: async () => {
        n += 1
        return {
          toolCalls: [{ name: 'list_questions', arguments: {} }],
          usage: { input: 5, output: 5 },
          costUsd: 0.04,
        }
      },
    }
    const opts: CoordinationDriverOptions = {
      name: 'root',
      chat,
      blobs,
      makeWorkerAgent: () => workerLeaf('w', { input: 1, output: 1 }),
      perWorker: { maxIterations: 4, maxTokens: 100 },
      systemPrompt: 'drive',
      maxTurns: 0,
    }
    const result = await createSupervisor<unknown, unknown>().run(
      coordinationDriverAgent(opts),
      'usd-bound',
      {
        budget: { maxIterations: 1000, maxTokens: 10_000_000, maxUsd: 0.1 }, // ~2-3 turns of $0.04 fit
        runId: 'meter-usd-bound',
        journal,
        blobs,
        executors: createExecutorRegistry(),
        maxDepth: 2,
        now: () => 0,
      },
    )

    // usdLeft: 0.1 → 0.06 → 0.02 → -0.02; poolStarved's usd arm breaks at the top of turn 3
    // (usdLeft -0.02 <= 0). The driver halts on USD — NOT the 2000-turn tripwire, NOT the token
    // ceiling (10M tokens untouched). This is the MEDIUM fix: maxTurns=0 is usd-bounded too.
    expect(n).toBe(3)
    expect(result.kind).toBe('no-winner')
  })
})

describe('equal-k ledger reconciliation — trajectoryReport.extraRootSpend folds in driver inference', () => {
  it('without extraRootSpend the journal total is child-work only; with it, total matches spentTotal', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const at = new Date(0).toISOString()
    await journal.beginTree('arm', at)
    // A coordination-driver arm tree: root 'arm' + one worker that spends 10/5 tokens. The driver's
    // own inference is NOT a journaled node (it was metered via Scope.meter → pool.observe).
    await journal.appendEvent('arm', {
      kind: 'spawned',
      id: 'arm',
      label: 'root',
      budget: { maxIterations: 1, maxTokens: 1 },
      runtime: 'router',
      seq: 0,
      at,
    })
    await journal.appendEvent('arm', {
      kind: 'spawned',
      id: 'arm:s0',
      parent: 'arm',
      label: 'w',
      budget: { maxIterations: 1, maxTokens: 1 },
      runtime: 'router',
      seq: 1,
      at,
    })
    await journal.appendEvent('arm', {
      kind: 'settled',
      id: 'arm:s0',
      status: 'done',
      outRef: 'blob:w',
      spent: { iterations: 1, tokens: { input: 10, output: 5 }, usd: 0, ms: 0 },
      seq: 0,
      at,
    })

    // Default: the journal sum is child-work only — the latent divergence vs SupervisedResult.spentTotal.
    const childOnly = await trajectoryReport(journal, blobs, 'arm')
    expect(childOnly.total.tokens).toEqual({ input: 10, output: 5 })

    // Pass the run's driverInference (from result.spentBreakdown) → total now equals spentTotal,
    // so equalKOnCost credits the driver arm for its OWN inference. The ledgers agree.
    const driverInference = { iterations: 0, tokens: { input: 210, output: 100 }, usd: 0.02, ms: 0 }
    const reconciled = await trajectoryReport(journal, blobs, 'arm', {
      extraRootSpend: driverInference,
    })
    expect(reconciled.total.tokens).toEqual({ input: 220, output: 105 })
    expect(reconciled.total.usd).toBeCloseTo(0.02, 6)
  })
})

describe('budget pool — observe() debits the conserved pool, observedTotal() tracks driver inference', () => {
  it('moves free → committed (invariant preserved), accumulates observedTotal, and drives tokensLeft negative on overspend', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1000, maxUsd: 5 }, () => 0)
    expect(pool.readout().tokensLeft).toBe(1000)

    pool.observe({ iterations: 1, tokens: { input: 100, output: 50 }, usd: 0.5, ms: 0 })
    expect(pool.readout().tokensLeft).toBe(850) // 1000 - 150
    expect(pool.observedTotal()).toEqual({
      iterations: 1,
      tokens: { input: 100, output: 50 },
      usd: 0.5,
      ms: 0,
    })

    // A second observe accumulates and can overshoot — free goes negative, an honest exhaustion signal.
    pool.observe({ iterations: 1, tokens: { input: 800, output: 200 }, usd: 1, ms: 0 })
    expect(pool.readout().tokensLeft).toBe(-150) // 850 - 1000
    expect(pool.observedTotal()).toEqual({
      iterations: 2,
      tokens: { input: 900, output: 250 },
      usd: 1.5,
      ms: 0,
    })
    // observe never opens a ticket — the leak detector stays clean.
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
  })
})
