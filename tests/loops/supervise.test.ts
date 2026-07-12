import type { AgentProfile } from '@tangle-network/sandbox'
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
    ...(script.inbox ? { deliver: (m: unknown) => script.inbox?.push(m) } : {}),
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
    expect(r).toEqual({ ok: false, reason: 'budget-exhausted' })
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
})

// ── 2. equal-k by construction ──────────────────────────────────────────────────

describe('equal-k by construction', () => {
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

  it('send() steers a LIVE child via its inbox; false for settled / unknown / no-inbox', async () => {
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
    const supervisor = createSupervisor<unknown, unknown>()
    supervisor.attach(handle)
    let observed = -1
    const driver: Agent<unknown, unknown> = {
      name: 'observe',
      async act(_t, scope: Scope<unknown>): Promise<unknown> {
        scope.spawn(leafAgent('c', { out: 'c', events: tokensOnly(1, 1, 1) }), 't', {
          budget: { maxIterations: 1, maxTokens: 10 },
          label: 'c',
        })
        observed = handle.view().nodes.length
        await scope.next()
        return 'c'
      },
    }
    const result = await supervisor.run(driver, 't', supervisorOpts())
    expect(result.kind).toBe('winner')
    expect(observed).toBe(1)
    // Unbound again after the run completes.
    expect(() => handle.view()).toThrow()
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
