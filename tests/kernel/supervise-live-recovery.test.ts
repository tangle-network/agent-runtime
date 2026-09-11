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
import { driverAgent } from '../../src/runtime/supervise/coordination-driver'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, SpawnJournal } from '../../src/runtime/supervise/types'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { testAgentProfile } from './test-agent-profile'

it('starts the resumed parent while its original child awaits parent coordination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supervise-live-recovery-'))
  const runDirectory = join(directory, 'run')
  const context = createFileRunContext(runDirectory)
  let releaseChild!: () => void
  const parentOpened = new Promise<void>((resolve) => {
    releaseChild = resolve
  })
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
                  parentOpened,
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
  const common = {
    runId: 'root',
    budget: { maxIterations: 5, maxTokens: 100 },
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
          const child = scope.spawn(worker(), 'child task', {
            key: 'child',
            budget: { maxIterations: 1, maxTokens: 10 },
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
    recovering = true
    // The guard exists for one hazard: a recovery preflight that awaits the child's terminal
    // event before the parent runs, which deadlocks against the gate above. Once the parent has
    // acted that deadlock is impossible, and the remaining path (release the gate, journal the
    // child's settlement) is a durable write sequence whose duration is a property of the host's
    // fsync latency, not of the contract under test. Measured 2026-09-11 at load average ~350:
    // 656-732 ms from arming to settlement, so an unscoped 500 ms guard cancelled a healthy run.
    cutoff = setTimeout(() => {
      if (!parentActed) abort.abort(new Error('recovery blocked parent coordination'))
    }, 500)
    const result = await createSupervisor<string, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          parentActed = true
          expect(scope.view.inFlight).toBe(1)
          expect(scope.budget.reservedTokens).toBe(10)
          let resumedMessages = ''
          const promptDriver = driverAgent({
            name: 'resumed-coordinator',
            systemPrompt: 'Continue the existing workers.',
            toolNames: ['await_event'],
            blobs: context.blobs,
            perWorker: { maxIterations: 1, maxTokens: 10 },
            makeWorkerAgent: worker,
            maxTurns: 1,
            brain: async (messages) => {
              resumedMessages = JSON.stringify(messages)
              return {
                content: 'waiting for the original worker',
                toolCalls: [],
                usage: { input: 0, output: 0 },
                costUsd: 0,
                costProvenance: 'provider-receipt',
              }
            },
          })
          await promptDriver.act('continue', scope)
          expect(resumedMessages).toContain('Recovered keys are attached to this scope')
          expect(resumedMessages).toContain('child → root:s0')
          expect(resumedMessages).not.toContain('Keys IN DOUBT')
          releaseChild()
          const settled = await scope.next()
          expect(settled?.handle.id).toBe('root:s0')
          return settled?.kind === 'done' ? settled.out : undefined
        },
      },
      'task',
      {
        ...createFileRunContext(runDirectory),
        ...common,
        signal: abort.signal,
        recoverExecutor: providerAsExecutor(provider(), { destroyOnSettle: false }),
      },
    )
    expect(parentActed).toBe(true)
    // The guard never fired: the winner below came from the recovery path, not from a race the
    // guard happened to lose.
    expect(abort.signal.aborted).toBe(false)
    expect(result.kind).toBe('winner')
    expect(creates).toBe(1)
    const events = (await context.journal.loadTree('root')) ?? []
    expect(
      events.filter((event) => event.kind === 'spawned' && event.id === 'root:s0'),
    ).toHaveLength(1)
    expect(
      events.filter((event) => event.kind === 'execution-input' && event.id === 'root:s0'),
    ).toHaveLength(1)
    expect(
      events.filter((event) => event.kind === 'settled' && event.id === 'root:s0'),
    ).toHaveLength(1)
  } finally {
    if (cutoff) clearTimeout(cutoff)
    releaseChild()
    abort.abort()
    await rm(directory, { recursive: true, force: true })
  }
})

it.each([false, true])(
  'preserves accepted child failure=%s when cancellation arrives during provider teardown',
  async (failed) => {
    const directory = await mkdtemp(join(tmpdir(), 'supervise-accepted-teardown-'))
    const context = createFileRunContext(join(directory, 'run'))
    const base = durableRetainedProvider(join(directory, 'provider.json'))
    let destroying!: () => void
    let release!: () => void
    const destroyStarted = new Promise<void>((resolve) => {
      destroying = resolve
    })
    const finishDestroy = new Promise<void>((resolve) => {
      release = resolve
    })
    const controller = new AbortController()
    const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
      ...environment,
      session: (id, options) => {
        const session = environment.session!(id, options)
        return {
          ...session,
          result: async () => ({
            ...(await session.result()),
            usage: { inputTokens: 3, outputTokens: 2 },
            ...(failed ? { success: false, error: 'accepted provider failure' } : {}),
          }),
        }
      },
      destroy: async () => {
        destroying()
        await finishDestroy
        await environment.destroy?.()
      },
    })
    const provider: AgentEnvironmentProvider = {
      ...base,
      create: async (input) => wrap(await base.create(input)),
      get: async (id) => {
        const environment = await base.get!(id)
        return environment ? wrap(environment) : null
      },
    }
    const profile = testAgentProfile('accepted-child')
    const worker: Agent<unknown, unknown> = Object.assign(
      { name: profile.name, act: async () => 'unused' },
      { executorSpec: { profile, harness: null, executorFactory: providerAsExecutor(provider) } },
    )
    // A deadlock guard, not a performance bound: it converts a `destroy` that never starts, or a
    // release that never comes, into a clean failure with cleanup. It must sit above the healthy
    // path, which is ~11 fsynced journal appends before `destroy` runs. Measured 2026-09-11 at
    // load average ~320: 1.2-2.4 s to `destroy`, so a 1 s guard cancelled the child before its
    // result was accepted and the case flaked. 10 s keeps the guard under vitest's 20 s timeout.
    const cutoff = setTimeout(() => {
      controller.abort('test deadline')
      release()
    }, 10_000)
    try {
      await createSupervisor<string, unknown>().run(
        {
          name: 'root',
          async act(_task, scope) {
            expect(
              scope.spawn(worker, 'child task', {
                key: 'child',
                budget: { maxIterations: 1, maxTokens: 10 },
              }).ok,
            ).toBe(true)
            await destroyStarted
            const beforeAbort = (await context.journal.loadTree('root')) ?? []
            expect(
              beforeAbort.some(
                (event) => event.kind === 'execution-result' && event.id === 'root:s0',
              ),
            ).toBe(true)
            controller.abort('cancelled after result acceptance')
            release()
            await scope.next()
          },
        },
        'task',
        {
          ...context,
          runId: 'root',
          signal: controller.signal,
          budget: { maxIterations: 5, maxTokens: 100 },
          rootIdentity: {
            profileDigest: canonicalCandidateDigest({ name: 'root' }),
            taskDigest: canonicalCandidateDigest('task'),
          },
        },
      )
      const events = (await context.journal.loadTree('root')) ?? []
      expect(
        events.filter((event) => event.kind === 'execution-result' && event.id === 'root:s0'),
      ).toHaveLength(1)
      expect(
        events.filter((event) => event.kind === 'cancelled' && event.id === 'root:s0'),
      ).toHaveLength(0)
      expect(
        events.filter((event) => event.kind === 'settled' && event.id === 'root:s0'),
      ).toMatchObject([
        {
          status: failed ? 'down' : 'done',
          ...(failed ? { reason: 'accepted provider failure' } : {}),
          spent: { tokens: { input: 3, output: 2 } },
        },
      ])
    } finally {
      clearTimeout(cutoff)
      controller.abort()
      release()
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it('keeps an accepted provider result from bypassing the child allocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supervise-accepted-overspend-'))
  const context = createFileRunContext(join(directory, 'run'))
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session: (id, options) => {
      const session = environment.session!(id, options)
      return {
        ...session,
        result: async () => ({
          ...(await session.result()),
          usage: { inputTokens: 11, outputTokens: 0 },
        }),
      }
    },
  })
  const provider: AgentEnvironmentProvider = {
    ...base,
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  const profile = testAgentProfile('overspending-child')
  const worker: Agent<unknown, unknown> = Object.assign(
    { name: profile.name, act: async () => 'unused' },
    { executorSpec: { profile, harness: null, executorFactory: providerAsExecutor(provider) } },
  )
  try {
    const result = await createSupervisor<string, unknown>().run(
      {
        name: 'root',
        async act(_task, scope) {
          expect(
            scope.spawn(worker, 'child task', {
              key: 'child',
              budget: { maxIterations: 1, maxTokens: 10 },
            }).ok,
          ).toBe(true)
          const settled = await scope.next()
          expect(settled?.kind).toBe('down')
          return settled?.kind === 'done' ? settled.out : undefined
        },
      },
      'task',
      {
        ...context,
        runId: 'root',
        budget: { maxIterations: 5, maxTokens: 100 },
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ name: 'root' }),
          taskDigest: canonicalCandidateDigest('task'),
        },
      },
    )
    const events = (await context.journal.loadTree('root')) ?? []
    expect(events.some((event) => event.kind === 'execution-result')).toBe(true)
    expect(
      events.find((event) => event.kind === 'settled' && event.id === 'root:s0'),
    ).toMatchObject({ status: 'down' })
    expect(result.kind).toBe('no-winner')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
