import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentExactRunControlRef,
  type AgentNativeContextContinuationResult,
  type AgentRunCancellationAcknowledgement,
  type AgentRunCancellationRequest,
  AgentRunCancellationRequestSchema,
  type InteractionCapabilities,
  interactionRequestDigest,
  interactionResponseCommandDigest,
  NativeContextContinuationRequestSchema,
  nativeContextContinuationRequestDigest,
  nativeContextContinuationTurnDigest,
  type RuntimeEventEnvelope,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentSession,
  AgentSessionStatus,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RetainedRunAdmissionError, RetainedRunDispatchBindingError } from '../errors'
import {
  type RetainedRunAdmission,
  type RetainedRunAdmissionHook,
  reconnectRetainedRun,
  recoverRetainedRun,
  startRetainedRun,
  startRetainedRunInEnvironment,
} from './retained-run'
import { createRetainedRunHandle } from './retained-run-handle'
import { mintRetainedIdentity } from './retained-run-start'

const childScript = new URL('../../tests/helpers/retained-run-child.ts', import.meta.url).pathname
const retainedRequestDigest = `sha256:${'a'.repeat(64)}` as const

function recordedAdmissions(): {
  admissions: RetainedRunAdmission[]
  onAdmission: RetainedRunAdmissionHook
} {
  const admissions: RetainedRunAdmission[] = []
  return {
    admissions,
    onAdmission: async (admission) => {
      assertDetachedAdmissionPhase(admission)
      admissions.push(admission)
    },
  }
}

function assertDetachedAdmissionPhase(admission: RetainedRunAdmission): void {
  switch (admission.phase) {
    case 'intent':
    case 'environment':
    case 'dispatched':
      return
    default: {
      const exhaustive: never = admission
      throw new Error(`unexpected detached admission: ${JSON.stringify(exhaustive)}`)
    }
  }
}

interface ChildExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

async function runChild(
  stateFile: string,
  referenceFile: string,
  phase:
    | 'start'
    | 'reconnect'
    | 'start-kill-intent'
    | 'recover-intent'
    | 'start-kill-dispatched'
    | 'recover-dispatched'
    | 'start-kill-environment'
    | 'recover-environment'
    | 'start-kill-live'
    | 'recover-live',
): Promise<ChildExit> {
  return await new Promise<ChildExit>((resolveChild, rejectChild) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', childScript, stateFile, referenceFile, phase],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', rejectChild)
    child.once('close', (code, signal) => resolveChild({ code, signal, stdout, stderr }))
  })
}

describe('retained runtime run control', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent-runtime-retained-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('reconstructs in a new process, resumes after an exclusive cursor, answers, and cancels', async () => {
    const stateFile = join(directory, 'provider.json')
    const referenceFile = join(directory, 'reference.json')

    const first = await runChild(stateFile, referenceFile, 'start')
    expect(first.code, first.stderr).toBe(0)
    expect(first.signal).toBeNull()
    const started = JSON.parse(await readFile(`${referenceFile}.output`, 'utf8')) as {
      first: { eventId: string; cursor: string; sequence: number; runId: string }
      controlRef: { runId: string }
    }
    expect(started.first).toMatchObject({
      eventId: 'event-0',
      cursor: 'event-0',
      sequence: 0,
      runId: started.controlRef.runId,
    })
    const admissions = JSON.parse(await readFile(`${referenceFile}.admissions`, 'utf8')) as Array<{
      phase: string
      sessionId?: string
      executionId?: string
      controlRef?: { runId: string }
    }>
    expect(admissions.map((admission) => admission.phase)).toEqual([
      'intent',
      'environment',
      'dispatched',
    ])
    expect(admissions[2]?.controlRef).toEqual(started.controlRef)
    // The child minted identity in its own process; re-mint here and compare.
    expect(admissions[0]).toMatchObject(mintRetainedIdentity('restart-proof', 'restart-proof'))

    const second = await runChild(stateFile, referenceFile, 'reconnect')
    expect(second.code, second.stderr).toBe(0)
    expect(second.signal).toBeNull()
    const reconnected = JSON.parse(await readFile(`${referenceFile}.output`, 'utf8')) as {
      events: Array<{ eventId: string; cursor: string; sequence: number; runId: string }>
      statusBefore: { status: string; runId: string; effect: string }
      interaction: { status: string; operationId: string }
      cancellation: {
        operationId: string
        status: string
        effect: string
        snapshot: { status: string; reason?: string }
      }
      continuation: {
        acknowledgement: { status: string; operationId: string }
        controlRef: { runId: string; executionId: string }
      }
      result: { text: string; success: boolean }
    }
    expect(
      reconnected.events.map(({ eventId, cursor, sequence }) => ({
        eventId,
        cursor,
        sequence,
      })),
    ).toEqual([
      { eventId: 'event-1', cursor: 'event-1', sequence: 1 },
      { eventId: 'event-2', cursor: 'event-2', sequence: 2 },
    ])
    expect(new Set(reconnected.events.map((event) => event.runId))).toEqual(
      new Set(['native-run-restart-native-operation']),
    )
    expect(reconnected.statusBefore).toMatchObject({ status: 'running', effect: 'unknown' })
    expect(reconnected.interaction).toMatchObject({
      operationId: 'answer-after-restart',
      status: 'accepted',
    })
    expect(reconnected.cancellation).toMatchObject({
      operationId: 'restart-cancel-operation',
      status: 'accepted',
      effect: 'cancelled',
      reason: 'test cleanup',
      snapshot: { status: 'cancelled', reason: 'test cleanup' },
    })
    expect(reconnected.continuation).toMatchObject({
      acknowledgement: {
        operationId: 'restart-native-operation',
        status: 'replayed',
      },
      controlRef: {
        runId: 'native-run-restart-native-operation',
        executionId: 'native-execution-restart-native-operation',
      },
    })
    expect(reconnected.result).toMatchObject({ text: 'durable result', success: true })

    const durableState = JSON.parse(await readFile(stateFile, 'utf8')) as {
      environments: Record<
        string,
        {
          sessions: Record<string, { status: string; nativeOperations: Record<string, unknown> }>
        }
      >
    }
    // The child omitted identity; this process re-mints the same coordinates.
    const minted = mintRetainedIdentity('restart-proof', 'restart-proof')
    expect(
      durableState.environments['environment-restart-proof']?.sessions[minted.sessionId]?.status,
    ).toBe('cancelled')
    expect(
      Object.keys(
        durableState.environments['environment-restart-proof']?.sessions[minted.sessionId]
          ?.nativeOperations ?? {},
      ),
    ).toEqual(['restart-native-operation'])
  })

  it('persists public headless intent before create and replays private values after a crash', async () => {
    const identity = mintRetainedIdentity('headless-intent-environment', 'headless-intent-turn')
    const controlRef = {
      runId: 'headless-intent-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      ...identity,
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: identity.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'recovered', success: true, sessionId: identity.sessionId }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    const environment = {
      profile: { name: 'worker' },
      idempotencyKey: 'headless-intent-environment',
      secrets: { TANGLE_TOKEN: 'headless-secret-value' },
      providerOptions: { credential: 'headless-provider-secret' },
    }
    const turn = { prompt: 'replay this exact turn', turnId: 'headless-intent-turn' }
    let creates = 0
    let created: CreateAgentEnvironmentInput | undefined
    const originalCreate = provider.create
    provider.create = async (input) => {
      creates += 1
      created = input
      return originalCreate(input)
    }
    const firstAdmissions: RetainedRunAdmission[] = []
    const failed = await startRetainedRun({
      provider,
      environment,
      turn,
      onAdmission: async (admission) => {
        firstAdmissions.push(admission)
        if (admission.phase === 'intent') throw new Error('coordinator crashed')
      },
    }).catch((error: unknown) => error)

    expect(failed).toBeInstanceOf(RetainedRunAdmissionError)
    expect((failed as RetainedRunAdmissionError).phase).toBe('intent')
    expect(creates).toBe(0)
    const intent = firstAdmissions[0]
    if (intent?.phase !== 'intent') throw new Error('expected the headless intent admission')
    expect(JSON.stringify(intent)).not.toContain('headless-secret-value')
    expect(JSON.stringify(intent)).not.toContain('headless-provider-secret')

    await expect(
      startRetainedRun({
        provider,
        environment,
        turn: { ...turn, prompt: 'changed replay material' },
        intent,
        onAdmission: async () => {},
      }),
    ).rejects.toThrow('retained run intent conflicts with replay material')
    expect(creates).toBe(0)

    await expect(
      startRetainedRun({
        provider,
        environment: {
          ...environment,
          secrets: { OTHER_TOKEN: 'headless-secret-value' },
        },
        turn,
        intent,
        onAdmission: async () => {},
      }),
    ).rejects.toThrow('retained run intent conflicts with replay material')
    expect(creates).toBe(0)

    const recoveryAdmissions = recordedAdmissions()
    const recovered = await recoverRetainedRun({
      provider,
      admission: intent,
      replay: {
        environment: {
          ...environment,
          secrets: { TANGLE_TOKEN: 'changed-low-entropy' },
        },
        turn,
      },
      onAdmission: recoveryAdmissions.onAdmission,
    })
    expect(recovered.outcome).toBe('recovered')
    expect(creates).toBe(1)
    expect(created?.metadata).toEqual({
      retainedIdempotencyKey: environment.idempotencyKey,
    })
    expect(created?.secrets).toEqual({ TANGLE_TOKEN: 'changed-low-entropy' })
    expect(created?.providerOptions).toEqual({ credential: 'headless-provider-secret' })
    expect(recoveryAdmissions.admissions.map((admission) => admission.phase)).toEqual([
      'environment',
      'dispatched',
    ])
  })

  it('recovers a headless intent after a coordinator SIGKILL before provider.create', async () => {
    const stateFile = join(directory, 'intent-crash-provider.json')
    const referenceFile = join(directory, 'intent-crash-reference.json')

    const killed = await runChild(stateFile, referenceFile, 'start-kill-intent')
    expect(killed.code).toBeNull()
    expect(killed.signal).toBe('SIGKILL')
    expect(existsSync(stateFile)).toBe(false)
    const intent = JSON.parse(await readFile(referenceFile, 'utf8')) as {
      phase: string
      sessionId: string
      executionId: string
      requestDigest: string
    }
    expect(intent).toMatchObject({
      phase: 'intent',
      sessionId: mintRetainedIdentity('kill-intent', 'kill-intent').sessionId,
    })

    const recovered = await runChild(stateFile, referenceFile, 'recover-intent')
    expect(recovered.code, recovered.stderr).toBe(0)
    expect(recovered.signal).toBeNull()
    const output = JSON.parse(await readFile(`${referenceFile}.output`, 'utf8')) as {
      controlRef: { environmentId: string; sessionId: string; executionId: string }
    }
    expect(output.controlRef).toMatchObject({
      environmentId: 'environment-kill-intent',
      sessionId: intent.sessionId,
      executionId: intent.executionId,
    })
    const recoveryAdmissions = JSON.parse(
      await readFile(`${referenceFile}.recovered-admissions`, 'utf8'),
    ) as Array<{ phase: string }>
    expect(recoveryAdmissions.map((admission) => admission.phase)).toEqual([
      'environment',
      'dispatched',
    ])
  })

  it('destroys exactly the environment this call created when dispatch fails', async () => {
    // Braid measured the opposite failure first: an unconditional destroy deleted a workspace a
    // same-key replay had returned. The provider's creation receipt is what separates the two.
    let destroys = 0
    const created = providerWithEnvironment({
      creation: 'created',
      async dispatch() {
        throw new Error('connection lost after dispatch')
      },
      async destroy() {
        destroys += 1
      },
    })
    await expect(
      startRetainedRun({
        provider: created,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'created-key' },
        turn: { prompt: 'go', turnId: 'created-turn' },
        onAdmission: recordedAdmissions().onAdmission,
      }),
    ).rejects.toThrow('connection lost after dispatch')
    expect(destroys).toBe(1)

    const replayed = providerWithEnvironment({
      creation: 'replayed',
      async dispatch() {
        throw new Error('connection lost after dispatch')
      },
      async destroy() {
        destroys += 1
      },
    })
    await expect(
      startRetainedRun({
        provider: replayed,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'replayed-key' },
        turn: { prompt: 'go', turnId: 'replayed-turn' },
        onAdmission: recordedAdmissions().onAdmission,
      }),
    ).rejects.toThrow('connection lost after dispatch')
    // A pre-existing environment another caller may hold survives the failure.
    expect(destroys).toBe(1)
  })

  it('reports both errors when destroying a created environment also fails', async () => {
    const created = providerWithEnvironment({
      creation: 'created',
      async dispatch() {
        throw new Error('connection lost after dispatch')
      },
      async destroy() {
        throw new Error('destroy refused')
      },
    })
    await expect(
      startRetainedRun({
        provider: created,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'aggregate-key' },
        turn: { prompt: 'go', turnId: 'aggregate-turn' },
        onAdmission: recordedAdmissions().onAdmission,
      }),
    ).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [
        expect.objectContaining({ message: 'connection lost after dispatch' }),
        expect.objectContaining({ message: 'destroy refused' }),
      ],
    })
  })

  it('keeps an environment after dispatch becomes uncertain, but cleans an unused one', async () => {
    let destroys = 0
    const uncertain = providerWithEnvironment({
      async dispatch() {
        throw new Error('connection lost after dispatch')
      },
      async destroy() {
        destroys += 1
      },
    })
    const uncertainRecorder = recordedAdmissions()
    await expect(
      startRetainedRun({
        provider: uncertain,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'environment-key' },
        turn: { prompt: 'go', turnId: 'turn-key' },
        onAdmission: uncertainRecorder.onAdmission,
      }),
    ).rejects.toThrow('connection lost after dispatch')
    expect(destroys).toBe(0)
    // The environment admission was durable before the uncertain dispatch.
    expect(uncertainRecorder.admissions.map((admission) => admission.phase)).toEqual([
      'intent',
      'environment',
    ])

    const unusable = providerWithEnvironment({
      dispatch: undefined,
      session: undefined,
      async destroy() {
        destroys += 1
      },
    })
    const unusableRecorder = recordedAdmissions()
    await expect(
      startRetainedRun({
        provider: unusable,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'unused-key' },
        turn: { prompt: 'go', turnId: 'unused-turn' },
        onAdmission: unusableRecorder.onAdmission,
      }),
    ).rejects.toThrow('does not expose detached session control')
    expect(destroys).toBe(1)
    // The durable intent remains, but the unusable environment is destroyed.
    expect(unusableRecorder.admissions.map((admission) => admission.phase)).toEqual(['intent'])
  })

  it('starts a fresh retained session inside an existing environment', async () => {
    const identity = mintRetainedIdentity('durable-environment-key', 'fresh-workspace-turn')
    const controlRef = {
      runId: 'fresh-run-in-existing-environment',
      provider: 'test-provider',
      environmentId: 'environment-1',
      ...identity,
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: identity.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({
        text: 'same workspace, fresh harness chat',
        success: true,
        sessionId: identity.sessionId,
        metadata: {
          runId: controlRef.runId,
          executionId: controlRef.executionId,
          requestDigest: controlRef.requestDigest,
        },
      }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    let createCalls = 0
    let destroyCalls = 0
    const getIds: string[] = []
    const listQueries: Array<Record<string, unknown> | undefined> = []
    let dispatched: AgentTurnInput | undefined
    const provider = providerWithEnvironment({
      async dispatch(input) {
        dispatched = input
        return { id: identity.sessionId, provider: 'test-provider', controlRef }
      },
      session(id) {
        if (id !== identity.sessionId) throw new Error('unexpected session id')
        return session
      },
      async destroy() {
        destroyCalls += 1
      },
    })
    provider.create = async () => {
      createCalls += 1
      throw new Error('existing-environment start must not create')
    }
    const get = provider.get!
    provider.get = async (id) => {
      getIds.push(id)
      return get(id)
    }
    provider.list = async (query) => {
      listQueries.push(query?.metadata)
      return [
        {
          id: 'environment-1',
          provider: 'test-provider',
          metadata: { retainedIdempotencyKey: 'durable-environment-key' },
        },
      ]
    }
    const recorder = recordedAdmissions()

    const run = await startRetainedRunInEnvironment({
      provider,
      environment: { id: 'environment-1', idempotencyKey: 'durable-environment-key' },
      turn: { prompt: 'inspect the existing workspace', turnId: 'fresh-workspace-turn' },
      onAdmission: recorder.onAdmission,
    })

    expect(createCalls).toBe(0)
    expect(destroyCalls).toBe(0)
    expect(getIds).toEqual(['environment-1'])
    expect(listQueries).toEqual([{ retainedIdempotencyKey: 'durable-environment-key' }])
    expect(dispatched).toEqual({
      prompt: 'inspect the existing workspace',
      turnId: 'fresh-workspace-turn',
      detach: true,
      ...identity,
    })
    expect(recorder.admissions).toMatchObject([
      {
        phase: 'environment',
        environmentId: 'environment-1',
        idempotencyKey: 'durable-environment-key',
        turnId: 'fresh-workspace-turn',
        ...identity,
      },
      {
        phase: 'dispatched',
        idempotencyKey: 'durable-environment-key',
        turnId: 'fresh-workspace-turn',
        controlRef,
      },
    ])
    await expect(run.result()).resolves.toMatchObject({
      text: 'same workspace, fresh harness chat',
      sessionId: identity.sessionId,
    })
  })

  it('fails before admission when an existing retained environment is unavailable or unusable', async () => {
    const missing = providerWithEnvironment({})
    missing.get = async () => null
    const missingRecorder = recordedAdmissions()
    await expect(
      startRetainedRunInEnvironment({
        provider: missing,
        environment: { id: 'missing-environment', idempotencyKey: 'missing-key' },
        turn: { prompt: 'go', turnId: 'missing-turn' },
        onAdmission: missingRecorder.onAdmission,
      }),
    ).rejects.toThrow('no longer holds environment')
    expect(missingRecorder.admissions).toEqual([])

    let destroyCalls = 0
    const unusable = providerWithEnvironment({
      dispatch: undefined,
      session: undefined,
      async destroy() {
        destroyCalls += 1
      },
    })
    const unusableRecorder = recordedAdmissions()
    await expect(
      startRetainedRunInEnvironment({
        provider: unusable,
        environment: { id: 'environment-1', idempotencyKey: 'existing-key' },
        turn: { prompt: 'go', turnId: 'existing-turn' },
        onAdmission: unusableRecorder.onAdmission,
      }),
    ).rejects.toThrow('does not expose detached session control')
    expect(destroyCalls).toBe(0)
    expect(unusableRecorder.admissions).toEqual([])

    const foreign = providerWithEnvironment({})
    const getForeign = foreign.get!
    foreign.get = async (id) => {
      const environment = await getForeign(id)
      return environment === null ? null : { ...environment, provider: 'other-provider' }
    }
    const foreignRecorder = recordedAdmissions()
    await expect(
      startRetainedRunInEnvironment({
        provider: foreign,
        environment: { id: 'environment-1', idempotencyKey: 'existing-key' },
        turn: { prompt: 'go', turnId: 'foreign-turn' },
        onAdmission: foreignRecorder.onAdmission,
      }),
    ).rejects.toThrow('reconstructed a different retained environment')
    expect(foreignRecorder.admissions).toEqual([])
  })

  it('fails before admission when retained environment ownership is not proven', async () => {
    let dispatchCalls = 0
    const mismatched = providerWithEnvironment({
      async dispatch() {
        dispatchCalls += 1
        throw new Error('dispatch must not run for a mismatched owner')
      },
    })
    mismatched.list = async () => [
      {
        id: 'environment-1',
        provider: 'test-provider',
        metadata: { retainedIdempotencyKey: 'owner-key' },
      },
    ]
    const mismatchedRecorder = recordedAdmissions()
    await expect(
      startRetainedRunInEnvironment({
        provider: mismatched,
        environment: { id: 'environment-1', idempotencyKey: 'attacker-key' },
        turn: { prompt: 'go', turnId: 'fresh-turn' },
        onAdmission: mismatchedRecorder.onAdmission,
      }),
    ).rejects.toThrow('could not bind environment "environment-1"')
    expect(dispatchCalls).toBe(0)
    expect(mismatchedRecorder.admissions).toEqual([])

    const unobservable = providerWithEnvironment({})
    const unobservableRecorder = recordedAdmissions()
    await expect(
      startRetainedRunInEnvironment({
        provider: unobservable,
        environment: { id: 'environment-1', idempotencyKey: 'owner-key' },
        turn: { prompt: 'go', turnId: 'fresh-turn' },
        onAdmission: unobservableRecorder.onAdmission,
      }),
    ).rejects.toThrow('cannot prove retained environment ownership')
    expect(unobservableRecorder.admissions).toEqual([])
  })

  it('allowlists a fresh retained start when JavaScript supplies stale run fields', async () => {
    const controlRef = {
      runId: 'fresh-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'fresh-session',
      executionId: 'fresh-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true, sessionId: controlRef.sessionId }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    let recorded: AgentTurnInput | undefined
    const provider = providerWithEnvironment({
      async dispatch(input) {
        recorded = input
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    const staleTurn = {
      prompt: 'fresh prompt',
      turnId: 'fresh-turn',
      runId: 'old-run',
      sessionId: 'old-session',
      executionId: 'old-execution',
      lastEventId: 'old-event',
      detach: false,
      controlRef: { ...controlRef, runId: 'old-run' },
      contextTransfer: { stale: true },
      nativeContinuation: { stale: true },
    } as unknown as AgentTurnInput & { turnId: string }

    await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'fresh-environment' },
      turn: staleTurn,
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    expect(recorded).toEqual({
      prompt: 'fresh prompt',
      turnId: 'fresh-turn',
      detach: true,
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
    })
  })

  it('injects explicit Runtime-owned identity into a retained dispatch', async () => {
    const controlRef = {
      runId: 'owned-execution',
      provider: 'test-provider',
      environmentId: 'owned-environment',
      sessionId: 'owned-session',
      executionId: 'owned-execution',
      requestDigest: retainedRequestDigest,
    }
    let recorded: AgentTurnInput | undefined
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true, sessionId: controlRef.sessionId }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      id: controlRef.environmentId,
      async dispatch(input) {
        recorded = input
        return { id: controlRef.sessionId, provider: controlRef.provider, controlRef }
      },
      session: () => session,
    })
    let created: CreateAgentEnvironmentInput | undefined
    const originalCreate = provider.create
    provider.create = async (input) => {
      created = input
      return originalCreate(input)
    }

    const recorder = recordedAdmissions()
    await startRetainedRun({
      provider,
      environment: {
        profile: { name: 'worker' },
        idempotencyKey: controlRef.environmentId,
        metadata: { tenant: 'acme' },
      },
      turn: { prompt: 'owned task', turnId: 'owned-turn', sessionId: 'stale-session' },
      onAdmission: recorder.onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    expect(recorded).toEqual({
      prompt: 'owned task',
      turnId: 'owned-turn',
      detach: true,
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
    })
    // Caller metadata is preserved, while the Runtime ownership marker is canonical.
    const intent = recorder.admissions[0]
    if (intent?.phase !== 'intent') throw new Error('expected the headless intent admission')
    expect(created?.metadata).toEqual({
      tenant: 'acme',
      retainedIdempotencyKey: controlRef.environmentId,
    })
    expect(recorder.admissions).toMatchObject([
      {
        phase: 'intent',
        provider: controlRef.provider,
        idempotencyKey: controlRef.environmentId,
        turnId: 'owned-turn',
        sessionId: controlRef.sessionId,
        executionId: controlRef.executionId,
        runId: expect.any(String),
        requestedProfileDigest: expect.any(String),
        requestDigest: expect.any(String),
      },
      {
        phase: 'environment',
        provider: controlRef.provider,
        environmentId: controlRef.environmentId,
        idempotencyKey: controlRef.environmentId,
        turnId: 'owned-turn',
        sessionId: controlRef.sessionId,
        executionId: controlRef.executionId,
      },
      {
        phase: 'dispatched',
        controlRef,
        idempotencyKey: controlRef.environmentId,
        turnId: 'owned-turn',
      },
    ])
  })

  it('rejects a schema-valid result bound to another session', async () => {
    const controlRef = {
      runId: 'result-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'result-session',
      executionId: 'result-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'foreign result', success: true, sessionId: 'foreign-session' }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'result-environment' },
      turn: { prompt: 'go', turnId: 'result-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    await expect(run.result()).rejects.toMatchObject({
      code: 'RETAINED_RESULT_BINDING_INVALID',
      message: expect.stringContaining('another retained session'),
    })
  })

  it('requires exact run and execution coordinates on reconnect and result', async () => {
    const controlRef = {
      runId: 'exact-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'exact-session',
      executionId: 'exact-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({
        text: 'foreign execution',
        success: true,
        sessionId: controlRef.sessionId,
        metadata: { executionId: 'another-execution' },
      }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'exact-environment' },
      turn: { prompt: 'go', turnId: 'exact-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })
    await expect(
      reconnectRetainedRun({
        provider,
        controlRef: { ...controlRef, runId: 'another-run', executionId: 'another-execution' },
      }),
    ).rejects.toThrow('different retained session')
    await expect(run.result()).rejects.toMatchObject({
      code: 'RETAINED_RESULT_BINDING_INVALID',
      message: expect.stringContaining('another retained execution'),
    })
  })

  it('acknowledges cancellation by operation id and never repeats its effect', async () => {
    const controlRef = {
      runId: 'cancel-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'cancel-session',
      executionId: 'cancel-execution',
      requestDigest: retainedRequestDigest,
    }
    let cancelCalls = 0
    let cancellationReason: string | undefined
    let cancellationDigest: AgentRunCancellationRequest['requestDigest'] | undefined
    let cancellationSeen = false
    let status: AgentSessionStatus = 'running'
    const session = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => status,
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true, sessionId: controlRef.sessionId }),
      prompt: async () => ({ text: 'continued', success: true }),
      async cancel(options?: { executionId?: string }) {
        cancelCalls += 1
        expect(options).toMatchObject({ executionId: controlRef.executionId })
        status = 'cancelled'
      },
      async cancelRun(
        request: AgentRunCancellationRequest,
      ): Promise<AgentRunCancellationAcknowledgement> {
        const exactRequest = AgentRunCancellationRequestSchema.parse(request)
        if (cancellationSeen) {
          return {
            operationId: exactRequest.operationId,
            requestDigest: exactRequest.requestDigest,
            run: exactRequest.run,
            status: exactRequest.reason === cancellationReason ? 'replayed' : 'conflict',
            effect: exactRequest.reason === cancellationReason ? 'cancelled' : 'unknown',
            ...(exactRequest.reason === cancellationReason
              ? {}
              : { existingRequestDigest: cancellationDigest }),
          }
        }
        cancellationSeen = true
        cancellationReason = exactRequest.reason
        cancellationDigest = exactRequest.requestDigest
        cancelCalls += 1
        status = 'cancelled'
        return {
          operationId: exactRequest.operationId,
          requestDigest: exactRequest.requestDigest,
          run: exactRequest.run,
          status: 'accepted',
          effect: 'cancelled',
        }
      },
    } as AgentSession & {
      cancelRun(request: AgentRunCancellationRequest): Promise<AgentRunCancellationAcknowledgement>
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'cancel-environment' },
      turn: { prompt: 'go', turnId: 'cancel-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })
    const first = await run.cancel({ operationId: 'cancel-operation', reason: 'stop now' })
    const replay = await run.cancel({ operationId: 'cancel-operation', reason: 'stop now' })
    const conflict = await run.cancel({ operationId: 'cancel-operation', reason: 'different' })
    const reconnected = await reconnectRetainedRun({ provider, controlRef })
    if (!reconnected) throw new Error('expected retained run reconnection')
    const crossProcessReplay = await reconnected.cancel({
      operationId: 'cancel-operation',
      reason: 'stop now',
    })
    expect(first).toMatchObject({
      operationId: 'cancel-operation',
      status: 'accepted',
      effect: 'cancelled',
      reason: 'stop now',
      snapshot: { status: 'cancelled', reason: 'stop now' },
    })
    expect(replay).toMatchObject({ status: 'replayed', effect: 'cancelled' })
    expect(conflict).toMatchObject({ status: 'conflict', effect: 'unknown' })
    expect(crossProcessReplay).toMatchObject({ status: 'replayed', effect: 'cancelled' })
    expect(cancelCalls).toBe(1)
  })

  it('omits an undefined cancellation reason from the durable operation digest', async () => {
    const controlRef = {
      runId: 'cancel-no-reason-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'cancel-no-reason-session',
      executionId: 'cancel-no-reason-execution',
      requestDigest: retainedRequestDigest,
    }
    let seenReason: string | undefined = 'sentinel'
    const session = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running' as const,
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
      async cancelRun(request: AgentRunCancellationRequest) {
        const exactRequest = AgentRunCancellationRequestSchema.parse(request)
        seenReason = exactRequest.reason
        return {
          operationId: exactRequest.operationId,
          requestDigest: exactRequest.requestDigest,
          run: exactRequest.run,
          status: 'accepted' as const,
          effect: 'not_live' as const,
        }
      },
    } as AgentSession & {
      cancelRun(request: AgentRunCancellationRequest): Promise<AgentRunCancellationAcknowledgement>
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'cancel-no-reason' },
      turn: { prompt: 'go', turnId: 'cancel-no-reason-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    await expect(run.cancel({ operationId: 'cancel-without-reason' })).resolves.toMatchObject({
      status: 'accepted',
      effect: 'not_live',
    })
    expect(seenReason).toBeUndefined()
  })

  it('rejects cancellation when the provider has no durable operation contract', async () => {
    const controlRef = {
      runId: 'cancel-unsupported-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'cancel-unsupported-session',
      executionId: 'cancel-unsupported-execution',
      requestDigest: retainedRequestDigest,
    }
    let legacyCancelCalls = 0
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {
        legacyCancelCalls += 1
      },
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'cancel-unsupported' },
      turn: { prompt: 'go', turnId: 'cancel-unsupported-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    await expect(run.cancel({ operationId: 'cancel-unsupported-operation' })).rejects.toThrow(
      'does not expose durable cancellation operations',
    )
    expect(legacyCancelCalls).toBe(0)
  })

  it('rejects a caller-supplied control reference when reconnecting a session without provider identity', async () => {
    const controlRef = {
      runId: 'forged-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'forged-session',
      executionId: 'forged-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({ session: () => session })

    await expect(reconnectRetainedRun({ provider, controlRef })).rejects.toThrow(
      'provider session did not return its provider-owned run control reference',
    )
  })

  it('rejects contradictory provider and environment identities', async () => {
    const controlRef = {
      runId: 'identity-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'identity-session',
      executionId: 'identity-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const contradictoryReference = providerWithEnvironment({
      dispatch: async () => ({
        id: session.id,
        provider: 'another-provider',
        controlRef,
      }),
      session: () => session,
    })

    const contradiction = await startRetainedRun({
      provider: contradictoryReference,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'identity-environment' },
      turn: { prompt: 'go', turnId: 'identity-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    }).catch((error: unknown) => error)
    expect(contradiction).toBeInstanceOf(RetainedRunDispatchBindingError)
    expect((contradiction as RetainedRunDispatchBindingError).cause).toMatchObject({
      message: 'provider dispatch returned a session reference for another provider',
    })
    expect((contradiction as RetainedRunDispatchBindingError).returned).toMatchObject({
      provider: 'another-provider',
    })

    const wrongEnvironment = providerWithEnvironment({
      id: 'another-environment',
      session: () => session,
    })
    await expect(reconnectRetainedRun({ provider: wrongEnvironment, controlRef })).rejects.toThrow(
      'different retained environment',
    )
  })

  it('rejects a provider that cannot promise detach, replay, and turn idempotency', async () => {
    let creates = 0
    const provider = providerWithEnvironment({}, false)
    const originalCreate = provider.create
    provider.create = async (input) => {
      creates += 1
      return originalCreate(input)
    }
    await expect(
      startRetainedRun({
        provider,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'unsafe-key' },
        turn: { prompt: 'go', turnId: 'unsafe-turn' },
        onAdmission: recordedAdmissions().onAdmission,
      }),
    ).rejects.toThrow('cannot control a retry-safe retained run')
    expect(creates).toBe(0)
  })

  it('rejects an unsupported enabled interaction before create or dispatch', async () => {
    let creates = 0
    let dispatches = 0
    const provider = providerWithEnvironment({
      async dispatch() {
        dispatches += 1
        throw new Error('dispatch must not run')
      },
    })
    const create = provider.create
    provider.create = async (input) => {
      creates += 1
      return create(input)
    }

    await expect(
      startRetainedRun({
        provider,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'unsupported-true' },
        turn: {
          prompt: 'go',
          turnId: 'unsupported-turn-true',
          interactions: { question: true },
        },
        onAdmission: recordedAdmissions().onAdmission,
      }),
    ).rejects.toThrow('does not support requested interactions: question')
    expect({ creates, dispatches }).toEqual({ creates: 0, dispatches: 0 })
  })

  it('treats a false interaction posture as explicitly disabled', async () => {
    let dispatches = 0
    let dispatchedControlRef: AgentSession['controlRef']
    const provider = providerWithEnvironment({
      async dispatch(input) {
        dispatches += 1
        const sessionId = input.sessionId ?? 'missing-session'
        const executionId = input.executionId ?? 'missing-execution'
        dispatchedControlRef = {
          runId: executionId,
          provider: 'test-provider',
          environmentId: 'environment-1',
          sessionId,
          executionId,
          requestDigest: retainedRequestDigest,
        }
        return {
          id: sessionId,
          provider: 'test-provider',
          controlRef: dispatchedControlRef,
        }
      },
      session(id) {
        if (!dispatchedControlRef) throw new Error('dispatch did not bind a control reference')
        return {
          id,
          controlRef: dispatchedControlRef,
          status: async () => 'running',
          async *events() {
            yield* []
          },
          result: async () => ({ text: 'done', success: true }),
          prompt: async () => ({ text: 'continued', success: true }),
          cancel: async () => {},
        }
      },
    })

    await expect(
      startRetainedRun({
        provider,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'disabled-question' },
        turn: {
          prompt: 'go',
          turnId: 'disabled-question-turn',
          interactions: { question: false },
        },
        onAdmission: recordedAdmissions().onAdmission,
      }),
    ).resolves.toBeDefined()
    expect(dispatches).toBe(1)
  })

  it.each([
    ['replay', { replay: false, responseIdempotency: true }],
    ['response idempotency', { replay: true, responseIdempotency: false }],
  ] as const)('requires %s for an interaction dispatch', async (_missing, override) => {
    let creates = 0
    const provider = providerWithEnvironment({})
    const baseCapabilities = provider.capabilities
    provider.capabilities = async () => ({
      ...(await baseCapabilities()),
      interactions: interactionCapabilities(override),
    })
    const create = provider.create
    provider.create = async (input) => {
      creates += 1
      return create(input)
    }

    await expect(
      startRetainedRun({
        provider,
        environment: { profile: { name: 'worker' }, idempotencyKey: `unsafe-${_missing}` },
        turn: {
          prompt: 'go',
          turnId: `unsafe-${_missing}-turn`,
          interactions: { question: true },
        },
        onAdmission: recordedAdmissions().onAdmission,
      }),
    ).rejects.toThrow('without replay and response idempotency')
    expect(creates).toBe(0)
  })

  it('rejects legacy replay flags without exact retained identity promises', async () => {
    let creates = 0
    const controlRef = {
      runId: 'no-session-rebuild-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'no-session-rebuild-session',
      executionId: 'no-session-rebuild-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    const capabilities = provider.capabilities
    provider.capabilities = async () => {
      const { retainedControl: _retainedControl, ...legacy } = await capabilities()
      return legacy
    }
    const originalCreate = provider.create
    provider.create = async (input) => {
      creates += 1
      return originalCreate(input)
    }

    await expect(
      startRetainedRun({
        provider,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'no-session-rebuild' },
        turn: { prompt: 'go', turnId: 'no-session-rebuild-turn' },
        onAdmission: recordedAdmissions().onAdmission,
        identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
      }),
    ).rejects.toThrow('cannot control a retry-safe retained run')
    expect(creates).toBe(0)
  })

  it('returns at once for a session that is already stopped', async () => {
    // `stopped` is a member of `AgentSessionStatus` and the runtime treats it as terminal
    // everywhere else (`sandboxSessionStatusFromAgentSessionStatus` projects it to `failed` —
    // "Sandbox has no neutral stopped state"). The terminal predicate omitted it, so this wait
    // polled every 25 ms for its whole deadline before returning the answer it had at the first
    // snapshot.
    const controlRef = {
      runId: 'stopped-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'stopped-session',
      executionId: 'stopped-execution',
      requestDigest: retainedRequestDigest,
    }
    let statusCalls = 0
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => {
        statusCalls += 1
        return 'stopped'
      },
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: false }),
      prompt: async () => ({ text: 'continued', success: false }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'stopped-environment' },
      turn: { prompt: 'go', turnId: 'stopped-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    const started = Date.now()
    await expect(run.status({ waitMs: 500 })).resolves.toMatchObject({ status: 'stopped' })
    expect(Date.now() - started).toBeLessThan(200)
    expect(statusCalls).toBe(1)
  })

  it('waits for a status change up to the caller deadline and honors cancellation', async () => {
    const controlRef = {
      runId: 'status-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'status-session',
      executionId: 'status-execution',
      requestDigest: retainedRequestDigest,
    }
    let statusCalls = 0
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => (++statusCalls < 3 ? 'running' : 'completed'),
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'status-environment' },
      turn: { prompt: 'go', turnId: 'status-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    await expect(run.status({ waitMs: 200 })).resolves.toMatchObject({
      status: 'completed',
      effect: 'not_live',
    })
    expect(statusCalls).toBe(3)
    await expect(run.status({ waitMs: -1 })).rejects.toThrow('non-negative safe integer')

    statusCalls = 0
    const controller = new AbortController()
    const pending = run.status({ waitMs: 200, signal: controller.signal })
    controller.abort('caller stopped waiting')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('interrupts a provider status call that ignores the abort signal', async () => {
    const controlRef = {
      runId: 'status-abort-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'status-abort-session',
      executionId: 'status-abort-execution',
      requestDigest: retainedRequestDigest,
    }
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => {
        resolveStarted()
        return await new Promise<AgentSessionStatus>(() => {})
      },
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'status-abort-environment' },
      turn: { prompt: 'go', turnId: 'status-abort-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })
    const controller = new AbortController()
    const pending = run.status({ signal: controller.signal })
    await started
    controller.abort('caller stopped status')
    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      message: 'caller stopped status',
    })
  })

  it('interrupts a durable cancellation call that ignores the abort signal', async () => {
    const controlRef = {
      runId: 'cancel-abort-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'cancel-abort-session',
      executionId: 'cancel-abort-execution',
      requestDigest: retainedRequestDigest,
    }
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    let cancelCalls = 0
    const session = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running' as const,
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
      async cancelRun() {
        cancelCalls += 1
        resolveStarted()
        return await new Promise<AgentRunCancellationAcknowledgement>(() => {})
      },
    } as AgentSession & {
      cancelRun(
        request: AgentRunCancellationRequest,
        options?: { signal?: AbortSignal },
      ): Promise<AgentRunCancellationAcknowledgement>
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'cancel-abort-environment' },
      turn: { prompt: 'go', turnId: 'cancel-abort-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })
    const controller = new AbortController()
    const pending = run.cancel({ operationId: 'cancel-abort-operation', signal: controller.signal })
    await started
    controller.abort('caller stopped cancellation')
    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      message: 'caller stopped cancellation',
    })
    expect(cancelCalls).toBe(1)
  })

  it('cancels a native continuation from the provider reference admitted before its result', async () => {
    const initialControlRef: AgentExactRunControlRef = {
      runId: 'continuation-admission-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'continuation-admission-session',
      executionId: 'continuation-admission-execution',
      requestDigest: retainedRequestDigest,
    }
    const continuationTurn = { prompt: 'continue while the provider is still running' }
    const expectedBoundary = {
      runId: initialControlRef.runId,
      provider: initialControlRef.provider,
      environmentId: initialControlRef.environmentId,
      sessionId: initialControlRef.sessionId,
      executionId: initialControlRef.executionId,
      requestDigest: initialControlRef.requestDigest,
      boundary: {
        kind: 'messages' as const,
        messageIds: ['continuation-admission-message'],
        digest: `sha256:${'b'.repeat(64)}` as const,
      },
      observedAt: '2026-08-28T00:00:00.000Z',
    }
    const continuationMaterial = {
      operationId: 'continuation-admission-operation',
      run: initialControlRef,
      expectedBoundary,
      turnDigest: nativeContextContinuationTurnDigest(continuationTurn),
    }
    const continuationRequest = NativeContextContinuationRequestSchema.parse({
      ...continuationMaterial,
      requestDigest: nativeContextContinuationRequestDigest(continuationMaterial),
    })
    const nextControlRef: AgentExactRunControlRef = {
      ...initialControlRef,
      runId: 'continuation-admitted-run',
      executionId: 'continuation-admitted-execution',
      requestDigest: continuationRequest.requestDigest,
    }
    const continuationResult: AgentNativeContextContinuationResult = {
      acknowledgement: {
        operationId: continuationRequest.operationId,
        requestDigest: continuationRequest.requestDigest,
        status: 'accepted',
        historyMessagesSent: 0,
        actualBoundary: expectedBoundary,
      },
      result: {
        text: 'continuation was cancelled after admission',
        success: false,
        sessionId: nextControlRef.sessionId,
        metadata: {
          runId: nextControlRef.runId,
          executionId: nextControlRef.executionId,
          requestDigest: nextControlRef.requestDigest,
        },
      },
      controlRef: nextControlRef,
    }
    let currentControlRef = initialControlRef
    let cancelled = false
    let resolveContinuationStarted!: () => void
    const continuationStarted = new Promise<void>((resolve) => {
      resolveContinuationStarted = resolve
    })
    let resolveContinuation!: (result: AgentNativeContextContinuationResult) => void
    const continuationCompletion = new Promise<AgentNativeContextContinuationResult>((resolve) => {
      resolveContinuation = resolve
    })
    let continuationCompleted = false
    let cancellationRequest: AgentRunCancellationRequest | undefined
    const session: AgentSession = {
      id: initialControlRef.sessionId,
      get controlRef() {
        return currentControlRef
      },
      status: async () => (cancelled ? 'cancelled' : 'running'),
      async *events() {
        yield* []
      },
      result: async () => ({
        text: 'cancelled',
        success: false,
        sessionId: nextControlRef.sessionId,
        metadata: {
          runId: nextControlRef.runId,
          executionId: nextControlRef.executionId,
          requestDigest: nextControlRef.requestDigest,
        },
      }),
      prompt: async () => ({ text: 'unused', success: false }),
      cancel: async () => {},
      async continueNative(_request, options) {
        currentControlRef = nextControlRef
        const onAdmission = options.onAdmission
        if (onAdmission === undefined) throw new Error('test provider did not receive onAdmission')
        onAdmission(nextControlRef)
        resolveContinuationStarted()
        try {
          return await continuationCompletion
        } finally {
          continuationCompleted = true
        }
      },
      async contextBoundary() {
        return expectedBoundary
      },
      async cancelRun(request) {
        cancellationRequest = request
        cancelled = true
        return {
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          run: request.run,
          status: 'accepted' as const,
          effect: 'cancelled' as const,
        }
      },
    }
    const provider = providerWithEnvironment({})
    const capabilities: AgentEnvironmentCapabilities = {
      ...(await provider.capabilities()),
      nativeContinuation: {
        atomicBoundary: true,
        requestIdempotency: true,
        admissionControl: true,
      },
    }
    const environment: AgentEnvironment = {
      id: initialControlRef.environmentId,
      provider: initialControlRef.provider,
      status: async () => 'running',
      async *stream() {
        yield* []
      },
    }
    const run = createRetainedRunHandle(
      environment,
      session,
      initialControlRef,
      capabilities,
      undefined,
    )

    const pendingContinuation = run.beginNativeContinuation(continuationRequest, continuationTurn)
    await expect(pendingContinuation.admission).resolves.toEqual(nextControlRef)
    await continuationStarted
    expect(continuationCompleted).toBe(false)
    expect(run.controlRef).toEqual(nextControlRef)
    await expect(run.status()).resolves.toMatchObject({
      runId: nextControlRef.runId,
      status: 'running',
      controlRef: nextControlRef,
    })

    const cancellation = await run.cancel({
      operationId: 'cancel-admitted-continuation',
      reason: 'user stopped the admitted continuation',
    })
    expect(cancellation).toMatchObject({
      status: 'accepted',
      effect: 'cancelled',
      snapshot: { status: 'cancelled', controlRef: nextControlRef },
    })
    expect(cancellationRequest?.run).toEqual(nextControlRef)

    resolveContinuation(continuationResult)
    await expect(pendingContinuation.result).resolves.toMatchObject({
      acknowledgement: { status: 'accepted' },
      controlRef: nextControlRef,
    })
  })

  it('does not create an unhandled admission rejection when only the result is observed', async () => {
    const controlRef: AgentExactRunControlRef = {
      runId: 'continuation-failure-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'continuation-failure-session',
      executionId: 'continuation-failure-execution',
      requestDigest: retainedRequestDigest,
    }
    const continuationTurn = { prompt: 'fail before admission' }
    const expectedBoundary = {
      runId: controlRef.runId,
      provider: controlRef.provider,
      environmentId: controlRef.environmentId,
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
      requestDigest: controlRef.requestDigest,
      boundary: {
        kind: 'messages' as const,
        messageIds: ['continuation-failure-message'],
        digest: `sha256:${'c'.repeat(64)}` as const,
      },
      observedAt: '2026-08-28T00:00:00.000Z',
    }
    const continuationMaterial = {
      operationId: 'continuation-failure-operation',
      run: controlRef,
      expectedBoundary,
      turnDigest: nativeContextContinuationTurnDigest(continuationTurn),
    }
    const request = NativeContextContinuationRequestSchema.parse({
      ...continuationMaterial,
      requestDigest: nativeContextContinuationRequestDigest(continuationMaterial),
    })
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'unused', success: false }),
      prompt: async () => ({ text: 'unused', success: false }),
      cancel: async () => {},
      async continueNative() {
        throw new Error('native continuation failed before admission')
      },
    }
    const provider = providerWithEnvironment({})
    const capabilities: AgentEnvironmentCapabilities = {
      ...(await provider.capabilities()),
      nativeContinuation: {
        atomicBoundary: true,
        requestIdempotency: true,
        admissionControl: true,
      },
    }
    const environment: AgentEnvironment = {
      id: controlRef.environmentId,
      provider: controlRef.provider,
      status: async () => 'running',
      async *stream() {
        yield* []
      },
    }
    const run = createRetainedRunHandle(environment, session, controlRef, capabilities, undefined)
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      const pendingContinuation = run.beginNativeContinuation(request, continuationTurn)
      await expect(pendingContinuation.result).rejects.toThrow(
        'native continuation failed before admission',
      )
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('rejects a terminal native continuation identity that differs from its admission', async () => {
    const initialControlRef: AgentExactRunControlRef = {
      runId: 'continuation-identity-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'continuation-identity-session',
      executionId: 'continuation-identity-execution',
      requestDigest: retainedRequestDigest,
    }
    const continuationTurn = { prompt: 'continue with one admitted run' }
    const expectedBoundary = {
      runId: initialControlRef.runId,
      provider: initialControlRef.provider,
      environmentId: initialControlRef.environmentId,
      sessionId: initialControlRef.sessionId,
      executionId: initialControlRef.executionId,
      requestDigest: initialControlRef.requestDigest,
      boundary: {
        kind: 'messages' as const,
        messageIds: ['continuation-identity-message'],
        digest: `sha256:${'d'.repeat(64)}` as const,
      },
      observedAt: '2026-08-28T00:00:00.000Z',
    }
    const continuationMaterial = {
      operationId: 'continuation-identity-operation',
      run: initialControlRef,
      expectedBoundary,
      turnDigest: nativeContextContinuationTurnDigest(continuationTurn),
    }
    const request = NativeContextContinuationRequestSchema.parse({
      ...continuationMaterial,
      requestDigest: nativeContextContinuationRequestDigest(continuationMaterial),
    })
    const admittedControlRef: AgentExactRunControlRef = {
      ...initialControlRef,
      runId: 'continuation-admitted-identity-run',
      executionId: 'continuation-admitted-identity-execution',
      requestDigest: request.requestDigest,
    }
    const terminalControlRef: AgentExactRunControlRef = {
      ...initialControlRef,
      runId: 'continuation-terminal-identity-run',
      executionId: 'continuation-terminal-identity-execution',
      requestDigest: request.requestDigest,
    }
    const continuationResult: AgentNativeContextContinuationResult = {
      acknowledgement: {
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        status: 'accepted',
        historyMessagesSent: 0,
        actualBoundary: expectedBoundary,
      },
      result: {
        text: 'terminal identity changed',
        success: true,
        sessionId: terminalControlRef.sessionId,
        metadata: {
          runId: terminalControlRef.runId,
          executionId: terminalControlRef.executionId,
          requestDigest: terminalControlRef.requestDigest,
        },
      },
      controlRef: terminalControlRef,
    }
    let currentControlRef = initialControlRef
    const session: AgentSession = {
      id: initialControlRef.sessionId,
      get controlRef() {
        return currentControlRef
      },
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'unused', success: false }),
      prompt: async () => ({ text: 'unused', success: false }),
      cancel: async () => {},
      async continueNative(_request, options) {
        options.onAdmission?.(admittedControlRef)
        currentControlRef = terminalControlRef
        return continuationResult
      },
    }
    const provider = providerWithEnvironment({})
    const capabilities: AgentEnvironmentCapabilities = {
      ...(await provider.capabilities()),
      nativeContinuation: {
        atomicBoundary: true,
        requestIdempotency: true,
        admissionControl: true,
      },
    }
    const environment: AgentEnvironment = {
      id: initialControlRef.environmentId,
      provider: initialControlRef.provider,
      status: async () => 'running',
      async *stream() {
        yield* []
      },
    }
    const run = createRetainedRunHandle(
      environment,
      session,
      initialControlRef,
      capabilities,
      undefined,
    )

    const pendingContinuation = run.beginNativeContinuation(request, continuationTurn)
    await expect(pendingContinuation.admission).resolves.toEqual(admittedControlRef)
    await expect(pendingContinuation.result).rejects.toMatchObject({
      code: 'RETAINED_NATIVE_CONTINUATION_RESULT_CHANGED',
      message: 'provider changed the native continuation run after admission',
    })
  })

  it('interrupts a retained event read and closes its provider iterator', async () => {
    const controlRef = {
      runId: 'events-abort-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'events-abort-session',
      executionId: 'events-abort-execution',
      requestDigest: retainedRequestDigest,
    }
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    let returnCalls = 0
    const eventStream: AsyncIterable<AgentEnvironmentEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            resolveStarted()
            return await new Promise<IteratorResult<AgentEnvironmentEvent>>(() => {})
          },
          return: async () => {
            returnCalls += 1
            return { done: true, value: undefined }
          },
        }
      },
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      events: () => eventStream,
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'events-abort-environment' },
      turn: { prompt: 'go', turnId: 'events-abort-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })
    const controller = new AbortController()
    const iterator = run.events({ signal: controller.signal })[Symbol.asyncIterator]()
    const pending = iterator.next()
    await started
    controller.abort('caller stopped events')
    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      message: 'caller stopped events',
    })
    expect(returnCalls).toBe(1)
  })

  it('does not call an interaction method unless retry safety was declared', async () => {
    let responses = 0
    const controlRef = {
      runId: 'undeclared-interaction-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'undeclared-interaction-session',
      executionId: 'undeclared-interaction-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      async respondToInteraction(command) {
        responses += 1
        return {
          operationId: command.operationId,
          binding: command.binding,
          commandDigest: command.commandDigest,
          status: 'accepted',
        }
      },
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'interaction-environment' },
      turn: { prompt: 'go', turnId: 'interaction-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    const binding = {
      runId: controlRef.runId,
      provider: controlRef.provider,
      environmentId: controlRef.environmentId,
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
      interactionId: 'interaction-1',
      requestDigest: controlRef.requestDigest,
    }
    const response = { id: 'interaction-1', outcome: 'accepted' as const }
    await expect(
      run.respondToInteraction({
        operationId: 'undeclared-interaction-operation',
        binding,
        commandDigest: interactionResponseCommandDigest({ binding, response }),
        response,
      }),
    ).rejects.toThrow('does not promise retry-safe interaction responses')
    expect(responses).toBe(0)
  })

  it('replays identity stored in data when the transport has no top-level id', async () => {
    const controlRef = {
      runId: 'fallback-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'fallback-session',
      executionId: 'fallback-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: 'fallback-session',
      controlRef,
      status: async () => 'running',
      async *events() {
        yield {
          type: 'status',
          data: {
            normalized: { type: 'status', status: 'completed' },
            eventId: 'fallback-event',
            cursor: 'fallback-cursor',
            sequence: 4,
            occurredAt: '2026-08-02T03:00:00.000Z',
          },
        }
        yield {
          type: 'status',
          data: {
            status: 'completed',
            eventId: 'fallback-next-event',
            cursor: 'fallback-next-cursor',
            sequence: 5,
            occurredAt: '2026-08-02T03:00:01.000Z',
          },
        }
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'fallback-environment' },
      turn: { prompt: 'go', turnId: 'fallback-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })
    const events: RuntimeEventEnvelope[] = []
    for await (const event of run.events()) events.push(event)

    expect(events.map(({ eventId, cursor, sequence }) => ({ eventId, cursor, sequence }))).toEqual([
      { eventId: 'fallback-event', cursor: 'fallback-cursor', sequence: 4 },
      { eventId: 'fallback-next-event', cursor: 'fallback-next-cursor', sequence: 5 },
    ])
    const replayed: RuntimeEventEnvelope[] = []
    for await (const event of run.events({
      after: { cursor: 'fallback-cursor', sequence: 4 },
    })) {
      replayed.push(event)
    }
    expect(replayed).toHaveLength(1)
    expect(replayed[0]).toMatchObject({
      eventId: 'fallback-next-event',
      cursor: 'fallback-next-cursor',
      sequence: 5,
    })
  })

  it('preserves the CLI Bridge cursor while emitting its canonical event identity', async () => {
    const controlRef = {
      runId: 'run-1',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'session-1',
      executionId: 'execution-1',
      requestDigest: retainedRequestDigest,
    }
    const source: AgentEnvironmentEvent[] = [
      {
        id: '1',
        type: 'status',
        data: {
          status: 'started',
          runId: controlRef.runId,
          sessionId: controlRef.sessionId,
          executionId: controlRef.executionId,
          cursor: '1',
          eventId: 'run-1:1',
          sequence: 1,
        },
        normalized: { type: 'status', status: 'started' },
        providerEvent: { eventId: 'run-1:1' },
      },
      {
        id: '2',
        type: 'status',
        data: {
          status: 'completed',
          runId: controlRef.runId,
          sessionId: controlRef.sessionId,
          executionId: controlRef.executionId,
          cursor: '2',
          eventId: 'run-1:2',
          sequence: 2,
        },
        normalized: { type: 'status', status: 'completed' },
        providerEvent: { eventId: 'run-1:2' },
      },
    ]
    const replayCursors: Array<string | null> = []
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'completed',
      async *events(options) {
        replayCursors.push(options?.since ?? null)
        yield* source.slice(options?.since === '1' ? 1 : 0)
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'cli-bridge-identity' },
      turn: { prompt: 'go', turnId: 'cli-bridge-identity-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    const fresh: RuntimeEventEnvelope[] = []
    for await (const event of run.events()) fresh.push(event)
    expect(fresh.map(({ eventId, cursor, sequence }) => ({ eventId, cursor, sequence }))).toEqual([
      { eventId: 'run-1:1', cursor: '1', sequence: 1 },
      { eventId: 'run-1:2', cursor: '2', sequence: 2 },
    ])

    const replayed: RuntimeEventEnvelope[] = []
    for await (const event of run.events({ after: { cursor: '1', sequence: 1 } })) {
      replayed.push(event)
    }
    expect(replayCursors).toEqual([null, '1'])
    expect(replayed).toMatchObject([{ eventId: 'run-1:2', cursor: '2', sequence: 2 }])
  })

  it('assigns contiguous positive sequences when a replayable provider omits them', async () => {
    const controlRef = {
      runId: 'generated-sequence-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'generated-sequence-session',
      executionId: 'generated-sequence-execution',
      requestDigest: retainedRequestDigest,
    }
    const source = [
      {
        id: 'generated-event-1',
        type: 'status',
        data: { cursor: 'generated-cursor-1', runId: controlRef.runId },
        normalized: { type: 'status', status: 'started' },
      },
      {
        id: 'generated-event-2',
        type: 'status',
        data: { cursor: 'generated-cursor-2', runId: controlRef.runId },
        normalized: { type: 'status', status: 'completed' },
      },
    ] satisfies AgentEnvironmentEvent[]
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'completed',
      async *events(options) {
        const start = options?.since === 'generated-cursor-1' ? 1 : 0
        yield* source.slice(start)
      },
      result: async () => ({
        text: 'done',
        success: true,
        sessionId: controlRef.sessionId,
        metadata: {
          runId: controlRef.runId,
          executionId: controlRef.executionId,
          requestDigest: controlRef.requestDigest,
        },
      }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'generated-sequence' },
      turn: { prompt: 'go', turnId: 'generated-sequence-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    const fresh: RuntimeEventEnvelope[] = []
    for await (const event of run.events()) fresh.push(event)
    expect(fresh.map(({ eventId, sequence }) => ({ eventId, sequence }))).toEqual([
      { eventId: 'generated-event-1', sequence: 1 },
      { eventId: 'generated-event-2', sequence: 2 },
    ])

    const replayed: RuntimeEventEnvelope[] = []
    for await (const event of run.events({
      after: { cursor: 'generated-cursor-1', sequence: 1 },
    })) {
      replayed.push(event)
    }
    expect(replayed.map(({ eventId, sequence }) => ({ eventId, sequence }))).toEqual([
      { eventId: 'generated-event-2', sequence: 2 },
    ])
  })

  it('preserves a harness-native id while binding session.updated to its execution', async () => {
    const controlRef = {
      runId: 'native-session-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'retained-provider-session',
      executionId: 'native-session-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield {
          id: 'native-session-event',
          type: 'session.updated',
          data: {
            sessionId: 'harness-native-session',
            runId: controlRef.runId,
            executionId: controlRef.executionId,
          },
          normalized: {
            type: 'session.updated',
            sessionId: 'harness-native-session',
          },
        }
        yield {
          id: 'foreign-native-session-event',
          type: 'session.updated',
          data: {
            sessionId: 'another-harness-session',
            runId: controlRef.runId,
            executionId: 'foreign-execution',
          },
          normalized: {
            type: 'session.updated',
            sessionId: 'another-harness-session',
          },
        }
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'native-session' },
      turn: { prompt: 'go', turnId: 'native-session-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    const events = run.events()[Symbol.asyncIterator]()
    await expect(events.next()).resolves.toMatchObject({
      value: {
        eventId: 'native-session-event',
        event: { type: 'session.updated', sessionId: 'harness-native-session' },
      },
    })
    await expect(events.next()).rejects.toThrow('another retained execution')
  })

  it('still rejects a foreign retained session on lifecycle event payloads', async () => {
    const controlRef = {
      runId: 'foreign-session-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'expected-retained-session',
      executionId: 'foreign-session-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield {
          id: 'foreign-session-event',
          type: 'status',
          data: { sessionId: 'foreign-retained-session' },
          normalized: { type: 'status', status: 'processing' },
        }
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'foreign-session' },
      turn: { prompt: 'go', turnId: 'foreign-session-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    await expect(collectRetainedEvents(run.events())).rejects.toThrow('another retained session')
  })

  it.each(['live', 'replay'] as const)(
    'validates nested interaction binding on the %s event path',
    async (path) => {
      const controlRef = {
        runId: `nested-interaction-${path}-run`,
        provider: 'test-provider',
        environmentId: 'environment-1',
        sessionId: `nested-interaction-${path}-session`,
        executionId: `nested-interaction-${path}-execution`,
        requestDigest: retainedRequestDigest,
      }
      const requestMaterial = {
        id: `nested-interaction-${path}`,
        kind: 'question',
        title: 'Need input',
        answerSpec: {
          fields: [{ type: 'text' as const, name: 'answer', label: 'Answer' }],
        },
        binding: {
          runId: controlRef.runId,
          provider: controlRef.provider,
          environmentId: controlRef.environmentId,
          sessionId: controlRef.sessionId,
          executionId: 'foreign-execution',
          interactionId: `nested-interaction-${path}`,
        },
      }
      const session: AgentSession = {
        id: controlRef.sessionId,
        controlRef,
        status: async () => 'running',
        async *events(): AsyncIterable<AgentEnvironmentEvent> {
          yield {
            id: `nested-interaction-${path}-event`,
            type: 'interaction',
            data: {},
            normalized: {
              type: 'interaction',
              request: {
                ...requestMaterial,
                requestDigest: interactionRequestDigest(requestMaterial),
              },
            },
          }
        },
        result: async () => ({ text: 'done', success: true }),
        prompt: async () => ({ text: 'continued', success: true }),
        cancel: async () => {},
      }
      const provider = providerWithEnvironment({
        dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
        session: () => session,
      })
      const run = await startRetainedRun({
        provider,
        environment: {
          profile: { name: 'worker' },
          idempotencyKey: `nested-interaction-${path}-environment`,
        },
        turn: { prompt: 'go', turnId: `nested-interaction-${path}-turn` },
        onAdmission: recordedAdmissions().onAdmission,
        identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
      })

      const events =
        path === 'live'
          ? run.events()
          : run.events({ after: { cursor: 'before-event', sequence: 0 } })
      await expect(collectRetainedEvents(events)).rejects.toThrow(
        'provider returned an interaction for another retained execution',
      )
    },
  )

  it('validates a replay anchor before skipping it', async () => {
    const controlRef = {
      runId: 'anchor-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'anchor-session',
      executionId: 'anchor-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield {
          type: 'status',
          data: {
            status: 'completed',
            runId: 'foreign-run',
            eventId: 'anchor-event',
            cursor: 'anchor-cursor',
            sequence: 4,
          },
        }
        yield {
          type: 'status',
          data: {
            status: 'completed',
            runId: controlRef.runId,
            eventId: 'next-event',
            cursor: 'next-cursor',
            sequence: 5,
          },
        }
      },
      result: async () => ({
        text: 'done',
        success: true,
        sessionId: controlRef.sessionId,
        metadata: { runId: controlRef.runId },
      }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'anchor-environment' },
      turn: { prompt: 'go', turnId: 'anchor-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    await expect(
      collectRetainedEvents(run.events({ after: { cursor: 'anchor-cursor', sequence: 4 } })),
    ).rejects.toThrow('another retained run')
  })

  it('rejects retained events bound to another run on the transport object', async () => {
    const controlRef = {
      runId: 'transport-binding-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'transport-binding-session',
      executionId: 'transport-binding-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield {
          type: 'status',
          data: { status: 'completed', eventId: 'transport-binding-event' },
          runId: 'foreign-run',
        } as unknown as AgentEnvironmentEvent
      },
      result: async () => ({ text: 'done', success: true }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      dispatch: async () => ({ id: session.id, provider: 'test-provider', controlRef }),
      session: () => session,
    })
    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'transport-binding' },
      turn: { prompt: 'go', turnId: 'transport-binding-turn' },
      onAdmission: recordedAdmissions().onAdmission,
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    await expect(collectRetainedEvents(run.events())).rejects.toThrow('another retained run')
  })

  it('keeps environment creation stable while retained dispatch identity changes', async () => {
    const createInputs: CreateAgentEnvironmentInput[] = []
    const dispatches: AgentTurnInput[] = []
    let currentSession: AgentSession | undefined
    const provider = providerWithEnvironment({
      id: 'environment-stable',
      async dispatch(input) {
        if (input.sessionId === undefined || input.executionId === undefined) {
          throw new Error('retained dispatch identity is missing')
        }
        dispatches.push(input)
        const controlRef = {
          runId: `run-${input.turnId}`,
          provider: 'test-provider',
          environmentId: 'environment-stable',
          sessionId: input.sessionId,
          executionId: input.executionId,
          requestDigest: retainedRequestDigest,
        }
        currentSession = {
          id: input.sessionId,
          controlRef,
          status: async () => 'running',
          async *events() {
            yield* []
          },
          result: async () => ({
            text: input.prompt ?? '',
            success: true,
            sessionId: input.sessionId,
          }),
          prompt: async () => ({ text: 'continued', success: true }),
          cancel: async () => {},
        }
        return { id: input.sessionId, provider: 'test-provider', controlRef }
      },
      session() {
        if (currentSession === undefined) throw new Error('retained session is missing')
        return currentSession
      },
    })
    const originalCreate = provider.create
    provider.create = async (input) => {
      createInputs.push(input)
      return originalCreate(input)
    }
    const environment = {
      profile: { name: 'worker' },
      idempotencyKey: 'environment-stable',
      metadata: { tenant: 'acme', retainedIdempotencyKey: 'caller-value' },
    }

    const first = await startRetainedRun({
      provider,
      environment,
      turn: { prompt: 'first turn', turnId: 'turn-first' },
      onAdmission: async () => {},
    })
    const second = await startRetainedRun({
      provider,
      environment,
      turn: { prompt: 'second turn', turnId: 'turn-second' },
      onAdmission: async () => {},
    })

    expect(createInputs).toHaveLength(2)
    expect(createInputs[1]).toEqual(createInputs[0])
    expect(createInputs[0]?.metadata).toEqual({
      tenant: 'acme',
      retainedIdempotencyKey: 'environment-stable',
    })
    expect(
      dispatches.map(({ turnId, sessionId, executionId }) => ({
        turnId,
        sessionId,
        executionId,
      })),
    ).toEqual([
      {
        turnId: 'turn-first',
        sessionId: mintRetainedIdentity('environment-stable', 'turn-first').sessionId,
        executionId: mintRetainedIdentity('environment-stable', 'turn-first').executionId,
      },
      {
        turnId: 'turn-second',
        sessionId: mintRetainedIdentity('environment-stable', 'turn-second').sessionId,
        executionId: mintRetainedIdentity('environment-stable', 'turn-second').executionId,
      },
    ])
    expect(first.controlRef.sessionId).not.toBe(second.controlRef.sessionId)
    expect(first.controlRef.executionId).not.toBe(second.controlRef.executionId)
  })

  it('rejects a start with no admission hook before any provider call', async () => {
    let creates = 0
    const provider = providerWithEnvironment({})
    const originalCreate = provider.create
    provider.create = async (input) => {
      creates += 1
      return originalCreate(input)
    }
    await expect(
      startRetainedRun({
        provider,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'hookless-environment' },
        turn: { prompt: 'go', turnId: 'hookless-turn' },
        onAdmission: undefined as unknown as RetainedRunAdmissionHook,
      }),
    ).rejects.toThrow('requires an awaited onAdmission durability hook')
    expect(creates).toBe(0)
  })

  it('awaits each admission before dispatch and before the start resolves', async () => {
    const log: string[] = []
    const controlRef = {
      runId: 'ordering-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'ordering-session',
      executionId: 'ordering-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true, sessionId: controlRef.sessionId }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        log.push('dispatch')
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    const originalCreate = provider.create
    provider.create = async (input) => {
      log.push('create')
      return originalCreate(input)
    }

    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'ordering-environment' },
      turn: { prompt: 'go', turnId: 'ordering-turn' },
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
      onAdmission: async (admission) => {
        // The delay proves the runtime awaits the hook instead of racing past it.
        await new Promise((resolve) => setTimeout(resolve, 10))
        log.push(`admission:${admission.phase}`)
      },
    })
    log.push('resolved')

    expect(log).toEqual([
      'admission:intent',
      'create',
      'admission:environment',
      'dispatch',
      'admission:dispatched',
      'resolved',
    ])
    expect(run.controlRef).toEqual(controlRef)
  })

  it('fails a start whose admission cannot persist, keeps the environment, and stays recoverable', async () => {
    let destroys = 0
    const controlRef = {
      runId: 'admission-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'admission-session',
      executionId: 'admission-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true, sessionId: controlRef.sessionId }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        return { id: session.id, provider: 'test-provider', controlRef }
      },
      session: () => session,
      async destroy() {
        destroys += 1
      },
    })

    const failure = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'admission-environment' },
      turn: { prompt: 'go', turnId: 'admission-turn' },
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
      onAdmission: async (admission) => {
        if (admission.phase === 'dispatched') throw new Error('journal write failed')
      },
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(RetainedRunAdmissionError)
    const admissionFailure = failure as RetainedRunAdmissionError
    expect(admissionFailure.code).toBe('capture_integrity')
    expect(admissionFailure.phase).toBe('dispatched')
    expect(admissionFailure.admission).toMatchObject({ phase: 'dispatched', controlRef })
    expect(admissionFailure.cause).toMatchObject({ message: 'journal write failed' })
    expect(destroys).toBe(0)

    const recovered = await recoverRetainedRun({
      provider,
      environmentId: controlRef.environmentId,
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
    })
    expect(recovered.outcome).toBe('recovered')
    if (recovered.outcome === 'recovered') {
      expect(recovered.handle.controlRef).toEqual(controlRef)
    }
  })

  it('fails closed when recovery coordinates name a session bound to another execution', async () => {
    const controlRef = {
      runId: 'mismatch-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'mismatch-session',
      executionId: 'other-execution',
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true, sessionId: controlRef.sessionId }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    const provider = providerWithEnvironment({ session: () => session })

    await expect(
      recoverRetainedRun({
        provider,
        environmentId: 'environment-1',
        sessionId: 'mismatch-session',
        executionId: 'expected-execution',
      }),
    ).rejects.toThrow('other retained run coordinates')
  })

  it('reports not_found from recovery when the provider no longer holds the environment', async () => {
    const provider = providerWithEnvironment({})
    provider.get = async () => null

    await expect(
      recoverRetainedRun({
        provider,
        environmentId: 'environment-gone',
        sessionId: 'session-gone',
        executionId: 'execution-gone',
      }),
    ).resolves.toEqual({ outcome: 'not_found' })
  })

  it('recovers a run whose caller was SIGKILLed inside the dispatched admission', {
    timeout: 120_000,
  }, async () => {
    const stateFile = join(directory, 'kill-dispatched-provider.json')
    const referenceFile = join(directory, 'kill-dispatched-admission.json')

    const killed = await runChild(stateFile, referenceFile, 'start-kill-dispatched')
    expect(killed.signal, killed.stderr).toBe('SIGKILL')
    expect(killed.code).toBeNull()
    // The child died inside the hook, so it never observed a resolved handle.
    expect(existsSync(`${referenceFile}.observed`)).toBe(false)
    // The child omitted identity; re-mint the same coordinates in this process.
    const minted = mintRetainedIdentity('kill-dispatched', 'kill-dispatched')
    const admission = JSON.parse(await readFile(referenceFile, 'utf8')) as {
      phase: string
      controlRef: Record<string, string>
    }
    expect(admission.phase).toBe('dispatched')
    expect(admission.controlRef).toMatchObject({
      runId: 'run-kill-dispatched',
      provider: 'durable-test',
      environmentId: 'environment-kill-dispatched',
      sessionId: minted.sessionId,
      executionId: minted.executionId,
    })

    const recovered = await runChild(stateFile, referenceFile, 'recover-dispatched')
    expect(recovered.code, recovered.stderr).toBe(0)
    expect(recovered.signal).toBeNull()
    const output = JSON.parse(await readFile(`${referenceFile}.output`, 'utf8')) as {
      controlRef: { runId: string }
      eventIds: string[]
      replayedIds: string[]
      cancellation: { operationId: string; status: string; effect: string }
    }
    expect(output.controlRef.runId).toBe('run-kill-dispatched')
    expect(output.eventIds).toEqual(['event-0', 'event-1', 'event-2'])
    // The replay after the saved cursor repeats no already-consumed event id.
    expect(output.replayedIds).toEqual(['event-1', 'event-2'])
    expect(output.replayedIds).not.toContain('event-0')
    expect(output.cancellation).toMatchObject({
      operationId: 'kill-dispatched-cancel',
      status: 'accepted',
      effect: 'cancelled',
    })
    const durableState = JSON.parse(await readFile(stateFile, 'utf8')) as {
      environments: Record<string, { sessions: Record<string, { status: string }> }>
    }
    expect(
      durableState.environments['environment-kill-dispatched']?.sessions[minted.sessionId]?.status,
    ).toBe('cancelled')
  })

  it('finds no run but a destroyable environment after a SIGKILL inside the environment admission', {
    timeout: 120_000,
  }, async () => {
    const stateFile = join(directory, 'kill-environment-provider.json')
    const referenceFile = join(directory, 'kill-environment-admission.json')

    const killed = await runChild(stateFile, referenceFile, 'start-kill-environment')
    expect(killed.signal, killed.stderr).toBe('SIGKILL')
    expect(killed.code).toBeNull()
    const admission = JSON.parse(await readFile(referenceFile, 'utf8')) as Record<string, string>
    expect(admission).toMatchObject({
      phase: 'environment',
      provider: 'durable-test',
      environmentId: 'environment-kill-environment',
      idempotencyKey: 'kill-environment',
      turnId: 'kill-environment',
      sessionId: 'session-kill-environment',
      executionId: 'execution-kill-environment',
    })
    // The kill happened before dispatch: the provider holds the environment, no session.
    const stateAfterKill = JSON.parse(await readFile(stateFile, 'utf8')) as {
      environments: Record<string, { sessions: Record<string, unknown> }>
    }
    expect(stateAfterKill.environments['environment-kill-environment']?.sessions).toEqual({})

    const recovered = await runChild(stateFile, referenceFile, 'recover-environment')
    expect(recovered.code, recovered.stderr).toBe(0)
    expect(recovered.signal).toBeNull()
    const output = JSON.parse(await readFile(`${referenceFile}.output`, 'utf8')) as {
      firstOutcome: string
      orphanFound: boolean
      secondOutcome: string
      orphanRemains: boolean
    }
    // A provider that cannot self-identify the never-dispatched session
    // reports unverifiable, and the environment stays findable for triage.
    expect(output.firstOutcome).toBe('unverifiable')
    expect(output.orphanFound).toBe(true)
    // After the test-owned destroy, recovery proves the environment is gone.
    expect(output.secondOutcome).toBe('not_found')
    expect(output.orphanRemains).toBe(false)
    const durableState = JSON.parse(await readFile(stateFile, 'utf8')) as {
      environments: Record<string, unknown>
    }
    expect(durableState.environments).toEqual({})
  })

  it('recovers a live run from only the environment admission after a SIGKILL before the dispatched record', {
    timeout: 120_000,
  }, async () => {
    const stateFile = join(directory, 'kill-live-provider.json')
    const referenceFile = join(directory, 'kill-live-admission.json')

    // The reviewer-proven window: dispatch commits remotely, the process dies
    // before the dispatched record persists, and only the environment
    // admission survives.
    const killed = await runChild(stateFile, referenceFile, 'start-kill-live')
    expect(killed.signal, killed.stderr).toBe('SIGKILL')
    expect(killed.code).toBeNull()
    const minted = mintRetainedIdentity('kill-live', 'kill-live')
    const admission = JSON.parse(await readFile(referenceFile, 'utf8')) as Record<string, string>
    expect(admission).toMatchObject({
      phase: 'environment',
      environmentId: 'environment-kill-live',
      sessionId: minted.sessionId,
      executionId: minted.executionId,
    })
    // The dispatch committed before the kill: the provider holds the session.
    const stateAfterKill = JSON.parse(await readFile(stateFile, 'utf8')) as {
      environments: Record<string, { sessions: Record<string, unknown> }>
    }
    expect(
      Object.keys(stateAfterKill.environments['environment-kill-live']?.sessions ?? {}),
    ).toEqual([minted.sessionId])

    const recovered = await runChild(stateFile, referenceFile, 'recover-live')
    expect(recovered.code, recovered.stderr).toBe(0)
    expect(recovered.signal).toBeNull()
    const output = JSON.parse(await readFile(`${referenceFile}.output`, 'utf8')) as {
      controlRef: Record<string, string>
      eventIds: string[]
      cancellation: { operationId: string; status: string; effect: string }
    }
    expect(output.controlRef).toMatchObject({
      environmentId: 'environment-kill-live',
      sessionId: minted.sessionId,
      executionId: minted.executionId,
    })
    expect(output.eventIds).toEqual(['event-0', 'event-1', 'event-2'])
    expect(output.cancellation).toMatchObject({
      operationId: 'kill-live-cancel',
      status: 'accepted',
      effect: 'cancelled',
    })
    const durableState = JSON.parse(await readFile(stateFile, 'utf8')) as {
      environments: Record<string, { sessions: Record<string, { status: string }> }>
    }
    expect(
      durableState.environments['environment-kill-live']?.sessions[minted.sessionId]?.status,
    ).toBe('cancelled')
  })

  it('mints deterministic identity into the dispatch input and both admissions when identity is omitted', async () => {
    const minted = mintRetainedIdentity('mint-environment', 'mint-turn')
    const controlRef = {
      runId: 'mint-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: minted.sessionId,
      executionId: minted.executionId,
      requestDigest: retainedRequestDigest,
    }
    const session: AgentSession = {
      id: controlRef.sessionId,
      controlRef,
      status: async () => 'running',
      async *events() {
        yield* []
      },
      result: async () => ({ text: 'done', success: true, sessionId: controlRef.sessionId }),
      prompt: async () => ({ text: 'continued', success: true }),
      cancel: async () => {},
    }
    let dispatched: AgentTurnInput | undefined
    const provider = providerWithEnvironment({
      async dispatch(input) {
        dispatched = input
        return { id: controlRef.sessionId, provider: 'test-provider', controlRef }
      },
      session: () => session,
    })
    let created: CreateAgentEnvironmentInput | undefined
    const originalCreate = provider.create
    provider.create = async (input) => {
      created = input
      return originalCreate(input)
    }

    const recorder = recordedAdmissions()
    await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'mint-environment' },
      turn: { prompt: 'go', turnId: 'mint-turn' },
      onAdmission: recorder.onAdmission,
    })

    expect(dispatched).toMatchObject(minted)
    expect(created?.metadata).toEqual({
      retainedIdempotencyKey: 'mint-environment',
    })
    expect(recorder.admissions[1]).toMatchObject({ phase: 'environment', ...minted })
    expect(recorder.admissions[2]).toMatchObject({
      phase: 'dispatched',
      controlRef: { sessionId: minted.sessionId, executionId: minted.executionId },
    })
  })

  it('fails loud with the provider reference when dispatch dishonors the requested identity', async () => {
    let destroys = 0
    const rogueRef = {
      runId: 'rogue-run',
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'rogue-session',
      executionId: 'rogue-execution',
      requestDigest: retainedRequestDigest,
    }
    const provider = providerWithEnvironment({
      async dispatch() {
        return { id: rogueRef.sessionId, provider: 'test-provider', controlRef: rogueRef }
      },
      async destroy() {
        destroys += 1
      },
    })

    const recorder = recordedAdmissions()
    const failure = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'dishonor-environment' },
      turn: { prompt: 'go', turnId: 'dishonor-turn' },
      identity: { sessionId: 'honest-session', executionId: 'honest-execution' },
      onAdmission: recorder.onAdmission,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(RetainedRunDispatchBindingError)
    const binding = failure as RetainedRunDispatchBindingError
    expect(binding.code).toBe('backend_integrity')
    expect(binding.requested).toEqual({
      provider: 'test-provider',
      environmentId: 'environment-1',
      sessionId: 'honest-session',
      executionId: 'honest-execution',
    })
    expect(binding.returned).toMatchObject({ id: 'rogue-session' })
    expect(binding.returned.controlRef).toMatchObject({ sessionId: 'rogue-session' })
    // The environment stays alive, and its admission is already durable.
    expect(destroys).toBe(0)
    expect(recorder.admissions.map((admission) => admission.phase)).toEqual([
      'intent',
      'environment',
    ])
    expect(recorder.admissions[1]).toMatchObject({
      sessionId: 'honest-session',
      executionId: 'honest-execution',
    })
  })
})

async function collectRetainedEvents(events: AsyncIterable<RuntimeEventEnvelope>): Promise<void> {
  for await (const _event of events) {
    // The first event is expected to fail its retained-run binding check.
  }
}

function providerWithEnvironment(
  overrides: Partial<AgentEnvironment>,
  replay = true,
): AgentEnvironmentProvider {
  const environment: AgentEnvironment = {
    id: 'environment-1',
    provider: 'test-provider',
    status: async () => 'running',
    async *stream() {
      yield* []
    },
    async dispatch() {
      throw new Error('dispatch should have been overridden')
    },
    session() {
      throw new Error('session should not be reached')
    },
    ...overrides,
  }
  return {
    name: 'test-provider',
    capabilities: () => ({
      profile: {
        namedProfiles: true,
        systemPrompt: { replace: true, append: true },
        instructions: true,
        tools: true,
        permissions: true,
        mcp: true,
        subagents: true,
        resources: { files: true, instructions: true },
        runtimeUpdate: true,
        validation: true,
      },
      streaming: { live: true, replay, detach: replay, turnIdempotency: replay },
      sessions: { continue: true, list: true, messages: true },
      ...(replay
        ? {
            retainedControl: {
              exactRunIdentity: true,
              resultIdentity: true,
              eventIdentity: true,
              cancellationIdempotency: true,
            },
          }
        : {}),
      workspace: {
        read: false,
        write: false,
        exec: false,
        git: false,
        upload: false,
        download: false,
      },
      branching: { checkpoint: false, fork: false },
      placement: false,
      usage: false,
      confidential: false,
    }),
    async create() {
      return environment
    },
    async get() {
      return environment
    },
  }
}

function interactionCapabilities(
  overrides: Partial<InteractionCapabilities> = {},
): InteractionCapabilities {
  return {
    kinds: ['question'],
    answerFieldTypes: ['text'],
    responseScopes: ['interaction'],
    secretAnswers: false,
    concurrentRequests: false,
    replay: true,
    responseIdempotency: true,
    ...overrides,
  }
}
