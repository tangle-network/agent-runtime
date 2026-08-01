import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import { ValidationError } from '../../src/errors'
import { defaultSelectWinner } from '../../src/runtime/run-loop'
import { createBudgetPool, spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { createInbox } from '../../src/runtime/supervise/inbox'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope, settledToIteration } from '../../src/runtime/supervise/scope'
import { createRootHandle, createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  DefaultVerdict,
  Executor,
  ExecutorResult,
  Scope,
  Settled,
  SpawnEvent,
  Spend,
  SupervisorOpts,
  UsageEvent,
  WidenGate,
} from '../../src/runtime/supervise/types'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'

// ── The mock Executor — the whole keystone runs offline against this ─────────
//
// A scripted leaf: a fixed `UsageEvent` program drives the conserved-pool fold, a
// scripted `out` (+ optional verdict) is the artifact the driver branches on, and a
// `failWith` knob lets a child go `down` (typed, never re-thrown by the scope) so the
// supervisor join barrier can be exercised. No network, no sandbox, no subprocess.
interface MockScript {
  readonly out: unknown
  readonly events: UsageEvent[]
  readonly verdict?: DefaultVerdict
  /** When set, `execute` throws — the scope types it into a `down` settlement. */
  readonly failWith?: string
  /** When set, `execute` blocks on this promise until the scope aborts it. */
  readonly block?: Promise<void>
  /** When set, the executor implements `deliver` (the inbox) and pushes received messages here. */
  readonly inbox?: unknown[]
}

function mockExecutor(script: MockScript): Executor<unknown> {
  const spent = spendFromUsageEvents(script.events)
  const outRef = `mock:${stableKey(script.out)}`
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute(_task: unknown, signal: AbortSignal): AsyncIterable<UsageEvent> {
      // Streaming shape: yield the scripted usage, then the artifact is read from
      // resultArtifact(). A `block` script parks until the spawn-scoped signal aborts,
      // so an abort mid-flight tears the child down deterministically.
      return (async function* () {
        if (script.failWith !== undefined) throw new ValidationError(script.failWith)
        if (script.block) {
          await Promise.race([
            script.block,
            new Promise<void>((resolve) => {
              if (signal.aborted) return resolve()
              signal.addEventListener('abort', () => resolve(), { once: true })
            }),
          ])
        }
        for (const ev of script.events) yield ev
      })()
    },
    ...(script.inbox
      ? {
          deliver(message: unknown): void {
            script.inbox?.push(message)
          },
        }
      : {}),
    teardown(): Promise<{ destroyed: boolean }> {
      return Promise.resolve({ destroyed: true })
    },
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef,
        out: script.out,
        ...(script.verdict ? { verdict: script.verdict } : {}),
        spent,
      }
    },
  }
  return executor
}

function stableKey(value: unknown): string {
  return JSON.stringify(value) ?? String(value)
}

/** A leaf agent carrying a BYO mock executor as its `executorSpec.executor`. The scope
 *  resolves this verbatim through the open registry (BYO precedence), so no built-in
 *  router/sandbox/cli factory ever fires — the test stays fully offline. */
function leafAgent(name: string, script: MockScript): Agent<unknown, unknown> {
  const spec: AgentSpec = {
    profile: { name } as AgentProfile,
    harness: null,
    executor: mockExecutor(script),
  }
  return { name, act: async () => script.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

const tokensOnly = (input: number, output: number, iterations = 1): UsageEvent[] => {
  const evs: UsageEvent[] = []
  for (let i = 0; i < iterations; i += 1) evs.push({ kind: 'iteration' })
  evs.push({ kind: 'tokens', input, output })
  return evs
}

function scopeArgs(over: Partial<Parameters<typeof createScope>[0]> = {}) {
  const pool = over.pool ?? createBudgetPool({ maxIterations: 100, maxTokens: 100_000 }, () => 0)
  const journal = over.journal ?? new InMemorySpawnJournal()
  const root = over.root ?? 'run'
  return {
    args: {
      parentId: over.parentId ?? root,
      root,
      pool,
      journal,
      blobs: over.blobs ?? new InMemoryResultBlobStore(),
      executors: over.executors ?? createExecutorRegistry(),
      seams: over.seams ?? {},
      depth: over.depth ?? 0,
      maxDepth: over.maxDepth,
      signal: over.signal ?? new AbortController().signal,
      now: over.now ?? (() => 0),
      hooks: over.hooks,
    },
    pool,
    journal,
  }
}

async function beginScope(over: Partial<Parameters<typeof createScope>[0]> = {}) {
  const { args, pool, journal } = scopeArgs(over)
  await journal.beginTree(args.root, new Date(0).toISOString())
  return { scope: createScope<unknown>(args), pool, journal, args }
}

// ── 1. Conserved budget pool ─────────────────────────────────────────────────────

describe('conserved budget pool', () => {
  it.each([
    { maxIterations: -1, maxTokens: 100 },
    { maxIterations: 1.5, maxTokens: 100 },
    { maxIterations: 1, maxTokens: -1 },
    { maxIterations: 1, maxTokens: Number.MAX_SAFE_INTEGER + 1 },
    { maxIterations: 1, maxTokens: 100, maxUsd: Number.POSITIVE_INFINITY },
    { maxIterations: 1, maxTokens: 100, deadlineMs: -1 },
  ] as Budget[])('rejects a malformed root budget before it can create capacity', (invalid) => {
    expect(() => createBudgetPool(invalid, () => 0)).toThrow(/non-negative/)
  })

  it('rejects a negative reservation without changing the root balance', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 100 }, () => 0)
    expect(() => pool.reserve({ maxIterations: -10, maxTokens: -100 })).toThrow(/non-negative/)
    expect(pool.readout()).toMatchObject({
      tokensLeft: 100,
      tokensKnown: true,
      reservedTokens: 0,
    })
  })

  it('reserve fails closed when the pool cannot cover the child', () => {
    const pool = createBudgetPool({ maxIterations: 4, maxTokens: 1000 }, () => 0)
    const a = pool.reserve({ maxIterations: 2, maxTokens: 600, label: '' } as Budget)
    expect(a.ok).toBe(true)
    // 600 reserved, 400 free; a 500-token child must fail closed (never overcommit).
    const b = pool.reserve({ maxIterations: 2, maxTokens: 500, label: '' } as Budget)
    expect(b).toEqual({ ok: false, reason: 'budget-exhausted' })
    expect(pool.readout().tokensLeft).toBe(400)
    expect(pool.readout().reservedTokens).toBe(600)
  })

  it('names an UNBUDGETED dollar channel separately from an exhausted one', () => {
    // The root budgets no dollars, so a child naming maxUsd is unsatisfiable at ANY amount.
    // Reporting that as `budget-exhausted` invites a caller to retry smaller forever.
    const pool = createBudgetPool({ maxIterations: 4, maxTokens: 1000 }, () => 0)
    const big = pool.reserve({ maxIterations: 1, maxTokens: 10, maxUsd: 5, label: '' } as Budget)
    expect(big).toEqual({ ok: false, reason: 'usd-unbudgeted' })
    // Shrinking the ask cannot help — the same refusal, which is the point of the distinct reason.
    const tiny = pool.reserve({
      maxIterations: 1,
      maxTokens: 10,
      maxUsd: 0.01,
      label: '',
    } as Budget)
    expect(tiny).toEqual({ ok: false, reason: 'usd-unbudgeted' })
    // A child that names no dollars is admitted against the same pool.
    expect(pool.reserve({ maxIterations: 1, maxTokens: 10, label: '' } as Budget).ok).toBe(true)
  })

  it('still reports an exhausted dollar balance as budget-exhausted when the root budgets dollars', () => {
    const pool = createBudgetPool({ maxIterations: 4, maxTokens: 1000, maxUsd: 1 }, () => 0)
    expect(
      pool.reserve({ maxIterations: 1, maxTokens: 10, maxUsd: 0.75, label: '' } as Budget).ok,
    ).toBe(true)
    const over = pool.reserve({ maxIterations: 1, maxTokens: 10, maxUsd: 0.5, label: '' } as Budget)
    expect(over).toEqual({ ok: false, reason: 'budget-exhausted' })
  })

  it('refunds the unspent remainder on reconcile (Σ conservation)', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1000 }, () => 0)
    const r = pool.reserve({ maxIterations: 5, maxTokens: 800, label: '' } as Budget)
    if (!r.ok) throw new Error('reserve should have succeeded')
    expect(pool.readout().tokensLeft).toBe(200)
    expect(pool.readout().reservedTokens).toBe(800)
    // Spent 300 of the 800 reserved → 500 refunds to free; reserved drops to 0.
    pool.reconcile(r.ticket, {
      iterations: 2,
      tokens: { input: 100, output: 200 },
      usd: 0,
      ms: 0,
    })
    expect(pool.readout().tokensLeft).toBe(700)
    expect(pool.readout().reservedTokens).toBe(0)
  })

  it('records actual overspend and refuses later work instead of clamping telemetry', () => {
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 20 }, () => 0)
    const first = pool.reserve({ maxIterations: 1, maxTokens: 10 })
    if (!first.ok) throw new Error('reserve should have succeeded')

    // The violation is fail-loud, but ONLY AFTER the settlement: the actual spend is committed,
    // the ticket closes, and `free` goes honestly negative — never a clamp, never a strand.
    expect(() =>
      pool.reconcile(first.ticket, {
        iterations: 1,
        tokens: { input: 20, output: 0 },
        usd: 0,
        ms: 0,
      }),
    ).toThrow(/spent 20 tokens > reserved 10/)

    expect(() => pool.assertNoOpenTickets()).not.toThrow()
    expect(pool.readout().tokensLeft).toBe(0)
    expect(pool.reserve({ maxIterations: 1, maxTokens: 1 })).toEqual({
      ok: false,
      reason: 'budget-exhausted',
    })
  })

  it('fails loud on a double reconcile (no silent double refund)', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1000 }, () => 0)
    const r = pool.reserve({ maxIterations: 5, maxTokens: 800, label: '' } as Budget)
    if (!r.ok) throw new Error('reserve should have succeeded')
    const spend: Spend = { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
    pool.reconcile(r.ticket, spend)
    expect(() => pool.reconcile(r.ticket, spend)).toThrow(/unknown or already-settled/)
  })

  it('assertNoOpenTickets is the leak detector — throws while a ticket is open, passes once reconciled', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1000 }, () => 0)
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
    const r = pool.reserve({ maxIterations: 1, maxTokens: 100, label: '' } as Budget)
    if (!r.ok) throw new Error('reserve should have succeeded')
    expect(() => pool.assertNoOpenTickets()).toThrow(/reservation\(s\) still open/)
    pool.reconcile(r.ticket, { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
  })

  it('a usd request against an uncapped root is unsatisfiable (fail closed)', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1000 }, () => 0)
    const r = pool.reserve({ maxIterations: 1, maxTokens: 10, maxUsd: 0.5, label: '' } as Budget)
    // Refused as before; the REASON now separates "never budgeted" from "ran out", because only
    // one of the two can be cleared by asking for less.
    expect(r).toEqual({ ok: false, reason: 'usd-unbudgeted' })
  })

  it('commits OBSERVED usd spend under an uncapped root (maxUsd optional, not a hard $0 limit)', () => {
    // Regression: a real priced leaf reports usd via estimateCost. With no root usd ceiling
    // (the common case — usd is observed, not budgeted), reconcile must COMMIT that spend, not
    // fail-close as if $0 were reserved. The earlier bug killed every real priced child here.
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 1000 }, () => 0)
    const r = pool.reserve({ maxIterations: 1, maxTokens: 500, label: '' } as Budget)
    if (!r.ok) throw new Error('reserve should have succeeded')
    expect(r.ticket.reserved.usd).toBe(0)
    expect(() =>
      pool.reconcile(r.ticket, {
        iterations: 1,
        tokens: { input: 40, output: 60 },
        usd: 0.000415,
        ms: 0,
      }),
    ).not.toThrow()
    // Tokens still conserve normally; usd is uncapped so usdLeft stays 0 (not budgeted).
    expect(pool.readout().tokensLeft).toBe(900)
    expect(pool.readout().usdLeft).toBe(0)
  })

  it('preserves unknown dollar telemetry under an uncapped root without blocking admission', () => {
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 1000 }, () => 0)
    const r = pool.reserve({ maxIterations: 1, maxTokens: 500 })
    if (!r.ok) throw new Error('reserve should have succeeded')

    expect(() =>
      pool.reconcile(r.ticket, {
        iterations: 1,
        tokens: { input: 40, output: 60 },
        usd: 0,
        usdKnown: false,
        ms: 0,
      }),
    ).not.toThrow()
    expect(pool.readout()).toMatchObject({ usdCapped: false, usdKnown: false, tokensLeft: 900 })
    expect(pool.reserve({ maxIterations: 1, maxTokens: 100 }).ok).toBe(true)
  })

  it('marks restored in-doubt dollar telemetry unknown even without a dollar limit', () => {
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 1000 }, () => 0, {
      uncertainReservations: [{ maxIterations: 1, maxTokens: 500 }],
    })

    expect(pool.readout()).toMatchObject({
      tokensKnown: false,
      usdCapped: false,
      usdKnown: false,
      tokensLeft: 500,
    })
  })

  it('refuses malformed committed spend during restore instead of restoring it as zero', () => {
    expect(() =>
      createBudgetPool({ maxIterations: 2, maxTokens: 1000 }, () => 0, {
        committed: {
          iterations: 1,
          tokens: { input: -1, output: 0 },
          usd: 0,
          ms: 0,
        },
      }),
    ).toThrow(/budget restore committed\.tokens\.input/)
  })

  it('commits an UNBUDGETED child dollar spend against a capped root (no phantom $0 ceiling)', () => {
    // A child budget may omit `maxUsd` even when the ROOT caps dollars — the common shape, and
    // exactly what the supervisor spawns. Such a child reserves $0 because it asked for no
    // dollar allocation, which is NOT the same as a declared ceiling of $0: its real dollars
    // are observed spend, debited from the root's balance. Reading the $0 as a ceiling made a
    // successful priced child fail its own reconcile and strand its reservation.
    const pool = createBudgetPool({ maxIterations: 4, maxTokens: 1000, maxUsd: 10 }, () => 0)
    const r = pool.reserve({ maxIterations: 2, maxTokens: 500, label: '' } as Budget)
    if (!r.ok) throw new Error('reserve should have succeeded')
    expect(r.ticket.reserved).toMatchObject({ usd: 0, usdBudgeted: false })
    expect(() =>
      pool.reconcile(r.ticket, {
        iterations: 1,
        tokens: { input: 100, output: 50 },
        usd: 0.25,
        ms: 0,
      }),
    ).not.toThrow()
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
    // The dollars are real, so the capped root's balance shrinks by exactly what was spent.
    expect(pool.readout()).toMatchObject({
      tokensLeft: 850,
      reservedTokens: 0,
      usdLeft: 9.75,
      usdCapped: true,
      tokensKnown: true,
    })
  })

  it('closes admission once unbudgeted child dollars drain a capped root', () => {
    // The debit above is what keeps the cap enforceable: nothing reserved those dollars, so the
    // only thing standing between an unbudgeted child and an unbounded bill is the free balance
    // falling through zero and `reserve` failing closed.
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1000, maxUsd: 1 }, () => 0)
    const first = pool.reserve({ maxIterations: 1, maxTokens: 100, label: '' } as Budget)
    if (!first.ok) throw new Error('reserve should have succeeded')
    pool.reconcile(first.ticket, {
      iterations: 1,
      tokens: { input: 1, output: 1 },
      usd: 1.5,
      ms: 0,
    })
    // Overspent past the root ceiling: the balance is honestly negative, not clamped to zero.
    expect(pool.readout().usdLeft).toBe(-0.5)
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
    expect(pool.reserve({ maxIterations: 1, maxTokens: 10, maxUsd: 0.01 } as Budget)).toEqual({
      ok: false,
      reason: 'budget-exhausted',
    })
  })

  it('still fails loud when a child that DECLARED a dollar ceiling exceeds it', () => {
    // The relaxation above is scoped to an UNDECLARED ceiling. A child that named `maxUsd` and
    // blew through it is a clamp bug in the caller and stays fail-loud — while still settling.
    const pool = createBudgetPool({ maxIterations: 4, maxTokens: 1000, maxUsd: 10 }, () => 0)
    const r = pool.reserve({ maxIterations: 2, maxTokens: 500, maxUsd: 0.5 } as Budget)
    if (!r.ok) throw new Error('reserve should have succeeded')
    expect(r.ticket.reserved).toMatchObject({ usd: 0.5, usdBudgeted: true })
    expect(() =>
      pool.reconcile(r.ticket, {
        iterations: 1,
        tokens: { input: 10, output: 10 },
        usd: 0.75,
        ms: 0,
      }),
    ).toThrow(/spent \$0\.75 > reserved \$0\.5/)
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
  })

  it('closes the ticket on EVERY fail-loud reconcile path (no reservation escapes)', () => {
    // The leak detector only helps if no error path can walk past the settlement. Each case
    // below throws; each must still release its reservation and close its ticket, because the
    // caller (`Scope.runChild`) marks the child reconciled BEFORE calling and never retries.
    const overspend = (spent: Spend, root: Budget, child: Budget) => {
      const pool = createBudgetPool(root, () => 0)
      const r = pool.reserve(child)
      if (!r.ok) throw new Error('reserve should have succeeded')
      expect(() => pool.reconcile(r.ticket, spent)).toThrow()
      expect(() => pool.assertNoOpenTickets()).not.toThrow()
      expect(pool.readout().reservedTokens).toBe(0)
      return pool
    }
    const root: Budget = { maxIterations: 10, maxTokens: 1000, maxUsd: 5 } as Budget
    const child: Budget = { maxIterations: 2, maxTokens: 100, maxUsd: 1 } as Budget

    // Token overspend: the actual spend is committed, so `free` goes honestly negative rather
    // than the reservation being stranded at its ceiling forever.
    const tokensOver = overspend(
      { iterations: 1, tokens: { input: 300, output: 0 }, usd: 0, ms: 0 },
      root,
      child,
    )
    expect(tokensOver.readout().tokensLeft).toBe(700)

    overspend({ iterations: 9, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 }, root, child)
    overspend({ iterations: 1, tokens: { input: 1, output: 1 }, usd: 4, ms: 0 }, root, child)
    overspend(
      { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, usdKnown: false, ms: 0 },
      root,
      child,
    )
  })

  it('never interprets explicitly unknown dollar cost as $0 under a dollar limit', () => {
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 1000, maxUsd: 1 }, () => 0)
    const r = pool.reserve({ maxIterations: 1, maxTokens: 500, maxUsd: 1 } as Budget)
    if (!r.ok) throw new Error('reserve should have succeeded')
    expect(() =>
      pool.reconcile(r.ticket, {
        iterations: 1,
        tokens: { input: 40, output: 60 },
        usd: 0,
        usdKnown: false,
        ms: 0,
      }),
    ).toThrow(/unknown dollar cost/)
    expect(pool.readout()).toMatchObject({
      tokensLeft: 900,
      reservedTokens: 0,
      usdLeft: 0,
    })
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
    expect(pool.reserve({ maxIterations: 1, maxTokens: 10 } as Budget)).toEqual({
      ok: false,
      reason: 'budget-exhausted',
    })
  })

  it('never interprets explicitly unknown token usage as zero', () => {
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 1000 }, () => 0)
    const r = pool.reserve({ maxIterations: 1, maxTokens: 500 })
    if (!r.ok) throw new Error('reserve should have succeeded')
    // The turn happened with an unreported count: it settles (no strand) and the readout marks the
    // balance a ceiling rather than a measurement. Token admission stays open — one provider that
    // skipped a usage report must not end the run.
    expect(() =>
      pool.reconcile(r.ticket, {
        iterations: 1,
        tokens: { input: 0, output: 0 },
        tokensKnown: false,
        usd: 0,
        ms: 0,
      }),
    ).not.toThrow()
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
    expect(pool.readout()).toMatchObject({ tokensKnown: false })
    expect(pool.reserve({ maxIterations: 1, maxTokens: 1 }).ok).toBe(true)
  })

  it('refuses to observe unknown manager dollar cost under a dollar cap', () => {
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 1000, maxUsd: 1 }, () => 0)
    expect(() =>
      pool.observe({
        iterations: 1,
        tokens: { input: 40, output: 60 },
        usd: 0,
        usdKnown: false,
        ms: 0,
      }),
    ).toThrow(/unknown dollar cost/)
    // The refusal happens before any balance mutates: no invented figure, no silently consumed
    // cap. The caller (`Scope.meter`) still journals the spend, and the run surfaces the refusal
    // as `driver-failed` carrying this reason.
    expect(pool.readout()).toMatchObject({ tokensLeft: 1000, usdLeft: 1, usdCapped: true })
  })

  it('spendFromUsageEvents folds tokens + usd on separate channels', () => {
    const spend = spendFromUsageEvents([
      { kind: 'iteration' },
      { kind: 'tokens', input: 10, output: 5 },
      { kind: 'tokens', input: 2, output: 3 },
      { kind: 'cost', usd: 0.01 },
    ])
    expect(spend).toEqual({ iterations: 1, tokens: { input: 12, output: 8 }, usd: 0.01, ms: 0 })
  })

  it('preserves explicitly unknown dollar cost in sync and async usage folds', async () => {
    const events: UsageEvent[] = [
      { kind: 'tokens', input: 12, output: 3 },
      { kind: 'cost', usd: 0, usdKnown: false },
      { kind: 'iteration' },
    ]
    const expected: Spend = {
      iterations: 1,
      tokens: { input: 12, output: 3 },
      usd: 0,
      usdKnown: false,
      ms: 0,
    }

    expect(spendFromUsageEvents(events)).toEqual(expected)

    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 100 }, () => 0)
    const stream = (async function* (): AsyncIterable<UsageEvent> {
      yield* events
    })()
    await expect(pool.spendFrom(stream)).resolves.toEqual(expected)
  })

  it('keeps a dollar limit unusable after a concurrent known reservation refunds', () => {
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 100, maxUsd: 1 }, () => 0)
    const unknown = pool.reserve({ maxIterations: 1, maxTokens: 50, maxUsd: 0.5 } as Budget)
    const known = pool.reserve({ maxIterations: 1, maxTokens: 50, maxUsd: 0.5 } as Budget)
    if (!unknown.ok || !known.ok) throw new Error('both reservations should have succeeded')

    expect(() =>
      pool.reconcile(unknown.ticket, {
        iterations: 1,
        tokens: { input: 5, output: 5 },
        usd: 0,
        usdKnown: false,
        ms: 0,
      }),
    ).toThrow(/unknown dollar cost/)
    pool.reconcile(known.ticket, {
      iterations: 1,
      tokens: { input: 5, output: 5 },
      usd: 0.1,
      ms: 0,
    })

    expect(pool.readout()).toMatchObject({ usdLeft: 0, reservedTokens: 0 })
    expect(pool.reserve({ maxIterations: 1, maxTokens: 1 } as Budget)).toEqual({
      ok: false,
      reason: 'budget-exhausted',
    })
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
  })
})

// ── 2. equal-k by construction ──────────────────────────────────────────────────

describe('equal-k by construction', () => {
  it('preserves unknown dollar cost when Scope folds a streaming executor', async () => {
    const { scope } = await beginScope()
    const spawned = scope.spawn(
      leafAgent('unknown-cost', {
        out: 'complete',
        events: [
          { kind: 'tokens', input: 12, output: 3 },
          { kind: 'cost', usd: 0, usdKnown: false },
          { kind: 'iteration' },
        ],
      }),
      'task',
      { label: 'unknown-cost', budget: { maxIterations: 1, maxTokens: 100 } },
    )
    expect(spawned.ok).toBe(true)
    if (!spawned.ok) return

    const settled = await scope.next()
    expect(settled?.kind).toBe('done')
    expect(settled?.spent).toMatchObject({
      iterations: 1,
      tokens: { input: 12, output: 3 },
      usd: 0,
      usdKnown: false,
    })
    expect(scope.progress(spawned.handle.id)).toMatchObject({
      usd: 0,
      usdKnown: false,
    })
  })

  it('closes a dollar-limited reservation after unknown cost and refuses further spend', async () => {
    const pool = createBudgetPool({ maxIterations: 2, maxTokens: 100, maxUsd: 1 }, () => 0)
    const { scope } = await beginScope({ pool })
    const spawned = scope.spawn(
      leafAgent('unknown-priced-child', {
        out: 'complete',
        events: [
          { kind: 'tokens', input: 12, output: 3 },
          { kind: 'cost', usd: 0, usdKnown: false },
          { kind: 'iteration' },
        ],
      }),
      'task',
      {
        label: 'unknown-priced-child',
        budget: { maxIterations: 1, maxTokens: 100, maxUsd: 0.5 },
      },
    )
    expect(spawned.ok).toBe(true)

    const settled = await scope.next()
    expect(settled).toMatchObject({
      kind: 'down',
      reason: expect.stringMatching(/unknown dollar cost/),
    })
    expect(pool.readout()).toMatchObject({
      tokensLeft: 85,
      reservedTokens: 0,
      usdLeft: 0,
    })
    expect(() => pool.assertNoOpenTickets()).not.toThrow()

    expect(
      scope.spawn(leafAgent('after-unknown-cost', { out: 'should-not-run', events: [] }), 'task', {
        label: 'after-unknown-cost',
        budget: { maxIterations: 1, maxTokens: 1 },
      }),
    ).toEqual({ ok: false, reason: 'budget-exhausted' })
  })

  // ── The cost-event × declared-ceiling matrix ──────────────────────────────────
  //
  // Every cell runs the SAME successful child under a dollar-capped root and varies only
  // (a) whether the executor emits a priced `cost` event and (b) whether the child's own
  // budget declares `maxUsd`. Before the fix, the cost-event + no-declared-ceiling cell was
  // the one that broke: `reserve` recorded $0, `clampSpend` passed the real dollars through
  // untouched, and `reconcile` read the $0 as a ceiling and threw — past the ticket's
  // settlement. The child settled `down` on its own SUCCESS path AND stranded its whole
  // reservation, so `assertNoOpenTickets` failed the run at the join barrier.
  for (const cell of [
    { cost: true, declaresUsd: true },
    { cost: true, declaresUsd: false },
    { cost: false, declaresUsd: true },
    { cost: false, declaresUsd: false },
  ] as const) {
    const name = `${cell.cost ? 'a priced' : 'an unpriced'} child ${
      cell.declaresUsd ? 'that declares maxUsd' : 'with no declared maxUsd'
    } settles done and leaks no reservation`
    it(name, async () => {
      const pool = createBudgetPool({ maxIterations: 100, maxTokens: 100_000, maxUsd: 10 }, () => 0)
      const { scope } = await beginScope({ pool })
      const events: UsageEvent[] = [
        { kind: 'iteration' },
        { kind: 'tokens', input: 100, output: 50 },
        ...(cell.cost ? [{ kind: 'cost', usd: 0.25 } as UsageEvent] : []),
      ]
      const spawned = scope.spawn(leafAgent('priced-leaf', { out: 'complete', events }), 'task', {
        label: 'priced-leaf',
        budget: {
          maxIterations: 5,
          maxTokens: 1000,
          ...(cell.declaresUsd ? { maxUsd: 1 } : {}),
        },
      })
      expect(spawned.ok).toBe(true)
      if (!spawned.ok) return

      const settled = await scope.next()
      expect(settled).toMatchObject({ kind: 'done', out: 'complete' })
      expect(settled?.spent).toMatchObject({
        iterations: 1,
        tokens: { input: 100, output: 50 },
        usd: cell.cost ? 0.25 : 0,
      })
      expect(spawned.handle.status).toBe('done')
      // The invariant the whole instrument rests on: nothing outstanding at the join barrier.
      expect(() => pool.assertNoOpenTickets()).not.toThrow()
      expect(pool.readout()).toMatchObject({
        tokensLeft: 99_850,
        reservedTokens: 0,
        tokensKnown: true,
        usdCapped: true,
        // Priced dollars are debited from the capped root whether or not the CHILD named a
        // ceiling; an unpriced child leaves the root balance untouched.
        usdLeft: cell.cost ? 9.75 : 10,
      })
    })
  }

  it('an UNKNOWN-priced child under a capped root still taints the dollar channel without leaking', async () => {
    // The neighbouring cell, unchanged by the fix and asserted here so it stays that way: a
    // cost event whose dollars are explicitly UNKNOWN under a dollar-capped root is a
    // different fact from a priced one. The root can no longer know its own balance, so the
    // channel is tainted and admission closes — the child goes `down` and later reservations
    // are refused. Only the leak is a defect; this refusal is the designed behavior. The
    // child declares no `maxUsd` here, which is the shape a live supervisor spawns.
    const pool = createBudgetPool({ maxIterations: 12, maxTokens: 400_000, maxUsd: 2 }, () => 0)
    const { scope } = await beginScope({ pool })
    const spawned = scope.spawn(
      leafAgent('unknown-priced-leaf', {
        out: 'complete',
        events: [
          { kind: 'iteration' },
          { kind: 'tokens', input: 4000, output: 900 },
          { kind: 'cost', usd: 0, usdKnown: false },
        ],
      }),
      'task',
      { label: 'unknown-priced-leaf', budget: { maxIterations: 6, maxTokens: 8000 } },
    )
    expect(spawned.ok).toBe(true)

    const settled = await scope.next()
    expect(settled).toMatchObject({
      kind: 'down',
      reason: expect.stringMatching(/unknown dollar cost/),
    })
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
    expect(pool.readout()).toMatchObject({ reservedTokens: 0, usdLeft: 0, usdCapped: true })
    expect(
      scope.spawn(leafAgent('after-unknown', { out: 'should-not-run', events: [] }), 'task', {
        label: 'after-unknown',
        budget: { maxIterations: 1, maxTokens: 1 },
      }),
    ).toEqual({ ok: false, reason: 'budget-exhausted' })
  })

  it('records a priced child on an UNCAPPED root as observed-but-unbudgeted dollars', async () => {
    // The regression guard for the other half of the rule: with no ROOT ceiling, dollars are
    // observed, never budgeted. The settlement records them without a reservation channel, so
    // `usdLeft` stays 0 with `usdCapped: false` (a readout of "not budgeted", not "exhausted")
    // and a known dollar amount leaves `tokensKnown` alone.
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: 100_000 }, () => 0)
    const { scope } = await beginScope({ pool })
    const spawned = scope.spawn(
      leafAgent('priced-uncapped', {
        out: 'complete',
        events: [
          { kind: 'iteration' },
          { kind: 'tokens', input: 100, output: 50 },
          { kind: 'cost', usd: 0.25 },
        ],
      }),
      'task',
      { label: 'priced-uncapped', budget: { maxIterations: 5, maxTokens: 1000 } },
    )
    expect(spawned.ok).toBe(true)

    const settled = await scope.next()
    expect(settled).toMatchObject({ kind: 'done', out: 'complete' })
    expect(settled?.spent).toMatchObject({ usd: 0.25 })
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
    expect(pool.readout()).toMatchObject({
      tokensLeft: 99_850,
      reservedTokens: 0,
      tokensKnown: true,
      usdCapped: false,
      usdLeft: 0,
    })
  })

  it('two arms at equal per-child budget spend equal total iterations', async () => {
    // Each arm spawns 3 children at a fixed 1-iteration budget; both arms draw from a
    // pool sized for exactly 6, so the realized Σiterations is equal by the conserved
    // reservation — no arm can overcommit past its half.
    const runArm = async (label: string) => {
      const { scope } = await beginScope({ root: `arm-${label}`, parentId: `arm-${label}` })
      let spawned = 0
      for (let i = 0; i < 3; i += 1) {
        const res = scope.spawn(
          leafAgent(`${label}-${i}`, { out: { label, i }, events: tokensOnly(10, 10, 1) }),
          'task',
          { budget: { maxIterations: 1, maxTokens: 100 }, label: `${label}-${i}` },
        )
        if (res.ok) spawned += 1
      }
      let total = 0
      for (let settled = await scope.next(); settled !== null; settled = await scope.next()) {
        if (settled.kind === 'done') total += settled.spent.iterations
      }
      return { spawned, total }
    }
    const treatment = await runArm('t')
    const blind = await runArm('b')
    expect(treatment.spawned).toBe(3)
    expect(blind.spawned).toBe(3)
    expect(treatment.total).toBe(blind.total)
    expect(treatment.total).toBe(3)
  })
})

// ── 3. The reactive Scope: seq order, view, inFlight ────────────────────────────

describe('reactive scope', () => {
  // Regression pin (scope↔journal seam): a `spawned` event must not reuse the cursor
  // `seq` that `next()` later stamps on the `settled` event, or the journal's per-tree
  // unique-seq guard rejects the settle write and the cursor rejects. The scope's OWN
  // doc says "`seq` is stamped by `next()`, never here" — so the spawn event needs a
  // separate spawn-ordinal. One spawn → one drain must not corrupt the journal.
  it('one spawn → one drain does not collide the journal seq namespace', async () => {
    const journal = new InMemorySpawnJournal()
    const { scope } = await beginScope({ journal })
    scope.spawn(leafAgent('only', { out: 1, events: tokensOnly(1, 1, 1) }), 'task', {
      budget: { maxIterations: 1, maxTokens: 10 },
      label: 'only',
    })
    const settled = await scope.next()
    expect(settled?.kind).toBe('done')
    expect(settled?.seq).toBe(0)
    const events = (await journal.loadTree('run')) as SpawnEvent[]
    const settledSeqs = events.filter((e) => e.kind === 'settled').map((e) => e.seq)
    expect(new Set(settledSeqs).size).toBe(settledSeqs.length)
  })

  it('a synchronous factory throw releases the reservation (no conserved-pool leak)', async () => {
    // The leak window the codex audit flagged: reserve() runs, then the scope constructs the
    // executor via the registry factory — if THAT throws, runChild (which reconciles the ticket)
    // is never reached. The reservation must be released so total ≡ free + reserved + committed.
    const boomRegistry = {
      register() {
        throw new Error('unused')
      },
      resolve() {
        return {
          succeeded: true as const,
          value: () => {
            throw new Error('factory boom')
          },
        }
      },
    } as unknown as Parameters<typeof createScope>[0]['executors']
    const { scope, pool } = await beginScope({ executors: boomRegistry })
    const agent = {
      name: 'boom',
      act: async () => 0,
      executorSpec: { profile: {} as AgentProfile, harness: null },
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    expect(() =>
      scope.spawn(agent, 'task', { budget: { maxIterations: 1, maxTokens: 100 }, label: 'boom' }),
    ).toThrow(/factory boom/)
    expect(pool.readout().tokensLeft).toBe(100_000)
    expect(pool.readout().reservedTokens).toBe(0)
    expect(() => pool.assertNoOpenTickets()).not.toThrow()
  })

  it('accepts a void-returning Executor.deliver and steers its live child', async () => {
    const { scope } = await beginScope()
    const inbox: unknown[] = []
    let release!: () => void
    const block = new Promise<void>((r) => {
      release = r
    })
    const res = scope.spawn(
      leafAgent('w', { out: 1, events: tokensOnly(1, 1, 1), block, inbox }),
      'task',
      {
        budget: { maxIterations: 1, maxTokens: 10 },
        label: 'w',
      },
    )
    if (!res.ok) throw new Error('spawn should have succeeded')
    // Live child with an inbox → delivered.
    expect(scope.send(res.handle.id, { steer: 'do X next' })).toBe(true)
    expect(inbox).toEqual([{ steer: 'do X next' }])
    // Unknown id → false (no live child).
    expect(scope.send('no-such-node', { steer: 'x' })).toBe(false)
    // Unblock + drain → child settles.
    release()
    const settled = await scope.next()
    expect(settled?.kind).toBe('done')
    // Settled child → false (can't steer a finished child).
    expect(scope.send(res.handle.id, { steer: 'too late' })).toBe(false)
    expect(inbox).toHaveLength(1)
  })

  it('send() returns false for a live child whose executor has no inbox (cannot steer mid-flight)', async () => {
    const { scope } = await beginScope()
    let release!: () => void
    const block = new Promise<void>((r) => {
      release = r
    })
    const res = scope.spawn(
      leafAgent('w', { out: 1, events: tokensOnly(1, 1, 1), block }),
      'task',
      {
        budget: { maxIterations: 1, maxTokens: 10 },
        label: 'w',
      },
    )
    if (!res.ok) throw new Error('spawn should have succeeded')
    expect(scope.send(res.handle.id, { steer: 'x' })).toBe(false) // no `deliver` on the executor
    release()
    await scope.next()
  })

  it('send() returns false when a live child inbox rejects a malformed message', async () => {
    const { scope } = await beginScope()
    const inbox = createInbox()
    let release!: () => void
    const block = new Promise<void>((resolve) => {
      release = resolve
    })
    const executor = mockExecutor({ out: 1, events: tokensOnly(1, 1, 1), block })
    executor.deliver = (message) => inbox.deliver(message)
    const agent = {
      name: 'validated-inbox',
      act: async () => 1,
      executorSpec: {
        profile: { name: 'validated-inbox' } as AgentProfile,
        harness: null,
        executor,
      },
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    const spawned = scope.spawn(agent, 'task', {
      budget: { maxIterations: 1, maxTokens: 10 },
      label: 'validated-inbox',
    })
    if (!spawned.ok) throw new Error('spawn should have succeeded')

    expect(scope.send(spawned.handle.id, { junk: true })).toBe(false)
    expect(scope.send(spawned.handle.id, { steer: 'use the valid route' })).toBe(true)
    expect(inbox.drain()).toEqual([
      { kind: 'steer', text: 'use the valid route', interrupt: false },
    ])
    release()
    await scope.next()
  })

  it('next() yields in monotonic seq order and view reflects the in-memory tree', async () => {
    const { scope } = await beginScope()
    for (let i = 0; i < 4; i += 1) {
      const res = scope.spawn(
        leafAgent(`c${i}`, { out: { i }, events: tokensOnly(5, 5, 1) }),
        'task',
        { budget: { maxIterations: 1, maxTokens: 50 }, label: `c${i}` },
      )
      expect(res.ok).toBe(true)
    }
    expect(scope.view.nodes).toHaveLength(4)

    const seqs: number[] = []
    const ids: string[] = []
    for (let settled = await scope.next(); settled !== null; settled = await scope.next()) {
      seqs.push(settled.seq)
      ids.push(settled.handle.id)
    }
    // seq is the monotonic cursor order, contiguous from 0.
    expect(seqs).toEqual([0, 1, 2, 3])
    // ids are the deterministic `${parent}:s${seq}` form minted at spawn order.
    expect(ids.every((id) => /^run:s\d+$/.test(id))).toBe(true)
    expect(scope.view.inFlight).toBe(0)
  })

  it('inFlight shrinks as children settle (live set is the nursery, not the log)', async () => {
    // Both children park on their own gate so neither settles before the assertion —
    // inFlight is read off the in-memory nursery, deterministically, with no race.
    const gateA = deferred()
    const gateB = deferred()
    const { scope } = await beginScope()
    scope.spawn(
      leafAgent('a', { out: 'a', events: tokensOnly(1, 1, 1), block: gateA.promise }),
      'task',
      { budget: { maxIterations: 1, maxTokens: 10 }, label: 'a' },
    )
    scope.spawn(
      leafAgent('b', { out: 'b', events: tokensOnly(1, 1, 1), block: gateB.promise }),
      'task',
      { budget: { maxIterations: 1, maxTokens: 10 }, label: 'b' },
    )
    expect(scope.view.inFlight).toBe(2)
    gateA.resolve()
    const first = await scope.next()
    expect(first?.kind).toBe('done')
    expect(scope.view.inFlight).toBe(1)
    gateB.resolve()
    const second = await scope.next()
    expect(second?.kind).toBe('done')
    expect(scope.view.inFlight).toBe(0)
    expect(await scope.next()).toBeNull()
  })

  it('a thrown executor becomes a typed `down` (infra), never rejects the cursor', async () => {
    const { scope } = await beginScope()
    scope.spawn(leafAgent('boom', { out: null, events: [], failWith: 'leaf exploded' }), 'task', {
      budget: { maxIterations: 1, maxTokens: 10 },
      label: 'boom',
    })
    scope.spawn(leafAgent('ok', { out: 'ok', events: tokensOnly(1, 1, 1) }), 'task', {
      budget: { maxIterations: 1, maxTokens: 10 },
      label: 'ok',
    })
    const settles: Settled<unknown>[] = []
    for (let s = await scope.next(); s !== null; s = await scope.next()) settles.push(s)
    const down = settles.find((s) => s.kind === 'down')
    const done = settles.find((s) => s.kind === 'done')
    expect(down).toBeDefined()
    if (down?.kind === 'down') {
      expect(down.infra).toBe(true)
      expect(down.reason).toContain('leaf exploded')
    }
    expect(done?.kind).toBe('done')
  })

  it('spawn fails closed on depth-exceeded', async () => {
    const { scope } = await beginScope({ depth: 2, maxDepth: 2 })
    const res = scope.spawn(leafAgent('deep', { out: 1, events: tokensOnly(1, 1) }), 'task', {
      budget: { maxIterations: 1, maxTokens: 10 },
      label: 'deep',
    })
    expect(res).toEqual({ ok: false, reason: 'depth-exceeded' })
  })

  it('spawn fails closed on budget-exhausted', async () => {
    const { scope } = await beginScope({
      pool: createBudgetPool({ maxIterations: 1, maxTokens: 10 }, () => 0),
    })
    const ok = scope.spawn(leafAgent('a', { out: 1, events: tokensOnly(1, 1) }), 'task', {
      budget: { maxIterations: 1, maxTokens: 10 },
      label: 'a',
    })
    expect(ok.ok).toBe(true)
    const overflow = scope.spawn(leafAgent('b', { out: 2, events: tokensOnly(1, 1) }), 'task', {
      budget: { maxIterations: 1, maxTokens: 10 },
      label: 'b',
    })
    expect(overflow).toEqual({ ok: false, reason: 'budget-exhausted' })
  })

  it('abort mid-flight reaps the live child (down, no throw)', async () => {
    const controller = new AbortController()
    const gate = deferred() // never resolves — the child only ends via abort.
    const { scope } = await beginScope({ signal: controller.signal })
    scope.spawn(
      leafAgent('parked', { out: 'p', events: tokensOnly(1, 1, 1), block: gate.promise }),
      'task',
      { budget: { maxIterations: 1, maxTokens: 10 }, label: 'parked' },
    )
    expect(scope.view.inFlight).toBe(1)
    controller.abort('test reap')
    const settled = await scope.next()
    expect(settled?.kind).toBe('down')
    expect(scope.view.inFlight).toBe(0)
  })
})

// ── 4. settledToIteration adapter (single-sourced selection) ─────────────────────

describe('settledToIteration adapter', () => {
  it('projects a done settlement into the kernel Iteration so defaultSelectWinner is shared', async () => {
    const { scope } = await beginScope()
    scope.spawn(
      leafAgent('lo', {
        out: 'lo',
        events: tokensOnly(1, 1, 1),
        verdict: { valid: true, score: 0.2 },
      }),
      'task',
      { budget: { maxIterations: 1, maxTokens: 10 }, label: 'lo' },
    )
    scope.spawn(
      leafAgent('hi', {
        out: 'hi',
        events: tokensOnly(1, 1, 1),
        verdict: { valid: true, score: 0.9 },
      }),
      'task',
      { budget: { maxIterations: 1, maxTokens: 10 }, label: 'hi' },
    )
    const iterations = []
    for (let s = await scope.next(); s !== null; s = await scope.next()) {
      if (s.kind === 'done') iterations.push(settledToIteration(s))
    }
    const winner = defaultSelectWinner(iterations)
    expect(winner?.output).toBe('hi')
    expect(winner?.verdict?.score).toBe(0.9)
  })

  it('fails loud when handed a `down` settlement (only a done child is an iteration)', () => {
    const down: Settled<unknown> = {
      kind: 'down',
      handle: { id: 'run:s0', label: 'x', status: 'failed', abort() {} },
      reason: 'boom',
      infra: false,
      restartCount: 0,
      seq: 0,
    }
    expect(() => settledToIteration(down)).toThrow(/cannot adapt a 'down'/)
  })
})

// ── 5. Open executor registry resolution ─────────────────────────────────────────

describe('open executor registry', () => {
  it('resolves a BYO executor verbatim (highest precedence)', () => {
    const registry = createExecutorRegistry()
    const byo = mockExecutor({ out: 'x', events: [] })
    const spec: AgentSpec = {
      profile: { name: 'byo' } as AgentProfile,
      harness: null,
      executor: byo,
    }
    const r = registry.resolve(spec)
    expect(r.succeeded).toBe(true)
    if (r.succeeded) {
      const built = r.value(spec, { signal: new AbortController().signal, seams: {} })
      // BYO factory returns the SAME instance — not a re-constructed router executor.
      expect(built).toBe(byo)
    }
  })

  it('harness:null resolves the router factory; a BackendType resolves the sandbox factory', () => {
    const registry = createExecutorRegistry()
    const router = registry.resolve({ profile: { name: 'r' } as AgentProfile, harness: null })
    const sandbox = registry.resolve({
      profile: { name: 's' } as AgentProfile,
      harness: 'claude-code',
    })
    expect(router.succeeded).toBe(true)
    expect(sandbox.succeeded).toBe(true)
    // Distinct factories: router/inline vs the sandbox-composing-runLoop built-in.
    if (router.succeeded && sandbox.succeeded) {
      expect(router.value).not.toBe(sandbox.value)
    }
  })

  it('register is fail-loud on a duplicate runtime tag', () => {
    const registry = createExecutorRegistry()
    expect(() => registry.register('router', mockRouterFactory())).toThrow(/already registered/)
  })

  it('register accepts a brand-new runtime tag (the open extension point)', () => {
    const registry = createExecutorRegistry()
    expect(() => registry.register('vendorx', mockRouterFactory())).not.toThrow()
  })

  it('scope.spawn fails loud when an agent carries no executorSpec (AgentSpec)', async () => {
    const { scope } = await beginScope()
    const noSpec: Agent<unknown, unknown> = { name: 'orphan', act: async () => 1 }
    expect(() =>
      scope.spawn(noSpec, 'task', { budget: { maxIterations: 1, maxTokens: 10 }, label: 'orphan' }),
    ).toThrow(/exposes no .*executorSpec/)
  })
})

function mockRouterFactory() {
  return () => mockExecutor({ out: 'x', events: [] })
}

// ── WidenGate defaults flat (the R2 firewall stays dormant by construction) ──────

describe('WidenGate default', () => {
  it('a flat gate never widens for any settlement', () => {
    // The frozen contract: the default WidenGate returns false for EVERY settlement, so a
    // gate run never widens and the widening-from-verdict (selector≠judge) conflict stays
    // dormant. No `judgeExempt` escape hatch is set.
    const flat: WidenGate<unknown> = { shouldWiden: () => false }
    expect(flat.judgeExempt).toBeUndefined()
    const budget = { tokensLeft: 1000, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 }
    const done: Settled<unknown> = {
      kind: 'done',
      handle: { id: 'run:s0', label: 'a', status: 'done', abort() {} },
      out: 'a',
      outRef: 'mock:"a"',
      verdict: { valid: true, score: 0.99 },
      spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
      seq: 0,
    }
    const down: Settled<unknown> = {
      kind: 'down',
      handle: { id: 'run:s1', label: 'b', status: 'failed', abort() {} },
      reason: 'x',
      infra: false,
      restartCount: 0,
      seq: 1,
    }
    // Even a near-perfect verdict does not widen under the flat default.
    expect(flat.shouldWiden(done, budget)).toBe(false)
    expect(flat.shouldWiden(down, budget)).toBe(false)
  })
})

// ── 6. Supervisor: join barrier, abort cascade, typed result ────────────────────

function supervisorOpts(over: Partial<SupervisorOpts> = {}): SupervisorOpts {
  return {
    budget: over.budget ?? { maxIterations: 100, maxTokens: 100_000 },
    runId: over.runId ?? 'sup',
    journal: over.journal ?? new InMemorySpawnJournal(),
    blobs: over.blobs ?? new InMemoryResultBlobStore(),
    executors: over.executors ?? createExecutorRegistry(),
    maxDepth: over.maxDepth,
    maxRestarts: over.maxRestarts,
    withinMs: over.withinMs,
    now: over.now ?? (() => 0),
    signal: over.signal,
  }
}

/** A flat-harness driver: spawn one child per arm, drain to settlement, select the best
 *  valid via the SAME single-sourced argmax the loop kernel uses. Returns the winner's
 *  `out` — selection lives in the driver, not the supervisor (selector≠judge). */
function flatHarness(arms: Array<{ name: string; script: MockScript }>): Agent<unknown, unknown> {
  return {
    name: 'flat-harness',
    async act(task, scope: Scope<unknown>): Promise<unknown> {
      for (const arm of arms) {
        scope.spawn(leafAgent(arm.name, arm.script), task, {
          budget: { maxIterations: 1, maxTokens: 1000 },
          label: arm.name,
        })
      }
      const iterations = []
      for (let s = await scope.next(); s !== null; s = await scope.next()) {
        if (s.kind === 'done') iterations.push(settledToIteration(s))
      }
      const winner = defaultSelectWinner(iterations)
      if (!winner) throw new ValidationError('flat-harness: no valid child')
      return winner.output
    },
  }
}

describe('supervisor', () => {
  it('returns a typed `winner` and a `down` child does not crash the join', async () => {
    const supervisor = createSupervisor<unknown, unknown>()
    const result = await supervisor.run(
      flatHarness([
        {
          name: 'good',
          script: {
            out: 'good',
            events: tokensOnly(10, 10, 1),
            verdict: { valid: true, score: 0.8 },
          },
        },
        { name: 'dead', script: { out: null, events: [], failWith: 'arm down' } },
        {
          name: 'meh',
          script: {
            out: 'meh',
            events: tokensOnly(10, 10, 1),
            verdict: { valid: true, score: 0.3 },
          },
        },
      ]),
      'solve it',
      supervisorOpts(),
    )
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') {
      expect(result.out).toBe('good')
      // spentTotal sums the conserved spend off every journaled settlement (2 done arms).
      expect(result.spentTotal.iterations).toBe(2)
      expect(result.spentTotal.tokens.input).toBe(20)
      expect(result.tree.nodes.length).toBe(3)
    }
  })

  it('returns a typed `no-winner` (never best!) when every child is down', async () => {
    const supervisor = createSupervisor<unknown, unknown>()
    const result = await supervisor.run(
      flatHarness([
        { name: 'd1', script: { out: null, events: [], failWith: 'down 1' } },
        { name: 'd2', script: { out: null, events: [], failWith: 'down 2' } },
      ]),
      'task',
      supervisorOpts(),
    )
    expect(result.kind).toBe('no-winner')
    if (result.kind === 'no-winner') {
      expect(result.reason).toBe('all-children-down')
      expect(result.downCount).toBe(2)
      // A no-winner still carries the conserved spend, summed off the same journal the winner path
      // reads — well-formed (every channel present, non-negative), never absent or fabricated.
      expect(result.spentTotal).toBeDefined()
      expect(result.spentTotal.iterations).toBeGreaterThanOrEqual(0)
      expect(result.spentTotal.tokens.input).toBeGreaterThanOrEqual(0)
      expect(result.spentTotal.tokens.output).toBeGreaterThanOrEqual(0)
      expect(result.spentTotal.usd).toBeGreaterThanOrEqual(0)
    }
  })

  it('a caller abort cascades teardown over live children (allSettled, no throw)', async () => {
    const controller = new AbortController()
    const gate = deferred() // children never settle on their own.
    const supervisor = createSupervisor<unknown, unknown>()
    const driver: Agent<unknown, unknown> = {
      name: 'parker',
      async act(_t, scope: Scope<unknown>): Promise<unknown> {
        scope.spawn(
          leafAgent('p1', { out: 1, events: tokensOnly(1, 1, 1), block: gate.promise }),
          't',
          { budget: { maxIterations: 1, maxTokens: 10 }, label: 'p1' },
        )
        scope.spawn(
          leafAgent('p2', { out: 2, events: tokensOnly(1, 1, 1), block: gate.promise }),
          't',
          { budget: { maxIterations: 1, maxTokens: 10 }, label: 'p2' },
        )
        // Abort arrives while both children are parked; the first next() must see the reap.
        controller.abort('caller cancel')
        const settled = await scope.next()
        if (settled?.kind === 'down') throw new ValidationError('aborted')
        return 'unreachable'
      },
    }
    const result = await supervisor.run(driver, 't', supervisorOpts({ signal: controller.signal }))
    expect(result.kind).toBe('no-winner')
    if (result.kind === 'no-winner') expect(result.reason).toBe('aborted')
  })

  it('a bound RootHandle reads the live tree and is fail-loud when detached', async () => {
    const handle = createRootHandle<unknown>()
    // Detached: every method is a typed throw, never a silent no-op.
    expect(() => handle.view()).toThrow()
    expect(() => handle.deliver({ steer: 'too early' })).toThrow()
    const supervisor = createSupervisor<unknown, unknown>()
    supervisor.attach(handle)
    let observed = -1
    let received: unknown
    const started = deferred()
    const release = deferred()
    const driver: Agent<unknown, unknown> = {
      name: 'observe',
      deliver(message): boolean {
        received = message
        return true
      },
      async act(_t, scope: Scope<unknown>): Promise<unknown> {
        scope.spawn(leafAgent('c', { out: 'c', events: tokensOnly(1, 1, 1) }), 't', {
          budget: { maxIterations: 1, maxTokens: 10 },
          label: 'c',
        })
        observed = handle.view().nodes.length
        started.resolve()
        await release.promise
        await scope.next()
        return 'c'
      },
    }
    const running = supervisor.run(driver, 't', supervisorOpts())
    await started.promise
    expect(handle.deliver({ steer: 'use the corrected plan', interrupt: true })).toBe(true)
    release.resolve()
    const result = await running
    expect(result.kind).toBe('winner')
    expect(observed).toBe(1)
    expect(received).toEqual({ steer: 'use the corrected plan', interrupt: true })
    // Unbound again after the run completes.
    expect(() => handle.view()).toThrow()
    expect(() => handle.deliver({ steer: 'too late' })).toThrow()
  })

  it('a live root manager without an inbox reports that delivery was not accepted', async () => {
    const handle = createRootHandle<unknown>()
    const supervisor = createSupervisor<unknown, unknown>()
    supervisor.attach(handle)
    const started = deferred()
    const release = deferred()
    const running = supervisor.run(
      {
        name: 'no-inbox',
        async act() {
          started.resolve()
          await release.promise
          return 'done'
        },
      },
      't',
      supervisorOpts(),
    )
    await started.promise
    expect(handle.deliver({ steer: 'cannot receive this' })).toBe(false)
    release.resolve()
    await running
  })

  it('RootHandle returns false when the live manager inbox rejects malformed input', async () => {
    const handle = createRootHandle<unknown>()
    const supervisor = createSupervisor<unknown, unknown>()
    supervisor.attach(handle)
    const inbox = createInbox()
    const started = deferred()
    const release = deferred()
    const running = supervisor.run(
      {
        name: 'validated-root-inbox',
        deliver: (message) => inbox.deliver(message),
        async act() {
          started.resolve()
          await release.promise
          return 'done'
        },
      },
      't',
      supervisorOpts({ runId: 'validated-root-inbox' }),
    )
    await started.promise

    expect(handle.deliver({ junk: true })).toBe(false)
    expect(handle.deliver({ steer: 'valid correction' })).toBe(true)
    expect(inbox.drain()).toEqual([{ kind: 'steer', text: 'valid correction', interrupt: false }])
    release.resolve()
    await running
  })

  it('refuses to cross-route one RootHandle across concurrent runs', async () => {
    const handle = createRootHandle<unknown>()
    const firstSupervisor = createSupervisor<unknown, unknown>()
    const secondSupervisor = createSupervisor<unknown, unknown>()
    firstSupervisor.attach(handle)
    secondSupervisor.attach(handle)

    const firstStarted = deferred()
    const releaseFirst = deferred()
    const firstMessages: unknown[] = []
    const first = firstSupervisor.run(
      {
        name: 'first-owner',
        deliver(message): boolean {
          firstMessages.push(message)
          return true
        },
        async act() {
          firstStarted.resolve()
          await releaseFirst.promise
          return 'first'
        },
      },
      't',
      supervisorOpts({ runId: 'root-handle-first' }),
    )
    await firstStarted.promise

    let secondActed = false
    await expect(
      secondSupervisor.run(
        {
          name: 'second-owner',
          async act() {
            secondActed = true
            return 'second'
          },
        },
        't',
        supervisorOpts({ runId: 'root-handle-second' }),
      ),
    ).rejects.toThrow(/already controls a live run/)
    expect(secondActed).toBe(false)
    expect(handle.deliver({ steer: 'still for first' })).toBe(true)
    expect(firstMessages).toEqual([{ steer: 'still for first' }])

    releaseFirst.resolve()
    await expect(first).resolves.toMatchObject({ kind: 'winner', out: 'first' })

    const secondStarted = deferred()
    const releaseSecond = deferred()
    const secondMessages: unknown[] = []
    const sequential = secondSupervisor.run(
      {
        name: 'second-owner-after-release',
        deliver(message): boolean {
          secondMessages.push(message)
          return true
        },
        async act() {
          secondStarted.resolve()
          await releaseSecond.promise
          return 'second'
        },
      },
      't',
      supervisorOpts({ runId: 'root-handle-sequential' }),
    )
    await secondStarted.promise
    expect(handle.deliver({ steer: 'now for second' })).toBe(true)
    expect(secondMessages).toEqual([{ steer: 'now for second' }])
    releaseSecond.resolve()
    await expect(sequential).resolves.toMatchObject({ kind: 'winner', out: 'second' })
  })

  it('releases a RootHandle lease when startup fails before the manager runs', async () => {
    const handle = createRootHandle<unknown>()
    const supervisor = createSupervisor<unknown, unknown>()
    supervisor.attach(handle)
    const occupied = new InMemorySpawnJournal()
    await occupied.beginTree('occupied-root-handle', new Date(0).toISOString())

    await expect(
      supervisor.run(
        { name: 'never-starts', act: async () => 'unreachable' },
        't',
        supervisorOpts({ runId: 'occupied-root-handle', journal: occupied }),
      ),
    ).rejects.toThrow(/already exists/)

    const started = deferred()
    const release = deferred()
    const running = supervisor.run(
      {
        name: 'starts-after-failure',
        async act() {
          started.resolve()
          await release.promise
          return 'done'
        },
      },
      't',
      supervisorOpts({ runId: 'root-handle-after-startup-failure' }),
    )
    await started.promise
    expect(handle.view().root).toBe('root-handle-after-startup-failure')
    release.resolve()
    await expect(running).resolves.toMatchObject({ kind: 'winner', out: 'done' })
  })

  it('attach rejects a foreign handle not minted by createRootHandle', () => {
    const supervisor = createSupervisor<unknown, unknown>()
    const foreign = {
      view() {
        return { root: '', nodes: [], inFlight: 0 }
      },
      signal() {},
      abort() {},
    }
    expect(() => supervisor.attach(foreign)).toThrow(/createRootHandle/)
  })
})

// ── 7. Replay determinism ────────────────────────────────────────────────────────

describe('replay determinism', () => {
  it('replaying a recorded journal yields the same tree + winner in the same seq order', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const supervisor = createSupervisor<unknown, unknown>()
    const arms = [
      {
        name: 'a',
        script: {
          out: { ans: 'a' },
          events: tokensOnly(10, 5, 1),
          verdict: { valid: true, score: 0.4 },
        },
      },
      {
        name: 'b',
        script: {
          out: { ans: 'b' },
          events: tokensOnly(8, 4, 1),
          verdict: { valid: true, score: 0.9 },
        },
      },
      {
        name: 'c',
        script: {
          out: { ans: 'c' },
          events: tokensOnly(6, 3, 1),
          verdict: { valid: true, score: 0.6 },
        },
      },
    ]
    const live = await supervisor.run(
      flatHarness(arms),
      'task',
      supervisorOpts({ runId: 'replay-run', journal, blobs }),
    )
    expect(live.kind).toBe('winner')
    const liveWinner = live.kind === 'winner' ? live.out : undefined

    // Replay the recorded journal: rehydrate each `out` from the blob store in seq order.
    const replayed = await replaySpawnTree(journal, blobs, 'replay-run')
    const replaySeqs = replayed.map((s) => s.seq)
    expect(replaySeqs).toEqual([...replaySeqs].sort((x, y) => x - y))

    // Re-run the SAME driver selection over the replayed settlements — same winner.
    const iterations = replayed
      .filter((s): s is Extract<Settled<unknown>, { kind: 'done' }> => s.kind === 'done')
      .map(settledToIteration)
    const replayWinner = defaultSelectWinner(iterations)?.output
    expect(replayWinner).toEqual(liveWinner)
    expect((replayWinner as { ans: string }).ans).toBe('b')

    // materializeTreeView re-derives the recorded tree (same node ids + statuses).
    const events = (await journal.loadTree('replay-run')) as SpawnEvent[]
    const view = materializeTreeView(events)
    const leafNodes = view.nodes.filter((n) => n.parent === 'replay-run')
    expect(leafNodes).toHaveLength(3)
    expect(leafNodes.every((n) => n.status === 'done')).toBe(true)
    expect(view.inFlight).toBe(0)
  })

  it('replay fails loud on a journaled outRef missing from the blob store', async () => {
    const journal = new InMemorySpawnJournal()
    await journal.beginTree('gap', new Date(0).toISOString())
    await journal.appendEvent('gap', {
      kind: 'spawned',
      id: 'gap:s0',
      parent: 'gap',
      label: 'x',
      budget: { maxIterations: 1, maxTokens: 10 },
      runtime: 'router',
      seq: 0,
      at: new Date(0).toISOString(),
    })
    await journal.appendEvent('gap', {
      kind: 'settled',
      id: 'gap:s0',
      status: 'done',
      outRef: 'mock:"orphan"',
      spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
      seq: 1,
      at: new Date(0).toISOString(),
    })
    await expect(replaySpawnTree(journal, new InMemoryResultBlobStore(), 'gap')).rejects.toThrow(
      /no artifact for outRef/,
    )
  })
})

// ── 9. one observable tree — spawn/settle ride the lifecycle hook stream ─────────
//
// The recursive tree is observable through the SAME `RuntimeHooks` stream `runLoop`/
// `tool-loop` feed: `scope.spawn` emits `agent.spawn`, the settle cursor emits
// `agent.child`. This is what the topology viewer reads — without it the tree is only
// in the journal (replay-only, not live). The journal stays the durable record; the
// hook stream is the live projection. Both must agree.

describe('lifecycle hook stream (the topology viewer source)', () => {
  it('emits agent.spawn at spawn and agent.child at settle, with parent/child + status', async () => {
    const events: RuntimeHookEvent[] = []
    const { scope } = await beginScope({
      root: 'run',
      parentId: 'run',
      hooks: { onEvent: (e) => void events.push(e) },
    })

    scope.spawn(
      leafAgent('ok', {
        out: 'A',
        events: tokensOnly(1, 1, 1),
        verdict: { score: 0.9, valid: true },
      }),
      'task',
      {
        budget: { maxIterations: 1, maxTokens: 100 },
        label: 'winner',
      },
    )
    scope.spawn(leafAgent('boom', { out: null, events: [], failWith: 'leaf exploded' }), 'task', {
      budget: { maxIterations: 1, maxTokens: 100 },
      label: 'loser',
    })
    for (let s = await scope.next(); s !== null; s = await scope.next()) {
      /* drain — settling is what fires agent.child */
    }

    const spawns = events.filter((e) => e.target === 'agent.spawn')
    const settles = events.filter((e) => e.target === 'agent.child')
    expect(spawns).toHaveLength(2)
    expect(settles).toHaveLength(2)

    // Every event carries the run id, the tree parent, and the child it is about.
    for (const e of [...spawns, ...settles]) {
      expect(e.runId).toBe('run')
      expect(e.parentId).toBe('run')
      expect(e.phase).toBe('after')
      expect((e.payload as { childId: string }).childId).toMatch(/^run:s\d+$/)
    }
    // spawn payload names the runtime + label so the viewer can draw the node before it settles.
    expect(spawns.map((e) => (e.payload as { label: string }).label).sort()).toEqual([
      'loser',
      'winner',
    ])
    // child payload carries the terminal status the viewer colors the node by.
    const byStatus = Object.fromEntries(
      settles.map((e) => [
        (e.payload as { status: string }).status,
        e.payload as Record<string, unknown>,
      ]),
    )
    expect(byStatus.done).toMatchObject({ status: 'done', score: 0.9, valid: true })
    expect(byStatus.down).toMatchObject({ status: 'down', reason: 'leaf exploded' })
  })

  it('stays silent (journal-only) when no hooks are wired', async () => {
    const { scope, journal } = await beginScope({ root: 'run', parentId: 'run' })
    scope.spawn(leafAgent('solo', { out: 1, events: tokensOnly(1, 1, 1) }), 'task', {
      budget: { maxIterations: 1, maxTokens: 100 },
      label: 'solo',
    })
    await scope.next()
    // No hooks ⇒ no throw, and the journal still recorded the lifecycle (the durable record).
    const recorded = (await journal.loadTree('run')) ?? []
    expect(recorded.some((e) => e.kind === 'spawned')).toBe(true)
    expect(recorded.some((e) => e.kind === 'settled')).toBe(true)
  })
})

// ── helpers ────────────────────────────────────────────────────────────────────

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
