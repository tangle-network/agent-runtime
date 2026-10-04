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
import {
  type ProviderWorkspaceRetentionPort,
  providerAsExecutor,
} from '../../src/runtime/environment-provider'
import {
  describeRetainedNativeStops,
  stopRetainedNativeExecution,
} from '../../src/runtime/retained-native-stop'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { cancelRun } from '../../src/runtime/supervise/run-layout'
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

/**
 * A retained provider whose dispatch starts a real native process, the way the Tangle sidecar
 * starts a harness CLI. The process runs in its own process group and ignores whether anyone
 * observes it: the event stream blocks until the process exits, and closing the stream does not
 * stop it. Only the exact cancellation does, by signalling the whole group, as the sidecar's
 * `/agents/run/cancel` does.
 */
function liveProcessProvider(
  stateFile: string,
  options: {
    /** Acknowledge a stop as `cancel_requested` and end the process this much later, the way an
     *  asynchronous provider does. Its status reads `running` until the process exits. */
    readonly asynchronousStopMs?: number
  } = {},
) {
  const processes = new Map<string, ChildProcess>()
  // Executions whose event stream Runtime opened: it is observing the native process.
  const observed = new Set<string>()
  const base = durableRetainedProvider(stateFile)
  let creates = 0
  let destroys = 0
  let token = ''
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    dispatch: async (turn) => {
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
        status: async (statusOptions) =>
          running(harness()) ? 'running' : await session.status(statusOptions),
        cancelRun: async (request, cancelOptions) => {
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
      token ||= input.env?.AGENT_RUNTIME_COORDINATION_TOKEN ?? ''
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
  }
}

/** Capture always succeeds but never carries a verified receipt for an unsettled turn, so the
 *  source environment is kept for evidence, as it was on both Discovery runs. */
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
function retainedLeaf(provider: AgentEnvironmentProvider): Agent<unknown, string> {
  const profile = testAgentProfile('leaf')
  return Object.assign(
    { name: 'leaf', act: async () => 'unused' },
    {
      executorSpec: {
        profile,
        harness: profile.harness,
        executorFactory: providerAsExecutor(provider, { workspaceRetention: evidenceRetention() }),
      },
    },
  )
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

    cancelRun(runDir, 'operator-cancel', { source: 'operator', reason: 'no subscription spend' })
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

  it('stops each child harness process before it settles and records its usage as unknown', async () => {
    const directory = await scratch('native-stop-child-')
    const runDir = join(directory, 'run')
    const live = liveProcessProvider(join(directory, 'provider.json'))
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
        ...createFileRunContext(runDir),
        runId: 'root',
        budget: { maxIterations: 10, maxTokens: 100 },
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ name: 'root-profile' }),
          taskDigest: canonicalCandidateDigest('root-task'),
        },
        retainedAtSettlement: 'release',
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
  })

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
        ...createFileRunContext(runDir),
        runId: 'root',
        budget: { maxIterations: 10, maxTokens: 100 },
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ name: 'root-profile' }),
          taskDigest: canonicalCandidateDigest('root-task'),
        },
        retainedAtSettlement: 'release',
      },
    )
    expect(stoppedWhileLive).toBe(true)
    expect(result.kind).toBe('winner')
    expect(live.destroys()).toBe(0)
  })
  it('waits for a stop the provider accepts asynchronously before the run settles', async () => {
    const directory = await scratch('native-stop-async-')
    const runDir = join(directory, 'run')
    const live = liveProcessProvider(join(directory, 'provider.json'), {
      asynchronousStopMs: 1_500,
    })
    const cancel = new AbortController()
    const settling = createSupervisor<string, string>().run(
      {
        name: 'root',
        act: async (_task, scope) => {
          scope.spawn(retainedLeaf(live.provider), 'child task', {
            key: 'work',
            budget: { maxIterations: 1, maxTokens: 100 },
          })
          await scope.next()
          return 'root done'
        },
      },
      'root-task',
      {
        ...createFileRunContext(runDir),
        runId: 'root',
        budget: { maxIterations: 10, maxTokens: 100 },
        rootIdentity: {
          profileDigest: canonicalCandidateDigest({ name: 'root-profile' }),
          taskDigest: canonicalCandidateDigest('root-task'),
        },
        retainedAtSettlement: 'release',
        signal: cancel.signal,
      },
    )
    await expect.poll(() => live.observing(), { timeout: 10_000 }).toBe(true)
    const [harness] = [...live.processes.values()]

    cancel.abort('operator cancelled the run')
    const result = await settling

    expect(result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
    expect(live.destroys()).toBe(0)
    expect(running(harness!)).toBe(false)
    const events = (await createFileRunContext(runDir).journal.loadTree('root')) ?? []
    expect(
      ofKind(events, 'environment-teardown')
        .filter((event) => event.id === 'root:s0')
        .at(-1),
    ).toMatchObject({ detail: expect.stringMatching(/stopped at .*; usage unknown: killed at /) })
  })

  it('answers within its deadline when the provider cannot be reached to reconnect', async () => {
    const stalled: AgentEnvironmentProvider = {
      name: 'stalled',
      capabilities: () => new Promise(() => {}),
      create: () => new Promise(() => {}),
      get: () => new Promise(() => {}),
    }
    const started = Date.now()
    const stop = await stopRetainedNativeExecution({
      provider: stalled,
      controlRef: {
        runId: 'run-1',
        provider: 'stalled',
        environmentId: 'environment-1',
        sessionId: 'session-1',
        executionId: 'execution-1',
        requestDigest: canonicalCandidateDigest('request-1'),
      },
      signal: AbortSignal.timeout(200),
    })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(stop).toMatchObject({ executionId: 'execution-1', effect: 'unknown' })
    expect(describeRetainedNativeStops([stop])).toContain('stop unconfirmed')
  })
})
