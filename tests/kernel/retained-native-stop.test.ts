import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it } from 'vitest'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import { RunCancellationReason } from '../../src/runtime/index'
import { cancelRun } from '../../src/runtime/supervise/run-cancellation'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, SpawnEvent, UsageEvent } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const directories: string[] = []
const harnesses: ChildProcess[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    if (harness.exitCode === null && harness.signalCode === null) killGroup(harness, 'SIGKILL')
  }
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(
    directories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
      ),
  )
})

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    process.kill(-child.pid!, signal)
  } catch {
    // Already gone.
  }
}

function exited(child: ChildProcess): Promise<void> {
  return child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once('exit', () => resolve()))
}

/** Whether a native harness process is still running: not exited, not merely unobserved. */
function running(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

/** A real detached process group survives observation loss; only exact provider stop ends it. */
function liveProcessProvider(
  stateFile: string,
  options: {
    /** Acknowledge a stop as `cancel_requested` and end the process this much later, the way an
     *  asynchronous provider does. Its status reads `running` until the process exits, then
     *  `stopped`. */
    readonly asynchronousStopMs?: number
    readonly stopUnavailable?: boolean
  } = {},
) {
  const processes = new Map<string, ChildProcess>()
  const stoppedAt = new Map<string, number>()
  // Executions whose event stream Runtime opened: it is observing the native process.
  const observed = new Set<string>()
  const base = durableRetainedProvider(stateFile)
  let creates = 0
  let destroys = 0
  let dispatches = 0
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    dispatch: async (turn) => {
      dispatches += 1
      const dispatched = await environment.dispatch!(turn)
      const executionId = dispatched.controlRef!.executionId!
      if (!processes.has(executionId)) {
        // A parent shell with a child: the stop must reach the whole group, not one pid.
        const harness = spawn('/bin/sh', ['-c', 'sleep 300 & wait'], {
          detached: true,
          stdio: 'ignore',
        })
        harnesses.push(harness)
        harness.once('exit', () => stoppedAt.set(executionId, Date.now()))
        processes.set(executionId, harness)
      }
      return dispatched
    },
    session: (id, sessionOptions) => {
      const session = environment.session!(id, sessionOptions)
      const executionId = sessionOptions?.controlRef?.executionId ?? ''
      const harness = (): ChildProcess => {
        const child = processes.get(executionId)
        if (child === undefined) throw new Error(`no native process for ${executionId}`)
        return child
      }
      return {
        ...session,
        async *events(): AsyncIterable<AgentEnvironmentEvent> {
          observed.add(executionId)
          yield {
            id: 'event-0',
            type: 'status',
            data: { sequence: 0, occurredAt: new Date().toISOString() },
            normalized: { type: 'status', status: 'started' },
          }
          await exited(harness())
        },
        result: async () => {
          await exited(harness())
          return { ...(await session.result()), success: false, error: 'native process stopped' }
        },
        status: async (statusOptions) => {
          if (running(harness())) return 'running'
          return options.asynchronousStopMs === undefined
            ? await session.status(statusOptions)
            : 'stopped'
        },
        cancelRun: async (request, cancelOptions) => {
          if (options.stopUnavailable) throw new Error('native stop transport unavailable')
          const child = harness()
          if (options.asynchronousStopMs !== undefined) {
            const acknowledgement = await session.cancelRun!(request, cancelOptions)
            setTimeout(() => killGroup(child, 'SIGTERM'), options.asynchronousStopMs)
            return { ...acknowledgement, effect: 'cancel_requested' }
          }
          if (running(child)) {
            killGroup(child, 'SIGTERM')
            await exited(child)
          }
          return await session.cancelRun!(request, cancelOptions)
        },
      }
    },
    destroy: async () => {
      destroys += 1
      // Destroying a box ends every process in it.
      for (const harness of processes.values()) killGroup(harness, 'SIGKILL')
      await environment.destroy?.()
    },
  })
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    create: async (input) => {
      creates += 1
      return wrap(await base.create(input))
    },
    get: async (id) => {
      const environment = await base.get!(id)
      return environment ? wrap(environment) : null
    },
  }
  return {
    provider,
    processes,
    stoppedAt,
    observing: () => observed.size > 0,
    creates: () => creates,
    destroys: () => destroys,
    dispatches: () => dispatches,
  }
}

function ofKind<K extends SpawnEvent['kind']>(
  events: readonly SpawnEvent[],
  kind: K,
): Array<Extract<SpawnEvent, { kind: K }>> {
  return events.filter((event): event is Extract<SpawnEvent, { kind: K }> => event.kind === kind)
}

/** A retained provider execution using native custody, without a client capture writer. */
function retainedLeaf(
  provider: AgentEnvironmentProvider,
  factory = providerAsExecutor(provider),
): Agent<unknown, string> {
  const profile = testAgentProfile('leaf')
  return Object.assign(
    { name: 'leaf', act: async () => 'unused' },
    {
      executorSpec: {
        profile,
        harness: profile.harness,
        executorFactory: factory,
      },
    },
  )
}

function childRunContext(runDir: string) {
  return {
    ...createFileRunContext(runDir),
    runId: 'root',
    budget: { maxIterations: 10, maxTokens: 100 },
    rootIdentity: {
      profileDigest: canonicalCandidateDigest({ name: 'root-profile' }),
      taskDigest: canonicalCandidateDigest('root-task'),
    },
    retainedAtSettlement: 'release' as const,
  }
}

/** Whether `condition` holds before `ms` elapse. */
async function within(ms: number, condition: () => boolean): Promise<boolean> {
  const until = Date.now() + ms
  while (!condition()) {
    if (Date.now() >= until) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return true
}

async function scratch(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

describe('native custody when a retained run is cancelled', () => {
  it('stops the root harness process before it settles and records its usage as unknown', async () => {
    const directory = await scratch('native-stop-owner-')
    const proxy = await coordinationProxy()
    proxies.push(proxy)
    const runDir = join(directory, 'run')
    const runId = 'native-stop-owner'
    const context = createFileRunContext(runDir)
    const live = liveProcessProvider(join(directory, 'provider.json'))
    const backend = { backend: 'provider' as const, provider: live.provider }

    const settling = supervise(
      testAgentProfile('root', { tools: runtimeToolDeclarations('submit_result') }),
      'Produce the answer.',
      {
        runDir,
        runId,
        journal: context.journal,
        blobs: context.blobs,
        backend,
        driverBackend: backend,
        budget: { maxIterations: 20, maxTokens: 1_000, deadlineMs: 60_000 },
        driverRetry: { enabled: false },
        retainedAtSettlement: 'release',
        deliverable: { describe: 'never submitted', check: () => false },
        continuation: testContinuation(),
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => {
            proxy.forwardTo(address.port)
            return `${proxy.url}/manager`
          },
        },
      },
    )
    await expect.poll(() => live.observing(), { timeout: 10_000 }).toBe(true)
    const [harness] = [...live.processes.values()]
    expect(running(harness!)).toBe(true)

    cancelRun(runDir, 'operator-cancel', {
      operator: 'test-operator',
      source: 'operator',
      reason: 'no subscription spend',
    })
    const result = await settling

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
    expect(live.destroys()).toBe(1)
    expect(result.teardownUnconfirmed).toBeUndefined()
    expect(running(harness!)).toBe(false)
    const events = (await context.journal.loadTree(runId)) ?? []
    const teardown = ofKind(events, 'environment-teardown').filter((event) => event.id === runId)
    expect(teardown.at(-1)).toMatchObject({
      destroyed: true,
    })
  })

  it.each([undefined, 1_500])(
    'stops each child before settlement (async stop: %s)',
    async (asynchronousStopMs) => {
      const directory = await scratch('native-stop-child-')
      const runDir = join(directory, 'run')
      const live = liveProcessProvider(join(directory, 'provider.json'), { asynchronousStopMs })
      const worker = retainedLeaf(live.provider)
      const cancel = new AbortController()
      const settling = createSupervisor<string, string>().run(
        {
          name: 'root',
          act: async (_task, scope) => {
            scope.spawn(worker, 'child task', {
              key: 'work',
              budget: { maxIterations: 1, maxTokens: 100 },
            })
            await scope.next()
            return 'root done'
          },
        },
        'root-task',
        {
          ...childRunContext(runDir),
          signal: cancel.signal,
        },
      )
      await expect.poll(() => live.observing(), { timeout: 10_000 }).toBe(true)
      const [harness] = [...live.processes.values()]
      expect(running(harness!)).toBe(true)

      cancel.abort('operator cancelled the run')
      const result = await settling

      expect(result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
      expect(live.destroys()).toBe(1)
      expect(running(harness!)).toBe(false)
      const events = (await createFileRunContext(runDir).journal.loadTree('root')) ?? []
      const teardown = ofKind(events, 'environment-teardown').filter(
        (event) => event.id === 'root:s0',
      )
      expect(teardown.at(-1)).toMatchObject({
        destroyed: true,
      })
    },
  )

  it('stops a worker the root aborts while the run is still live', async () => {
    const directory = await scratch('native-stop-worker-')
    const runDir = join(directory, 'run')
    const live = liveProcessProvider(join(directory, 'provider.json'))
    // Whether the worker's process had exited by the time its cancellation settled, read while the
    // root still runs, so no root release can be what stopped it.
    let stoppedWhileLive: boolean | undefined
    const result = await createSupervisor<string, string>().run(
      {
        name: 'root',
        act: async (_task, scope) => {
          const spawned = scope.spawn(retainedLeaf(live.provider), 'child task', {
            key: 'work',
            budget: { maxIterations: 1, maxTokens: 100 },
          })
          await expect.poll(() => live.observing(), { timeout: 10_000 }).toBe(true)
          const [harness] = [...live.processes.values()]
          expect(running(harness!)).toBe(true)
          if (!spawned.ok) throw new Error(`spawn refused: ${spawned.reason}`)
          spawned.handle.abort('the director stopped this worker')
          expect((await scope.next())?.kind).toBe('down')
          stoppedWhileLive = await within(5_000, () => !running(harness!))
          return 'root done'
        },
      },
      'root-task',
      {
        ...childRunContext(runDir),
      },
    )
    expect(stoppedWhileLive).toBe(true)
    expect(result.kind).toBe('winner')
    expect(live.destroys()).toBe(1)
  })
})

describe('a deadline that ends a retained turn', () => {
  it.each([undefined, 1_500])(
    'records settlement only after the physical process stops (async stop: %s)',
    async (asynchronousStopMs) => {
      const directory = await scratch('native-stop-deadline-')
      const runDir = join(directory, 'run')
      const live = liveProcessProvider(join(directory, 'provider.json'), { asynchronousStopMs })
      await createSupervisor<string, string>().run(
        {
          name: 'root',
          act: async (_task, scope) => {
            scope.spawn(retainedLeaf(live.provider), 'child task', {
              key: 'work',
              budget: { maxIterations: 1, maxTokens: 100, deadlineMs: 1_500 },
            })
            await expect.poll(() => live.observing()).toBe(true)
            expect([...live.processes.values()].some(running)).toBe(true)
            expect(await scope.next()).toMatchObject({
              kind: 'down',
              reason: 'child deadline exceeded',
            })
            expect([...live.processes.values()].some(running)).toBe(false)
            return 'root done'
          },
        },
        'root-task',
        childRunContext(runDir),
      )
      expect(live.stoppedAt.size).toBe(1)
      const stoppedAt = [...live.stoppedAt.values()][0]!
      const events = (await createFileRunContext(runDir).journal.loadTree('root')) ?? []
      const settlements = events.filter(
        (event) =>
          event.id === 'root:s0' && (event.kind === 'settled' || event.kind === 'reconciled'),
      )
      expect(settlements.length).toBeGreaterThan(0)
      for (const event of settlements)
        expect(Date.parse(event.at)).toBeGreaterThanOrEqual(stoppedAt)
      expect(live.destroys()).toBe(1)
      expect(
        ofKind(events, 'execution-input').every((event) => event.workspaceRetention !== true),
      ).toBe(true)
    },
    30_000,
  )
})

describe('terminal recovery of a previously admitted native process', () => {
  it.each(['deadline', 'cancelled', 'unknown', 'undispatched', 'retry-stop'] as const)(
    'stops only the exact original process on %s recovery and releases only confirmed custody',
    async (ending) => {
      const directory = await scratch('native-stop-terminal-resume-')
      const runDir = join(directory, 'run')
      const context = createFileRunContext(runDir)
      const availability = { stopUnavailable: ending === 'unknown' || ending === 'retry-stop' }
      const live = liveProcessProvider(join(directory, 'provider.json'), availability)
      const factory = providerAsExecutor(live.provider)
      const worker = retainedLeaf(live.provider)
      let clock = Date.now()
      const common = {
        ...childRunContext(runDir),
        budget: { maxIterations: 10, maxTokens: 100, deadlineMs: 60_000 },
        now: () => clock,
      }
      let interrupted = false
      await expect(
        createSupervisor<string, string>().run(
          {
            name: 'root',
            act: async (_task, scope) => {
              scope.spawn(worker, 'child task', {
                key: 'work',
                budget: { maxIterations: 1, maxTokens: 100 },
              })
              await scope.next()
              return 'unreachable'
            },
          },
          'root-task',
          {
            ...common,
            journal: {
              beginTree: context.journal.beginTree.bind(context.journal),
              loadTree: context.journal.loadTree.bind(context.journal),
              appendEvent: async (root, event) => {
                if (
                  ending === 'undispatched' &&
                  event.kind === 'execution-admitted' &&
                  event.admission.phase === 'dispatched'
                ) {
                  interrupted = true
                  throw new Error('lost dispatch before its journal commit')
                }
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
            },
          },
        ),
      ).rejects.toThrow('durable state unavailable')
      expect(interrupted).toBe(true)
      const [harness] = [...live.processes.values()]
      expect(running(harness!)).toBe(true)
      const before = { creates: live.creates(), dispatches: live.dispatches() }
      expect(before).toEqual({ creates: 1, dispatches: 1 })
      // An unrelated process group must never be affected by cleanup of this admission.
      const canary = spawn('/bin/sh', ['-c', 'sleep 300 & wait'], {
        detached: true,
        stdio: 'ignore',
      })
      harnesses.push(canary)
      const cancel = new AbortController()
      if (ending !== 'cancelled') clock += 120_000
      else cancel.abort(new RunCancellationReason('operator', 'cancelled before resume'))
      let recovered: ReturnType<typeof factory> | undefined
      const result = await createSupervisor<string, string>().run(
        {
          name: 'root',
          act: async () => {
            throw new Error('terminal root acted')
          },
        },
        'root-task',
        {
          ...common,
          recoverExecutor: (spec, context) => {
            recovered = factory(spec, context)
            return recovered
          },
          retainedAtSettlement: 'release',
          signal: cancel.signal,
          teardownConfirmMs: 1_000,
        },
      )
      expect(result).toMatchObject({
        kind: 'no-winner',
        reason: ending === 'cancelled' ? 'cancelled' : 'deadline',
      })
      const unresolved = ['unknown', 'undispatched', 'retry-stop'].includes(ending)
      expect(running(harness!)).toBe(unresolved)
      expect(running(canary)).toBe(true)
      expect({ creates: live.creates(), dispatches: live.dispatches() }).toEqual(before)
      expect(live.destroys()).toBe(unresolved ? 0 : 1)
      if (unresolved) expect(result.teardownUnconfirmed?.length).toBeGreaterThan(0)
      else expect(result.teardownUnconfirmed).toBeUndefined()
      const events = (await context.journal.loadTree('root')) ?? []
      const admission = ofKind(events, 'execution-admitted').find(
        (event) =>
          event.admission.phase === (ending === 'undispatched' ? 'environment' : 'dispatched'),
      )!
      const original =
        admission.admission.phase === 'dispatched'
          ? admission.admission.controlRef
          : admission.admission.phase === 'environment'
            ? admission.admission
            : undefined
      expect(ofKind(events, 'environment-teardown').at(-1)).toMatchObject({
        id: admission.id,
        environmentId: original?.environmentId,
        destroyed: !unresolved,
      })
      if (ending === 'retry-stop') {
        availability.stopUnavailable = false
        const receipts = await recovered!.releaseRetained!(AbortSignal.timeout(5_000))
        expect(running(harness!)).toBe(false)
        expect(running(canary)).toBe(true)
        expect(receipts).toMatchObject([
          { environmentId: original?.environmentId, destroyed: true },
        ])
        expect(live.destroys()).toBe(1)
        expect({ creates: live.creates(), dispatches: live.dispatches() }).toEqual(before)
      }
    },
    30_000,
  )
})

it('releases warm native custody after an unknown stop later receives an exact stop ACK', async () => {
  const directory = await scratch('native-stop-warm-retry-')
  const availability = { stopUnavailable: true }
  const live = liveProcessProvider(join(directory, 'provider.json'), availability)
  const factory = providerAsExecutor(live.provider)
  let executor: ReturnType<typeof factory> | undefined
  let finishTurn!: () => void
  const turnEnded = new Promise<void>((resolve) => {
    finishTurn = resolve
  })
  const worker = retainedLeaf(live.provider, (spec, context) => {
    executor = factory(spec, context)
    const execute = executor.execute.bind(executor)
    executor.execute = async function* (task, signal) {
      try {
        yield* execute(task, signal) as AsyncIterable<UsageEvent>
      } finally {
        finishTurn()
      }
    }
    return executor
  })
  let first: readonly { environmentId: string; destroyed: boolean }[] | undefined
  let second: typeof first
  let firstAlive: boolean | undefined
  let firstDestroys: number | undefined
  let secondAlive: boolean | undefined
  await createSupervisor<string, string>().run(
    {
      name: 'root',
      act: async (_task, scope) => {
        const spawned = scope.spawn(worker, 'child task', {
          key: 'work',
          budget: { maxIterations: 1, maxTokens: 100 },
        })
        if (!spawned.ok) throw new Error(`spawn refused: ${spawned.reason}`)
        await expect.poll(() => live.observing()).toBe(true)
        spawned.handle.abort('the director stopped this worker')
        await turnEnded
        const [harness] = [...live.processes.values()]
        first = await executor!.releaseRetained!(AbortSignal.timeout(5_000))
        firstAlive = running(harness!)
        firstDestroys = live.destroys()
        availability.stopUnavailable = false
        second = await executor!.releaseRetained!(AbortSignal.timeout(5_000))
        secondAlive = running(harness!)
        return 'root done'
      },
    },
    'root-task',
    childRunContext(join(directory, 'run')),
  )
  expect(first).toMatchObject([{ destroyed: false }])
  expect(firstAlive).toBe(true)
  expect(firstDestroys).toBe(0)
  expect(secondAlive).toBe(false)
  expect(second).toMatchObject([{ environmentId: first![0]!.environmentId, destroyed: true }])
  expect(live.destroys()).toBe(1)
  expect({ creates: live.creates(), dispatches: live.dispatches() }).toEqual({
    creates: 1,
    dispatches: 1,
  })
})
