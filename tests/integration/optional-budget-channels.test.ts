import { describe, expect, it } from 'vitest'
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
      { ...context, runId: 'uncapped-root', budget: {}, workerSlots: 0 },
    )
    expect(entered).toBe(8)
    expect(result.spentTotal).toMatchObject({ tokens: { input: 8 }, iterations: 8 })
  }, 10_000)

  it.each([false, true])(
    'persists child ceiling violations through real nested execution (zero=%s)',
    async (zero) => {
      const context = createInMemoryRunContext({ withDriver: true })
      const runId = zero ? 'zero-child-cap' : 'mixed-caps'
      const observed = spend(zero ? 1 : 4, zero ? 1 : 7)
      const overspent = zero
        ? [
            { channel: 'tokens', reserved: 0, spent: 1 },
            { channel: 'iterations', reserved: 0, spent: 1 },
          ]
        : [{ channel: 'iterations', reserved: 1, spent: 7 }]
      const worker = driverChild(
        testAgentProfile('metered-worker'),
        {
          name: 'metered-worker',
          async act(task, scope) {
            await scope.meter(observed)
            return task
          },
        },
        context.journal,
      )
      const result = await createSupervisor<unknown, unknown>().run(
        {
          name: 'root',
          async act(task, scope) {
            expect(
              scope.spawn(worker, task, {
                budget: zero
                  ? { maxTokens: 0, maxIterations: 0 }
                  : { maxTokens: 6, maxIterations: 1 },
              }).ok,
            ).toBe(true)
            expect(scope.budget).toMatchObject({
              tokensCapped: !zero,
              iterationsCapped: false,
              reservedTokens: zero ? 0 : 6,
            })
            if (!zero) {
              expect(scope.spawn(worker, task, { budget: { maxTokens: 11 } })).toMatchObject({
                ok: false,
                reason: 'budget-exhausted',
              })
            }
            expect(await scope.next()).toMatchObject({ budgetViolation: { overspent } })
            expect(scope.budget).toMatchObject({
              tokensLeft: zero ? 0 : 6,
              reservedTokens: 0,
              committedTokens: observed.tokens.input,
            })
            return task
          },
        },
        'done',
        { ...context, runId, budget: zero ? {} : { maxTokens: 10 }, workerSlots: 0 },
      )
      const events = await context.journal.loadTree(runId)
      expect(events?.find((event) => event.kind === 'settled')).toMatchObject({
        budgetViolation: { overspent },
      })
      expect(result.spentTotal).toMatchObject({
        tokens: { input: observed.tokens.input },
        iterations: observed.iterations,
      })
      expect(result.fleetYield).toMatchObject({ spawned: 1, done: 1 })
    },
  )
})
