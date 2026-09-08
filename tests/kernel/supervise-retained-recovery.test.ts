import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { providerAsExecutor } from '../../src/runtime/environment-provider'
import {
  type RetainedExecutorContext,
  retainedExecutorSeamKey,
} from '../../src/runtime/supervise/retained-executor'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, ExecutorFactory, Scope, SpawnEvent } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from './test-agent-profile'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('supervised retained provider recovery', () => {
  it('reconnects a dispatched child after lost local acknowledgement without another dispatch', async () => {
    const fixture = await setup('dispatched')
    await fixture.first()
    const before = (await fixture.context.journal.loadTree('root')) ?? []
    expect(
      before.some(
        (event) => event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
      ),
    ).toBe(true)
    expect(before.some((event) => event.kind === 'settled')).toBe(false)
    const result = await fixture.resume()
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toBe('durable result')
    expect(fixture.dispatches()).toBe(1)
    const after = (await fixture.context.journal.loadTree('root')) ?? []
    expect(
      after.filter((event) => event.kind === 'settled' && event.id === 'root:s0'),
    ).toMatchObject([{ status: 'done', spent: { iterations: 1, tokens: { input: 3, output: 2 } } }])
    expect(fixture.creations()).toBe(1)
    expect(fixture.resumeBudget()).toBe(95)
  })

  it('dispatches the original keyed request after a crash before dispatch', async () => {
    const fixture = await setup('environment')
    await fixture.first()
    const before = JSON.parse(await readFile(fixture.stateFile, 'utf8'))
    expect(
      Object.values(before.environments).map((env) =>
        Object.keys((env as { sessions: object }).sessions),
      ),
    ).toEqual([[]])
    const result = await fixture.resume()
    expect(result.kind).toBe('winner')
    expect(fixture.dispatches()).toBe(1)
    expect(fixture.resumeBudget()).toBe(95)
  })

  it('refuses changed replay material before reconnecting an existing execution', async () => {
    const fixture = await setup('dispatched')
    await fixture.first()
    const result = await fixture.resume(
      providerAsExecutor(fixture.provider(), {
        taskToTurn: () => ({ prompt: 'changed task' }),
      }),
    )
    expect(result.kind).toBe('no-winner')
    expect(fixture.creations()).toBe(1)
  })

  it('drains recovered child writes before returning the resumed parent failure', async () => {
    const fixture = await setup('environment', false, 2)
    await fixture.first()
    const started = deferred()
    const release = deferred()
    const cause = new Error('first recovery failed')
    let writerFinished = false
    let returned = false
    let retained: RetainedExecutorContext | undefined
    const journal = fixture.context.journal
    const factory = providerAsExecutor(fixture.provider(), { destroyOnSettle: false })
    const recovery: ExecutorFactory<unknown> = (spec, ctx) => {
      const executor = factory(spec, ctx)
      if (ctx.node?.nodeId === 'root:s0') {
        return {
          ...executor,
          recover: async () => {
            await started.promise
            throw cause
          },
        }
      }
      retained = ctx.seams[retainedExecutorSeamKey] as RetainedExecutorContext
      return executor
    }
    const outcome = fixture
      .run(
        async () => {
          await started.promise
          throw cause
        },
        recovery,
        {
          beginTree: journal.beginTree.bind(journal),
          loadTree: journal.loadTree.bind(journal),
          appendEvent: async (root, event) => {
            if (
              event.kind === 'execution-admitted' &&
              event.id === 'root:s1' &&
              event.admission.phase === 'dispatched'
            ) {
              started.resolve()
              await release.promise
              await journal.appendEvent(root, event)
              writerFinished = true
            } else {
              await journal.appendEvent(root, event)
            }
          },
        },
      )
      .then(
        (result) => {
          returned = true
          return result
        },
        (error) => {
          returned = true
          return error
        },
      )
    await started.promise
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(returned).toBe(false)
    release.resolve()
    expect(await outcome).toMatchObject({ kind: 'no-winner', error: { message: cause.message } })
    expect(writerFinished).toBe(true)
    const events = await journal.loadTree('root')
    await expect(
      Promise.resolve().then(() => retained!.onAdmission(retained!.admissions[0]!)),
    ).rejects.toBeDefined()
    expect(await journal.loadTree('root')).toEqual(events)
    expect(events?.some((event) => event.kind === 'execution-result')).toBe(false)
  })

  it('reuses accepted output after environment deletion when cursor settlement was interrupted', async () => {
    const fixture = await setup('settled', true)
    await fixture.first()
    expect(JSON.parse(await readFile(fixture.stateFile, 'utf8')).environments).toEqual({})
    const before = (await fixture.context.journal.loadTree('root')) ?? []
    expect(before.some((event) => event.kind === 'execution-result')).toBe(true)
    expect(before.some((event) => event.kind === 'settled')).toBe(false)
    const result = await fixture.resume(() => {
      throw new Error('completed output must not construct an executor')
    })
    expect(result.kind).toBe('winner')
    expect(fixture.creations()).toBe(1)
  })

  it('keeps an interrupted key in doubt without a configured recovery executor', async () => {
    const fixture = await setup('dispatched')
    await fixture.first()
    let rejection: unknown
    await fixture.run(async (scope) => {
      rejection = scope.spawn(fixture.worker(), 'task', {
        key: 'work',
        label: 'work',
        budget: { maxIterations: 1, maxTokens: 10 },
      })
      return 'inspected'
    })
    expect(rejection).toEqual({ ok: false, reason: 'in-doubt' })
    expect(fixture.creations()).toBe(1)
  })

  it('preserves a saved over-budget result as a failed settlement on replay', async () => {
    const fixture = await setup('settled', true, 1, { inputTokens: 9, outputTokens: 2 })
    await fixture.first()
    await fixture.run(
      async (scope) => {
        expect(scope.resume?.keys.get('work')?.state).toBe('down')
        return 'inspected'
      },
      () => {
        throw new Error('saved output must not recreate an executor')
      },
    )
    const events = (await fixture.context.journal.loadTree('root')) ?? []
    expect(
      events.filter((event) => event.kind === 'settled' && event.id === 'root:s0'),
    ).toMatchObject([{ status: 'down', spent: { tokens: { input: 9, output: 2 } } }])
    expect(fixture.creations()).toBe(1)
  })

  it('rejects a recovery factory bound to a different provider before replacement work', async () => {
    const fixture = await setup('dispatched')
    await fixture.first()
    const foreign = { ...fixture.provider(), name: 'foreign-provider' }
    const result = await fixture.resume(providerAsExecutor(foreign))
    expect(result.kind).toBe('no-winner')
    expect(fixture.creations()).toBe(1)
    const events = (await fixture.context.journal.loadTree('root')) ?? []
    expect(events.some((event) => event.kind === 'settled')).toBe(false)
  })

  it('rejects an extra foreign root before replay can dispatch an admitted child', async () => {
    const fixture = await setup('environment')
    await fixture.first()
    const journal = fixture.context.journal
    const original = (await journal.loadTree('root'))!.find(
      (event) => event.kind === 'spawned' && event.id === 'root',
    )!
    await journal.appendEvent('root', { ...original, id: 'foreign-root' })
    const before = await journal.loadTree('root')
    await expect(fixture.resume()).rejects.toThrow('exactly one root')
    expect(await journal.loadTree('root')).toEqual(before)
    expect(fixture.dispatches()).toBe(0)
    expect(fixture.creations()).toBe(1)
  })
})

async function setup(
  loss: 'environment' | 'dispatched' | 'settled',
  destroyOnSettle = false,
  childCount = 1,
  usage = { inputTokens: 3, outputTokens: 2 },
) {
  const root = await mkdtemp(join(tmpdir(), 'supervise-retained-'))
  roots.push(root)
  const stateFile = join(root, 'provider.json')
  const runDir = join(root, 'run')
  const context = createFileRunContext(runDir)
  let createCount = 0
  let dispatchCount = 0
  let resumedTokens: number | undefined
  const provider = (): AgentEnvironmentProvider => {
    const base = durableRetainedProvider(stateFile)
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      dispatch: async (input) => {
        dispatchCount++
        return environment.dispatch!(input)
      },
      session: (id, options) => {
        const session = environment.session!(id, options)
        return {
          ...session,
          result: async () => ({
            ...(await session.result()),
            usage,
          }),
        }
      },
    })
    return {
      ...base,
      create: async (input) => {
        createCount++
        return wrap(await base.create(input))
      },
      get: async (id) => {
        const environment = await base.get!(id)
        return environment ? wrap(environment) : null
      },
    }
  }
  const profile = testAgentProfile('retained-worker')
  const worker = (): Agent<unknown, unknown> =>
    Object.assign(
      { name: 'retained-worker', act: async () => 'unused' },
      {
        executorSpec: {
          profile,
          harness: profile.harness,
          executorFactory: providerAsExecutor(provider(), { destroyOnSettle }),
        },
      },
    )
  const common = {
    runId: 'root',
    budget: { maxIterations: 10, maxTokens: 100 },
    rootIdentity: {
      profileDigest: canonicalCandidateDigest({ name: 'root-profile' }),
      taskDigest: canonicalCandidateDigest('root-task'),
    },
  }
  const run = (
    act: (scope: Scope<string>) => Promise<string>,
    recoverExecutor?: ExecutorFactory<unknown>,
    journal = context.journal,
  ) =>
    createSupervisor<string, string>().run(
      { name: 'root', act: (_task, scope) => act(scope) },
      'root-task',
      {
        ...createFileRunContext(runDir),
        ...common,
        journal,
        ...(recoverExecutor ? { recoverExecutor } : {}),
      },
    )
  return {
    stateFile,
    context,
    provider,
    worker,
    run,
    creations: () => createCount,
    dispatches: () => dispatchCount,
    resumeBudget: () => resumedTokens,
    first: async () => {
      const injected = new Set<string>()
      const journal = context.journal
      const interrupted = {
        ...context,
        journal: {
          beginTree: journal.beginTree.bind(journal),
          loadTree: journal.loadTree.bind(journal),
          appendEvent: async (id: string, event: SpawnEvent) => {
            if (!injected.has(event.id) && loss === 'settled' && event.kind === 'settled') {
              injected.add(event.id)
              throw new Error('cursor connection lost')
            }
            await journal.appendEvent(id, event)
            if (
              !injected.has(event.id) &&
              loss !== 'settled' &&
              event.kind === 'execution-admitted' &&
              event.admission.phase === loss
            ) {
              injected.add(event.id)
              throw new Error('dispatch acknowledgement lost')
            }
          },
        },
      }
      await createSupervisor<string, string>().run(
        {
          name: 'root',
          act: async (_task, scope) => {
            for (let child = 0; child < childCount; child++) {
              const spawned = scope.spawn(worker(), 'task', {
                key: child === 0 ? 'work' : `work-${child}`,
                label: 'work',
                budget: { maxIterations: 1, maxTokens: 10 },
              })
              expect(spawned.ok).toBe(true)
            }
            for (let child = 0; child < childCount; child++) await scope.next()
            return 'first process'
          },
        },
        'root-task',
        { ...interrupted, ...common },
      )
      expect(injected.size).toBe(childCount)
    },
    resume: (factory = providerAsExecutor(provider(), { destroyOnSettle })) =>
      run(async (scope) => {
        if (scope.view.inFlight > 0) {
          const settled = await scope.next()
          if (settled?.kind !== 'done') throw new Error('original execution remains unresolved')
        }
        resumedTokens = scope.budget.tokensLeft
        const replayed = scope.spawn(worker(), 'task', {
          key: 'work',
          label: 'work',
          budget: { maxIterations: 1, maxTokens: 10 },
        })
        expect(replayed.ok).toBe(true)
        if (!replayed.ok || replayed.prior?.state !== 'completed')
          throw new Error('expected original accepted result')
        return (replayed.prior.settled.out as { content: string }).content
      }, factory),
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
