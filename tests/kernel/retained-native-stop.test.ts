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
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import type { ProviderWorkspaceRetentionPort } from '../../src/runtime/provider-workspace-retention'
import { RunCancellationReason } from '../../src/runtime/index'
import { cancelRun } from '../../src/runtime/supervise/run-cancellation'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, SpawnEvent } from '../../src/runtime/supervise/types'
import { createCandidateOutputFixture } from '../helpers/candidate-execution-fixture'
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
    observing: () => observed.size > 0,
    creates: () => creates,
    destroys: () => destroys,
    dispatches: () => dispatches,
  }
}

/** Captures deterministic workspace bytes through the real artifact persistence boundary. */
function evidenceRetention(): ProviderWorkspaceRetentionPort {
  const { outputArtifacts } = createCandidateOutputFixture()
  return {
    timeoutMs: 5_000,
    artifacts: outputArtifacts,
    async capture(context) {
      return (
        await captureAgentCandidateWorkspaceFiles(
          [{ path: 'turn.txt', mode: 0o644, bytes: Uint8Array.from(Buffer.from('partial\n')) }],
          { artifactPersistence: { executionId: context.executionId, outputArtifacts } },
        )
      ).snapshot
    },
  }
}

function ofKind<K extends SpawnEvent['kind']>(
  events: readonly SpawnEvent[],
  kind: K,
): Array<Extract<SpawnEvent, { kind: K }>> {
  return events.filter((event): event is Extract<SpawnEvent, { kind: K }> => event.kind === kind)
}

/** A leaf whose provider execution is retained and whose kept source is evidence. */
function retainedLeaf(
  provider: AgentEnvironmentProvider,
  workspaceRetention = evidenceRetention(),
): Agent<unknown, string> {
  const profile = testAgentProfile('leaf')
  return Object.assign(
    { name: 'leaf', act: async () => 'unused' },
    {
      executorSpec: {
        profile,
        harness: profile.harness,
        executorFactory: providerAsExecutor(provider, { workspaceRetention }),
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

describe('a cancelled run that keeps a retained environment for evidence', () => {
  it('stops the root harness process before it settles and records its usage as unknown', async () => {
    const directory = await scratch('native-stop-owner-')
    const proxy = await coordinationProxy()
    proxies.push(proxy)
    const runDir = join(directory, 'run')
    const runId = 'native-stop-owner'
    const context = createFileRunContext(runDir)
    const live = liveProcessProvider(join(directory, 'provider.json'))
    const workspaceRetention = evidenceRetention()
    const backend = { backend: 'provider' as const, provider: live.provider, workspaceRetention }

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
    // The box is kept for evidence, and nothing runs inside it any more.
    expect(live.destroys()).toBe(0)
    expect(result.teardownUnconfirmed?.[0]?.kept).toMatchObject([{ keptFor: 'evidence' }])
    expect(running(harness!)).toBe(false)
    const events = (await context.journal.loadTree(runId)) ?? []
    const teardown = ofKind(events, 'environment-teardown').filter((event) => event.id === runId)
    expect(teardown.at(-1)).toMatchObject({
      destroyed: false,
      detail: expect.stringMatching(/stopped at .*; usage unknown: killed at /),
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
      expect(live.destroys()).toBe(0)
      expect(running(harness!)).toBe(false)
      const events = (await createFileRunContext(runDir).journal.loadTree('root')) ?? []
      const teardown = ofKind(events, 'environment-teardown').filter(
        (event) => event.id === 'root:s0',
      )
      expect(teardown.at(-1)).toMatchObject({
        destroyed: false,
        detail: expect.stringMatching(/stopped at .*; usage unknown: killed at /),
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
    expect(live.destroys()).toBe(0)
  })
})

describe('a deadline that ends a retained turn', () => {
  // The node's settlement must cite a copy taken after its harness physically stopped.
  it('settles the node only after the stopped harness session is copied', async () => {
    const directory = await scratch('native-stop-deadline-settle-')
    const runDir = join(directory, 'run')
    const live = liveProcessProvider(join(directory, 'provider.json'))
    const retention = evidenceRetention()
    const harnessRunning = (): boolean => [...live.processes.values()].some(running)
    const copies: Array<{ scope: string; harnessRunning: boolean; storedAt: number }> = []
    const workspaceRetention: ProviderWorkspaceRetentionPort = {
      ...retention,
      // A copy taken while the turn runs, so the node holds a running copy when its deadline hits.
      nativeIntervalMs: 200,
      async capture(context) {
        const running = harnessRunning()
        const snapshot = await retention.capture(context)
        copies.push({ scope: 'workspace', harnessRunning: running, storedAt: Date.now() })
        return snapshot
      },
      async captureNative(context) {
        const running = harnessRunning()
        const snapshot = await retention.capture(context)
        copies.push({
          scope: `native:${context.phase}`,
          harnessRunning: running,
          storedAt: Date.now(),
        })
        return snapshot
      },
    }
    const worker = retainedLeaf(live.provider, workspaceRetention)
    await createSupervisor<string, string>().run(
      {
        name: 'root',
        act: async (_task, scope) => {
          scope.spawn(worker, 'child task', {
            key: 'work',
            budget: { maxIterations: 1, maxTokens: 100, deadlineMs: 1_500 },
          })
          expect(await scope.next()).toMatchObject({
            kind: 'down',
            reason: 'child deadline exceeded',
          })
          return 'root done'
        },
      },
      'root-task',
      {
        ...childRunContext(runDir),
      },
    )
    expect(copies.some((copy) => copy.harnessRunning)).toBe(true)
    const stopped = copies.find((copy) => !copy.harnessRunning)
    expect(stopped).toBeDefined()
    const events = (await createFileRunContext(runDir).journal.loadTree('root')) ?? []
    const settles = events.filter(
      (event) =>
        event.id === 'root:s0' && (event.kind === 'settled' || event.kind === 'reconciled'),
    )
    expect(settles.length).toBeGreaterThan(0)
    for (const event of settles) {
      expect(Date.parse((event as { at: string }).at)).toBeGreaterThanOrEqual(stopped!.storedAt)
    }
  })

  // Provider outcome persistence can lag the physical stop; the final copy waits for it.
  it('copies a stopped harness again until the provider records how it ended', async () => {
    const directory = await scratch('native-stop-deadline-ended-')
    const runDir = join(directory, 'run')
    const live = liveProcessProvider(join(directory, 'provider.json'))
    const retention = evidenceRetention()
    const harnessRunning = (): boolean => [...live.processes.values()].some(running)
    let stoppedAt: number | undefined
    const copies: Array<{ phase: string; outcome: string; storedAt: number }> = []
    const workspaceRetention: ProviderWorkspaceRetentionPort = {
      ...retention,
      async captureNative(context) {
        if (!harnessRunning()) stoppedAt ??= Date.now()
        // The provider records the outcome 1.2 s after the process is gone.
        const outcome =
          stoppedAt !== undefined && Date.now() - stoppedAt >= 1_200 ? 'cancelled' : 'unknown'
        const snapshot = await retention.capture(context)
        copies.push({ phase: context.phase ?? 'none', outcome, storedAt: Date.now() })
        return {
          snapshot,
          provenance: {
            status: 'reported' as const,
            environmentId: context.environment.id,
            executionId: context.executionId,
            workspaceScope: 'none' as const,
            attempts: [
              {
                executionId: context.controlRef?.executionId ?? context.executionId,
                ordinal: 1,
                providerSessionId: context.providerSessionId ?? 'session',
                nativeSessionIds: [],
                processIds: [],
                outcome,
                missingReasons: [],
              },
            ],
            missing: outcome === 'unknown' ? ['native_snapshot_live'] : [],
          },
        }
      },
    }
    const worker = retainedLeaf(live.provider, workspaceRetention)
    await createSupervisor<string, string>().run(
      {
        name: 'root',
        act: async (_task, scope) => {
          scope.spawn(worker, 'child task', {
            key: 'work',
            budget: { maxIterations: 1, maxTokens: 100, deadlineMs: 1_500 },
          })
          await scope.next()
          return 'root done'
        },
      },
      'root-task',
      {
        ...childRunContext(runDir),
      },
    )
    const final = copies.filter((copy) => copy.phase === 'failed')
    expect(final.map((copy) => copy.outcome)).toContain('unknown')
    expect(final.at(-1)?.outcome).toBe('cancelled')
    const events = (await createFileRunContext(runDir).journal.loadTree('root')) ?? []
    const settles = events.filter(
      (event) =>
        event.id === 'root:s0' && (event.kind === 'settled' || event.kind === 'reconciled'),
    )
    expect(settles.length).toBeGreaterThan(0)
    for (const event of settles) {
      expect(Date.parse((event as { at: string }).at)).toBeGreaterThanOrEqual(
        final.at(-1)!.storedAt,
      )
    }
  }, 30_000)
})

describe('terminal recovery of a previously admitted native process', () => {
  it.each(['deadline', 'cancelled', 'unknown', 'undispatched'] as const)(
    'stops the original process before capture/return on %s entry without dispatching',
    async (ending) => {
      const directory = await scratch('native-stop-terminal-resume-')
      const runDir = join(directory, 'run')
      const context = createFileRunContext(runDir)
      const live = liveProcessProvider(join(directory, 'provider.json'), {
        stopUnavailable: ending === 'unknown',
      })
      const retention = evidenceRetention()
      const copies: Array<{
        running: boolean
        executionId?: string
        environmentId: string
        sessionId?: string
      }> = []
      const workspaceRetention: ProviderWorkspaceRetentionPort = {
        ...retention,
        async capture(context) {
          copies.push({
            running: [...live.processes.values()].some(running),
            executionId: context.controlRef?.executionId,
            environmentId: context.environment.id,
            sessionId: context.providerSessionId ?? undefined,
          })
          throw new Error('terminal workspace capture refused')
        },
        async captureNative(context) {
          copies.push({
            running: [...live.processes.values()].some(running),
            executionId: context.controlRef?.executionId,
            environmentId: context.environment.id,
            sessionId: context.providerSessionId ?? undefined,
          })
          return retention.capture(context)
        },
      }
      const factory = providerAsExecutor(live.provider, { workspaceRetention })
      const worker = retainedLeaf(live.provider, workspaceRetention)
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
      copies.length = 0
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
          recoverExecutor: factory,
          retainedAtSettlement: 'release',
          signal: cancel.signal,
          teardownConfirmMs: 1_000,
        },
      )
      expect(result).toMatchObject({
        kind: 'no-winner',
        reason: ending === 'cancelled' ? 'cancelled' : 'deadline',
      })
      expect(running(harness!)).toBe(ending === 'unknown' || ending === 'undispatched')
      expect(running(canary)).toBe(true)
      expect({ creates: live.creates(), dispatches: live.dispatches() }).toEqual(before)
      if (ending === 'unknown' || ending === 'undispatched') expect(copies).toEqual([])
      else {
        expect(copies.length).toBeGreaterThan(0)
        expect(copies.some((copy) => copy.running)).toBe(false)
      }
      expect(live.destroys()).toBe(0) // Incomplete evidence keeps the stopped source.
      expect(result.teardownUnconfirmed?.[0]?.kept?.[0]).toMatchObject({ keptFor: 'evidence' })
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
      for (const copy of copies)
        expect(copy).toMatchObject({
          environmentId: original?.environmentId,
          executionId:
            admission.admission.phase === 'dispatched'
              ? admission.admission.controlRef.executionId
              : undefined,
          sessionId:
            admission.admission.phase === 'dispatched'
              ? admission.admission.controlRef.sessionId
              : undefined,
        })
      expect(ofKind(events, 'environment-teardown').at(-1)).toMatchObject({
        id: admission.id,
        environmentId: original?.environmentId,
        destroyed: false,
      })
    },
    30_000,
  )
})
