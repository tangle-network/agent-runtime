/**
 * A child that finished its work but spent more than its reservation keeps its artifact.
 *
 * Measured in discovery-lab runs on 2026-09-12 (agent-runtime#1206): a Tangle sandbox child
 * reserved at 800,000 tokens reported zero usage for 157 progress events, then reported 1,918,127
 * tokens in its terminal receipt. Its executor returned the artifact three seconds later, and the
 * settlement threw at reconcile: `down`, `infra: true`, no `outRef`. The pool had already
 * committed the true spend, so the throw changed no accounting and discarded a paid-for result.
 *
 * The settled record now carries the overspend as `budgetViolation`, and the pool's reduced free
 * balance refuses later reservations on its own. Accounting faults still fail the child closed.
 */

import { describe, expect, it } from 'vitest'
import {
  contentAddress,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import { type BudgetPool, createBudgetPool } from '../../src/runtime/supervise/budget'
import { RetainedExecutionPendingError } from '../../src/runtime/supervise/retained-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  SpawnEvent,
  Spend,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'
import { testAgentProfile } from './test-agent-profile'

interface StreamScript {
  readonly out: unknown
  readonly events: ReadonlyArray<UsageEvent>
  /** Thrown after every event has been yielded, before an artifact exists. */
  readonly crashAfterEvents?: Error
  readonly outcome?: ExecutorResult<unknown>['outcome']
}

function spendOf(events: ReadonlyArray<UsageEvent>): Spend {
  const spend: Spend = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
  for (const event of events) {
    if (event.kind === 'iteration') spend.iterations += 1
    if (event.kind === 'tokens') {
      spend.tokens.input += event.input
      spend.tokens.output += event.output
    }
    if (event.kind === 'cost') {
      spend.usd += event.usd
      if (event.usdKnown === false) spend.usdKnown = false
    }
  }
  return spend
}

/** A streaming leaf shaped like the sandbox executor: usage arrives when the executor reports it,
 *  and the artifact is read after the stream drains. */
function streamingExecutor(script: StreamScript): Executor<unknown> {
  return {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        for (const event of script.events) yield event
        if (script.crashAfterEvents) throw script.crashAfterEvents
      })()
    },
    teardown: async () => ({ destroyed: true }),
    resultArtifact: () => ({
      ...(script.outcome ? { outcome: script.outcome } : {}),
      outRef: 'executor-hint',
      out: script.out,
      spent: spendOf(script.events),
    }),
  }
}

/** A one-shot leaf whose terminal result carries the whole spend. */
function oneShotExecutor(out: unknown, spent: Spend): Executor<unknown> {
  const result: ExecutorResult<unknown> = { outRef: 'executor-hint', out, spent }
  return {
    runtime: 'router',
    execute: async () => result,
    teardown: async () => ({ destroyed: true }),
    resultArtifact: () => result,
  }
}

function leaf(name: string, executor: Executor<unknown>): Agent<unknown, unknown> {
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => undefined, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

async function scopeOver(pool: BudgetPool, hooks?: { onEvent: (e: RuntimeHookEvent) => void }) {
  const journal = new InMemorySpawnJournal()
  const blobs = new InMemoryResultBlobStore()
  await journal.beginTree('run', new Date(0).toISOString())
  const scope = createScope<unknown>({
    parentId: 'run',
    root: 'run',
    pool,
    journal,
    blobs,
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: new AbortController().signal,
    now: () => 0,
    hooks,
  })
  return { scope, journal, blobs }
}

const settledRecord = async (journal: InMemorySpawnJournal, id: string) =>
  ((await journal.loadTree('run')) ?? []).find(
    (event): event is Extract<SpawnEvent, { kind: 'settled' }> =>
      event.kind === 'settled' && event.id === id,
  )

describe('a completed child that overspent its reservation', () => {
  it('settles done with its artifact when usage arrives only in the terminal receipt', async () => {
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 2_500_000 }, 0)
    const hookEvents: RuntimeHookEvent[] = []
    const { scope, journal, blobs } = await scopeOver(pool, {
      onEvent: (event) => void hookEvents.push(event),
    })
    const out = { problems: ['mined problem'] }
    const zeroProgress: UsageEvent[] = Array.from({ length: 5 }, () => ({
      kind: 'tokens' as const,
      input: 0,
      output: 0,
    }))
    const spawned = scope.spawn(
      leaf(
        'enumerate',
        streamingExecutor({
          out,
          events: [
            ...zeroProgress,
            { kind: 'tokens', input: 1_871_225, output: 46_902 },
            { kind: 'iteration' },
          ],
        }),
      ),
      'task',
      { label: 'enumerate', budget: { maxIterations: 16, maxTokens: 800_000 } },
    )
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return

    const violation = {
      overspent: [{ channel: 'tokens', reserved: 800_000, spent: 1_918_127 }],
    }
    const settled = await scope.next()
    expect(settled).toMatchObject({ kind: 'done', out, outRef: contentAddress(out) })
    if (settled?.kind !== 'done') return
    expect(settled.budgetViolation).toEqual(violation)
    expect(await blobs.get(settled.outRef)).toEqual(out)

    expect(await settledRecord(journal, spawned.handle.id)).toMatchObject({
      status: 'done',
      outRef: contentAddress(out),
      budgetViolation: violation,
      spent: { tokens: { input: 1_871_225, output: 46_902 } },
    })
    expect(hookEvents.find((event) => event.target === 'agent.child')?.payload).toMatchObject({
      status: 'done',
      budgetViolation: violation,
    })
    expect(scope.view.nodes.find((node) => node.id === spawned.handle.id)).toMatchObject({
      status: 'done',
      budgetViolation: violation,
    })

    // The pool charged the true spend, so the next full reservation is refused on its own.
    expect(pool.readout()).toMatchObject({ tokensLeft: 581_873, reservedTokens: 0 })
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
    expect(
      scope.spawn(leaf('next', oneShotExecutor('unused', spendOf([]))), 'task', {
        label: 'next',
        budget: { maxIterations: 16, maxTokens: 800_000 },
      }),
    ).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfall: { channel: 'tokens', requested: 800_000, free: 581_873 },
    })

    // Replay and the materialized tree read the same record.
    const [replayed] = await replaySpawnTree(journal, blobs, 'run')
    expect(replayed).toMatchObject({ kind: 'done', out, budgetViolation: violation })
    const events = (await journal.loadTree('run')) ?? []
    expect(
      materializeTreeView(events).nodes.find((node) => node.id === spawned.handle.id),
    ).toMatchObject({ status: 'done', budgetViolation: violation })
  })

  it('settles done with its artifact when a one-shot executor returns the overspend', async () => {
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 1_000_000 }, 0)
    const { scope, journal } = await scopeOver(pool)
    const out = 'sheaf scope checked'
    const spawned = scope.spawn(
      leaf(
        'check',
        oneShotExecutor(out, {
          iterations: 3,
          tokens: { input: 566_461, output: 26_159 },
          usd: 0,
          ms: 0,
        }),
      ),
      'task',
      { label: 'check', budget: { maxIterations: 10, maxTokens: 70_000 } },
    )
    expect(spawned.ok).toBe(true)
    const settled = await scope.next()
    expect(settled).toMatchObject({
      kind: 'done',
      out,
      outRef: contentAddress(out),
      budgetViolation: { overspent: [{ channel: 'tokens', reserved: 70_000, spent: 592_620 }] },
    })
    expect(await settledRecord(journal, 'run:s0')).toMatchObject({
      status: 'done',
      budgetViolation: { overspent: [{ channel: 'tokens', reserved: 70_000, spent: 592_620 }] },
    })
    expect(pool.readout().tokensLeft).toBe(407_380)
  })

  it('names every overspent channel: tokens, iterations, declared dollars, and resources', async () => {
    const pool = createBudgetPool(
      {
        maxIterations: 100,
        maxTokens: 10_000,
        maxUsd: 10,
        resources: { gpu: { unit: 'seconds', limit: 100 } },
      },
      0,
    )
    const { scope } = await scopeOver(pool)
    const budget: Budget = {
      maxIterations: 1,
      maxTokens: 100,
      maxUsd: 0.5,
      resources: { gpu: { unit: 'seconds', limit: 4 } },
    }
    scope.spawn(
      leaf(
        'everything',
        oneShotExecutor('done anyway', {
          iterations: 2,
          tokens: { input: 150, output: 0 },
          usd: 0.75,
          ms: 0,
          resources: { gpu: { unit: 'seconds', amount: 5, known: true } },
        }),
      ),
      'task',
      { label: 'everything', budget },
    )
    expect(await scope.next()).toMatchObject({
      kind: 'done',
      out: 'done anyway',
      budgetViolation: {
        overspent: [
          { channel: 'tokens', reserved: 100, spent: 150 },
          { channel: 'iterations', reserved: 1, spent: 2 },
          { channel: 'usd', reserved: 0.5, spent: 0.75 },
          { channel: 'resource:gpu', reserved: 4, spent: 5 },
        ],
      },
    })
    expect(pool.readout()).toMatchObject({ tokensLeft: 9_850, iterationsLeft: 98, usdLeft: 9.25 })
    expect(pool.readout().resources?.gpu).toMatchObject({ remaining: 95, committed: 5 })
  })

  it('carries no budgetViolation when the child stayed inside its reservation', async () => {
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 1_000 }, 0)
    const { scope, journal } = await scopeOver(pool)
    scope.spawn(
      leaf(
        'inside',
        streamingExecutor({ out: 'ok', events: [{ kind: 'tokens', input: 100, output: 0 }] }),
      ),
      'task',
      { label: 'inside', budget: { maxIterations: 1, maxTokens: 100 } },
    )
    const settled = await scope.next()
    expect(settled?.kind).toBe('done')
    expect(settled && 'budgetViolation' in settled).toBe(false)
    expect(await settledRecord(journal, 'run:s0')).not.toHaveProperty('budgetViolation')
  })

  it('shows the overspend to a director through await_event', async () => {
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 2_000_000 }, 0)
    const { scope, blobs } = await scopeOver(pool)
    const out = { review: 'accepted' }
    scope.spawn(
      leaf(
        'review',
        streamingExecutor({ out, events: [{ kind: 'tokens', input: 1_115_291, output: 0 }] }),
      ),
      'task',
      { label: 'review', budget: { maxIterations: 1, maxTokens: 800_000 } },
    )
    const tools = createCoordinationTools({
      scope,
      blobs,
      makeWorkerAgent: () => leaf('unused', oneShotExecutor('unused', spendOf([]))),
      perWorker: { maxIterations: 1, maxTokens: 800_000 },
    })
    const awaitEvent = tools.tools.find((tool) => tool.name === 'await_event')
    if (!awaitEvent) throw new Error('await_event is missing')
    const violation = {
      overspent: [{ channel: 'tokens', reserved: 800_000, spent: 1_115_291 }],
    }
    expect(await awaitEvent.handler({ kinds: ['settled'] })).toMatchObject({
      type: 'settled',
      status: 'done',
      outRef: contentAddress(out),
      budgetViolation: violation,
    })
    expect(tools.settled()).toMatchObject([{ status: 'done', budgetViolation: violation }])
  })
})

describe('an overspent child that did not complete, or whose accounting is at fault', () => {
  it('stays down when the executor crashed, and still records the overspend', async () => {
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 2_000_000 }, 0)
    const { scope, journal } = await scopeOver(pool)
    scope.spawn(
      leaf(
        'crash',
        streamingExecutor({
          out: 'never read',
          events: [{ kind: 'tokens', input: 900_000, output: 0 }],
          crashAfterEvents: new Error('provider stream closed'),
        }),
      ),
      'task',
      { label: 'crash', budget: { maxIterations: 4, maxTokens: 800_000 } },
    )
    const settled = await scope.next()
    expect(settled).toMatchObject({
      kind: 'down',
      reason: 'provider stream closed',
      infra: false,
      budgetViolation: { overspent: [{ channel: 'tokens', reserved: 800_000, spent: 900_000 }] },
    })
    const record = await settledRecord(journal, 'run:s0')
    expect(record).toMatchObject({
      status: 'down',
      budgetViolation: { overspent: [{ channel: 'tokens', reserved: 800_000, spent: 900_000 }] },
    })
    expect(record).not.toHaveProperty('outRef')
    expect(pool.readout().tokensLeft).toBe(1_100_000)
  })

  it('keeps an executor-reported failure down, and records the overspend beside it', async () => {
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 2_000_000 }, 0)
    const { scope } = await scopeOver(pool)
    const out = { partial: true }
    scope.spawn(
      leaf(
        'failed',
        streamingExecutor({
          out,
          events: [{ kind: 'tokens', input: 900_000, output: 0 }],
          outcome: { success: false, error: 'harness reported failure' },
        }),
      ),
      'task',
      { label: 'failed', budget: { maxIterations: 4, maxTokens: 800_000 } },
    )
    expect(await scope.next()).toMatchObject({
      kind: 'down',
      reason: 'harness reported failure',
      infra: false,
      budgetViolation: { overspent: [{ channel: 'tokens', reserved: 800_000, spent: 900_000 }] },
    })
  })

  it('fails closed on unknown dollar cost under a dollar cap even when tokens also overspent', async () => {
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 2_000_000, maxUsd: 5 }, 0)
    const { scope, journal } = await scopeOver(pool)
    scope.spawn(
      leaf(
        'unpriced',
        streamingExecutor({
          out: 'must not be accepted as done',
          events: [
            { kind: 'tokens', input: 900_000, output: 0 },
            { kind: 'cost', usd: 0, usdKnown: false, provenance: 'uncaptured' },
          ],
        }),
      ),
      'task',
      { label: 'unpriced', budget: { maxIterations: 4, maxTokens: 800_000, maxUsd: 1 } },
    )
    // The fault decides the outcome; the measured token overspend is still on the record.
    const violation = { overspent: [{ channel: 'tokens', reserved: 800_000, spent: 900_000 }] }
    const settled = await scope.next()
    expect(settled).toMatchObject({
      kind: 'down',
      infra: true,
      reason: expect.stringMatching(/unknown dollar cost under a dollar-capped budget/),
      budgetViolation: violation,
    })
    expect(await settledRecord(journal, 'run:s0')).toMatchObject({
      status: 'down',
      infra: true,
      budgetViolation: violation,
    })
    expect(pool.readout()).toMatchObject({ usdLeft: 0, reservedTokens: 0 })
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
  })

  it('records the overspend on a cancelled record, and replay reads it back', async () => {
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 2_000_000 }, 0)
    const { scope, journal, blobs } = await scopeOver(pool)
    let reported!: () => void
    const usageReported = new Promise<void>((resolve) => {
      reported = resolve
    })
    const executor: Executor<unknown> = {
      runtime: 'router',
      execute(_task: unknown, signal: AbortSignal): AsyncIterable<UsageEvent> {
        return (async function* () {
          yield { kind: 'tokens' as const, input: 900_000, output: 0 }
          // Runs only after the fold consumed the usage event above.
          reported()
          await new Promise<void>((_, reject) => {
            if (signal.aborted) reject(signal.reason)
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        })()
      },
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => ({ outRef: 'never', out: 'never', spent: spendOf([]) }),
    }
    const spawned = scope.spawn(leaf('cancelled', executor), 'task', {
      label: 'cancelled',
      budget: { maxIterations: 4, maxTokens: 800_000 },
    })
    if (!spawned.ok) throw new Error('spawn refused')
    await usageReported
    await scope.cancel(spawned.handle.id, { operationId: 'cancel-overspent' })
    const violation = { overspent: [{ channel: 'tokens', reserved: 800_000, spent: 900_000 }] }
    expect(await scope.next()).toMatchObject({ kind: 'down', budgetViolation: violation })
    const events = (await journal.loadTree('run')) ?? []
    expect(events.find((event) => event.kind === 'cancelled')).toMatchObject({
      id: spawned.handle.id,
      budgetViolation: violation,
    })
    expect(await replaySpawnTree(journal, blobs, 'run')).toMatchObject([
      { kind: 'down', budgetViolation: violation },
    ])
  })

  it('keeps a retained-pending child free of a violation its journal cannot carry', async () => {
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 2_000_000 }, 0)
    const { scope, journal } = await scopeOver(pool)
    const executor: Executor<unknown> = {
      runtime: 'router',
      execute(): AsyncIterable<UsageEvent> {
        return (async function* () {
          yield { kind: 'tokens' as const, input: 900_000, output: 0 }
          throw new RetainedExecutionPendingError(new Error('provider still running'))
        })()
      },
      teardown: async () => ({ destroyed: false, detail: 'retained' }),
      resultArtifact: () => ({ outRef: 'never', out: 'never', spent: spendOf([]) }),
    }
    const spawned = scope.spawn(leaf('retained', executor), 'task', {
      label: 'retained',
      budget: { maxIterations: 4, maxTokens: 800_000 },
    })
    if (!spawned.ok) throw new Error('spawn refused')
    const settled = await scope.next()
    // The node stays open for recovery, so it has no terminal record. The recovered settlement
    // reports the overspend from the recorded result; the live views must not report one early.
    expect(settled).toMatchObject({ kind: 'down', infra: true, retainedExecution: 'pending' })
    expect(settled).not.toHaveProperty('budgetViolation')
    const events = (await journal.loadTree('run')) ?? []
    expect(events.some((event) => event.kind === 'settled' || event.kind === 'cancelled')).toBe(
      false,
    )
    expect(events.find((event) => event.kind === 'reconciled')).toMatchObject({
      id: spawned.handle.id,
    })
    const node = scope.view.nodes.find((entry) => entry.id === spawned.handle.id)
    expect(node).not.toHaveProperty('budgetViolation')
    expect(node).toMatchObject({ retainedExecution: 'pending' })
    expect(pool.readout().reservedTokens).toBe(0)
  })

  it('fails closed on unknown usage of an enforced resource', async () => {
    const pool = createBudgetPool(
      { maxIterations: 10, maxTokens: 1_000, resources: { gpu: { unit: 'seconds', limit: 10 } } },
      0,
    )
    const { scope } = await scopeOver(pool)
    scope.spawn(
      leaf(
        'unmetered-gpu',
        oneShotExecutor('must not be accepted as done', {
          iterations: 1,
          tokens: { input: 500, output: 0 },
          usd: 0,
          ms: 0,
          resources: { gpu: { unit: 'seconds', amount: 1, known: false } },
        }),
      ),
      'task',
      {
        label: 'unmetered-gpu',
        budget: {
          maxIterations: 1,
          maxTokens: 100,
          resources: { gpu: { unit: 'seconds', limit: 2 } },
        },
      },
    )
    expect(await scope.next()).toMatchObject({
      kind: 'down',
      infra: true,
      reason: expect.stringMatching(/resource gpu: unknown usage under an enforced limit/),
    })
  })
})
