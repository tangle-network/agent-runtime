import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { driverChild, driverExecutorFactory } from '../../src/runtime/supervise/driver-executor'
import {
  RetainedExecutionPendingError,
  registerRetainedExecutorPreparation,
} from '../../src/runtime/supervise/retained-executor'
import { createInMemoryRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, AgentSpec, ExecutorFactory } from '../../src/runtime/supervise/types'
import { testAgentProfile } from './test-agent-profile'

it.each(['complete', 'exhaust', 'cancel'] as const)(
  'recovers budget-queued managers with outcome %s without blocking the parent or duplicating work',
  async (outcome) => {
    const context = createInMemoryRunContext({ withDriver: true })
    let recovering = false
    let release!: () => void
    const parentOpened = new Promise<void>((resolve) => {
      release = resolve
    })
    const recovered: string[] = []
    const fresh: string[] = []
    let recoveryFactory: ExecutorFactory<unknown>
    const manager = (name: string): Agent<unknown, unknown> =>
      driverChild(
        testAgentProfile(name),
        {
          name,
          async act(_task, scope) {
            if (!recovering) {
              fresh.push(name)
              throw new RetainedExecutionPendingError(new Error('retained observation unavailable'))
            }
            recovered.push(name)
            if (name === 'first') await parentOpened
            await scope.meter({
              iterations: 1,
              tokens: { input: outcome === 'exhaust' && name === 'first' ? 8 : 1, output: 0 },
              usd: 0,
              ms: 1,
            })
            return name
          },
        },
        context.journal,
        undefined,
        undefined,
        recoveryFactory,
      )
    recoveryFactory = registerRetainedExecutorPreparation(
      () => {
        throw new Error('no leaf should execute')
      },
      ({ profile }) => ({
        spec: (manager(profile.name!) as Agent<unknown, unknown> & { executorSpec: AgentSpec })
          .executorSpec,
        factory: driverExecutorFactory,
      }),
    )
    const common = {
      ...context,
      runId: 'root',
      budget: { maxIterations: 10, maxTokens: 10 },
      workerSlots: 1,
      rootIdentity: {
        profileDigest: canonicalCandidateDigest({ name: 'root' }),
        taskDigest: canonicalCandidateDigest('task'),
      },
    }
    await createSupervisor<string, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          for (const name of ['first', 'second']) {
            const child = scope.spawn(manager(name), 'same task', {
              key: name,
              budget: { maxIterations: 4, maxTokens: 8 },
            })
            expect(child.ok).toBe(true)
            expect((await scope.next())?.kind).toBe('down')
          }
        },
      },
      'task',
      common,
    )
    expect(fresh).toEqual(['first', 'second'])
    const before = (await context.journal.loadTree('root'))!
    expect(before.filter((e) => e.kind === 'reconciled')).toHaveLength(2)
    expect(before.filter((e) => e.kind === 'settled')).toHaveLength(0)
    recovering = true
    let parentActed = false
    const abort = new AbortController()
    const cutoff = setTimeout(() => {
      if (!parentActed) abort.abort(new Error('budget recovery blocked parent'))
      release()
    }, 1_000)
    try {
      const result = await createSupervisor<string, unknown>().run(
        {
          name: 'root',
          async act(_task, scope) {
            parentActed = true
            expect(scope.budget.reservedTokens).toBe(8)
            expect(scope.budget.tokensLeft).toBe(2)
            expect(scope.view.nodes.filter((n) => n.id !== 'root')).toHaveLength(2)
            expect(scope.view.nodes.find((n) => n.id === 'root:s1')?.status).toBe('queued')
            expect(
              scope.spawn(manager('first'), 'same task', {
                key: 'first',
                budget: { maxIterations: 4, maxTokens: 8 },
              }),
            ).toMatchObject({ ok: false, reason: 'duplicate-key' })
            let factories = 0
            expect(
              scope.spawn(
                () => {
                  factories++
                  return manager('duplicate')
                },
                'other',
                {
                  key: 'too-large',
                  budget: { maxIterations: 1, maxTokens: 11 },
                },
              ),
            ).toMatchObject({ ok: false, reason: 'budget-exhausted' })
            expect(factories).toBe(0)
            if (outcome === 'cancel') {
              abort.abort('operator cancelled recovery')
              release()
              return undefined
            }
            release()
            const outputs: unknown[] = []
            for (let next = await scope.next(); next; next = await scope.next()) {
              if (outcome === 'exhaust' && next.handle.id === 'root:s1') {
                expect(next.kind).toBe('down')
                if (next.kind === 'down') expect(next.reason).toContain('budget-exhausted')
              } else {
                expect(next.kind).toBe('done')
                if (next.kind === 'done') outputs.push(next.out)
              }
            }
            expect(outputs.sort()).toEqual(outcome === 'complete' ? ['first', 'second'] : ['first'])
            return outputs
          },
        },
        'task',
        { ...common, resume: true, recoverExecutor: recoveryFactory, signal: abort.signal },
      )
      expect(parentActed, result.kind === 'no-winner' ? result.reason : result.kind).toBe(true)
      expect(abort.signal.aborted).toBe(outcome === 'cancel')
      if (outcome === 'cancel')
        expect(result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
      else expect(result.kind).toBe('winner')
      expect(recovered).toEqual(outcome === 'complete' ? ['first', 'second'] : ['first'])
      expect(fresh).toEqual(['first', 'second'])
      expect(result.spentTotal.tokens.input).toBe(
        outcome === 'complete' ? 2 : outcome === 'exhaust' ? 8 : 0,
      )
      const after = (await context.journal.loadTree('root'))!
      expect(after.filter((e) => e.kind === 'spawned' && e.parent === 'root')).toHaveLength(2)
      expect(after.slice(0, before.length)).toEqual(before)
      expect(after.filter((e) => e.kind === 'settled')).toHaveLength(
        outcome === 'complete' ? 2 : outcome === 'exhaust' ? 1 : 0,
      )
    } finally {
      clearTimeout(cutoff)
      release()
      abort.abort()
    }
  },
)
