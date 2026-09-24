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
import { describe, expect, it } from 'vitest'
import { createBudgetPool, ReservationWaitRefused } from '../../src/runtime/supervise/budget'
import type { Spend } from '../../src/runtime/supervise/types'

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
