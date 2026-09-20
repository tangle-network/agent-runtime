import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  replaySpawnTree,
} from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import { runDriverWithRetry } from './driver-retry'
import { RetainedExecutionPendingError } from './retained-executor'
import { createExecutorRegistry } from './runtime'
import { createRootHandle, createSupervisor } from './supervisor'
import type {
  Agent,
  AgentSpec,
  ExecutorResult,
  Scope,
  SpawnEvent,
  Spend,
  SupervisorOpts,
} from './types'

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
  it('persists the SDK HTTP status through retained wrappers and retry exhaustion', async () => {
    const fault = Object.assign(new Error('GET /v1/backends: Unknown error'), { status: 403 })
    const result = await createSupervisor().run(
      driver(async (scope) =>
        runDriverWithRetry({
          drive: async () => {
            throw new RetainedExecutionPendingError(fault)
          },
          progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
          budget: () => scope.budget,
          signal: scope.signal,
          policy: { enabled: false },
        }),
      ),
      'task',
      supervisorOpts(),
    )
    const persisted = JSON.parse(JSON.stringify(result))
    expect(persisted.reason).toBe('driver-failed')
    expect(persisted.error.message).toContain('HTTP 403')
    expect(persisted.error.message).toContain('GET /v1/backends: Unknown error')
  })

  it.each(['Bearer fixture-status-secret', 99, 600, 403.5, Number.NaN])(
    'does not export a non-HTTP status value: %s',
    async (status) => {
      const fault = Object.assign(new Error('provider failure'), { status })
      const result = await createSupervisor().run(
        driver(async () => {
          throw fault
        }),
        'task',
        supervisorOpts(),
      )
      const persisted = JSON.parse(JSON.stringify(result))
      expect(persisted.reason).toBe('driver-failed')
      expect(persisted.error.message).toBe('provider failure')
      expect(JSON.stringify(persisted.error)).not.toContain('fixture-status-secret')
    },
  )

  it('ignores an unreadable HTTP status without replacing the original failure', async () => {
    const fault = new Error('original failure')
    Object.defineProperty(fault, 'status', {
      get() {
        throw new Error('unreadable status')
      },
    })
    const result = await createSupervisor().run(
      driver(async () => {
        throw fault
      }),
      'task',
      supervisorOpts(),
    )
    const persisted = JSON.parse(JSON.stringify(result))
    expect(persisted.reason).toBe('driver-failed')
    expect(persisted.error.message).toBe('original failure')
  })

  it('keeps the typed settlement when a proxy cause refuses its prototype', async () => {
    const cause = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('unreadable prototype')
        },
      },
    )
    const fault = new Error('original provider failure', { cause })
    const result = await createSupervisor().run(
      driver(async () => {
        throw fault
      }),
      'task',
      supervisorOpts(),
    )
    const persisted = JSON.parse(JSON.stringify(result))
    expect(persisted.reason).toBe('driver-failed')
    expect(persisted.error.message).toContain('original provider failure')
    expect(persisted.error.message).toContain('[unreadable error cause]')
  })

  it.each([false, true])(
    'persists first and last causes through retries with a long first wrapper: %s',
    async (longFirst) => {
      const faults = [
        longFirst
          ? new Error('wrapper'.repeat(1_000), { cause: new Error('original admission rejected') })
          : new RetainedExecutionPendingError(new Error('original admission rejected')),
        new RetainedExecutionPendingError(
          new Error(`later reconciliation failed ${'detail '.repeat(1_000)}`),
        ),
      ]
      let attempts = 0
      const result = await createSupervisor().run(
        driver(async (scope) =>
          runDriverWithRetry({
            drive: async () => {
              throw faults[attempts++]
            },
            progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
            budget: () => scope.budget,
            signal: scope.signal,
            policy: { maxAttempts: 2 },
            sleep: async () => {},
          }),
        ),
        'task',
        supervisorOpts(),
      )
      const persisted = JSON.parse(JSON.stringify(result))
      expect(persisted.reason).toBe('driver-failed')
      expect(persisted.error.message).toContain('original admission rejected')
      expect(persisted.error.message).toContain('later reconciliation failed')
      expect(attempts).toBe(2)
    },
  )

  it('redacts error names and tolerates throwing error properties', async () => {
    for (const field of ['name', 'message', 'stack'] as const) {
      const fault = new Error('provider rejected')
      fault.name = 'Bearer fixture-name-secret'
      Object.defineProperty(fault, field, {
        get() {
          throw new Error('unreadable')
        },
      })
      const result = await createSupervisor().run(
        driver(async () => {
          throw fault
        }),
        'task',
        supervisorOpts(),
      )
      const persisted = JSON.parse(JSON.stringify(result))
      expect(persisted.reason).toBe('driver-failed')
      expect(JSON.stringify(persisted.error)).not.toContain('fixture-name-secret')
      expect(JSON.stringify(persisted.error)).toContain(`[unreadable error ${field}]`)
    }
  })

  it('keeps a retained provider cause through JSON without exposing a bearer credential', async () => {
    const fault = new RetainedExecutionPendingError(
      new Error('backend attachments unavailable; Authorization: Bearer fixture-secret-value'),
    )
    const result = await createSupervisor().run(
      driver(async () => {
        throw fault
      }),
      'task',
      supervisorOpts(),
    )
    const persisted = JSON.parse(JSON.stringify(result))
    expect(persisted.reason).toBe('driver-failed')
    expect(persisted.error.message).toContain('backend attachments unavailable')
    expect(JSON.stringify(persisted.error)).not.toContain('fixture-secret-value')
  })

  it('bounds a cyclic provider cause without changing the driver failure verdict', async () => {
    const fault = new Error('provider failure')
    fault.cause = fault
    const result = await createSupervisor().run(
      driver(async () => {
        throw fault
      }),
      'task',
      supervisorOpts(),
    )
    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner' || result.reason !== 'driver-failed') return
    expect(result.error.message).toContain('[circular]')
    expect(result.error.message.length).toBeLessThan(1024)
  })

  it('retains a nested cause after a long outer message and tolerates an unreadable cause', async () => {
    const original = new Error('original create refusal')
    Object.defineProperty(original, 'cause', {
      get() {
        throw new Error('unreadable')
      },
    })
    const fault = new Error('wrapper'.repeat(5_000), { cause: original })
    const result = await createSupervisor().run(
      driver(async () => {
        throw fault
      }),
      'task',
      supervisorOpts(),
    )
    if (result.kind !== 'no-winner' || result.reason !== 'driver-failed')
      throw new Error('wrong verdict')
    expect(result.error.message).toContain('original create refusal')
    expect(result.error.message).toContain('[unreadable error cause]')
    expect(result.error.message.length).toBeLessThan(16_384)
  })

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

  it('settles `no-children-spawned`, not `all-children-down`, when the driver returned undefined without spawning', async () => {
    const supervisor = createSupervisor<unknown, unknown>()
    const result = await supervisor.run(
      driver(async () => undefined),
      'task',
      supervisorOpts(),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // A driver that ran to completion, spawned nothing and selected nothing is an honest empty
    // result — but it is not a fleet failure, and the reason must not say it was.
    expect(result.reason).toBe('no-children-spawned')
    expect(result.fleetYield.spawned).toBe(0)
    expect(result.downCount).toBe(0)
    expect(result.error).toBeUndefined()
    expect('error' in result).toBe(false)
  })

  // A leaf whose executor is supplied inline: no provider, no sandbox, one `execute` that
  // answers with the artifact or the failure envelope the case needs. `harness: null` with an
  // `executor` routes through the registry's BYO arm.
  const leafProfile: AgentProfile = {
    name: 'leaf',
    harness: 'claude-code',
    model: { provider: 'fixture', default: 'fixture/model' },
  }
  function leaf(
    name: string,
    result: Partial<ExecutorResult<unknown>> & Pick<ExecutorResult<unknown>, 'out'>,
  ): Agent<unknown, unknown> {
    return {
      name,
      act: async () => undefined,
      executorSpec: {
        profile: { ...leafProfile, name },
        harness: null,
        executor: {
          runtime: 'router',
          execute: async () => ({ outRef: `byo:${name}`, spent: spend(1, 1), ...result }),
          resultArtifact: () => ({ outRef: `byo:${name}`, spent: spend(1, 1), ...result }),
          teardown: async () => ({ destroyed: true }),
        },
      },
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
  }
  const settlements = async (journal: InMemorySpawnJournal, runId: string) =>
    ((await journal.loadTree(runId)) ?? []).filter(
      (event): event is Extract<SpawnEvent, { kind: 'settled' }> => event.kind === 'settled',
    )

  it('settles `no-result-selected`, not `all-children-down`, when every child delivered and the root chose nothing', async () => {
    const journal = new InMemorySpawnJournal()
    const result = await createSupervisor<unknown, unknown>().run(
      driver(async (scope) => {
        for (const name of ['first', 'second']) {
          const spawned = scope.spawn(leaf(name, { out: `${name} banked` }), 'task', {
            label: name,
            budget: { maxIterations: 2, maxTokens: 100 },
          })
          if (!spawned.ok) throw new Error(spawned.reason)
        }
        while ((await scope.next()) !== null) {
          // drain every settlement, then select nothing
        }
        return undefined
      }),
      'task',
      supervisorOpts({ journal, runId: 'delivered-but-unselected' }),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // The 2026-09-20 corpus: 46 of 57 `all-children-down` runs had zero down children. The
    // label must name the root's choice, not a fleet failure that did not happen.
    expect(result.reason).toBe('no-result-selected')
    expect(result.downCount).toBe(0)
    expect(result.fleetYield).toMatchObject({ spawned: 2, done: 2, down: 0 })
    expect((await settlements(journal, 'delivered-but-unselected')).map((s) => s.status)).toEqual([
      'done',
      'done',
    ])
  })

  it('keeps one down child among delivered siblings on `downCount`, not in the reason', async () => {
    const restart =
      'Execution interrupted: the agent runtime restarted before the run produced a terminal event'
    const journal = new InMemorySpawnJournal()
    const result = await createSupervisor<unknown, unknown>().run(
      driver(async (scope) => {
        const children = [
          leaf('delivered', { out: 'banked' }),
          leaf('lost', { out: '', outcome: { success: false, error: restart } }),
        ]
        for (const child of children) {
          const spawned = scope.spawn(child, 'task', {
            label: child.name,
            budget: { maxIterations: 2, maxTokens: 100 },
          })
          if (!spawned.ok) throw new Error(spawned.reason)
        }
        while ((await scope.next()) !== null) {
          // drain
        }
        return undefined
      }),
      'task',
      supervisorOpts({ journal, runId: 'one-down-among-delivered' }),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // verified-agency-20260920b: 8 spawned, 6 done, 2 down to a runtime restart, and the run
    // settled `all-children-down`. The one-down-child rule that produced it is gone.
    expect(result.reason).toBe('no-result-selected')
    expect(result.downCount).toBe(1)
    expect(result.fleetYield).toMatchObject({ spawned: 2, done: 1, down: 1 })
  })

  it('settles `all-children-down` when every child failed but the root never read the cursor', async () => {
    // The harness-root shape: a director ends its turn without draining. Each child's failure
    // has resolved (the tree shows `settlementPending: down`) but no settlement was committed,
    // so a status-only count read the whole dead fleet as the root's own choice.
    const handle = createRootHandle<unknown>()
    const supervisor = createSupervisor<unknown, unknown>()
    supervisor.attach(handle)
    const result = await supervisor.run(
      driver(async (scope) => {
        for (const name of ['first', 'second']) {
          const spawned = scope.spawn(
            leaf(name, { out: '', outcome: { success: false, error: 'terminated' } }),
            'task',
            { label: name, budget: { maxIterations: 2, maxTokens: 100 } },
          )
          if (!spawned.ok) throw new Error(spawned.reason)
        }
        for (let waited = 0; waited < 2_000; waited += 5) {
          const children = handle.view().nodes.filter((node) => node.id !== handle.view().root)
          if (
            children.length === 2 &&
            children.every((node) => node.settlementPending !== undefined)
          ) {
            return undefined
          }
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
        throw new Error('children never resolved')
      }),
      'task',
      supervisorOpts({ runId: 'undrained-dead-fleet' }),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    expect(result.reason).toBe('all-children-down')
    expect(result.fleetYield).toMatchObject({ spawned: 2, done: 0, down: 2 })
  })

  it('lets a driver rejection through when one child is down and another delivered', async () => {
    // verified-agency-20260920b, the hour this was written: the root's sandbox sidecar died to
    // host capacity (503 SIDECAR_RESTART_FAILED, six identical attempts), the driver threw, and
    // the run settled `all-children-down` with no error field because two of its eight children
    // were down and that rule outranked the rejection. The platform death of the root was erased.
    const fault = new ValidationError(
      'driver failed after 6 attempts: Sidecar is unhealthy and restart failed: Host capacity',
    )
    const result = await createSupervisor<unknown, unknown>().run(
      driver(async (scope) => {
        const children = [
          leaf('delivered', { out: 'banked' }),
          leaf('lost', { out: '', outcome: { success: false, error: 'terminated' } }),
        ]
        for (const child of children) {
          const spawned = scope.spawn(child, 'task', {
            label: child.name,
            budget: { maxIterations: 2, maxTokens: 100 },
          })
          if (!spawned.ok) throw new Error(spawned.reason)
        }
        while ((await scope.next()) !== null) {
          // drain
        }
        throw fault
      }),
      'task',
      supervisorOpts({ runId: 'root-died-with-one-child-down' }),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    expect(result.reason).toBe('driver-failed')
    expect(result.downCount).toBe(1)
    if (result.reason !== 'driver-failed') return
    expect(result.error.message).toContain('Host capacity')
  })

  it('still settles `all-children-down` when every child went down before the root settled', async () => {
    const result = await createSupervisor<unknown, unknown>().run(
      driver(async (scope) => {
        for (const name of ['first', 'second']) {
          const spawned = scope.spawn(
            leaf(name, { out: '', outcome: { success: false, error: 'terminated' } }),
            'task',
            { label: name, budget: { maxIterations: 2, maxTokens: 100 } },
          )
          if (!spawned.ok) throw new Error(spawned.reason)
        }
        while ((await scope.next()) !== null) {
          // drain
        }
        return undefined
      }),
      'task',
      supervisorOpts({ runId: 'every-child-down' }),
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    expect(result.reason).toBe('all-children-down')
    expect(result.downCount).toBe(2)
    expect(result.fleetYield).toMatchObject({ spawned: 2, done: 0, down: 2 })
  })

  it('stamps `infra` from the executor envelope: true for the platform vocabulary, absent when unattributable', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    await createSupervisor<unknown, unknown>().run(
      driver(async (scope) => {
        const children = [
          leaf('platform', {
            out: '',
            outcome: {
              success: false,
              error:
                'Execution interrupted: the agent runtime restarted before the run produced a terminal event',
            },
          }),
          leaf('quota', {
            out: '',
            outcome: {
              success: false,
              error: 'the Sandbox interactive status failed',
              errorCode: 'QUOTA_EXCEEDED',
            },
          }),
          leaf('unattributed', {
            out: '',
            outcome: {
              success: false,
              error: 'claude-code execution failed: Process exited with code 1',
            },
          }),
        ]
        for (const child of children) {
          const spawned = scope.spawn(child, 'task', {
            label: child.name,
            budget: { maxIterations: 2, maxTokens: 100 },
          })
          if (!spawned.ok) throw new Error(spawned.reason)
        }
        while ((await scope.next()) !== null) {
          // drain
        }
        return undefined
      }),
      'task',
      supervisorOpts({ journal, blobs, runId: 'envelope-infra' }),
    )

    const settled = await settlements(journal, 'envelope-infra')
    const byLabel = (suffix: string) => settled.find((event) => event.id.endsWith(suffix))
    // Until 2026-09-20 every one of these carried `infra: false`; the flag caught 1 of 78
    // platform losses on the fleet corpus.
    expect(byLabel(':s0')).toMatchObject({ status: 'down', infra: true })
    expect(byLabel(':s1')).toMatchObject({ status: 'down', infra: true })
    const unattributed = byLabel(':s2')
    expect(unattributed).toMatchObject({ status: 'down' })
    expect(unattributed).not.toHaveProperty('infra')

    // Replay carries the same claims: the absent flag used to come back as `false` here, so a
    // resumed driver and every tree view saw a verdict the live run never made.
    const replayed = await replaySpawnTree(journal, blobs, 'envelope-infra')
    const replayedById = (suffix: string) => replayed.find((s) => s.handle.id.endsWith(suffix))
    expect(replayedById(':s0')).toMatchObject({ kind: 'down', infra: true })
    expect(replayedById(':s2')).toMatchObject({ kind: 'down' })
    expect(replayedById(':s2')).not.toHaveProperty('infra')
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

  it('reports `cancelled` when the driver throws after a caller abort', async () => {
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
    expect(result.reason).toBe('cancelled')
    // Same rule as the budget arm: the abort outranks the throw, and an outranked rejection is
    // not smuggled back as `error`.
    expect('error' in result).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('preserves cancellation when a deadline passes before settlement', async () => {
    const controller = new AbortController()
    let clock = 1
    const result = await createSupervisor().run(
      driver(async () => {
        controller.abort('operator stop')
        clock = 100
        throw new Error('cancelled')
      }),
      'task',
      supervisorOpts({
        signal: controller.signal,
        now: () => clock,
        budget: { maxIterations: 10, maxTokens: 1000, deadlineMs: 50 },
      }),
    )
    expect(result).toMatchObject({
      reason: 'cancelled',
      source: 'signal',
      cancellationReason: 'operator stop',
    })
  })

  it('carries an Error abort reason onto the cancellation it settles', async () => {
    const controller = new AbortController()
    const result = await createSupervisor().run(
      driver(async () => {
        controller.abort(new Error('operator closed the session'))
        return new Promise(() => {})
      }),
      'task',
      supervisorOpts({ signal: controller.signal }),
    )
    expect(result).toMatchObject({
      reason: 'cancelled',
      source: 'signal',
      cancellationReason: 'operator closed the session',
    })
  })

  it('keeps the generic reason for a reasonless caller abort', async () => {
    const controller = new AbortController()
    const result = await createSupervisor().run(
      driver(async () => {
        controller.abort()
        return new Promise(() => {})
      }),
      'task',
      supervisorOpts({ signal: controller.signal }),
    )
    // A bare `abort()` sets a platform `AbortError` whose message names nothing; that is not
    // promoted over the supervisor's own text.
    expect(result).toMatchObject({
      reason: 'cancelled',
      source: 'signal',
      cancellationReason: 'caller signal aborted',
    })
  })

  it('preserves a deadline that wins before cancellation', async () => {
    const controller = new AbortController()
    const result = await createSupervisor().run(
      driver(async (scope) => {
        scope.signal.addEventListener('abort', () => controller.abort('too late'), { once: true })
        return new Promise(() => {})
      }),
      'task',
      supervisorOpts({
        signal: controller.signal,
        now: Date.now,
        budget: { maxIterations: 10, maxTokens: 1000, deadlineMs: 10 },
      }),
    )
    expect(result).toMatchObject({ reason: 'budget-exhausted' })
  })

  it('names an explicit root handle cancellation', async () => {
    const handle = createRootHandle()
    const supervisor = createSupervisor()
    supervisor.attach(handle)
    const result = await supervisor.run(
      driver(async () => {
        handle.abort('operator stop')
        return new Promise(() => {})
      }),
      'task',
      supervisorOpts(),
    )
    expect(result).toMatchObject({
      reason: 'cancelled',
      source: 'root-handle',
      cancellationReason: 'operator stop',
    })
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
