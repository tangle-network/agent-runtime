import { describe, expect, it } from 'vitest'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import { createInMemoryRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import { zeroSpend } from '../../src/runtime/util'
import { testAgentProfile } from '../kernel/test-agent-profile'

const spend = (tokens: number, iterations: number) => ({
  ...zeroSpend(),
  tokens: { input: tokens, output: 0 },
  iterations,
})

describe('optional budget channels through production admission and accounting', () => {
  it('executes eight workers concurrently with no caps and holds no invented reservations', async () => {
    let entered = 0
    let release!: () => void
    let allEntered!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      allEntered = resolve
    })
    const context = createInMemoryRunContext({ withDriver: true })
    const worker = driverChild(
      testAgentProfile('worker'),
      {
        name: 'worker',
        async act(task, scope) {
          if (++entered === 8) allEntered()
          await held
          await scope.meter(spend(1, 1))
          return String(task)
        },
      },
      context.journal,
    )
    const result = await createSupervisor<string, string>().run(
      {
        name: 'root',
        async act(task, scope) {
          for (let index = 0; index < 8; index++) {
            expect(scope.spawn(worker, task, { budget: {} }).ok).toBe(true)
          }
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([
              started,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error(`only ${entered}/8 workers entered`)),
                  5_000,
                )
              }),
            ])
            expect(scope.budget).toMatchObject({
              tokensCapped: false,
              iterationsCapped: false,
              tokensLeft: 0,
              iterationsLeft: 0,
              reservedTokens: 0,
            })
          } finally {
            clearTimeout(timer)
            release()
          }
          for (let index = 0; index < 8; index++) await scope.next()
          return task
        },
      },
      'done',
      { ...context, budget: {}, workerSlots: 0 },
    )
    expect(entered).toBe(8)
    expect(result.spentTotal).toMatchObject({ tokens: { input: 8 }, iterations: 8 })
  }, 10_000)

  it('conserves a capped channel while enforcing child caps in uncapped channels', () => {
    const pool = createBudgetPool({ maxTokens: 10 }, 0)
    const first = pool.reserve({ maxTokens: 6, maxIterations: 1 })
    if (!first.ok) throw new Error('first worker refused')
    expect(first.ticket.reserved).toMatchObject({ tokens: 6, iterations: 0 })
    expect(pool.reserve({ maxTokens: 5 })).toMatchObject({ ok: false, reason: 'budget-exhausted' })
    expect(pool.readout()).toMatchObject({
      tokensLeft: 4,
      reservedTokens: 6,
      iterationsCapped: false,
    })
    expect(pool.reconcile(first.ticket, spend(4, 7))).toEqual({
      overspent: [{ channel: 'iterations', reserved: 1, spent: 7 }],
    })
    expect(pool.readout()).toMatchObject({
      tokensLeft: 6,
      reservedTokens: 0,
      committedTokens: 4,
      iterationsLeft: 0,
    })
    const second = pool.reserve({ maxTokens: 6 })
    if (!second.ok) throw new Error('refunded capacity not admitted')
    pool.reconcile(second.ticket, spend(6, 2))
    pool.assertNoOpenTickets()
    expect(pool.readout()).toMatchObject({ tokensLeft: 0, reservedTokens: 0, committedTokens: 10 })
  })

  it('preserves explicit zero child caps even when the root has no global reservation', () => {
    const pool = createBudgetPool({}, 0)
    const admitted = pool.reserve({ maxTokens: 0, maxIterations: 0 })
    if (!admitted.ok) throw new Error('zero ceiling refused')
    expect(admitted.ticket.reserved).toMatchObject({ tokens: 0, iterations: 0 })
    expect(pool.reconcile(admitted.ticket, spend(1, 1))).toEqual({
      overspent: [
        { channel: 'tokens', reserved: 0, spent: 1 },
        { channel: 'iterations', reserved: 0, spent: 1 },
      ],
    })
    pool.assertNoOpenTickets()
    expect(pool.readout()).toMatchObject({ tokensCapped: false, committedTokens: 1, tokensLeft: 0 })
    expect(
      createBudgetPool({ maxTokens: 0, maxIterations: 0 }, 0).reserve({ maxTokens: 1 }),
    ).toMatchObject({ ok: false })
  })

  it('restores unknown work without minting capacity or inventing an absent ceiling', () => {
    const restore = { committed: spend(2, 1), uncertainReservations: [{}] }
    const capped = createBudgetPool({ maxTokens: 10, maxIterations: 5 }, 0, restore)
    expect(capped.readout()).toMatchObject({
      tokensCapped: true,
      iterationsCapped: true,
      tokensKnown: false,
      tokensLeft: 0,
      iterationsLeft: 0,
      committedTokens: 10,
    })
    expect(capped.reserve({ maxTokens: 1 })).toMatchObject({ ok: false })
    const uncapped = createBudgetPool({}, 0, restore)
    expect(uncapped.readout()).toMatchObject({
      tokensCapped: false,
      iterationsCapped: false,
      tokensKnown: false,
      tokensLeft: 0,
      iterationsLeft: 0,
      reservedTokens: 0,
      committedTokens: 2,
    })
    const next = uncapped.reserve({})
    if (!next.ok) throw new Error('uncapped restored run refused')
    expect(uncapped.reconcile(next.ticket, spend(3, 2))).toBeUndefined()
    uncapped.assertNoOpenTickets()
    expect(uncapped.readout()).toMatchObject({ committedTokens: 5, tokensKnown: false })
  })
})
