import {
  type AgentRunControlRef,
  type ContextTransferReceipt,
  type ContextTransferRequest,
  ContextTransferRequestSchema,
  contextTransferRequestDigest,
  type NativeContextBoundaryProof,
  NativeContextContinuationRequestSchema,
  nativeContextContinuationRequestDigest,
  nativeContextContinuationTurnDigest,
  type PortableContextPlan,
  type PortableContextPlanRequest,
  type PortableConversationContext,
  portableContextPlanRequestDigest,
  portableConversationContextDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentSession,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { executePortableContextTransfer, planPortableContext } from './portable-context'
import { startRetainedRun } from './retained-run'

const sourceMaterial = {
  source: {
    runId: 'source-run',
    messageId: 'message-2',
    provider: 'source-provider',
    environmentId: 'source-environment',
    sessionId: 'source-session',
  },
  completeness: 'complete' as const,
  messages: [
    {
      id: 'message-1',
      role: 'user' as const,
      parts: [{ type: 'text', text: 'Continue this work.' }],
      timestamp: '2026-08-02T01:00:00.000Z',
    },
    {
      id: 'message-2',
      role: 'assistant' as const,
      parts: [{ type: 'reasoning', text: 'runner-private state' }],
      timestamp: '2026-08-02T01:00:01.000Z',
    },
  ],
  attachments: [],
}

const source: PortableConversationContext = {
  ...sourceMaterial,
  digest: portableConversationContextDigest(sourceMaterial),
}

describe('portable context planning and transfer', () => {
  it('plans without dispatch, rejects unknown parts, and stops over-limit context', () => {
    const request = planRequest(10)
    let decisions = 0
    let estimates = 0

    const unsupported = planPortableContext(request, {
      estimateTokens: () => {
        estimates += 1
        return 4
      },
    })
    expect(unsupported).toMatchObject({
      status: 'unsupported',
      requestId: request.requestId,
      requestDigest: request.requestDigest,
    })
    expect(estimates).toBe(0)

    const overLimit = planPortableContext(request, {
      decidePart(input) {
        decisions += 1
        return {
          partIndex: input.partIndex,
          action: 'transform',
          output: { type: 'text', text: 'Visible summary.' },
          reason: 'runner-private reasoning became portable text',
        }
      },
      estimateTokens(context) {
        estimates += 1
        expect(context.messages).toHaveLength(2)
        return 11
      },
    })
    expect(overLimit).toMatchObject({
      status: 'over_limit',
      estimatedTokens: 11,
      maxInputTokens: 10,
    })
    expect(decisions).toBe(1)
    expect(estimates).toBe(1)
  })

  it('creates one fresh session and accepts only its exact receipt', async () => {
    const request = transferRequest(readyPlan())
    const exact = transferProvider(request, 'exact')
    const staleTurn = {
      prompt: 'Continue from the transferred context.',
      turnId: 'stale-turn',
      sessionId: 'source-session',
      executionId: 'source-execution',
      lastEventId: 'source-event',
      detach: false,
      controlRef: { runId: 'source-run', sessionId: 'source-session' },
      contextTransfer: { stale: true },
      nativeContinuation: { stale: true },
    } as unknown as AgentTurnInput
    const execution = await executePortableContextTransfer({
      provider: exact.provider,
      environment: { profile: { name: 'destination-profile' }, backend: 'codex' },
      request,
      turn: staleTurn,
    })

    expect(execution.result.status).toBe('accepted')
    expect(execution.run?.controlRef).toMatchObject({
      provider: 'destination-provider',
      environmentId: `destination-${request.operationId}`,
      sessionId: `session-${request.operationId}`,
    })
    expect(exact.stats.createInputs).toEqual([
      expect.objectContaining({ idempotencyKey: request.operationId }),
    ])
    expect(exact.stats.turns).toEqual([
      {
        prompt: staleTurn.prompt,
        turnId: request.operationId,
        detach: true,
        contextTransfer: request,
      },
    ])
    expect(exact.stats.createInputs).toHaveLength(1)
    expect(exact.stats.turns).toHaveLength(1)
    expect(execution.run?.controlRef.environmentId).not.toBe(source.source.environmentId)
    expect(execution.run?.controlRef.sessionId).not.toBe(source.source.sessionId)

    const wrong = transferProvider(request, 'wrong-environment')
    const rejectedReceipt = await executePortableContextTransfer({
      provider: wrong.provider,
      environment: { profile: { name: 'destination-profile' } },
      request,
      turn: { prompt: 'Continue.' },
    })
    expect(rejectedReceipt.result).toMatchObject({
      status: 'unknown',
      retryable: true,
    })
    expect(rejectedReceipt.run).toBeUndefined()
    expect(wrong.stats.createInputs).toHaveLength(1)
    expect(wrong.stats.turns).toHaveLength(2)

    const wrongControl = transferProvider(request, 'wrong-control')
    const rejectedControl = await executePortableContextTransfer({
      provider: wrongControl.provider,
      environment: { profile: { name: 'destination-profile' } },
      request,
      turn: { prompt: 'Continue.' },
    })
    expect(rejectedControl.result).toMatchObject({
      status: 'unknown',
      retryable: true,
    })
    expect(rejectedControl.run).toBeUndefined()
    expect(wrongControl.stats.gets).toHaveLength(0)
    expect(wrongControl.stats.turns).toHaveLength(2)

    const omittedProvider = transferProvider(request, 'omitted-provider')
    const omitted = await executePortableContextTransfer({
      provider: omittedProvider.provider,
      environment: { profile: { name: 'destination-profile' } },
      request,
      turn: { prompt: 'Continue.' },
    })
    expect(omitted.result.status).toBe('accepted')
    expect(omittedProvider.stats.gets).toHaveLength(1)

    const mismatchedProvider = transferProvider(request, 'wrong-provider')
    const rejectedProvider = await executePortableContextTransfer({
      provider: mismatchedProvider.provider,
      environment: { profile: { name: 'destination-profile' } },
      request,
      turn: { prompt: 'Do not reconstruct.' },
    })
    expect(rejectedProvider.result).toMatchObject({ status: 'unknown', retryable: true })
    expect(mismatchedProvider.stats.turns).toHaveLength(2)
    expect(mismatchedProvider.stats.gets).toHaveLength(0)
  })

  it('retries a transfer when the first receipt is lost and reconstructs the committed run', async () => {
    const request = transferRequest(readyPlan())
    const recovered = transferProvider(request, 'lost-first')

    const execution = await executePortableContextTransfer({
      provider: recovered.provider,
      environment: { profile: { name: 'destination-profile' } },
      request,
      turn: { prompt: 'recover the lost transfer receipt' },
    })

    expect(execution.result).toMatchObject({ status: 'accepted' })
    expect(execution.run?.controlRef).toMatchObject({
      runId: `run-${request.operationId}`,
      sessionId: `session-${request.operationId}`,
    })
    expect(recovered.stats.turns).toHaveLength(2)
  })

  it('negotiates retained transfer support before creating or dispatching', async () => {
    const request = transferRequest(readyPlan())
    const unsupported = transferProvider(request, 'exact')
    unsupported.provider.capabilities = async () => {
      const { retainedControl: _retainedControl, ...base } = retainedCapabilities()
      return {
        ...base,
        streaming: { live: true, replay: false, detach: false, turnIdempotency: false },
      }
    }

    const execution = await executePortableContextTransfer({
      provider: unsupported.provider,
      environment: { profile: { name: 'destination-profile' } },
      request,
      turn: { prompt: 'must not dispatch' },
    })

    expect(execution.result).toMatchObject({ status: 'unknown', retryable: false })
    expect(unsupported.stats.createInputs).toHaveLength(0)
    expect(unsupported.stats.turns).toHaveLength(0)
    expect(unsupported.stats.gets).toHaveLength(0)
  })

  it('destroys an unused destination but retains one after dispatch becomes uncertain', async () => {
    const request = transferRequest(readyPlan())
    let unusedDestroys = 0
    const unusedEnvironment: AgentEnvironment = {
      id: 'unused-destination',
      provider: 'destination-provider',
      status: async () => 'running',
      async *stream() {
        yield* []
      },
      destroy: async () => {
        unusedDestroys += 1
      },
    }
    const unusedProvider: AgentEnvironmentProvider = {
      name: 'destination-provider',
      capabilities: retainedCapabilities,
      create: async () => unusedEnvironment,
      get: async () => unusedEnvironment,
    }
    const unused = await executePortableContextTransfer({
      provider: unusedProvider,
      environment: { profile: { name: 'destination-profile' } },
      request,
      turn: { prompt: 'Continue.' },
    })
    expect(unused.result).toMatchObject({ status: 'transport_failure', retryable: false })
    expect(unusedDestroys).toBe(1)

    let uncertainDestroys = 0
    const uncertainProvider: AgentEnvironmentProvider = {
      name: 'destination-provider',
      capabilities: retainedCapabilities,
      async create() {
        return {
          ...unusedEnvironment,
          id: 'uncertain-destination',
          async dispatch() {
            throw new Error('connection lost after transfer dispatch')
          },
          async destroy() {
            uncertainDestroys += 1
          },
        }
      },
      get: async () => null,
    }
    const uncertain = await executePortableContextTransfer({
      provider: uncertainProvider,
      environment: { profile: { name: 'destination-profile' } },
      request,
      turn: { prompt: 'Continue.' },
    })
    expect(uncertain.result).toMatchObject({ status: 'unknown', retryable: true })
    expect(uncertainDestroys).toBe(0)
  })
})

describe('native same-session continuation', () => {
  it('continues once at the same boundary and adopts the provider current run coordinates', async () => {
    const fixture = nativeProvider('matching')
    const run = await startRetainedRun({
      provider: fixture.provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'native-environment' },
      turn: { prompt: 'first turn', turnId: 'native-start' },
    })
    const initialControlRef = run.controlRef
    const turn = { prompt: 'new user turn' }
    const expectedBoundary = nativeBoundary(initialControlRef, '2026-08-02T02:00:00.000Z')
    const material = {
      run: initialControlRef,
      expectedBoundary,
      turnDigest: nativeContextContinuationTurnDigest(turn),
    }
    const request = NativeContextContinuationRequestSchema.parse({
      operationId: 'native-operation',
      requestDigest: nativeContextContinuationRequestDigest(material),
      ...material,
    })

    const first = await run.continueNative(request, turn)

    expect(first.acknowledgement).toMatchObject({
      status: 'accepted',
      operationId: request.operationId,
      historyMessagesSent: 0,
    })
    expect(first).toMatchObject({
      result: { text: 'continued', success: true, sessionId: initialControlRef.sessionId },
      controlRef: {
        ...initialControlRef,
        runId: `native-run-${request.operationId}`,
        executionId: `native-execution-${request.operationId}`,
      },
    })
    if (!('controlRef' in first)) throw new Error('expected accepted native continuation')
    expect(run.controlRef).toEqual({
      ...initialControlRef,
      runId: `native-run-${request.operationId}`,
      executionId: `native-execution-${request.operationId}`,
    })
    const expectedAfterContinuation = run.controlRef
    const exposedControlRef = run.controlRef
    Reflect.set(exposedControlRef, 'runId', 'caller-mutated-run')
    Reflect.set(first.controlRef, 'runId', 'caller-mutated-result')
    expect(run.controlRef).toEqual(expectedAfterContinuation)
    expect(run.controlRef.runId).toBe(`native-run-${request.operationId}`)
    expect(fixture.stats.continuationCalls).toBe(1)
    expect(fixture.stats.effectCalls).toBe(1)
    expect(fixture.stats.turns).toEqual([turn])
  })

  it.each(['mismatch', 'unverified'] as const)(
    'dispatches zero continuation turns when the boundary is %s',
    async (mode) => {
      const fixture = nativeProvider(mode)
      const run = await startRetainedRun({
        provider: fixture.provider,
        environment: { profile: { name: 'worker' }, idempotencyKey: `native-${mode}` },
        turn: { prompt: 'first turn', turnId: `native-start-${mode}` },
      })
      const turn = { prompt: 'must not run' }
      const expectedBoundary = nativeBoundary(run.controlRef, '2026-08-02T02:00:00.000Z')
      const material = {
        run: run.controlRef,
        expectedBoundary,
        turnDigest: nativeContextContinuationTurnDigest(turn),
      }
      const request = NativeContextContinuationRequestSchema.parse({
        operationId: `native-operation-${mode}`,
        requestDigest: nativeContextContinuationRequestDigest(material),
        ...material,
      })
      const result = await run.continueNative(request, turn)

      expect(result.acknowledgement.status).toBe(
        mode === 'mismatch' ? 'boundary_mismatch' : 'unverified',
      )
      expect(result.acknowledgement.historyMessagesSent).toBe(0)
      expect(fixture.stats.effectCalls).toBe(0)
    },
  )

  it('rejects a foreign boundary returned with a non-success continuation result', async () => {
    const fixture = nativeProvider('foreign-boundary')
    const run = await startRetainedRun({
      provider: fixture.provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'native-foreign-boundary' },
      turn: { prompt: 'first turn', turnId: 'native-start-foreign-boundary' },
    })
    const turn = { prompt: 'must not run' }
    const material = {
      run: run.controlRef,
      expectedBoundary: nativeBoundary(run.controlRef, '2026-08-02T02:00:00.000Z'),
      turnDigest: nativeContextContinuationTurnDigest(turn),
    }
    const request = NativeContextContinuationRequestSchema.parse({
      operationId: 'native-foreign-boundary-operation',
      requestDigest: nativeContextContinuationRequestDigest(material),
      ...material,
    })

    await expect(run.continueNative(request, turn)).rejects.toThrow(
      'native context proof does not identify this retained run',
    )
    expect(fixture.stats.effectCalls).toBe(0)
  })

  it('rejects a changed user turn before calling the provider', async () => {
    const fixture = nativeProvider('matching')
    const run = await startRetainedRun({
      provider: fixture.provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'native-wrong-turn' },
      turn: { prompt: 'first turn', turnId: 'native-start-wrong-turn' },
    })
    const boundTurn = { prompt: 'bound user turn' }
    const material = {
      run: run.controlRef,
      expectedBoundary: nativeBoundary(run.controlRef, '2026-08-02T02:00:00.000Z'),
      turnDigest: nativeContextContinuationTurnDigest(boundTurn),
    }
    const request = NativeContextContinuationRequestSchema.parse({
      operationId: 'native-wrong-turn-operation',
      requestDigest: nativeContextContinuationRequestDigest(material),
      ...material,
    })

    await expect(run.continueNative(request, { prompt: 'different user turn' })).rejects.toThrow(
      'targets another user turn',
    )
    expect(fixture.stats.continuationCalls).toBe(0)
    expect(fixture.stats.effectCalls).toBe(0)
  })

  it.each([
    { atomicBoundary: false, requestIdempotency: true },
    { atomicBoundary: true, requestIdempotency: false },
  ])('rejects false native guarantees before creating: %o', async (nativeContinuation) => {
    const fixture = nativeProvider('matching')
    let creates = 0
    const provider: AgentEnvironmentProvider = {
      ...fixture.provider,
      capabilities: () => ({ ...retainedCapabilities(), nativeContinuation }),
      async create() {
        creates += 1
        return fixture.provider.create()
      },
    }

    await expect(
      startRetainedRun({
        provider,
        environment: { profile: { name: 'worker' }, idempotencyKey: 'native-false-capability' },
        turn: { prompt: 'first turn', turnId: 'native-false-capability-start' },
      }),
    ).rejects.toThrow(
      'native continuation requires session continuation, atomic boundary admission, and request idempotency together',
    )
    expect(creates).toBe(0)
    expect(fixture.stats.continuationCalls).toBe(0)
    expect(fixture.stats.effectCalls).toBe(0)
  })

  it('recovers a committed continuation after the first response is lost', async () => {
    const fixture = nativeProvider('mutate-then-throw')
    const run = await startRetainedRun({
      provider: fixture.provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'native-retry' },
      turn: { prompt: 'first turn', turnId: 'native-start-retry' },
    })
    const initialControlRef = run.controlRef
    const turn = { prompt: 'retry-safe user turn' }
    const material = {
      run: initialControlRef,
      expectedBoundary: nativeBoundary(initialControlRef, '2026-08-02T02:00:00.000Z'),
      turnDigest: nativeContextContinuationTurnDigest(turn),
    }
    const request = NativeContextContinuationRequestSchema.parse({
      operationId: 'native-retry-operation',
      requestDigest: nativeContextContinuationRequestDigest(material),
      ...material,
    })

    await expect(run.continueNative(request, turn)).rejects.toThrow(
      'connection lost after continuation commit',
    )
    expect(run.controlRef).toEqual(initialControlRef)
    expect(fixture.stats.effectCalls).toBe(1)

    const replay = await run.continueNative(request, turn)
    expect(replay).toMatchObject({
      acknowledgement: { status: 'replayed', operationId: request.operationId },
      result: { text: 'continued', success: true, sessionId: initialControlRef.sessionId },
      controlRef: {
        runId: `native-run-${request.operationId}`,
        executionId: `native-execution-${request.operationId}`,
      },
    })
    if (!('controlRef' in replay)) throw new Error('expected replayed native continuation')
    expect(run.controlRef).toEqual(replay.controlRef)
    expect(fixture.stats.continuationCalls).toBe(2)
    expect(fixture.stats.effectCalls).toBe(1)
  })
})

function planRequest(maxInputTokens: number): PortableContextPlanRequest {
  const material = {
    source,
    destination: { runner: 'codex', provider: 'destination-provider' },
    maxInputTokens,
  }
  return {
    requestId: 'plan-request',
    requestDigest: portableContextPlanRequestDigest(material),
    ...material,
  }
}

function readyPlan(): PortableContextPlan {
  const planned = planPortableContext(planRequest(100), {
    decidePart(input) {
      return {
        partIndex: input.partIndex,
        action: 'transform',
        output: { type: 'text', text: 'Visible summary.' },
        reason: 'runner-private reasoning became portable text',
      }
    },
    estimateTokens: () => 8,
  })
  if (planned.status !== 'ready') throw new Error(`expected ready plan, got ${planned.status}`)
  return planned.plan
}

function transferRequest(plan: PortableContextPlan): ContextTransferRequest {
  const material = {
    plan,
    acceptance: {
      planDigest: plan.digest,
      acceptedAt: '2026-08-02T01:01:00.000Z',
      acceptedBy: 'user' as const,
    },
  }
  return ContextTransferRequestSchema.parse({
    operationId: 'context-operation',
    requestDigest: contextTransferRequestDigest(material),
    ...material,
  })
}

function transferProvider(
  request: ContextTransferRequest,
  mode:
    | 'exact'
    | 'wrong-environment'
    | 'wrong-control'
    | 'omitted-provider'
    | 'wrong-provider'
    | 'lost-first',
): {
  provider: AgentEnvironmentProvider
  stats: {
    createInputs: CreateAgentEnvironmentInput[]
    turns: AgentTurnInput[]
    gets: string[]
  }
} {
  const stats = {
    createInputs: [] as CreateAgentEnvironmentInput[],
    turns: [] as AgentTurnInput[],
    gets: [] as string[],
  }
  const environmentId = `destination-${request.operationId}`
  const sessionId = `session-${request.operationId}`
  const exactControlRef = {
    runId: `run-${request.operationId}`,
    provider: 'destination-provider',
    environmentId,
    sessionId,
    executionId: `execution-${request.operationId}`,
  }
  const controlRef =
    mode === 'wrong-control'
      ? { ...exactControlRef, runId: 'another-run', sessionId: 'another-session' }
      : exactControlRef
  const receipt: ContextTransferReceipt = {
    status: 'accepted',
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    planDigest: request.plan.digest,
    contextDigest: request.plan.context.digest,
    destination: request.plan.destination,
    provider: 'destination-provider',
    environmentId: mode === 'wrong-environment' ? 'another-environment' : environmentId,
    sessionId,
    sessionCreatedForOperationId: request.operationId,
    sessionCreatedAt: '2026-08-02T01:01:00.500Z',
    transferredMessageIds: request.plan.messages
      .filter((message) => message.action === 'include')
      .map((message) => message.messageId),
    omittedMessageIds: request.plan.messages
      .filter((message) => message.action === 'omit')
      .map((message) => message.messageId),
    admittedAt: '2026-08-02T01:01:01.000Z',
  }
  const session = (id: string, exactRef: AgentRunControlRef = controlRef): AgentSession => ({
    id,
    controlRef: exactRef,
    status: async () => 'running',
    async *events() {
      yield* []
    },
    result: async () => ({ text: 'transferred', success: true }),
    prompt: async () => ({ text: 'continued', success: true }),
    cancel: async () => {},
  })
  const environment = (): AgentEnvironment => ({
    id: environmentId,
    provider: 'destination-provider',
    status: async () => 'running',
    async *stream() {
      yield* []
    },
    async dispatch(input) {
      stats.turns.push(input)
      if (mode === 'lost-first' && stats.turns.length === 1) {
        return { id: sessionId } as never
      }
      return {
        id: sessionId,
        ...(mode === 'omitted-provider'
          ? {}
          : { provider: mode === 'wrong-provider' ? 'another-provider' : 'destination-provider' }),
        controlRef,
        contextTransferReceipt: receipt,
      }
    },
    session: (id, options) => session(id, options?.controlRef ?? controlRef),
  })
  return {
    stats,
    provider: {
      name: 'destination-provider',
      capabilities: retainedCapabilities,
      async create(input) {
        stats.createInputs.push(input)
        return environment()
      },
      async get(id) {
        stats.gets.push(id)
        return id === environmentId ? environment() : null
      },
    },
  }
}

function nativeProvider(
  mode: 'matching' | 'mismatch' | 'unverified' | 'foreign-boundary' | 'mutate-then-throw',
) {
  const stats = {
    continuationCalls: 0,
    effectCalls: 0,
    turns: [] as Array<{ prompt?: string }>,
  }
  const environmentId = 'native-environment'
  const sessionId = 'native-session'
  let currentControlRef = {
    runId: 'native-run',
    provider: 'native-provider',
    environmentId,
    sessionId,
    executionId: 'native-execution',
  }
  const outcomes = new Map<
    string,
    {
      requestDigest: string
      result: {
        acknowledgement: {
          operationId: string
          requestDigest: `sha256:${string}`
          status: 'accepted'
          historyMessagesSent: 0
          actualBoundary: NativeContextBoundaryProof
        }
        result: { text: string; success: true; sessionId: string }
        controlRef: AgentRunControlRef
      }
    }
  >()
  let lostFirstResponse = false
  const session = (): AgentSession => ({
    id: sessionId,
    get controlRef() {
      return currentControlRef
    },
    status: async () => 'running',
    async *events() {
      yield* []
    },
    result: async () => ({ text: 'first', success: true }),
    prompt: async () => {
      throw new Error('ordinary prompt must not implement native continuation')
    },
    async contextBoundary() {
      return nativeBoundary(currentControlRef, '2026-08-02T02:00:01.000Z')
    },
    async continueNative(request, options) {
      stats.continuationCalls += 1
      const prior = outcomes.get(request.operationId)
      if (prior) {
        if (prior.requestDigest !== request.requestDigest) {
          return {
            acknowledgement: {
              operationId: request.operationId,
              requestDigest: request.requestDigest,
              status: 'conflict',
              historyMessagesSent: 0,
              existingRequestDigest: prior.requestDigest as `sha256:${string}`,
            },
          }
        }
        return {
          ...prior.result,
          acknowledgement: { ...prior.result.acknowledgement, status: 'replayed' as const },
        }
      }

      const actualBoundary = nativeBoundary(request.run, '2026-08-02T02:00:01.000Z')
      if (mode === 'foreign-boundary') {
        return {
          acknowledgement: {
            operationId: request.operationId,
            requestDigest: request.requestDigest,
            status: 'boundary_mismatch' as const,
            historyMessagesSent: 0 as const,
            actualBoundary: nativeBoundary(
              { ...request.run, runId: 'foreign-run' },
              '2026-08-02T02:00:01.000Z',
            ),
          },
        }
      }
      if (mode === 'mismatch') {
        return {
          acknowledgement: {
            operationId: request.operationId,
            requestDigest: request.requestDigest,
            status: 'boundary_mismatch',
            historyMessagesSent: 0,
            actualBoundary: {
              ...actualBoundary,
              boundary: { kind: 'revision' as const, revision: 'different' },
            },
          },
        }
      }
      if (mode === 'unverified') {
        return {
          acknowledgement: {
            operationId: request.operationId,
            requestDigest: request.requestDigest,
            status: 'unverified',
            historyMessagesSent: 0,
          },
        }
      }

      stats.effectCalls += 1
      stats.turns.push(options.turn)
      if (!request.run.sessionId) throw new Error('native continuation requires a session')
      currentControlRef = {
        ...request.run,
        sessionId: request.run.sessionId,
        runId: `native-run-${request.operationId}`,
        executionId: `native-execution-${request.operationId}`,
      }
      const result = {
        acknowledgement: {
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          status: 'accepted' as const,
          historyMessagesSent: 0 as const,
          actualBoundary,
        },
        result: {
          text: 'continued',
          success: true as const,
          sessionId,
          metadata: {
            runId: currentControlRef.runId,
            executionId: currentControlRef.executionId,
          },
        },
        controlRef: currentControlRef,
      }
      outcomes.set(request.operationId, { requestDigest: request.requestDigest, result })
      if (mode === 'mutate-then-throw' && !lostFirstResponse) {
        lostFirstResponse = true
        throw new Error('connection lost after continuation commit')
      }
      return result
    },
    cancel: async () => {},
  })
  const environment = (): AgentEnvironment => ({
    id: environmentId,
    provider: 'native-provider',
    status: async () => 'running',
    async *stream() {
      yield* []
    },
    dispatch: async () => ({
      id: sessionId,
      provider: 'native-provider',
      controlRef: currentControlRef,
    }),
    session: () => session(),
  })
  return {
    stats,
    provider: {
      name: 'native-provider',
      capabilities: nativeCapabilities,
      create: async () => environment(),
      get: async (id: string) => (id === environmentId ? environment() : null),
    } satisfies AgentEnvironmentProvider,
  }
}

function nativeCapabilities() {
  return {
    ...retainedCapabilities(),
    nativeContinuation: { atomicBoundary: true, requestIdempotency: true },
  }
}

function nativeBoundary(
  controlRef: {
    runId: string
    provider: string
    environmentId: string
    sessionId?: string
  },
  observedAt: string,
): NativeContextBoundaryProof {
  if (!controlRef.sessionId) throw new Error('native boundary requires a session')
  return {
    runId: controlRef.runId,
    provider: controlRef.provider,
    environmentId: controlRef.environmentId,
    sessionId: controlRef.sessionId,
    boundary: {
      kind: 'messages',
      messageIds: ['message-1'],
      digest: `sha256:${'2'.repeat(64)}`,
    },
    observedAt,
  }
}

function retainedCapabilities() {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: true,
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: { files: true, instructions: true },
      runtimeUpdate: true,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: true, messages: true },
    retainedControl: {
      exactRunIdentity: true,
      resultIdentity: true,
      eventIdentity: true,
      cancellationIdempotency: true,
    },
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
  }
}
