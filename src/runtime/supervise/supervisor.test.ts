import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { createExecutorRegistry } from './runtime'
import { createSupervisor } from './supervisor'
import type { Agent, Scope, Spend, SupervisorOpts } from './types'

/** A supervisor wired to in-memory durability with a frozen clock — no network, no sandbox. The
 *  cases below never spawn a child, which is the exact production shape under test: the driver
 *  failed before the tree existed. */
function supervisorOpts(over: Partial<SupervisorOpts> = {}): SupervisorOpts {
  return {
    budget: over.budget ?? { maxIterations: 10, maxTokens: 1000 },
    runId: over.runId ?? 'driver-failure',
    journal: over.journal ?? new InMemorySpawnJournal(),
    blobs: over.blobs ?? new InMemoryResultBlobStore(),
    executors: over.executors ?? createExecutorRegistry(),
    now: over.now ?? (() => 0),
    ...(over.signal !== undefined ? { signal: over.signal } : {}),
  }
}

function spend(input: number, output: number): Spend {
  return { iterations: 1, tokens: { input, output }, usd: 0, ms: 0 }
}

/** A driver whose `act` runs `body` — the unit of behavior every case varies. */
function driver(body: (scope: Scope<unknown>) => Promise<unknown>): Agent<unknown, unknown> {
  return {
    name: 'driver',
    act: (_task, scope: Scope<unknown>) => body(scope),
  }
}

describe('supervisor: the driver rejection survives onto the typed no-winner', () => {
  it('carries the rejection and names a driver failure when no child ever went down', async () => {
    // The real production shape: a misconfigured run that dies before the tree exists.
    const fault = new ValidationError('executors: no executor registered for runtime "router"')
    const supervisor = createSupervisor<unknown, unknown>()
    const result = await supervisor.run(
      driver(async () => {
        throw fault
      }),
      'task',
      supervisorOpts(),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // The pre-fix result was `all-children-down` with `downCount: 0` — a configuration fault
    // wearing the costume of an honest empty tree.
    expect(result.reason).toBe('driver-failed')
    expect(result.downCount).toBe(0)
    // Narrowing on the discriminant is the guarantee under test: on this arm `error` is REQUIRED,
    // so the accesses below compile with no `?.` and no non-null assertion. If the union ever
    // reverts to a flat `error?`, this block stops compiling — the type IS the test.
    if (result.reason !== 'driver-failed') return
    // Compared against the thrown instance so the assertion proves transport, not upstream naming.
    expect(result.error).toEqual({
      name: fault.name,
      message: 'executors: no executor registered for runtime "router"',
      stack: fault.stack,
    })
    expect(result.error.stack).toContain(fault.message)
  })

  it('keeps `all-children-down` and carries no error when the driver returned undefined', async () => {
    const supervisor = createSupervisor<unknown, unknown>()
    const result = await supervisor.run(
      driver(async () => undefined),
      'task',
      supervisorOpts(),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // A driver that ran to completion and selected nothing is an honest empty result: the
    // existing reason, and nothing to recover from.
    expect(result.reason).toBe('all-children-down')
    expect(result.error).toBeUndefined()
    expect('error' in result).toBe(false)
  })

  it('still reports the budget reason when the driver throws AFTER exhausting the pool', async () => {
    const supervisor = createSupervisor<unknown, unknown>()
    const result = await supervisor.run(
      driver(async (scope) => {
        // Real exhaustion, not a zero-budget stub: the driver meters its own inference past the
        // ceiling, then fails the way a driver fails once it has nothing left to spend.
        await scope.meter(spend(900, 200))
        throw new ValidationError('driver: out of budget mid-plan')
      }),
      'task',
      supervisorOpts({ budget: { maxIterations: 10, maxTokens: 1000 } }),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // Budget exhaustion is the more specific explanation of the same rejection, so it outranks
    // `driver-failed` — the precedence order the classifier documents.
    expect(result.reason).toBe('budget-exhausted')
    // A lifecycle arm carries no `error`: the empty pool, not the throw, is the explanation, and
    // the union types that away (`error?: never`) rather than promising it in prose.
    expect('error' in result).toBe(false)
    expect(result.error).toBeUndefined()
    expect(result.spentTotal.tokens.input).toBe(900)
  })

  it('still reports `aborted` when the driver throws after a caller abort', async () => {
    const controller = new AbortController()
    const supervisor = createSupervisor<unknown, unknown>()
    const result = await supervisor.run(
      driver(async () => {
        controller.abort('caller cancel')
        throw new ValidationError('driver: observed cancellation')
      }),
      'task',
      supervisorOpts({ signal: controller.signal }),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    expect(result.reason).toBe('aborted')
    // Same rule as the budget arm: the abort outranks the throw, and an outranked rejection is
    // not smuggled back as `error`.
    expect('error' in result).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('normalizes a non-Error rejection rather than dropping it', async () => {
    const supervisor = createSupervisor<unknown, unknown>()
    const result = await supervisor.run(
      driver(async () => {
        // Legal, and exactly the authoring bug that used to vanish without a trace.
        const fault: unknown = { code: 'ENOENT', path: '/no/such/profile.json' }
        throw fault
      }),
      'task',
      supervisorOpts(),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    expect(result.reason).toBe('driver-failed')
    if (result.reason !== 'driver-failed') return
    expect(result.error.name).toBe('NonError')
    expect(result.error.message).toContain('ENOENT')
    expect(result.error.stack).toBeUndefined()
  })

  it('distinguishes `throw undefined` from a driver that never threw', async () => {
    const supervisor = createSupervisor<unknown, unknown>()
    const result = await supervisor.run(
      driver(async () => {
        const nothing: unknown = undefined
        throw nothing
      }),
      'task',
      supervisorOpts(),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // The undefined rejection value must not read as "no rejection" — that collapse is what the
    // `DriverRejection` wrapper exists to prevent.
    expect(result.reason).toBe('driver-failed')
    expect(result.error).toEqual({ name: 'NonError', message: 'undefined' })
  })
})
