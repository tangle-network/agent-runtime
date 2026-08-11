import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentRunCancellationAcknowledgement,
  type AgentRunCancellationRequest,
  AgentRunCancellationRequestSchema,
  interactionResponseCommandDigest,
  type RuntimeEventEnvelope,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentSession,
  AgentSessionStatus,
  AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reconnectRetainedRun, startRetainedRun } from './retained-run'

const childScript = new URL('../../tests/helpers/retained-run-child.ts', import.meta.url).pathname
const retainedRequestDigest = `sha256:${'a'.repeat(64)}` as const

interface ChildExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

async function runChild(
  stateFile: string,
  referenceFile: string,
  phase: 'start' | 'reconnect',
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
    expect(
      durableState.environments['environment-restart-proof']?.sessions['session-restart-proof']
        ?.status,
    ).toBe('cancelled')
    expect(
      Object.keys(
        durableState.environments['environment-restart-proof']?.sessions['session-restart-proof']
          ?.nativeOperations ?? {},
      ),
    ).toEqual(['restart-native-operation'])
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
    await expect(
      startRetainedRun({
        provider: uncertain,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'environment-key' },
        turn: { prompt: 'go', turnId: 'turn-key' },
      }),
    ).rejects.toThrow('connection lost after dispatch')
    expect(destroys).toBe(0)

    const unusable = providerWithEnvironment({
      dispatch: undefined,
      session: undefined,
      async destroy() {
        destroys += 1
      },
    })
    await expect(
      startRetainedRun({
        provider: unusable,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'unused-key' },
        turn: { prompt: 'go', turnId: 'unused-turn' },
      }),
    ).rejects.toThrow('does not expose detached session control')
    expect(destroys).toBe(1)
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
    })

    expect(recorded).toEqual({ prompt: 'fresh prompt', turnId: 'fresh-turn', detach: true })
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

    await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: controlRef.environmentId },
      turn: { prompt: 'owned task', turnId: 'owned-turn', sessionId: 'stale-session' },
      identity: { sessionId: controlRef.sessionId, executionId: controlRef.executionId },
    })

    expect(recorded).toEqual({
      prompt: 'owned task',
      turnId: 'owned-turn',
      detach: true,
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
    })
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
    })

    await expect(run.result()).rejects.toThrow('another retained session')
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
    })
    await expect(
      reconnectRetainedRun({
        provider,
        controlRef: { ...controlRef, runId: 'another-run', executionId: 'another-execution' },
      }),
    ).rejects.toThrow('different retained session')
    await expect(run.result()).rejects.toThrow('another retained execution')
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

    await expect(
      startRetainedRun({
        provider: contradictoryReference,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'identity-environment' },
        turn: { prompt: 'go', turnId: 'identity-turn' },
      }),
    ).rejects.toThrow('session reference for another provider')

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
      }),
    ).rejects.toThrow('cannot control a retry-safe retained run')
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
      }),
    ).rejects.toThrow('cannot control a retry-safe retained run')
    expect(creates).toBe(0)
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
    })

    await expect(collectRetainedEvents(run.events())).rejects.toThrow('another retained run')
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
