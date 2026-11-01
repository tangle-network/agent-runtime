/**
 * A reservation the pool cannot cover now waits for what open reservations return, instead of
 * failing, and is refused only once nothing open could return enough.
 *
 * Measured 2026-09-24 on a four-level audit through `supervise` (66 planned agents, default
 * slices, offline brain): every team lead's fourth claim checker was refused `budget-exhausted`,
 * because four default slices fill a lead's whole slice and the lead's own turns had already drawn
 * on it. 12 of 48 checkers never ran, while their siblings were about to return most of what
 * they held.
 */
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import { createCoordinationTools } from '../../src/mcp/tools/coordination-manager'
import { createBudgetPool, ReservationWaitRefused } from '../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, Budget, Scope, Spend } from '../../src/runtime/supervise/types'
import { testAgentProfile } from '../kernel/test-agent-profile'

const spent = (tokens: number, iterations = 1): Spend => ({
  iterations,
  tokens: { input: tokens, output: 0 },
  usd: 0,
  ms: 0,
})

const settledState = async (promise: Promise<void>): Promise<string> => {
  let state = 'waiting'
  promise.then(
    () => {
      state = 'granted'
    },
    (error: unknown) => {
      state = error instanceof ReservationWaitRefused ? 'refused' : 'failed'
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return state
}

describe('waiting reservations', () => {
  it('waits for a refund, holds nothing while it waits, and is granted when the refund lands', async () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 100 }, 0)
    const first = pool.reserve({ maxIterations: 1, maxTokens: 80 })
    const second = pool.reserve({ maxIterations: 1, maxTokens: 60 }, undefined, { wait: true })
    if (!first.ok || !second.ok) throw new Error('both reservations should be admitted')
    expect(first.granted).toBeUndefined()
    expect(second.granted).toBeDefined()
    // The waiting ticket reserves nothing.
    expect(pool.readout()).toMatchObject({ tokensLeft: 20, reservedTokens: 80 })
    expect(await settledState(second.granted!)).toBe('waiting')
    pool.reconcile(first.ticket, spent(10))
    expect(await settledState(second.granted!)).toBe('granted')
    expect(pool.readout()).toMatchObject({ tokensLeft: 30, reservedTokens: 60 })
    pool.reconcile(second.ticket, spent(5))
    pool.assertNoOpenTickets()
    expect(pool.readout()).toMatchObject({ tokensLeft: 85, reservedTokens: 0 })
  })

  it('is refused at once when even every open reservation returning could not cover it', () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 100 }, 0)
    expect(pool.reserve({ maxIterations: 1, maxTokens: 80 }).ok).toBe(true)
    expect(pool.reserve({ maxIterations: 1, maxTokens: 101 }, undefined, { wait: true })).toEqual({
      ok: false,
      reason: 'budget-exhausted',
      shortfalls: [{ channel: 'tokens', requested: 101, free: 20, held: 80 }],
    })
    // Without `wait`, a temporary shortfall is refused as before.
    expect(pool.reserve({ maxIterations: 1, maxTokens: 60 })).toMatchObject({
      ok: false,
      reason: 'budget-exhausted',
    })
  })

  it('is refused once the last open reservation settles without returning enough', async () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 100 }, 0)
    const first = pool.reserve({ maxIterations: 1, maxTokens: 80 })
    const waiter = pool.reserve({ maxIterations: 1, maxTokens: 60 }, undefined, { wait: true })
    if (!first.ok || !waiter.ok) throw new Error('both reservations should be admitted')
    pool.reconcile(first.ticket, spent(70))
    expect(await settledState(waiter.granted!)).toBe('refused')
    await expect(waiter.granted!).rejects.toMatchObject({
      reason: 'budget-exhausted',
      shortfalls: [{ channel: 'tokens', requested: 60, free: 30 }],
    })
    // The refused ticket is still open until its holder settles it, against nothing held.
    expect(pool.openReservations()).toHaveLength(1)
    pool.reconcile(waiter.ticket, spent(0, 0))
    pool.assertNoOpenTickets()
    expect(pool.readout()).toMatchObject({ tokensLeft: 30, reservedTokens: 0 })
  })

  it('grants in the order asked, and a later request queues behind a waiting one', async () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 100 }, 0)
    const holder = pool.reserve({ maxIterations: 1, maxTokens: 90 })
    const big = pool.reserve({ maxIterations: 1, maxTokens: 50 }, undefined, { wait: true })
    // Fits the 10 free now, but waits behind `big` so the order of asking is kept.
    const small = pool.reserve({ maxIterations: 1, maxTokens: 10 }, undefined, { wait: true })
    if (!holder.ok || !big.ok || !small.ok) throw new Error('all reservations should be admitted')
    expect(await settledState(small.granted!)).toBe('waiting')
    pool.reconcile(holder.ticket, spent(30))
    expect(await settledState(big.granted!)).toBe('granted')
    expect(await settledState(small.granted!)).toBe('granted')
    expect(pool.readout()).toMatchObject({ tokensLeft: 10, reservedTokens: 60 })
  })

  it('refuses a head that cannot fit once nothing is held, and still grants the next that does', async () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 100 }, 0)
    const holder = pool.reserve({ maxIterations: 1, maxTokens: 90 })
    const big = pool.reserve({ maxIterations: 1, maxTokens: 50 }, undefined, { wait: true })
    const small = pool.reserve({ maxIterations: 1, maxTokens: 20 }, undefined, { wait: true })
    if (!holder.ok || !big.ok || !small.ok) throw new Error('all reservations should be admitted')
    pool.reconcile(holder.ticket, spent(70))
    expect(await settledState(big.granted!)).toBe('refused')
    expect(await settledState(small.granted!)).toBe('granted')
  })

  it('withdraws a waiting ticket that its holder settles before it is granted', async () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 100 }, 0)
    const holder = pool.reserve({ maxIterations: 1, maxTokens: 90 })
    const withdrawn = pool.reserve({ maxIterations: 1, maxTokens: 50 }, undefined, { wait: true })
    const next = pool.reserve({ maxIterations: 1, maxTokens: 50 }, undefined, { wait: true })
    if (!holder.ok || !withdrawn.ok || !next.ok) throw new Error('all should be admitted')
    pool.reconcile(withdrawn.ticket, spent(0, 0))
    pool.reconcile(holder.ticket, spent(40))
    expect(await settledState(next.granted!)).toBe('granted')
    pool.reconcile(next.ticket, spent(0, 0))
    pool.assertNoOpenTickets()
    expect(pool.readout()).toMatchObject({ tokensLeft: 60, reservedTokens: 0 })
  })

  it('keeps the owner floor free for a waiting ticket too', async () => {
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 100 }, 0)
    const keep = { tokens: 20, iterations: 0 }
    const holder = pool.reserve({ maxIterations: 1, maxTokens: 80 }, undefined, { keep })
    const waiter = pool.reserve({ maxIterations: 1, maxTokens: 70 }, undefined, {
      wait: true,
      keep,
    })
    if (!holder.ok || !waiter.ok) throw new Error('both reservations should be admitted')
    // 100 - 15 = 85 free, less the 20 kept, leaves 65: not enough for 70, and nothing is held.
    pool.reconcile(holder.ticket, spent(15))
    expect(await settledState(waiter.granted!)).toBe('refused')
  })
})

/**
 * magnetar-rust-sandbox-20261101b (agent-runtime 3.0.22, `ownerShare: 0.5`): manager `:s3` held
 * 2,800,000 tokens. Its own turns had charged 610,298 and its first worker 417,963 when its next
 * two 500,000-token workers were refused with "free 371739": the pool still kept the whole
 * 1,400,000 owner share free although the manager had already spent 610,298 of it, so its own
 * turns came out of its team's half. Seven workers under two managers settled `down` that way.
 */
describe("a manager's own share", () => {
  const MANAGER: Budget = { maxTokens: 2_800_000, maxIterations: 380 }
  const tokens = (input: number): Spend => ({
    iterations: 0,
    tokens: { input, output: 0 },
    usd: 0,
    ms: 0,
  })
  const WORKER: Budget = { maxTokens: 500_000, maxIterations: 16 }

  function team(spentBy: Record<string, number>, gate: Promise<void>) {
    const makeWorkerAgent = (profile: { name?: string }): Agent<unknown, unknown> => {
      const name = profile.name ?? 'worker'
      const result = { outRef: name, out: name, spent: tokens(spentBy[name] ?? 0) }
      return {
        name,
        act: async () => name,
        executorSpec: {
          profile: testAgentProfile(name),
          harness: null,
          executor: {
            runtime: 'owner-share-test',
            async execute() {
              if (name !== 'ladder') await gate
              return result
            },
            resultArtifact: () => result,
            teardown: async () => ({ destroyed: true }),
          },
        },
      }
    }
    return (scope: Scope<unknown>) => {
      const coord = createCoordinationTools({
        scope,
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent,
        // A nested manager's default slice at this budget: an eighth of it at ownerShare 0.5.
        perWorker: { maxTokens: 350_000, maxIterations: 47 },
      })
      const tool = coord.tools.find((entry) => entry.name === 'spawn_worker')!
      const spawn = (name: string, budget: Budget) =>
        tool.handler({
          profile: testAgentProfile(name),
          task: name,
          label: name,
          budget,
        }) as Promise<Record<string, unknown>>
      const settled = async (count: number) => {
        while (coord.settled().length < count) {
          const wake = await coord.awaitWake({
            signal: scope.signal,
            heartbeatMs: 60_000,
            debounceMs: 0,
          })
          if (wake === undefined) break
        }
        return coord.settled().map(({ id, status }) => ({ id, status }))
      }
      return { spawn, settled }
    }
  }

  const stores = () => ({
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
  })
  const run = (
    act: (scope: Scope<unknown>) => Promise<unknown>,
    { journal, blobs }: ReturnType<typeof stores>,
    resume = false,
  ) =>
    createSupervisor().run({ name: 'manager', act: (_task, scope) => act(scope) }, 'task', {
      budget: MANAGER,
      reservationPolicy: { ownerShare: 0.5 },
      runId: 'owner-share',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      rootIdentity: {
        profileDigest: canonicalCandidateDigest({ profile: 'manager' }),
        taskDigest: canonicalCandidateDigest('task'),
      },
      ...(resume ? { resume: true } : {}),
    })

  it('spends its own turns from its own half, so its team keeps the other half', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tools = team({ ladder: 417_963, keccak: 120_000, merkle: 90_000 }, gate)
    const seen: Record<string, unknown> = {}
    await run(async (scope) => {
      const { spawn, settled } = tools(scope)
      await scope.meter(tokens(610_298))
      await spawn('ladder', { maxTokens: 500_000, maxIterations: 180 })
      await settled(1)
      seen.keccak = await spawn('keccak', WORKER)
      seen.merkle = await spawn('merkle', WORKER)
      seen.oversized = await spawn('oversized', { maxTokens: 2_000_000, maxIterations: 16 })
      release()
      seen.settled = await settled(3)
      return 'done'
    }, stores())
    // 1,400,000 for the team, less the 417,963 its first worker spent, is 982,037: the first
    // 500,000 worker starts at once and the second waits only for it.
    expect(seen.keccak).toMatchObject({ status: 'acquiring' })
    expect(seen.merkle).toMatchObject({ status: 'queued' })
    // A request no settlement could cover is refused at once, naming what is free now and what
    // its running workers hold, as fields.
    expect(seen.oversized).toMatchObject({
      error: 'budget-exhausted',
      shortfalls: [{ channel: 'tokens', requested: 2_000_000, free: 482_037, held: 500_000 }],
    })
    expect(seen.settled).toEqual([
      { id: 'owner-share:s0', status: 'done' },
      { id: 'owner-share:s1', status: 'done' },
      { id: 'owner-share:s2', status: 'done' },
    ])
  })

  it('still counts the turns it took before a restart', async () => {
    const durable = stores()
    const gate = Promise.resolve()
    const tools = team({ ladder: 417_963, keccak: 120_000 }, gate)
    await run(async (scope) => {
      const { spawn, settled } = tools(scope)
      await scope.meter(tokens(610_298))
      await spawn('ladder', { maxTokens: 500_000, maxIterations: 180 })
      await settled(1)
      throw new Error('the manager process stopped')
    }, durable).catch(() => undefined)
    let resumed: Record<string, unknown> = {}
    await run(
      async (scope) => {
        const { spawn, settled } = tools(scope)
        resumed = await spawn('keccak', WORKER)
        await settled(1)
        return 'done'
      },
      durable,
      true,
    )
    expect(resumed).toMatchObject({ status: 'acquiring' })
  })
})
