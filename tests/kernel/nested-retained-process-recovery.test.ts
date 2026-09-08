import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { expect, it } from 'vitest'
import { providerAsExecutor } from '../../src/runtime/environment-provider'
import { driverChild, driverExecutorFactory } from '../../src/runtime/supervise/driver-executor'
import {
  RetainedExecutionPendingError,
  registerRetainedExecutorPreparation,
} from '../../src/runtime/supervise/retained-executor'
import {
  createFileRunContext,
  createInMemoryRunContext,
} from '../../src/runtime/supervise/run-context'
import { meterRuntimeOwnedAccounting } from '../../src/runtime/supervise/scope'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, SpawnJournal } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from './test-agent-profile'

it('restores a nested manager before its retained child needs manager coordination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nested-process-recovery-'))
  const runDirectory = join(directory, 'run')
  const context = createFileRunContext(runDirectory, { withDriver: true })
  let releaseChild!: () => void
  const parentOpened = new Promise<void>((resolve) => {
    releaseChild = resolve
  })
  let releaseRoot!: () => void
  const rootInspected = new Promise<void>((resolve) => {
    releaseRoot = resolve
  })
  let freshFactories = 0
  let recovering = false
  let parentActed = false
  let creates = 0
  let interrupted = false
  const provider = (): AgentEnvironmentProvider => {
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      session: (id, options) => {
        const session = environment.session!(id, options)
        return {
          ...session,
          async *events(eventOptions) {
            // The retained child cannot make progress until its manager is running again.
            // A terminal-await recovery preflight blocks the only code that can open this gate.
            if (recovering) {
              const signal = eventOptions?.signal
              let onAbort: (() => void) | undefined
              try {
                await Promise.race([
                  Promise.all([parentOpened, rootInspected]),
                  new Promise<never>((_resolve, reject) => {
                    onAbort = () => reject(signal?.reason ?? new Error('child observation aborted'))
                    if (signal?.aborted) onAbort()
                    else signal?.addEventListener('abort', onAbort, { once: true })
                  }),
                ])
              } finally {
                if (onAbort) signal?.removeEventListener('abort', onAbort)
              }
            }
            yield* session.events(eventOptions)
          },
          result: async () => ({
            ...(await session.result()),
            usage: { inputTokens: 3, outputTokens: 2 },
          }),
        }
      },
    })
    return {
      ...base,
      create: async (input) => {
        creates++
        return wrap(await base.create(input))
      },
      get: async (id) => {
        const environment = await base.get!(id)
        return environment ? wrap(environment) : null
      },
    }
  }
  const profile = testAgentProfile('retained-child')
  const worker = (): Agent<unknown, unknown> =>
    Object.assign(
      { name: 'retained-child', act: async () => 'unused' },
      {
        executorSpec: {
          profile,
          harness: null,
          executorFactory: providerAsExecutor(provider(), { destroyOnSettle: false }),
        },
      },
    )
  const managerProfile = testAgentProfile('manager')
  const manager = (journal: SpawnJournal): Agent<unknown, unknown> =>
    driverChild(
      managerProfile,
      {
        name: 'manager',
        async act(_task, scope) {
          if (recovering) {
            parentActed = true
            expect(scope.view.inFlight).toBe(1)
            expect(scope.budget.reservedTokens).toBe(10)
            expect(scope.budget.tokensLeft).toBe(15)
            releaseChild()
          } else {
            await meterRuntimeOwnedAccounting(scope, {
              iterations: 0,
              tokens: { input: 5, output: 0 },
              usd: 0,
              ms: 0,
            })
            const child = scope.spawn(worker(), 'child task', {
              key: 'child',
              budget: { maxIterations: 1, maxTokens: 10 },
            })
            expect(child.ok).toBe(true)
          }
          const settled = await scope.next()
          if (!recovering)
            throw new RetainedExecutionPendingError(new Error('manager observation interrupted'))
          expect(settled?.handle.id).toBe('root:s0:s0')
          return {
            finalizedBy: 'manager',
            child: settled?.kind === 'done' ? settled.out : undefined,
          }
        },
      },
      journal,
      undefined,
      undefined,
      providerAsExecutor(provider(), { destroyOnSettle: false }),
    )
  const common = {
    runId: 'root',
    budget: { maxIterations: 3, maxTokens: 30 },
    maxLiveWorkers: 2,
    rootIdentity: {
      profileDigest: canonicalCandidateDigest({ name: 'root' }),
      taskDigest: canonicalCandidateDigest('task'),
    },
  }
  const journal: SpawnJournal = {
    beginTree: context.journal.beginTree.bind(context.journal),
    loadTree: context.journal.loadTree.bind(context.journal),
    appendEvent: async (root, event) => {
      await context.journal.appendEvent(root, event)
      if (
        !interrupted &&
        event.kind === 'execution-admitted' &&
        event.admission.phase === 'dispatched'
      ) {
        interrupted = true
        throw new Error('lost local dispatch acknowledgement')
      }
    },
  }
  const abort = new AbortController()
  let cutoff: ReturnType<typeof setTimeout> | undefined
  try {
    await createSupervisor<string, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          const child = scope.spawn(manager(journal), 'manager task', {
            key: 'manager',
            budget: { maxIterations: 3, maxTokens: 30 },
          })
          expect(child.ok).toBe(true)
          await scope.next()
        },
      },
      'task',
      { ...context, ...common, journal },
    )
    expect(interrupted).toBe(true)
    expect(creates).toBe(1)
    const interruptedParent = (await context.journal.loadTree('root')) ?? []
    expect(
      interruptedParent
        .filter((event) => event.kind === 'metered')
        .reduce(
          (sum, event) =>
            sum +
            (event.kind === 'metered' ? event.spend.tokens.input + event.spend.tokens.output : 0),
          0,
        ),
    ).toBe(5)
    recovering = true
    cutoff = setTimeout(() => abort.abort(new Error('recovery blocked parent coordination')), 500)
    const restarted = createFileRunContext(runDirectory, { withDriver: true })
    const recoveryFactory = registerRetainedExecutorPreparation(
      providerAsExecutor(provider(), { destroyOnSettle: false }),
      ({ spawned }) =>
        spawned.ownedTreeRoot === undefined
          ? undefined
          : {
              spec: (
                manager(restarted.journal) as Agent<unknown, unknown> & {
                  executorSpec: import('../../src/runtime/supervise/types').AgentSpec
                }
              ).executorSpec,
              factory: driverExecutorFactory,
            },
    )
    const result = await createSupervisor<string, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          expect(scope.view.inFlight).toBe(1)
          expect(scope.budget.reservedTokens).toBe(30)
          expect(scope.budget.tokensLeft).toBe(0)
          const fresh = scope.spawn(
            () => {
              freshFactories++
              return worker()
            },
            'fresh task',
            {
              key: 'fresh',
              budget: { maxIterations: 1, maxTokens: 1 },
            },
          )
          expect(fresh).toEqual({ ok: false, reason: 'max-live-workers' })
          expect(freshFactories).toBe(0)
          releaseRoot()
          const settled = await scope.next()
          expect(settled?.handle.id).toBe('root:s0')
          return settled?.kind === 'done' ? settled.out : undefined
        },
      },
      'task',
      {
        ...restarted,
        ...common,
        resume: true,
        signal: abort.signal,
        recoverExecutor: recoveryFactory,
      },
    )
    expect(parentActed).toBe(true)
    expect(result.kind).toBe('winner')
    expect(result.spentTotal.tokens.input + result.spentTotal.tokens.output).toBe(10)
    if (result.kind === 'winner') expect(result.out).toMatchObject({ finalizedBy: 'manager' })
    expect(creates).toBe(1)
    const events = (await context.journal.loadTree('root/root:s0')) ?? []
    expect(
      events.filter((event) => event.kind === 'spawned' && event.id === 'root:s0:s0'),
    ).toHaveLength(1)
    expect(
      events.filter((event) => event.kind === 'execution-input' && event.id === 'root:s0:s0'),
    ).toHaveLength(1)
    expect(
      events.filter((event) => event.kind === 'settled' && event.id === 'root:s0:s0'),
    ).toHaveLength(1)
  } finally {
    if (cutoff) clearTimeout(cutoff)
    releaseChild()
    releaseRoot()
    abort.abort()
    await rm(directory, { recursive: true, force: true })
  }
})

it('keeps nested cleanup uncertainty after the driver scope closes', async () => {
  const context = createInMemoryRunContext({ withDriver: true })
  const artifact = {
    outRef: 'internal:child',
    out: 'completed child',
    spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
  }
  const child = Object.assign(
    { name: 'child', act: async () => 'unused' },
    {
      executorSpec: {
        profile: testAgentProfile('child'),
        harness: null,
        executor: {
          runtime: 'router',
          execute: async () => artifact,
          teardown: async () => ({
            destroyed: false,
            detail: 'provider did not acknowledge deletion',
          }),
          resultArtifact: () => artifact,
        },
      },
    },
  )
  const manager = driverChild(
    testAgentProfile('manager'),
    {
      name: 'manager',
      async act(_task, scope) {
        expect(scope.spawn(child, 'work', { budget: { maxIterations: 1, maxTokens: 10 } }).ok).toBe(
          true,
        )
        expect((await scope.next())?.kind).toBe('down')
        return 'finalized manager'
      },
    },
    context.journal,
  )
  const result = await createSupervisor<string, unknown>().run(
    {
      name: 'root',
      async act(_task, scope) {
        expect(
          scope.spawn(manager, 'manage', { budget: { maxIterations: 2, maxTokens: 20 } }).ok,
        ).toBe(true)
        const settled = await scope.next()
        expect(settled?.kind).toBe('down')
        expect(scope.workerCapacity.unconfirmed.map((node) => node.id)).toContain('root:s0')
        expect(
          scope.spawn(
            () => {
              throw new Error('capacity must refuse before construction')
            },
            'fresh',
            {
              budget: { maxIterations: 1, maxTokens: 1 },
            },
          ),
        ).toEqual({ ok: false, reason: 'max-live-workers' })
        return 'observed nested cleanup uncertainty'
      },
    },
    'task',
    { ...context, runId: 'root', maxLiveWorkers: 2, budget: { maxIterations: 4, maxTokens: 100 } },
  )
  expect(result.kind, JSON.stringify(result)).toBe('winner')
  expect(result.teardownUnconfirmed?.map((node) => node.id)).toContain('root:s0')
})
