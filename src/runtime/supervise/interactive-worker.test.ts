import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentEnvironment,
  type AgentEnvironmentCapabilities,
  type AgentEnvironmentProvider,
  type AgentInteractiveSession,
  type AgentInteractiveSessionControlClaim,
  type AgentInteractiveSessionControlClaimAcknowledgement,
  type AgentInteractiveSessionPromptAcknowledgement,
  type AgentInteractiveSessionPromptCommand,
  type AgentInteractiveSessionRef,
  AgentInteractiveSessionRefSchema,
  type AgentInteractiveSessionStart,
  type AgentInteractiveSessionStatus,
  type AgentInteractiveSessionStopAcknowledgement,
  type AgentInteractiveSessionStopCommand,
  type AgentInteractiveTerminalSession,
  type AgentProfile,
  agentInteractiveSessionControlClaimRequestDigest,
  agentInteractiveSessionStopRequestDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { CreateAgentEnvironmentInput } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { loadTopSnapshot } from '../../tui/top-model'
import type { ToolLoopChat } from '../tool-loop'
import {
  interactiveAdmissionSeamKey,
  readWorkerInteractiveAdmissions,
  writeWorkerInteractiveAdmission,
} from './interactive-admission'
import { workerFromInteractiveProvider } from './interactive-worker'
import { provisionSupervisor } from './provision-supervisor'
import {
  cancelWorker,
  readWorkerCancellation,
  readWorkerSteerAcknowledgement,
  supervisorRunDir,
  writeWorkerSteer,
} from './run-layout'
import { superviseWithTestBrain } from './supervise'
import type { AgentSpec, ExecutorContext, WorkerInteractiveSession } from './types'
import { attachWorker } from './worker-interactive'

const profile: AgentProfile = {
  name: 'interactive worker fixture',
  harness: 'codex',
  model: { provider: 'openai', default: 'openai/gpt-5' },
}

describe('workerFromInteractiveProvider', () => {
  it('runs one provider process, persists admissions, retries steer, attaches, and cleans up', async () => {
    const fixture = interactiveProviderFixture()
    const root = mkdtempSync(join(tmpdir(), 'agent-runtime-interactive-'))
    try {
      const admissions: string[] = []
      const makeWorker = workerFromInteractiveProvider(fixture.provider, {
        environment: {
          metadata: { purpose: 'interactive-test', secret: 'never-persist-this' },
        },
        pollIntervalMs: 1,
        destroyEnvironmentOnTeardown: true,
      })
      const worker = makeWorker(profile, {
        assignmentId: 'assignment-1',
        parentNodeId: 'root',
        budget: { maxIterations: 2, maxTokens: 100 },
        task: 'Inspect the workspace',
        label: 'worker',
      }) as AgentWithExecutorSpec
      const signal = new AbortController().signal
      const context: ExecutorContext = {
        signal,
        node: {
          rootId: 'root',
          parentId: 'root',
          nodeId: 'root:s0',
          attemptId: 'attempt-1',
        },
        seams: {
          [interactiveAdmissionSeamKey]: async (
            admission: Parameters<typeof writeWorkerInteractiveAdmission>[2],
          ) => {
            admissions.push(admission.phase)
            writeWorkerInteractiveAdmission(root, 'root:s0', admission, () => 1_725_000_000_000)
          },
        },
      }
      const executor = worker.executorSpec.executorFactory!(worker.executorSpec, context)
      const stream = executor.execute('Inspect the workspace', signal)
      if (stream instanceof Promise) throw new Error('interactive executor must stream')
      const iterator = stream[Symbol.asyncIterator]()
      await expect(iterator.next()).resolves.toMatchObject({
        value: { kind: 'iteration' },
        done: false,
      })
      await expect(executor.interactiveReady!()).resolves.toMatchObject({ status: 'available' })
      expect(admissions).toEqual([
        'interactive_intent',
        'interactive_environment',
        'interactive_started',
      ])

      const session = availableSession(executor.interactive!())
      const control = await claimControl(session, 'terminal-test')
      const terminal = await session.attach({ control })
      await terminal.input({ data: 'ls\n' })
      await terminal.resize({ cols: 100, rows: 30 })
      await terminal.detach()
      await expect(collect(terminal.events({ since: 0 }))).resolves.toEqual([
        { type: 'ready', cols: 120, rows: 40 },
        { type: 'output', seq: 1, data: 'fixture output' },
      ])

      expect(executor.deliver?.({ steer: 'continue' })).toBe(true)
      await waitFor(() => fixture.stats.prompts.length === 1)
      expect(executor.deliver?.({ steer: 'continue' })).toBe(true)
      await waitFor(() => fixture.stats.prompts.length === 2)
      expect(fixture.stats.prompts[0]?.operationId).toBe(fixture.stats.prompts[1]?.operationId)
      expect(fixture.stats.prompts.map((prompt) => prompt.status)).toEqual(['accepted', 'replayed'])

      const stop = await executor.cancel!({ operationId: 'cancel-1', reason: 'test stop' })
      const retry = await executor.cancel!({ operationId: 'cancel-1', reason: 'test stop' })
      expect(stop.status).toBe('accepted')
      expect(stop.effect).toBe('cancelled')
      expect(retry).toEqual(stop)
      expect(fixture.stats.stops).toHaveLength(1)

      await expect(iterator.next()).resolves.toMatchObject({ done: false })
      await expect(iterator.next()).resolves.toMatchObject({ done: false })
      await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
      expect(() => executor.resultArtifact()).toThrow(/before execution settled/u)

      await expect(executor.teardown('infinity')).resolves.toEqual({ destroyed: true })
      await expect(executor.teardown('infinity')).resolves.toEqual({ destroyed: true })
      expect(fixture.stats.destroyCalls).toBe(1)

      const durable = readWorkerInteractiveAdmissions(root, 'root:s0')
      expect(durable.map((entry) => entry.phase)).toEqual(admissions)
      expect(JSON.stringify(durable)).not.toContain('never-persist-this')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reconnects the exact provider process after a fresh adapter is created', async () => {
    const fixture = interactiveProviderFixture()
    const first = await startFixtureProcess(
      fixture.provider,
      'reconnect-environment',
      'reconnect-process',
    )
    const restartedProvider = fixture.provider
    const second = await import('./../retained-interactive').then(
      ({ reconnectRetainedInteractiveRun }) =>
        reconnectRetainedInteractiveRun({ provider: restartedProvider, ref: first.ref }),
    )
    if (second === null) throw new Error('expected provider rediscovery')
    expect(second.ref).toEqual(first.ref)
    await expect(second.status()).resolves.toMatchObject({ state: 'running', ref: first.ref })
    const control = await claimControl(second, 'restarted-coordinator')
    const terminal = await second.attach({ control })
    await terminal.close()
    expect(fixture.stats.getCalls).toBeGreaterThan(0)
    await second.stop({
      operationId: 'reconnect-stop',
      ref: second.ref,
      control,
      requestDigest: agentInteractiveSessionStopRequestDigest({
        operationId: 'reconnect-stop',
        ref: second.ref,
        control,
      }),
    })
  })

  it('can retain provider ownership when teardown cleanup is disabled', async () => {
    const fixture = interactiveProviderFixture()
    const worker = workerFromInteractiveProvider(fixture.provider, {
      pollIntervalMs: 1,
      destroyEnvironmentOnTeardown: false,
    })(profile, {
      assignmentId: 'retained-environment',
      parentNodeId: 'root',
      budget: { maxIterations: 2, maxTokens: 100 },
      task: 'Leave the environment available',
      label: 'worker',
    }) as AgentWithExecutorSpec
    const context: ExecutorContext = {
      signal: new AbortController().signal,
      node: {
        rootId: 'root',
        parentId: 'root',
        nodeId: 'root:s0',
        attemptId: 'attempt-retained',
      },
      seams: {},
    }
    const executor = worker.executorSpec.executorFactory!(worker.executorSpec, context)
    const stream = executor.execute('Leave the environment available', context.signal)
    if (stream instanceof Promise) throw new Error('interactive executor must stream')
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()
    const handle = availableSession(await executor.interactiveReady!())
    await claimControl(handle, 'retained-environment')
    await executor.cancel!({ operationId: 'retained-stop', reason: 'finish test' })
    await expect(iterator.next()).resolves.toMatchObject({ done: false })
    await expect(iterator.next()).resolves.toMatchObject({ done: false })
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
    await expect(executor.teardown('infinity')).resolves.toEqual({ destroyed: true })
    expect(fixture.stats.destroyCalls).toBe(0)
  })

  it('creates a durable supervisor root, spawns a live worker, and attaches through the public API', async () => {
    const fixture = interactiveProviderFixture()
    const root = mkdtempSync(join(tmpdir(), 'agent-runtime-supervisor-interactive-'))
    const workerProfile: AgentProfile = {
      name: 'supervised interactive worker',
      harness: 'codex',
      model: { provider: 'openai', default: 'openai/gpt-5' },
    }
    let turn = 0
    const brain: ToolLoopChat = async () => {
      turn += 1
      if (turn === 1) {
        return {
          toolCalls: [
            {
              id: 'spawn-worker',
              name: 'spawn_worker',
              arguments: JSON.stringify({
                profile: workerProfile,
                task: 'wait for an external terminal controller',
                label: 'interactive worker',
              }),
            },
          ],
        }
      }
      if (turn === 2) {
        return {
          toolCalls: [{ id: 'wait-worker', name: 'await_event', arguments: '{}' }],
        }
      }
      return { content: 'worker stopped', toolCalls: [] }
    }
    try {
      const run = superviseWithTestBrain(
        {
          name: 'interactive supervisor',
          harness: 'cli-base',
          model: { provider: 'openai', default: 'openai/gpt-5' },
        },
        'coordinate one interactive worker',
        {
          budget: { maxIterations: 20, maxTokens: 1_000 },
          runDir: root,
          runId: 'interactive-supervisor',
          makeWorkerAgent: workerFromInteractiveProvider(fixture.provider, {
            pollIntervalMs: 1,
          }),
          brain,
        },
      )
      const attached = await waitForAttached(root, 'interactive-supervisor:s0', fixture.provider)
      const control = await claimControl(attached.handle, 'external-controller')
      const terminal = await attached.handle.attach({ control })
      await terminal.input({ data: 'status\n' })
      await terminal.resize({ cols: 100, rows: 30 })
      await terminal.close()
      const stopMaterial = {
        operationId: 'external-stop',
        ref: attached.handle.ref,
        control,
      }
      const stopped = await attached.handle.stop({
        ...stopMaterial,
        requestDigest: agentInteractiveSessionStopRequestDigest(stopMaterial),
      })
      expect(stopped.status).toBe('accepted')
      const result = await run
      expect(result.kind).toBe('no-winner')
      expect(fixture.stats.destroyCalls).toBe(1)
      expect(readWorkerInteractiveAdmissions(root, 'interactive-supervisor:s0')).toHaveLength(3)
      expect(
        JSON.stringify(readWorkerInteractiveAdmissions(root, 'interactive-supervisor:s0')),
      ).not.toContain('secret')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('provisionSupervisor', () => {
  it('provisions a real root and worker, exposes controls, attaches, and cleans up exactly once', async () => {
    const fixture = interactiveProviderFixture()
    const root = mkdtempSync(join(tmpdir(), 'agent-runtime-provision-'))
    try {
      const provisioned = await provisionSupervisor({
        invocationId: 'provision-lifecycle-1',
        task: 'Inspect the assigned workspace',
        workerEnvironment: {
          workspace: { cwd: { base: 'repository', path: '.' } },
          metadata: { purpose: 'provision-test' },
        },
        workspaceDir: root,
        timeoutMs: 5_000,
        pollMs: 2,
        profile,
        connection: { provider: fixture.provider },
      })
      expect(provisioned.rootDir).toBe(root)
      expect(provisioned.supervisorId).toMatch(/^runtime-supervisor-[a-f0-9]{64}$/u)
      expect(provisioned.workerId).toBe(`${provisioned.supervisorId}:s0`)
      expect(provisioned.providers).toBe(fixture.provider)
      expect(provisioned.terminalTakeover).toBe('required')
      expect(fixture.stats.createInputs[0]).toMatchObject({
        workspace: { cwd: { base: 'repository', path: '.' } },
        metadata: {
          purpose: 'provision-test',
          runtime: 'agent-runtime',
          invocationId: 'provision-lifecycle-1',
        },
      })
      expect(
        JSON.parse(
          readFileSync(
            join(supervisorRunDir(root, provisioned.supervisorId), 'state.json'),
            'utf8',
          ),
        ),
      ).toMatchObject({ task: 'Inspect the assigned workspace' })

      const supervisor = loadTopSnapshot(root).supervisors.find(
        (candidate) => candidate.id === provisioned.supervisorId,
      )
      expect(supervisor?.workers).toHaveLength(1)
      expect(supervisor?.workers[0]).toMatchObject({
        id: provisioned.workerId,
        status: 'running',
      })
      await waitForAsync(
        () => loadTopSnapshot(root).supervisors[0]?.workers[0]?.metered.iterations === 1,
        'worker progress',
      )

      const eventDir = supervisorRunDir(root, provisioned.supervisorId)
      const attached = await attachWorker(eventDir, provisioned.workerId, {
        providers: fixture.provider,
      })
      expect(attached.status).toBe('available')
      if (attached.status === 'available') {
        const control = await claimControl(attached.handle, 'provision-lifecycle-terminal')
        const terminal = await attached.handle.attach({ control })
        await expect(terminal.close()).resolves.toMatchObject({ status: 'closed' })
      }

      const firstSteer = writeWorkerSteer(root, provisioned.supervisorId, provisioned.workerId, {
        operationId: 'provision-steer-1',
        message: 'Continue the assigned task',
        source: 'provision-test',
        interrupt: false,
      })
      const retrySteer = writeWorkerSteer(root, provisioned.supervisorId, provisioned.workerId, {
        operationId: 'provision-steer-1',
        message: 'Continue the assigned task',
        source: 'provision-test',
        interrupt: false,
      })
      expect(firstSteer.replayed).toBe(false)
      expect(retrySteer.replayed).toBe(true)
      await waitForAsync(
        () => readWorkerSteerAcknowledgement(eventDir, 'provision-steer-1')?.effect === 'delivered',
        'steer acknowledgement',
      )
      expect(fixture.stats.prompts).toHaveLength(1)

      const queuedCancel = cancelWorker(eventDir, provisioned.workerId, 'provision-cancel-1', {
        reason: 'provision test cleanup',
        source: 'provision-test',
      })
      expect(queuedCancel.effect).toBe('unknown')
      await waitForAsync(
        () => readWorkerCancellation(eventDir, 'provision-cancel-1')?.effect === 'cancelled',
        'cancel acknowledgement',
      )
      const cancellation = readWorkerCancellation(eventDir, 'provision-cancel-1')
      expect(cancellation).toMatchObject({
        operationId: 'provision-cancel-1',
        worker: provisioned.workerId,
        effect: 'cancelled',
      })
      expect(cancellation?.terminated).toContain(provisioned.workerId)
      expect(
        cancelWorker(eventDir, provisioned.workerId, 'provision-cancel-1', {
          reason: 'provision test cleanup',
          source: 'provision-test',
        }),
      ).toEqual(cancellation)
      await expect(
        provisionSupervisor({
          invocationId: 'provision-lifecycle-1',
          task: 'Inspect the assigned workspace',
          workspaceDir: root,
          timeoutMs: 5_000,
          pollMs: 2,
          profile,
          connection: { provider: fixture.provider },
        }),
      ).rejects.toMatchObject({ unavailable: true })

      const receipt = await provisioned.cleanup()
      expect(receipt).toEqual({
        status: 'completed',
        rootDir: root,
        supervisorId: provisioned.supervisorId,
        workerId: provisioned.workerId,
        supervisorStatus: receipt.supervisorStatus,
        workerStatus: 'down',
        resourcesReleased: true,
        remainingResources: [],
      })
      await expect(provisioned.cleanup()).resolves.toEqual(receipt)
      expect(fixture.stats.destroyCalls).toBe(1)
      const finalWorker = loadTopSnapshot(root).supervisors[0]?.workers[0]
      expect(finalWorker?.status).toBe('down')
      expect(finalWorker?.spend.iterations).toBe(1)
      expect(finalWorker?.metered.iterations).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed when the caller supplies a provider that cannot reconnect', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-runtime-provision-unavailable-'))
    try {
      const provider = {
        name: 'non-reconnectable-provider',
        capabilities: () => fixtureCapabilities,
      } as AgentEnvironmentProvider
      await expect(
        provisionSupervisor({
          invocationId: 'provision-unavailable-1',
          task: 'Inspect the assigned workspace',
          workspaceDir: root,
          profile,
          connection: { provider },
        }),
      ).rejects.toMatchObject({ unavailable: true })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires an explicit provider connection instead of process defaults', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-runtime-provision-connection-'))
    try {
      await expect(
        provisionSupervisor({
          invocationId: 'provision-connection-required-1',
          task: 'Inspect the assigned workspace',
          workspaceDir: root,
          profile,
          connection: undefined as never,
        }),
      ).rejects.toMatchObject({ unavailable: true })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses timeoutMs for the live lifecycle after worker admission', async () => {
    const fixture = interactiveProviderFixture()
    const root = mkdtempSync(join(tmpdir(), 'agent-runtime-provision-deadline-'))
    try {
      const provisioned = await provisionSupervisor({
        invocationId: 'provision-lifecycle-deadline-1',
        task: 'Inspect the assigned workspace',
        workspaceDir: root,
        timeoutMs: 2_000,
        pollMs: 2,
        profile,
        connection: { provider: fixture.provider },
      })

      expect(fixture.stats.stops).toHaveLength(0)
      await waitForAsync(
        () => fixture.stats.stops.length === 1,
        'full supervisor lifecycle deadline',
        1_500,
      )
      expect(fixture.stats.stops[0]?.status).toBe('accepted')
      expect(fixture.stats.destroyCalls).toBe(1)

      await expect(provisioned.cleanup()).resolves.toMatchObject({
        workerStatus: 'down',
        resourcesReleased: true,
        remainingResources: [],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

type AgentWithExecutorSpec = ReturnType<ReturnType<typeof workerFromInteractiveProvider>> & {
  executorSpec: AgentSpec
}

async function startFixtureProcess(
  provider: AgentEnvironmentProvider,
  environmentIdempotencyKey: string,
  interactiveIdempotencyKey: string,
) {
  const { startRetainedInteractiveRun } = await import('./../retained-interactive')
  return startRetainedInteractiveRun({
    provider,
    environment: { profile, idempotencyKey: environmentIdempotencyKey },
    interactiveIdempotencyKey,
    onAdmission: async () => {},
  })
}

function availableSession(session: WorkerInteractiveSession) {
  if (session.status !== 'available') throw new Error(`worker is unavailable: ${session.reason}`)
  return session.handle
}

async function claimControl(
  session: AgentInteractiveSession,
  holderId: string,
): Promise<AgentInteractiveSessionControlClaim> {
  let generation = 0
  for (;;) {
    const material = {
      operationId: `claim-${holderId}-${generation}`,
      ref: session.ref,
      holderId,
      expectedGeneration: generation,
    }
    const acknowledgement = await session.claimControl({
      ...material,
      requestDigest: agentInteractiveSessionControlClaimRequestDigest(material),
    })
    if (acknowledgement.status === 'accepted' || acknowledgement.status === 'replayed') {
      if (!acknowledgement.control) throw new Error('fixture claim omitted control')
      return acknowledgement.control
    }
    if (acknowledgement.currentGeneration === undefined) {
      throw new Error('fixture claim did not advance generation')
    }
    generation = acknowledgement.currentGeneration
  }
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const event of events) result.push(event)
  return result
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('fixture condition did not become true')
}

async function waitForAsync(
  predicate: () => boolean,
  label: string,
  maxAttempts = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`fixture condition did not become true: ${label}`)
}

async function waitForAttached(
  eventDir: string,
  workerId: string,
  provider: AgentEnvironmentProvider,
): Promise<Extract<WorkerInteractiveSession, { status: 'available' }>> {
  let last: WorkerInteractiveSession | undefined
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const session = await attachWorker(eventDir, workerId, { providers: provider })
    last = session
    if (session.status === 'available') return session
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`worker ${workerId} did not become attachable: ${JSON.stringify(last)}`)
}

interface FixturePrompt extends AgentInteractiveSessionPromptCommand {
  status: 'accepted' | 'replayed'
}

interface FixtureStop extends AgentInteractiveSessionStopCommand {
  status: 'accepted' | 'replayed'
}

interface FixtureProcess {
  readonly ref: AgentInteractiveSessionRef
  generation: number
  control: AgentInteractiveSessionControlClaim
  state: 'running' | 'exited'
  readonly claims: Map<string, AgentInteractiveSessionControlClaimAcknowledgement>
  readonly prompts: Map<string, AgentInteractiveSessionPromptAcknowledgement>
  readonly stops: Map<string, AgentInteractiveSessionStopAcknowledgement>
}

function interactiveProviderFixture(): {
  provider: AgentEnvironmentProvider
  stats: {
    readonly prompts: FixturePrompt[]
    readonly stops: FixtureStop[]
    readonly createInputs: CreateAgentEnvironmentInput[]
    createCalls: number
    createEffects: number
    getCalls: number
    destroyCalls: number
  }
} {
  const environments = new Map<string, AgentEnvironment>()
  const processes = new Map<string, FixtureProcess>()
  const stats = {
    prompts: [] as FixturePrompt[],
    stops: [] as FixtureStop[],
    createInputs: [] as CreateAgentEnvironmentInput[],
    createCalls: 0,
    createEffects: 0,
    getCalls: 0,
    destroyCalls: 0,
  }
  const provider: AgentEnvironmentProvider = {
    name: 'fixture-provider',
    capabilities: () => fixtureCapabilities,
    async create(input) {
      stats.createInputs.push(structuredClone(input))
      stats.createCalls += 1
      const key = input.idempotencyKey ?? `unkeyed-${stats.createCalls}`
      const prior = environments.get(key)
      if (prior) return prior
      const environment = makeEnvironment(
        `environment-${canonicalCandidateDigest({ key }).slice('sha256:'.length, 'sha256:'.length + 12)}`,
        provider,
        processes,
        stats,
      )
      environments.set(key, environment)
      stats.createEffects += 1
      return environment
    },
    async get(id) {
      stats.getCalls += 1
      return [...environments.values()].find((environment) => environment.id === id) ?? null
    },
  }
  return { provider, stats }
}

const fixtureCapabilities: AgentEnvironmentCapabilities = {
  profile: {
    namedProfiles: false,
    systemPrompt: { replace: true, append: true },
    instructions: true,
    tools: true,
    permissions: true,
    mcp: true,
    subagents: true,
    resources: {
      files: true,
      instructions: true,
      tools: true,
      skills: true,
      agents: true,
      commands: true,
    },
    hooks: true,
    modes: true,
    runtimeUpdate: true,
    validation: true,
  },
  streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
  sessions: { continue: true, list: true, messages: true },
  workspace: {
    read: true,
    write: true,
    exec: true,
    git: true,
    upload: true,
    download: true,
    cwdBases: { repository: true, host: true },
  },
  branching: { checkpoint: false, fork: false },
  placement: false,
  usage: false,
  confidential: false,
  interactiveAgent: {
    start: true,
    control: true,
    status: true,
    attach: true,
    reattach: true,
    sendPrompt: true,
    input: true,
    resize: true,
    stop: true,
  },
}

function makeEnvironment(
  id: string,
  provider: AgentEnvironmentProvider,
  processes: Map<string, FixtureProcess>,
  stats: {
    readonly prompts: FixturePrompt[]
    readonly stops: FixtureStop[]
    destroyCalls: number
  },
): AgentEnvironment {
  return {
    id,
    provider: provider.name,
    capabilities: fixtureCapabilities,
    async status() {
      return 'running'
    },
    async *stream() {},
    async destroy() {
      stats.destroyCalls += 1
    },
    async startInteractive(request) {
      const existing = processes.get(request.run.executionId)
      if (existing) return existing.ref
      const ref = fixtureRef(request)
      const process: FixtureProcess = {
        ref,
        generation: 1,
        control: fixtureControl(ref, 'provider', 1),
        state: 'running',
        claims: new Map(),
        prompts: new Map(),
        stops: new Map(),
      }
      processes.set(request.run.executionId, process)
      return ref
    },
    interactive(ref) {
      const process = processes.get(ref.run.executionId)
      if (!process) throw new Error('fixture process not found')
      return fixtureInteractive(process, stats)
    },
  }
}

function fixtureInteractive(
  process: FixtureProcess,
  stats: { readonly prompts: FixturePrompt[]; readonly stops: FixtureStop[] },
): AgentInteractiveSession {
  return {
    ref: process.ref,
    async claimControl(request) {
      const previous = process.claims.get(request.operationId)
      const requestDigest = request.requestDigest
      if (previous) return previous
      if (request.expectedGeneration !== process.generation) {
        const conflict: AgentInteractiveSessionControlClaimAcknowledgement = {
          operationId: request.operationId,
          requestDigest,
          ref: process.ref,
          status: 'conflict',
          conflictReason: 'generation_mismatch',
          currentGeneration: process.generation,
        }
        process.claims.set(request.operationId, conflict)
        return conflict
      }
      process.generation += 1
      process.control = fixtureControl(process.ref, request.holderId, process.generation)
      const accepted: AgentInteractiveSessionControlClaimAcknowledgement = {
        operationId: request.operationId,
        requestDigest,
        ref: process.ref,
        status: 'accepted',
        control: process.control,
      }
      process.claims.set(request.operationId, accepted)
      return accepted
    },
    async status(): Promise<AgentInteractiveSessionStatus> {
      return process.state === 'running'
        ? { state: 'running', ref: process.ref }
        : {
            state: 'exited',
            ref: process.ref,
            endedAt: '2026-08-28T00:00:01.000Z',
            reason: 'stopped',
            exitCode: 0,
          }
    },
    async attach(request): Promise<AgentInteractiveTerminalSession> {
      return {
        ref: {
          terminalSessionId: `terminal-${process.ref.run.executionId}`,
          parentExecutionId: process.ref.run.executionId,
          name: 'fixture terminal',
          shell: '/bin/sh',
          command: 'codex',
          cwd: '/workspace',
          cols: request.cols ?? 120,
          rows: request.rows ?? 40,
          connectionId: `connection-${process.ref.run.executionId}`,
          createdAt: '2026-08-28T00:00:00.000Z',
          lastActivityAt: '2026-08-28T00:00:00.000Z',
          expiresAt: '2099-01-01T00:00:00.000Z',
          isRunning: process.state === 'running',
          attachCount: 1,
        },
        control: request.control,
        cursors: { earliest: 0, latest: 1 },
        async input() {},
        async resize() {},
        async detach() {
          return {
            status: 'detached',
            terminalSessionId: `terminal-${process.ref.run.executionId}`,
          }
        },
        async close() {
          return {
            status: 'closed',
            terminalSessionId: `terminal-${process.ref.run.executionId}`,
          }
        },
        async *events() {
          yield { type: 'ready', cols: request.cols ?? 120, rows: request.rows ?? 40 }
          yield { type: 'output', seq: 1, data: 'fixture output' }
        },
      }
    },
    async sendPrompt(command): Promise<AgentInteractiveSessionPromptAcknowledgement> {
      const previous = process.prompts.get(command.operationId)
      if (previous) {
        stats.prompts.push({ ...command, status: 'replayed' })
        return { ...previous, status: 'replayed' }
      }
      const accepted: AgentInteractiveSessionPromptAcknowledgement = {
        operationId: command.operationId,
        requestDigest: command.requestDigest,
        ref: process.ref,
        control: command.control,
        status: 'accepted',
      }
      process.prompts.set(command.operationId, accepted)
      stats.prompts.push({ ...command, status: 'accepted' })
      return accepted
    },
    async stop(command): Promise<AgentInteractiveSessionStopAcknowledgement> {
      const previous = process.stops.get(command.operationId)
      if (previous) {
        stats.stops.push({ ...command, status: 'replayed' })
        return { ...previous, status: 'replayed' }
      }
      process.state = 'exited'
      const accepted: AgentInteractiveSessionStopAcknowledgement = {
        operationId: command.operationId,
        requestDigest: command.requestDigest,
        ref: process.ref,
        control: command.control,
        status: 'accepted',
        effect: 'stopped',
      }
      process.stops.set(command.operationId, accepted)
      stats.stops.push({ ...command, status: 'accepted' })
      return accepted
    },
  }
}

function fixtureRef(request: AgentInteractiveSessionStart): AgentInteractiveSessionRef {
  const receipt = {
    kind: 'agent-execution-preparation' as const,
    schemaVersion: 1 as const,
    preparationId: `preparation-${request.run.executionId}`,
    requestDigest: request.run.requestDigest,
    authoredProfileDigest: request.requestedProfileDigest,
    effectiveProfileDigest: request.requestedProfileDigest,
    backend: 'fixture-provider',
    harness: request.profile.harness,
    harnessVersion: '1.0.0',
    resolvedModel: {
      requested: request.profile.model?.default ?? 'unknown',
      resolved: request.profile.model?.default ?? 'unknown',
    },
    workspace: {
      leaseId: `lease-${request.run.executionId}`,
      provider: request.run.provider,
      identityDigest: digest('workspace-identity'),
      isolation: 'per-run' as const,
      sourceSnapshotDigest: digest('source-snapshot'),
      sourceSnapshotPolicy: {
        kind: 'provider-declared' as const,
        name: 'fixture-source',
        version: 1,
        digest: digest('source-policy'),
      },
      preparedWorkspaceDigest: digest('prepared-workspace'),
      profileActivationDigest: digest('profile-activation'),
    },
    axisResults: [],
    executionPlanDigest: digest('execution-plan'),
    materializer: { name: 'fixture-provider', version: '1' },
    expiresAtMs: 4_102_444_800_000,
  }
  return AgentInteractiveSessionRefSchema.parse({
    run: request.run,
    preparationReceipt: { ...receipt, digest: canonicalCandidateDigest(receipt) },
    incarnationId: `incarnation-${request.run.executionId}`,
    startedAt: '2026-08-28T00:00:00.000Z',
  })
}

function fixtureControl(
  ref: AgentInteractiveSessionRef,
  holderId: string,
  generation: number,
): AgentInteractiveSessionControlClaim {
  return {
    refDigest: canonicalCandidateDigest(ref),
    generation,
    leaseId: `lease-${holderId}-${generation}`,
    holderId,
    expiresAt: '2099-01-01T00:00:00.000Z',
  }
}

function digest(seed: string): `sha256:${string}` {
  return canonicalCandidateDigest({ seed })
}
