import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
} from '../../src/durable/spawn-journal'
import { trajectoryReport } from '../../src/runtime/personify/trajectory'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import {
  type DriverAgentOptions,
  driverAgent,
} from '../../src/runtime/supervise/coordination-driver'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
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
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'
import { type ScriptedTurn, scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

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
        yield { kind: 'cost', usd: 0 }
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
  const spec: AgentSpec = {
    profile: testAgentProfile(name, { harness: 'cli-base' }),
    harness: null,
    executor,
  }
  return { name, act: async () => ({ worker: name }), executorSpec: spec } as Agent<
    unknown,
    unknown
  > & {
    executorSpec: AgentSpec
  }
}

// ── A scripted driver-LLM that reports per-turn usage (the production shape) ──────
// Past the script the brain emits a no-tool STOP turn (never silently repeat the last turn, which
// would loop forever if that turn carried tool calls): scriptedBrain repeats its last entry, so we
// append an explicit content-only stop as that terminal entry.
function meteredChat(turns: ScriptedTurn[]): ToolLoopChat {
  return scriptedBrain([...turns, { content: 'stop' }])
}

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

describe("driver inference metering — the driver's own tokens count against the conserved pool", () => {
  it('charges a nested worker once and releases the manager reservation', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const worker = workerLeaf('leaf', { input: 10, output: 0 })
    const childBudget: Budget = { maxIterations: 4, maxTokens: 40 }

    const nestedDriver: Agent<unknown, unknown> = {
      name: 'nested',
      async act(_task, scope) {
        const spawned = scope.spawn(worker, 'work', { budget: childBudget, label: 'leaf' })
        if (!spawned.ok) throw new Error(`nested spawn failed: ${spawned.reason}`)
        const settled = await scope.next()
        return settled?.kind === 'done' ? settled.out : undefined
      },
    }
    const nested = driverChild(
      testAgentProfile('nested', {
        harness: 'cli-base',
        metadata: { role: 'driver' },
      }),
      nestedDriver,
      journal,
    )
    const root: Agent<unknown, number> = {
      name: 'root',
      async act(_task, scope) {
        const spawned = scope.spawn(nested, 'nested work', {
          budget: childBudget,
          label: 'nested',
        })
        if (!spawned.ok) throw new Error(`root spawn failed: ${spawned.reason}`)
        await scope.next()
        return scope.budget.tokensLeft
      },
    }

    const result = await createSupervisor<unknown, number>().run(root, 'task', {
      budget: { maxIterations: 10, maxTokens: 100 },
      runId: 'nested-budget-once',
      journal,
      blobs,
      executors: withDriverExecutor(createExecutorRegistry()),
      maxDepth: 4,
      now: () => 0,
    })

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return
    expect(result.out).toBe(90)
    expect(result.spentTotal.tokens).toEqual({ input: 10, output: 0 })
  })

  it('folds driver inference into spentTotal and exposes the driver-vs-child breakdown', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const worker = workerLeaf('w', { input: 10, output: 5 })

    // 3 driver turns, each with REAL usage: spawn → await → stop.
    const chat = meteredChat([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: { profile: testAgentProfile('worker'), task: 'go' },
          },
        ],
        usage: { input: 100, output: 50 },
        costUsd: 0.01,
      },
      {
        toolCalls: [{ name: 'await_event', arguments: {} }],
        usage: { input: 80, output: 40 },
        costUsd: 0.008,
      },
      { content: 'delivered', usage: { input: 30, output: 10 }, costUsd: 0.002 },
    ])
    const opts: DriverAgentOptions = {
      name: 'root',
      brain: chat,
      blobs,
      makeWorkerAgent: () => worker,
      perWorker,
      systemPrompt: 'drive',
      maxTurns: 8,
    }
    const result = await createSupervisor<unknown, unknown>().run(driverAgent(opts), 'task', {
      budget: { maxIterations: 100, maxTokens: 100_000, maxUsd: 10 },
      runId: 'meter',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })

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

  it('re-homes a NESTED sub-driver inference up the tree: spentTotal counts every level (no silent undercount at depth)', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const worker = workerLeaf('leaf', { input: 10, output: 5 })
    const nestedPerWorker: Budget = { ...perWorker, maxUsd: 1 }

    // root driver → mid sub-driver → worker leaf. The recursive resolver: a 'driver' profile becomes
    // a driverChild wrapping another driverAgent; a 'worker' profile becomes the leaf.
    const driverOf = (
      name: string,
      brain: ToolLoopChat,
      workerBudget: Budget = nestedPerWorker,
    ): DriverAgentOptions => ({
      name,
      brain,
      blobs,
      makeWorkerAgent: makeAgent,
      perWorker: workerBudget,
      systemPrompt: 'drive',
      maxTurns: 8,
    })

    // mid sub-driver inference = 60/40 + 30/20 + 10/5 = 100/65 tokens, $0.05 (re-homed up).
    const midTurns: ScriptedTurn[] = [
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: {
              profile: testAgentProfile('worker', { metadata: { kind: 'worker' } }),
              task: 'sub',
            },
          },
        ],
        usage: { input: 60, output: 40 },
        costUsd: 0.05,
      },
      {
        toolCalls: [{ name: 'await_event', arguments: {} }],
        usage: { input: 30, output: 20 },
        costUsd: 0,
      },
      { content: 'mid done', usage: { input: 10, output: 5 }, costUsd: 0 },
    ]
    function makeAgent(
      profile: AgentProfile,
      context?: { readonly budget: Budget },
    ): Agent<unknown, unknown> {
      if (profile.metadata?.kind === 'driver') {
        if (!context) throw new Error('driver spawn context missing')
        const childBudget: Budget = {
          maxIterations: context.budget.maxIterations,
          maxTokens: Math.max(1, Math.floor(context.budget.maxTokens / 4)),
          ...(context.budget.maxUsd !== undefined ? { maxUsd: context.budget.maxUsd / 4 } : {}),
        }
        return driverChild(
          testAgentProfile('mid', {
            harness: 'cli-base',
            metadata: { kind: 'driver' },
          }),
          driverAgent(driverOf('mid', meteredChat(midTurns), childBudget)),
          journal,
        )
      }
      return worker
    }
    const midProfile = testAgentProfile('mid', { metadata: { kind: 'driver' } })
    // root driver inference = 100/50 + 50/30 + 20/10 = 170/90 tokens, $0.02.
    const rootChat = meteredChat([
      {
        toolCalls: [{ name: 'spawn_agent', arguments: { profile: midProfile, task: 'go' } }],
        usage: { input: 100, output: 50 },
        costUsd: 0.02,
      },
      {
        toolCalls: [{ name: 'await_event', arguments: {} }],
        usage: { input: 50, output: 30 },
        costUsd: 0,
      },
      { content: 'root done', usage: { input: 20, output: 10 }, costUsd: 0 },
    ])

    const result = await createSupervisor<unknown, unknown>().run(
      driverAgent(driverOf('root', rootChat)),
      'task',
      {
        budget: { maxIterations: 100, maxTokens: 100_000, maxUsd: 10 },
        runId: 'nested',
        journal,
        blobs,
        executors: withDriverExecutor(createExecutorRegistry()),
        maxDepth: 4,
        now: () => 0,
      },
    )

    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') return
    // childWork = the worker (10/5). driverInference = root (170/90, $0.02) + mid (100/65, $0.05) —
    // the mid sub-driver's inference re-homed up to the root tree, BOTH tokens AND usd. spentTotal = 280/160.
    expect(result.spentBreakdown?.driverInference.usd).toBeCloseTo(0.07, 6)
    expect(result.spentBreakdown?.childWork.tokens).toEqual({ input: 10, output: 5 })
    expect(result.spentBreakdown?.driverInference.tokens).toEqual({ input: 270, output: 155 })
    expect(result.spentTotal.tokens).toEqual({ input: 280, output: 160 })
  })

  it('re-homes a CRASHED sub-driver partial inference on the down path (pool and journal stay in agreement)', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()

    // A sub-driver that meters turn 0 (40/20) then CRASHES (chat throws) on turn 1 — the crash
    // settles it `down`, which must STILL re-home the partial inference it durably metered.
    const makeAgent = (profile: AgentProfile): Agent<unknown, unknown> => {
      if (profile.metadata?.kind === 'driver') {
        let t = 0
        const crashingChat: ToolLoopChat = async () => {
          t += 1
          if (t === 1)
            return {
              toolCalls: [{ id: 'call-q', name: 'list_questions', arguments: '{}' }],
              usage: { input: 40, output: 20 },
            }
          throw new Error('sub-driver network crash')
        }
        return driverChild(
          testAgentProfile('mid', {
            harness: 'cli-base',
            metadata: { kind: 'driver' },
          }),
          driverAgent({
            name: 'mid',
            brain: crashingChat,
            blobs,
            makeWorkerAgent: makeAgent,
            perWorker,
            systemPrompt: 'drive',
            maxTurns: 8,
          }),
          journal,
        )
      }
      return workerLeaf('w', { input: 1, output: 1 })
    }
    const rootChat = meteredChat([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: {
              profile: testAgentProfile('mid', { metadata: { kind: 'driver' } }),
              task: 'go',
            },
          },
        ],
        usage: { input: 100, output: 50 },
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] }, // drains the sub-driver's down settlement
      { content: 'root done' }, // no usage → root inference = 100/50
    ])

    await createSupervisor<unknown, unknown>().run(
      driverAgent({
        name: 'root',
        brain: rootChat,
        blobs,
        makeWorkerAgent: makeAgent,
        perWorker,
        systemPrompt: 'drive',
        maxTurns: 8,
      }),
      'task',
      {
        budget: { maxIterations: 100, maxTokens: 100_000 },
        runId: 'crash',
        journal,
        blobs,
        executors: withDriverExecutor(createExecutorRegistry()),
        maxDepth: 4,
        now: () => 0,
      },
    )

    // The crashed sub-driver (node `crash:s0`) settled `down`, yet its partial inference (40/20) was
    // re-homed into the root tree as a `metered` event — so the journal matches what the pool debited.
    const events = (await journal.loadTree('crash')) ?? []
    const subMetered = events.filter(
      (e): e is Extract<(typeof events)[number], { kind: 'metered' }> =>
        e.kind === 'metered' && e.id === 'crash:s0',
    )
    expect(subMetered.length).toBe(1)
    expect(subMetered[0]!.spend.tokens).toEqual({ input: 40, output: 20 })
    // Before the down-path re-home, this event would be absent → the sub-driver's inference would
    // live in the pool but not the journal (a silent undercount). Now it's present.
  })

  it('maxTurns=0 is bounded by inference: a never-stopping driver halts when its OWN tokens drain the pool', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const seen: Array<ReadonlyArray<Record<string, unknown>>> = []
    // A driver that NEVER stops — only the pool bound can halt it. Each turn spends 200 tokens of
    // its OWN inference on a no-spawn tool (list_questions reserves nothing), so only the metered
    // inference drains the pool.
    let n = 0
    const chat: ToolLoopChat = async (messages) => {
      seen.push(messages)
      n += 1
      return {
        toolCalls: [{ id: `call-${n}`, name: 'list_questions', arguments: '{}' }],
        usage: { input: 150, output: 50 },
      }
    }
    const opts: DriverAgentOptions = {
      name: 'root',
      brain: chat,
      blobs,
      makeWorkerAgent: () => workerLeaf('w', { input: 1, output: 1 }),
      perWorker: { maxIterations: 4, maxTokens: 500 },
      systemPrompt: 'drive',
      maxTurns: 0, // unlimited turn count — the pool is the only bound
    }
    const result = await createSupervisor<unknown, unknown>().run(
      driverAgent(opts),
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

  it.each([
    {
      label: 'zero remaining child iterations',
      rootBudget: { maxIterations: 0, maxTokens: 10_000 } satisfies Budget,
      workerBudget: { maxIterations: 1, maxTokens: 100 } satisfies Budget,
    },
    {
      label: 'remaining capped dollars below the exact child allocation',
      rootBudget: { maxIterations: 10, maxTokens: 10_000, maxUsd: 0.09 } satisfies Budget,
      workerBudget: { maxIterations: 1, maxTokens: 100, maxUsd: 0.1 } satisfies Budget,
    },
  ])('does not buy a manager turn with $label', async ({ rootBudget, workerBudget }) => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let managerTurns = 0
    const result = await createSupervisor<unknown, unknown>().run(
      driverAgent({
        name: 'root',
        brain: async () => {
          managerTurns += 1
          return {
            toolCalls: [{ id: 'would-spawn', name: 'spawn_agent', arguments: '{}' }],
            usage: { input: 5, output: 5 },
            costUsd: 0.01,
          }
        },
        blobs,
        makeWorkerAgent: () => workerLeaf('unused', { input: 1, output: 1 }),
        perWorker: workerBudget,
        systemPrompt: 'drive',
        maxTurns: 0,
      }),
      'cannot admit child work',
      {
        budget: rootBudget,
        runId: `pre-turn-admission-${rootBudget.maxUsd ?? 'iterations'}`,
        journal,
        blobs,
        executors: createExecutorRegistry(),
        maxDepth: 2,
        now: () => 0,
      },
    )

    expect(managerTurns).toBe(0)
    expect(result.kind).toBe('no-winner')
  })

  it('emits an agent.turn observability event per metered driver turn (the live A++ view)', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const turnEvents: RuntimeHookEvent[] = []
    const chat = meteredChat([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: { profile: testAgentProfile('worker'), task: 'go' },
          },
        ],
        usage: { input: 100, output: 50 },
        costUsd: 0.01,
      },
      {
        toolCalls: [{ name: 'await_event', arguments: {} }],
        usage: { input: 80, output: 40 },
        costUsd: 0,
      },
      { content: 'done', usage: { input: 30, output: 10 }, costUsd: 0 },
    ])
    const opts: DriverAgentOptions = {
      name: 'root',
      brain: chat,
      blobs,
      makeWorkerAgent: () => workerLeaf('w', { input: 10, output: 5 }),
      perWorker,
      systemPrompt: 'drive',
      maxTurns: 8,
    }
    const result = await createSupervisor<unknown, unknown>().run(driverAgent(opts), 'task', {
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
    expect(first.toolCalls).toEqual(['spawn_agent'])
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
    expect(at(1).toolCalls).toEqual(['await_event'])
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
    const chat: ToolLoopChat = async () => {
      n += 1
      return {
        toolCalls: [{ id: `call-${n}`, name: 'list_questions', arguments: '{}' }],
        usage: { input: 5, output: 5 },
        costUsd: 0.04,
        costProvenance: 'provider-receipt',
      }
    }
    const opts: DriverAgentOptions = {
      name: 'root',
      brain: chat,
      blobs,
      makeWorkerAgent: () => workerLeaf('w', { input: 1, output: 1 }),
      perWorker: { maxIterations: 4, maxTokens: 100 },
      systemPrompt: 'drive',
      maxTurns: 0,
    }
    const result = await createSupervisor<unknown, unknown>().run(driverAgent(opts), 'usd-bound', {
      budget: { maxIterations: 1000, maxTokens: 10_000_000, maxUsd: 0.1 }, // ~2-3 turns of $0.04 fit
      runId: 'meter-usd-bound',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })

    // usdLeft: 0.1 → 0.06 → 0.02 → -0.02; poolStarved's usd arm breaks at the top of turn 3
    // (usdLeft -0.02 <= 0). The driver halts on USD — NOT the 2000-turn tripwire, NOT the token
    // ceiling (10M tokens untouched). This is the MEDIUM fix: maxTurns=0 is usd-bounded too.
    expect(n).toBe(3)
    expect(result.kind).toBe('no-winner')
  })
})

describe('equal-k ledger — trajectoryReport sums driver inference from the journal automatically', () => {
  it('trajectoryReport.total includes driver inference from the journal automatically, matching spentTotal', async () => {
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
    // The driver's OWN inference is a `metered` event on the root node — exactly what Scope.meter
    // journals each turn. ONE ledger: trajectoryReport reads it automatically, no caller plumbing.
    await journal.appendEvent('arm', {
      kind: 'metered',
      id: 'arm',
      spend: { iterations: 0, tokens: { input: 210, output: 100 }, usd: 0.02, ms: 0 },
      seq: 0,
      at,
    })

    // trajectoryReport.total (→ equalKOnCost) now includes the driver inference by construction —
    // childWork (10/5) + driverInference (210/100) = 220/105 — matching SupervisedResult.spentTotal.
    const report = await trajectoryReport(journal, blobs, 'arm')
    expect(report.total.tokens).toEqual({ input: 220, output: 105 })
    expect(report.total.usd).toBeCloseTo(0.02, 6)
    // The root node's ownSpend carries the inference; the worker node carries the child work.
    const rootNode = report.nodes.find((n) => n.id === 'arm')
    expect(rootNode?.ownSpend.tokens).toEqual({ input: 210, output: 100 })
  })

  it('materializeTreeView folds metered driver inference onto node snapshots (resume fidelity)', () => {
    const at = new Date(0).toISOString()
    const view = materializeTreeView([
      {
        kind: 'spawned',
        id: 'r',
        label: 'root',
        budget: { maxIterations: 1, maxTokens: 1 },
        runtime: 'inline',
        seq: 0,
        at,
      },
      {
        kind: 'spawned',
        id: 'r:s0',
        parent: 'r',
        label: 'w',
        budget: { maxIterations: 1, maxTokens: 1 },
        runtime: 'router',
        seq: 1,
        at,
      },
      {
        kind: 'settled',
        id: 'r:s0',
        status: 'done',
        outRef: 'x',
        spent: { iterations: 1, tokens: { input: 10, output: 5 }, usd: 0, ms: 0 },
        seq: 0,
        at,
      },
      // metered seq 0 deliberately collides with the settled seq 0 — the separate additive pass
      // makes it order-independent, and a resumed tree must reflect the driver's inference.
      {
        kind: 'metered',
        id: 'r',
        spend: { iterations: 0, tokens: { input: 70, output: 30 }, usd: 0.01, ms: 0 },
        seq: 0,
        at,
      },
    ])
    const root = view.nodes.find((n) => n.id === 'r')
    expect(root?.spent.tokens).toEqual({ input: 70, output: 30 }) // metered folded onto the root node
    expect(root?.spent.usd).toBeCloseTo(0.01, 6)
    const worker = view.nodes.find((n) => n.id === 'r:s0')
    expect(worker?.spent.tokens).toEqual({ input: 10, output: 5 }) // settled child work intact
  })
})

// A turn that reports no usage is the one the pool used to never hear about at all: the driver
// skipped `scope.meter` entirely, so a turn that RAN was indistinguishable from a turn that never
// happened, and the conserved pool counted it as free. A missing measurement is never zero.
describe('unmetered turns are impossible — a turn with unknown usage is recorded, not skipped', () => {
  it('journals a metered event for EVERY driver turn, marking the unmeasured ones unknown', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    // Turn 0 reports real usage; turns 1 and 2 report NOTHING — the shape a provider that omitted
    // its usage block (or a stream that lost its terminal usage chunk) produces.
    const chat = meteredChat([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: { profile: testAgentProfile('worker'), task: 'go' },
          },
        ],
        usage: { input: 100, output: 50 },
        costUsd: 0.01,
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'delivered' },
    ])
    const opts: DriverAgentOptions = {
      name: 'root',
      brain: chat,
      blobs,
      makeWorkerAgent: () => workerLeaf('w', { input: 10, output: 5 }),
      perWorker,
      systemPrompt: 'drive',
      maxTurns: 8,
    }
    const result = await createSupervisor<unknown, unknown>().run(driverAgent(opts), 'task', {
      // No maxUsd: an unknown-dollar turn under a dollar CAP is a separate, fail-loud case the
      // pool already owns (`observe` refuses it) — here the run is only token/iteration budgeted.
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'unknown-usage',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 2,
      now: () => 0,
    })
    expect(result.kind).toBe('winner')

    const events = (await journal.loadTree('unknown-usage')) ?? []
    const metered = events.filter(
      (e): e is Extract<(typeof events)[number], { kind: 'metered' }> => e.kind === 'metered',
    )
    // THREE turns ran, so THREE metered records exist. Before this, only the first turn was
    // journaled and the other two vanished — two real inference turns recorded as never happening.
    expect(metered.length).toBe(3)
    expect(metered[0]!.spend.tokens).toEqual({ input: 100, output: 50 })
    expect(metered[0]!.spend.tokensKnown).toBeUndefined() // measured
    for (const ev of metered.slice(1)) {
      // Zero tokens, explicitly flagged as an unknown count rather than a measured zero — the same
      // shape the pool already uses for unknown dollars.
      expect(ev.spend.tokens).toEqual({ input: 0, output: 0 })
      expect(ev.spend.tokensKnown).toBe(false)
      expect(ev.spend.usdKnown).toBe(false)
    }
    // The unknown marker survives the roll-up: a total that summed the flag away would present an
    // under-count as an exact figure.
    expect(result.kind === 'winner' && result.spentTotal.tokensKnown).toBe(false)
  })

  it('marks the pool readout as an under-count once a turn goes unmeasured, without freezing the run', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1000 }, () => 0)
    expect(pool.readout().tokensKnown).toBe(true)

    pool.observe({
      iterations: 0,
      tokens: { input: 0, output: 0 },
      tokensKnown: false,
      usd: 0,
      usdKnown: false,
      ms: 0,
    })
    // `tokensLeft` is now a CEILING on what remains, not a measurement — and says so.
    expect(pool.readout().tokensKnown).toBe(false)
    expect(pool.readout().tokensLeft).toBe(1000)
    // Unlike the dollar channel, an unknown token count does NOT close admission: tokens are always
    // capped, so refusing every later reservation would turn one silent provider into a dead run.
    expect(pool.reserve({ maxIterations: 1, maxTokens: 100 }).ok).toBe(true)
  })

  it('fails loud instead of guessing when a turn of unknown cost runs under a DOLLAR cap', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    // The pool already owns this rule (`observe` refuses an unknown dollar cost under a cap): once
    // a turn's price is unknowable, a dollar ceiling cannot be enforced, and pretending the turn
    // cost $0 to keep going is exactly the over-spend the conserved pool exists to prevent. This
    // case exists so the escalation is a chosen contract, not an accident of the metering change.
    const chat: ToolLoopChat = async () => ({ content: 'no idea what that cost' })
    const result = await createSupervisor<unknown, unknown>().run(
      driverAgent({
        name: 'root',
        brain: chat,
        blobs,
        makeWorkerAgent: () => workerLeaf('w', { input: 1, output: 1 }),
        perWorker,
        systemPrompt: 'drive',
        maxTurns: 4,
      }),
      'task',
      {
        budget: { maxIterations: 10, maxTokens: 10_000, maxUsd: 1 },
        runId: 'usd-capped-unknown',
        journal,
        blobs,
        executors: createExecutorRegistry(),
        maxDepth: 2,
        now: () => 0,
      },
    )
    // The supervisor surfaces it as a named driver failure carrying the pool's own refusal — not a
    // crash, and above all not a run that quietly continued spending against a cap it stopped
    // enforcing. Nothing is guessed: no dollar figure is invented for the turn.
    expect(result.kind).toBe('no-winner')
    expect(result.kind === 'no-winner' && result.reason).toBe('driver-failed')
    expect(result.kind === 'no-winner' && (result.error as Error | undefined)?.message).toMatch(
      /unknown dollar cost under a dollar-capped budget/,
    )
  })

  it('records the turn as unknown even when the brain also emitted tool calls (no turn escapes)', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const turnDetails: Array<Record<string, unknown>> = []
    // A brain reporting no usage AND flagging the streamed transport's broken include_usage
    // contract — the driver records both facts on the turn.
    let n = 0
    const chat: ToolLoopChat = async () => {
      n += 1
      return n === 1
        ? {
            toolCalls: [{ id: 'call-1', name: 'list_questions', arguments: '{}' }],
            usageUnknown: true as const,
          }
        : { content: 'done', usageUnknown: true as const }
    }
    await createSupervisor<unknown, unknown>().run(
      driverAgent({
        name: 'root',
        brain: chat,
        blobs,
        makeWorkerAgent: () => workerLeaf('w', { input: 1, output: 1 }),
        perWorker,
        systemPrompt: 'drive',
        maxTurns: 8,
      }),
      'task',
      {
        budget: { maxIterations: 100, maxTokens: 100_000 },
        runId: 'stream-unknown',
        journal,
        blobs,
        executors: createExecutorRegistry(),
        maxDepth: 2,
        now: () => 0,
        hooks: {
          onEvent: (e) => {
            if (e.target === 'agent.turn') turnDetails.push(e.payload as Record<string, unknown>)
          },
        },
      },
    )
    expect(turnDetails.length).toBe(2)
    for (const d of turnDetails) {
      // A stream that finished with no usage chunk is a DIFFERENT fact from a brain that never
      // reports usage, and the journal keeps them apart.
      expect(d.streamUsageMissing).toBe(true)
      expect((d.spend as { tokensKnown?: boolean }).tokensKnown).toBe(false)
    }
  })
})

describe('budget pool — observe() debits the conserved pool for the live in-loop guard', () => {
  it('moves free → committed (invariant preserved) and drives the readout negative on overspend', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1000, maxUsd: 5 }, () => 0)
    expect(pool.readout().tokensLeft).toBe(1000)
    expect(pool.readout().usdLeft).toBe(5)

    pool.observe({ iterations: 1, tokens: { input: 100, output: 50 }, usd: 0.5, ms: 0 })
    expect(pool.readout().tokensLeft).toBe(850) // 1000 - 150
    expect(pool.readout().usdLeft).toBe(4.5)

    // A second observe overshoots — free goes negative, the honest exhaustion signal poolStarved reads.
    pool.observe({ iterations: 1, tokens: { input: 800, output: 200 }, usd: 1, ms: 0 })
    expect(pool.readout().tokensLeft).toBe(-150) // 850 - 1000
    expect(pool.readout().usdLeft).toBe(3.5)
    expect(pool.readout().usdCapped).toBe(true)
    // observe never opens a ticket — the leak detector stays clean.
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
  })
})
