import { InMemoryTraceStore, type LlmSpan } from '@tangle-network/agent-eval'
import type { AgentCandidateResolvedModel, Sha256Digest } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import {
  appendAuthoritativeModelSettlementSpans,
  assertTraceMatchesModelSettlement,
  sealAgentCandidateModelSettlement,
} from '../src/candidate-execution/model-settlement'
import { runProtectedAgentCandidateModelGrant } from '../src/candidate-execution/protected-model-grant'
import {
  type AgentCandidateModelGrantActivateInput,
  type AgentCandidateModelGrantClient,
  type AgentCandidateModelGrantReservation,
  type AgentCandidateModelGrantReserveInput,
  type AgentCandidateModelGrantSettleInput,
  createProtectedAgentCandidateModelPort,
} from '../src/candidate-execution/protected-model-port'
import type {
  AgentCandidateModelPort,
  AgentCandidateProtectedModelActivation,
  AgentCandidateProtectedModelSettlement,
  AgentCandidateProtectedModelSettlementCall,
} from '../src/candidate-execution/types'

const GATEWAY_DOMAIN = 'router.tangle.tools'
const ACTIVATION_ENV_NAMES = ['MODEL_API_KEY', 'MODEL_BASE_URL'] as const
const EXPIRES_AT_MS = 2_000_000_000_000

function sha(character: string): Sha256Digest {
  return `sha256:${character.repeat(64)}` as Sha256Digest
}

const resolvedModel: AgentCandidateResolvedModel = {
  requested: 'openai/gpt-5.2-codex',
  provider: 'openai',
  model: 'openai/gpt-5.2-codex-2026-07-01',
  snapshot: 'gpt-5.2-codex-2026-07-01',
  reasoningEffort: 'high',
}

function reserveInput(
  limits: AgentCandidateModelGrantReserveInput['limits'] = {
    maxModelCalls: 2,
    maxInputTokens: 30,
    maxOutputTokens: 20,
    maxCostUsd: 0.1,
  },
): AgentCandidateModelGrantReserveInput {
  return {
    executionId: 'execution-1',
    preparationId: 'preparation-1',
    expiresAtMs: EXPIRES_AT_MS,
    attempt: { number: 1, maxAttempts: 1, retryPolicy: 'none' },
    bundleDigest: sha('a'),
    resolved: resolvedModel,
    limits,
  }
}

function reservation(
  input: AgentCandidateModelGrantReserveInput,
): AgentCandidateModelGrantReservation {
  return {
    preparationId: input.preparationId,
    digest: sha('b'),
    expiresAtMs: input.expiresAtMs,
    enforcedLimits: input.limits,
    network:
      input.limits.maxModelCalls === 0
        ? { mode: 'disabled' }
        : { mode: 'gateway-only', domains: [GATEWAY_DOMAIN] },
  }
}

function activateInput(): AgentCandidateModelGrantActivateInput {
  return {
    executionId: 'execution-1',
    preparationId: 'preparation-1',
    grantDigest: sha('b'),
    resolved: resolvedModel,
    deadlineAtMs: EXPIRES_AT_MS - 1_000,
  }
}

function settleInput(
  reason: AgentCandidateModelGrantSettleInput['reason'] = 'completed',
): AgentCandidateModelGrantSettleInput {
  return {
    executionId: 'execution-1',
    preparationId: 'preparation-1',
    grantDigest: sha('b'),
    resolved: resolvedModel,
    reason,
  }
}

function modelCall(
  index: number,
  overrides: Partial<AgentCandidateProtectedModelSettlementCall> = {},
): AgentCandidateProtectedModelSettlementCall {
  const base = {
    callId: `call-${index}`,
    generationId: `generation-${index}`,
    traceSpanId: `generation-${index}`,
    status: 'succeeded',
    model: resolvedModel.model,
    startedAtMs: 1_000 + index * 100,
    endedAtMs: 1_050 + index * 100,
    inputTokens: 10,
    accountedInputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsdNanos: 10_000_000,
    costProvenance: 'observed' as const,
  }
  return {
    ...base,
    ...overrides,
    accountedInputTokens:
      overrides.accountedInputTokens ?? overrides.inputTokens ?? base.inputTokens,
  }
}

function settlement(
  calls: readonly AgentCandidateProtectedModelSettlementCall[] = [],
): AgentCandidateProtectedModelSettlement {
  return {
    preparationId: 'preparation-1',
    grantDigest: sha('b'),
    closed: true,
    usageWithinLimits: true,
    calls,
  }
}

interface FakeClientOptions {
  reserve?: (
    input: AgentCandidateModelGrantReserveInput,
  ) => Promise<AgentCandidateModelGrantReservation>
  activate?: (
    input: AgentCandidateModelGrantActivateInput,
  ) => Promise<AgentCandidateProtectedModelActivation>
  settle?: (
    input: AgentCandidateModelGrantSettleInput,
  ) => Promise<AgentCandidateProtectedModelSettlement>
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fakeClient(options: FakeClientOptions = {}): AgentCandidateModelGrantClient & {
  reserveInputs: AgentCandidateModelGrantReserveInput[]
  activateInputs: AgentCandidateModelGrantActivateInput[]
  settleInputs: AgentCandidateModelGrantSettleInput[]
} {
  const reserveInputs: AgentCandidateModelGrantReserveInput[] = []
  const activateInputs: AgentCandidateModelGrantActivateInput[] = []
  const settleInputs: AgentCandidateModelGrantSettleInput[] = []
  return {
    reserveInputs,
    activateInputs,
    settleInputs,
    reserve: async (input) => {
      reserveInputs.push(input)
      return options.reserve ? await options.reserve(input) : reservation(input)
    },
    activate: async (input) => {
      activateInputs.push(input)
      return options.activate
        ? await options.activate(input)
        : {
            env: {
              MODEL_API_KEY: 'protected-candidate-token',
              MODEL_BASE_URL: 'https://router.tangle.tools/v1',
            },
          }
    },
    settle: async (input) => {
      settleInputs.push(input)
      return options.settle ? await options.settle(input) : settlement()
    },
  }
}

function createPort(client: AgentCandidateModelGrantClient): AgentCandidateModelPort {
  return createProtectedAgentCandidateModelPort({
    client,
    gatewayDomain: GATEWAY_DOMAIN,
    activationEnvNames: ACTIVATION_ENV_NAMES,
    resolveModel: async ({ requested, reasoningEffort }) => ({
      ...resolvedModel,
      requested,
      reasoningEffort,
    }),
  })
}

async function reserve(port: AgentCandidateModelPort, input = reserveInput()) {
  return await port.reserveGrant(input)
}

describe('protected candidate model port', () => {
  it('reserves without a live secret, activates exact protected env, and settles exact usage', async () => {
    const client = fakeClient({
      settle: async () =>
        settlement([
          modelCall(1, {
            inputTokens: 20,
            outputTokens: 10,
            cachedInputTokens: 4,
            reasoningTokens: 3,
            costUsdNanos: 100_000_000,
          }),
        ]),
    })
    const port = createPort(client)

    await expect(
      port.resolve({
        requested: resolvedModel.requested,
        harness: 'opencode',
        reasoningEffort: resolvedModel.reasoningEffort,
      }),
    ).resolves.toEqual(resolvedModel)
    const reserved = await reserve(port)
    expect(JSON.stringify(reserved)).not.toContain('protected-candidate-token')
    expect(reserved).toEqual({
      preparationId: 'preparation-1',
      digest: sha('b'),
      expiresAtMs: EXPIRES_AT_MS,
      enforcedLimits: reserveInput().limits,
      network: { mode: 'gateway-only', domains: [GATEWAY_DOMAIN] },
    })
    expect(Object.isFrozen(reserved)).toBe(true)

    const activated = await port.activateGrant(activateInput())
    expect(activated).toEqual({
      env: {
        MODEL_API_KEY: 'protected-candidate-token',
        MODEL_BASE_URL: 'https://router.tangle.tools/v1',
      },
    })
    expect(Object.isFrozen(activated.env)).toBe(true)

    const settled = await port.settleGrant(settleInput('completed'))
    expect(settled.calls).toEqual([
      modelCall(1, {
        inputTokens: 20,
        outputTokens: 10,
        cachedInputTokens: 4,
        reasoningTokens: 3,
        costUsdNanos: 100_000_000,
      }),
    ])
    expect(client.settleInputs).toEqual([settleInput('completed')])
    expect(Object.isFrozen(settled.calls)).toBe(true)
  })

  it('keeps zero-call reservation, activation, and settlement entirely credential-free', async () => {
    const client = fakeClient({ activate: async () => ({ env: {} }) })
    const port = createPort(client)
    const input = reserveInput({
      maxModelCalls: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxCostUsd: 0,
    })
    await expect(port.reserveGrant(input)).resolves.toMatchObject({
      network: { mode: 'disabled' },
    })
    await expect(port.activateGrant(activateInput())).resolves.toEqual({ env: {} })
    await expect(port.settleGrant(settleInput())).resolves.toEqual(settlement())
    expect(client.activateInputs).toHaveLength(1)
  })

  it('rejects any protected env or final model row for a zero-call reservation', async () => {
    const client = fakeClient()
    const port = createPort(client)
    const input = reserveInput({
      maxModelCalls: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxCostUsd: 0,
    })
    await port.reserveGrant(input)
    await expect(port.activateGrant(activateInput())).rejects.toThrow(/environment names/)

    const rowClient = fakeClient({
      activate: async () => ({ env: {} }),
      settle: async () => settlement([modelCall(1)]),
    })
    const rowPort = createPort(rowClient)
    await rowPort.reserveGrant(input)
    await rowPort.activateGrant(activateInput())
    await expect(rowPort.settleGrant(settleInput())).rejects.toThrow(
      /model calls.*exceeds reserved/,
    )
  })

  it('rejects any secret or other extra field in the reservation response', async () => {
    const client = fakeClient({
      reserve: async (input) =>
        ({
          ...reservation(input),
          env: { MODEL_API_KEY: 'must-not-exist-before-activation' },
        }) as AgentCandidateModelGrantReservation,
    })
    await expect(reserve(createPort(client))).rejects.toThrow(/unknown field env/)
  })

  it('requires reservation retries to preserve both request and returned evidence', async () => {
    let digest = sha('b')
    const client = fakeClient({
      reserve: async (input) => ({ ...reservation(input), digest }),
    })
    const port = createPort(client)
    await expect(reserve(port)).resolves.toMatchObject({ digest: sha('b') })
    await expect(
      reserve(port, reserveInput({ ...reserveInput().limits, maxInputTokens: 29 })),
    ).rejects.toThrow(/changed immutable input/)
    expect(client.reserveInputs).toHaveLength(1)

    digest = sha('c')
    await expect(reserve(port)).rejects.toThrow(/different evidence/)
  })

  it('linearizes concurrent reservation retries before accepting changed input', async () => {
    const firstResponse = deferred<AgentCandidateModelGrantReservation>()
    const secondResponse = deferred<AgentCandidateModelGrantReservation>()
    const client = fakeClient({
      reserve: async (input) =>
        input.limits.maxInputTokens === 30 ? firstResponse.promise : secondResponse.promise,
    })
    const port = createPort(client)
    const firstInput = reserveInput()
    const secondInput = reserveInput({ ...firstInput.limits, maxInputTokens: 29 })
    const first = reserve(port, firstInput)
    const second = reserve(port, secondInput)

    firstResponse.resolve(reservation(firstInput))
    await expect(first).resolves.toMatchObject({ enforcedLimits: firstInput.limits })
    secondResponse.resolve(reservation(secondInput))
    await expect(second).rejects.toThrow(/changed immutable input/)
  })

  it('does not resurrect a reservation when a concurrent retry returns after settlement', async () => {
    const firstResponse = deferred<AgentCandidateModelGrantReservation>()
    const secondResponse = deferred<AgentCandidateModelGrantReservation>()
    let call = 0
    const client = fakeClient({
      reserve: async () => (++call === 1 ? firstResponse.promise : secondResponse.promise),
    })
    const port = createPort(client)
    const input = reserveInput()
    const first = reserve(port, input)
    const second = reserve(port, input)
    firstResponse.resolve(reservation(input))
    await first
    await port.settleGrant(settleInput())

    secondResponse.resolve(reservation(input))
    await expect(second).rejects.toThrow(/after the grant was settled/)
    await expect(port.activateGrant(activateInput())).rejects.toThrow(/already settled/)
  })

  it.each([
    [
      'expiry',
      (input: AgentCandidateModelGrantReserveInput) => ({
        ...reservation(input),
        expiresAtMs: input.expiresAtMs + 1,
      }),
    ],
    [
      'limits',
      (input: AgentCandidateModelGrantReserveInput) => ({
        ...reservation(input),
        enforcedLimits: { ...input.limits, maxInputTokens: input.limits.maxInputTokens + 1 },
      }),
    ],
    [
      'domain',
      (input: AgentCandidateModelGrantReserveInput) => ({
        ...reservation(input),
        network: { mode: 'gateway-only' as const, domains: ['other.example.com'] },
      }),
    ],
  ])('rejects reservation %s drift', async (_name, mutate) => {
    const client = fakeClient({ reserve: async (input) => mutate(input) })
    await expect(reserve(createPort(client))).rejects.toThrow(/changed|unexpected/)
  })

  it('requires the activation endpoint to return exactly the configured protected env', async () => {
    const extra = fakeClient({
      activate: async () => ({
        env: {
          MODEL_API_KEY: 'protected-candidate-token',
          MODEL_BASE_URL: 'https://router.tangle.tools/v1',
          DATABASE_URL: 'must-never-reach-candidate',
        },
      }),
    })
    const extraPort = createPort(extra)
    await reserve(extraPort)
    await expect(extraPort.activateGrant(activateInput())).rejects.toThrow(/environment names/)

    const missing = fakeClient({
      activate: async () => ({ env: { MODEL_API_KEY: 'protected-candidate-token' } }),
    })
    const missingPort = createPort(missing)
    await reserve(missingPort)
    await expect(missingPort.activateGrant(activateInput())).rejects.toThrow(/environment names/)
  })

  it('rejects activation before reservation, after settlement, and with changed grant identity', async () => {
    const client = fakeClient()
    const port = createPort(client)
    await expect(port.activateGrant(activateInput())).rejects.toThrow(/not reserved/)

    await reserve(port)
    await expect(port.activateGrant({ ...activateInput(), grantDigest: sha('c') })).rejects.toThrow(
      /immutable reservation/,
    )
    await port.settleGrant(settleInput())
    await expect(port.activateGrant(activateInput())).rejects.toThrow(/already settled/)
    expect(client.activateInputs).toHaveLength(0)
  })

  it('treats protected environment activation as single-use', async () => {
    const client = fakeClient()
    const port = createPort(client)
    await reserve(port)
    await expect(port.activateGrant(activateInput())).resolves.toMatchObject({ env: {} })
    await expect(port.activateGrant(activateInput())).rejects.toThrow(/single-use/)
    expect(client.activateInputs).toHaveLength(1)
  })

  it('linearizes concurrent activation before the service returns a credential', async () => {
    const response = deferred<AgentCandidateProtectedModelActivation>()
    const client = fakeClient({ activate: async () => response.promise })
    const port = createPort(client)
    await reserve(port)
    const first = port.activateGrant(activateInput())
    await expect(port.activateGrant(activateInput())).rejects.toThrow(/single-use/)
    response.resolve({
      env: {
        MODEL_API_KEY: 'protected-candidate-token',
        MODEL_BASE_URL: 'https://router.tangle.tools/v1',
      },
    })
    await expect(first).resolves.toMatchObject({ env: {} })
    expect(client.activateInputs).toHaveLength(1)
  })

  it('does not return a credential when settlement wins an activation race', async () => {
    const response = deferred<AgentCandidateProtectedModelActivation>()
    const client = fakeClient({ activate: async () => response.promise })
    const port = createPort(client)
    await reserve(port)
    const activation = port.activateGrant(activateInput())
    await port.settleGrant(settleInput('failed'))
    response.resolve({
      env: {
        MODEL_API_KEY: 'protected-candidate-token',
        MODEL_BASE_URL: 'https://router.tangle.tools/v1',
      },
    })
    await expect(activation).rejects.toThrow(/settled while activation was in flight/)
  })

  it.each([
    [
      'model calls',
      [
        modelCall(1, { inputTokens: 0, outputTokens: 0, costUsdNanos: 0 }),
        modelCall(2, { inputTokens: 0, outputTokens: 0, costUsdNanos: 0 }),
        modelCall(3, { inputTokens: 0, outputTokens: 0, costUsdNanos: 0 }),
      ],
    ],
    ['input tokens', [modelCall(1, { inputTokens: 31, outputTokens: 0, costUsdNanos: 0 })]],
    ['output tokens', [modelCall(1, { inputTokens: 0, outputTokens: 21, costUsdNanos: 0 })]],
    [
      'cost USD nanos',
      [modelCall(1, { inputTokens: 0, outputTokens: 0, costUsdNanos: 100_000_001 })],
    ],
  ])('rejects %s above the immutable reservation', async (label, calls) => {
    const client = fakeClient({ settle: async () => settlement(calls) })
    const port = createPort(client)
    await reserve(port)
    await expect(port.settleGrant(settleInput())).rejects.toThrow(
      new RegExp(`${label}.*exceeds reserved`),
    )
  })

  it('rejects aggregate token overflow when each channel remains below its own cap', async () => {
    const limits = {
      ...reserveInput().limits,
      maxTotalTokens: 40,
    }
    const client = fakeClient({
      settle: async () =>
        settlement([
          modelCall(1, {
            inputTokens: 30,
            outputTokens: 20,
            costUsdNanos: 0,
          }),
        ]),
    })
    const port = createPort(client)
    await reserve(port, reserveInput(limits))
    await expect(port.settleGrant(settleInput())).rejects.toThrow(
      /total tokens 50 exceeds reserved 40/,
    )
  })

  it('accepts the exact aggregate token boundary and binds it to the reservation', async () => {
    const limits = {
      ...reserveInput().limits,
      maxTotalTokens: 40,
    }
    const client = fakeClient({
      reserve: async (input) => reservation(input),
      settle: async () =>
        settlement([
          modelCall(1, {
            inputTokens: 25,
            outputTokens: 15,
            costUsdNanos: 0,
          }),
        ]),
    })
    const port = createPort(client)
    await expect(reserve(port, reserveInput(limits))).resolves.toMatchObject({
      enforcedLimits: limits,
    })
    await expect(port.settleGrant(settleInput())).resolves.toEqual(
      settlement([
        modelCall(1, {
          inputTokens: 25,
          outputTokens: 15,
          costUsdNanos: 0,
        }),
      ]),
    )
  })

  it('counts the Router accounted input total for aggregate enforcement', async () => {
    const limits = {
      ...reserveInput().limits,
      maxTotalTokens: 40,
    }
    const client = fakeClient({
      settle: async () =>
        settlement([
          modelCall(1, {
            inputTokens: 20,
            accountedInputTokens: 30,
            outputTokens: 15,
            costUsdNanos: 0,
          }),
        ]),
    })
    const port = createPort(client)
    await reserve(port, reserveInput(limits))
    await expect(port.settleGrant(settleInput())).rejects.toThrow(
      /total tokens 45 exceeds reserved 40/,
    )
  })

  it('fails closed when Router reports a settlement outside frozen limits', async () => {
    const client = fakeClient({
      settle: async () => ({ ...settlement(), usageWithinLimits: false }),
    })
    const port = createPort(client)
    await reserve(port)
    await expect(port.settleGrant(settleInput())).rejects.toThrow(
      /reports usage outside frozen limits/,
    )
  })

  it('keeps expired reservation limits for terminal local validation', async () => {
    const limits = {
      ...reserveInput().limits,
      maxTotalTokens: 40,
    }
    const expiresAtMs = Date.now() + 10
    const client = fakeClient({
      settle: async () =>
        settlement([
          modelCall(1, {
            inputTokens: 30,
            outputTokens: 20,
            costUsdNanos: 0,
          }),
        ]),
    })
    const port = createPort(client)
    await reserve(port, { ...reserveInput(limits), expiresAtMs })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiresAtMs + 1)
    try {
      await expect(port.settleGrant(settleInput())).rejects.toThrow(
        /total tokens 50 exceeds reserved 40/,
      )
    } finally {
      clock.mockRestore()
    }
  })

  it('rejects incomplete token usage before claiming aggregate compliance', async () => {
    const limits = {
      ...reserveInput().limits,
      maxTotalTokens: 40,
    }
    const partialCall = modelCall(1, { inputTokens: 25, outputTokens: 15, costUsdNanos: 0 })
    delete (partialCall as Partial<AgentCandidateProtectedModelSettlementCall>).outputTokens
    const client = fakeClient({
      settle: async () => settlement([partialCall as AgentCandidateProtectedModelSettlementCall]),
    })
    const port = createPort(client)
    await reserve(port, reserveInput(limits))
    await expect(port.settleGrant(settleInput())).rejects.toThrow(
      /model settlement call 0 is missing field outputTokens/,
    )
  })

  it.each([
    [
      'duplicate call ids',
      [modelCall(1), modelCall(2, { callId: 'call-1' })],
      /duplicate call ids/,
    ],
    [
      'duplicate trace span ids',
      [modelCall(1), modelCall(2, { generationId: 'generation-1', traceSpanId: 'generation-1' })],
      /duplicate trace span ids/,
    ],
  ])('rejects %s in the final ledger', async (_name, calls, pattern) => {
    const client = fakeClient({ settle: async () => settlement(calls) })
    const port = createPort(client)
    await reserve(port)
    await expect(port.settleGrant(settleInput())).rejects.toThrow(pattern)
  })

  it.each([
    ['preparation', { ...settlement(), preparationId: 'other-preparation' }, /preparation/],
    ['grant', { ...settlement(), grantDigest: sha('c') }, /grant digest/],
    [
      'router generation',
      settlement([modelCall(1, { traceSpanId: 'caller-chosen-span' })]),
      /router generationId/,
    ],
    ['model', settlement([modelCall(1, { model: 'openai/other-snapshot' })]), /unexpected model/],
  ])('rejects a mismatched %s in the final ledger', async (_name, value, pattern) => {
    const client = fakeClient({ settle: async () => value })
    const port = createPort(client)
    await reserve(port)
    await expect(port.settleGrant(settleInput())).rejects.toThrow(pattern)
  })

  it('rejects a partial or structurally extended final ledger', async () => {
    const partial = fakeClient({
      settle: async () => ({ ...settlement(), closed: false }) as never,
    })
    const partialPort = createPort(partial)
    await reserve(partialPort)
    await expect(partialPort.settleGrant(settleInput())).rejects.toThrow(/not closed/)

    const extended = fakeClient({
      settle: async () =>
        settlement([{ ...modelCall(1), providerRequest: 'untrusted-extra-field' } as never]),
    })
    const extendedPort = createPort(extended)
    await reserve(extendedPort)
    await expect(extendedPort.settleGrant(settleInput())).rejects.toThrow(/unknown field/)
  })

  it('requires settlement retries to preserve both final rows and termination reason', async () => {
    let calls = [modelCall(1)]
    const client = fakeClient({ settle: async () => settlement(calls) })
    const port = createPort(client)
    await reserve(port)
    await expect(port.settleGrant(settleInput('failed'))).resolves.toEqual(settlement(calls))
    await expect(port.settleGrant(settleInput('failed'))).resolves.toEqual(settlement(calls))

    calls = [modelCall(2)]
    await expect(port.settleGrant(settleInput('failed'))).rejects.toThrow(/different final ledger/)
    calls = [modelCall(1)]
    await expect(port.settleGrant(settleInput('timeout'))).rejects.toThrow(/termination reason/)
    expect(client.settleInputs).toHaveLength(3)
  })

  it('composes with the existing trace check to reject missing or extra model rows 1:1', async () => {
    const client = fakeClient({ settle: async () => settlement([modelCall(1)]) })
    const port = createPort(client)
    await reserve(port)
    const settled = await port.settleGrant(settleInput())
    const sealed = sealAgentCandidateModelSettlement(settled, {
      preparationId: 'preparation-1',
      grantDigest: sha('b'),
      model: resolvedModel.model,
    })
    const span = (index: number): LlmSpan => ({
      spanId: `generation-${index}`,
      runId: 'run-1',
      kind: 'llm',
      name: 'protected model call',
      startedAt: 1_000 + index * 100,
      endedAt: 1_050 + index * 100,
      status: 'ok',
      model: resolvedModel.model,
      messages: [],
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.01,
      attributes: {
        'tangle.protected_model.source': 'router-settlement',
        'tangle.router.call_id': `call-${index}`,
        'tangle.router.generation_id': `generation-${index}`,
      },
    })

    expect(() => assertTraceMatchesModelSettlement([], sealed)).toThrow(/do not match/)
    expect(() => assertTraceMatchesModelSettlement([span(1), span(2)], sealed)).toThrow(
      /do not match/,
    )
    expect(() => assertTraceMatchesModelSettlement([span(1)], sealed)).not.toThrow()

    const store = new InMemoryTraceStore()
    await store.appendRun({
      runId: 'run-1',
      scenarioId: 'candidate-model-port',
      startedAt: 900,
      endedAt: 1_200,
      status: 'completed',
    })
    await appendAuthoritativeModelSettlementSpans(store, 'run-1', sealed)
    const protectedSpans = (await store.spans({ runId: 'run-1' })).filter(
      (candidate): candidate is LlmSpan => candidate.kind === 'llm',
    )
    expect(protectedSpans).toEqual([span(1)])
    expect(() => assertTraceMatchesModelSettlement(protectedSpans, sealed)).not.toThrow()
  })

  it('settles one successful callback with the activated environment and exact result', async () => {
    const client = fakeClient({
      settle: async () => settlement([modelCall(1)]),
    })
    const port = createPort(client)
    const { resolved: _resolved, ...reserve } = reserveInput()
    const seen: string[] = []

    const result = await runProtectedAgentCandidateModelGrant({
      port,
      resolve: {
        requested: resolvedModel.requested,
        harness: 'opencode',
        reasoningEffort: resolvedModel.reasoningEffort,
      },
      reserve,
      deadlineAtMs: EXPIRES_AT_MS - 1_000,
      execute: async ({ activation, reservation, resolved }) => {
        seen.push(activation.env.MODEL_API_KEY)
        expect(reservation.digest).toBe(sha('b'))
        expect(resolved).toEqual(resolvedModel)
        return 'cell-result'
      },
    })

    expect(result.value).toBe('cell-result')
    expect(result.settlement).toEqual(settlement([modelCall(1)]))
    expect(seen).toEqual(['protected-candidate-token'])
    expect(client.settleInputs).toEqual([settleInput('completed')])
  })

  it('retries only an explicit draining settlement until the final ledger closes', async () => {
    let attempts = 0
    const client = fakeClient({
      settle: async () => {
        attempts += 1
        if (attempts === 1) {
          throw Object.assign(
            new Error('/v1/candidate-model-grants/settle failed: 409 candidate_grant_draining'),
            { code: 'candidate_grant_draining', status: 409 },
          )
        }
        return settlement([modelCall(1)])
      },
    })
    const port = createPort(client)
    const { resolved: _resolved, ...reserve } = reserveInput()

    const result = await runProtectedAgentCandidateModelGrant({
      port,
      resolve: {
        requested: resolvedModel.requested,
        harness: 'opencode',
        reasoningEffort: resolvedModel.reasoningEffort,
      },
      reserve,
      deadlineAtMs: Date.now() + 2_000,
      execute: async () => 'cell-result',
    })

    expect(result.value).toBe('cell-result')
    expect(result.settlement).toEqual(settlement([modelCall(1)]))
    expect(client.settleInputs).toHaveLength(2)
  })

  it('does not retry a non-draining settlement failure', async () => {
    const failure = Object.assign(
      new Error(
        '/v1/candidate-model-grants/settle failed: 409 candidate_grant_control_auth_failed',
      ),
      { code: 'candidate_grant_control_auth_failed', status: 409 },
    )
    let attempts = 0
    const client = fakeClient({
      settle: async () => {
        attempts += 1
        throw failure
      },
    })
    const port = createPort(client)
    const { resolved: _resolved, ...reserve } = reserveInput()

    await expect(
      runProtectedAgentCandidateModelGrant({
        port,
        resolve: {
          requested: resolvedModel.requested,
          harness: 'opencode',
          reasoningEffort: resolvedModel.reasoningEffort,
        },
        reserve,
        deadlineAtMs: Date.now() + 2_000,
        execute: async () => 'cell-result',
      }),
    ).rejects.toBe(failure)
    expect(attempts).toBe(1)
  })

  it('stops repeated draining retries at the caller deadline and preserves the last error', async () => {
    vi.useFakeTimers({ now: EXPIRES_AT_MS - 100 })
    try {
      const failure = Object.assign(
        new Error('/v1/candidate-model-grants/settle failed: 409 candidate_grant_draining'),
        { code: 'candidate_grant_draining', status: 409 },
      )
      let attempts = 0
      const client = fakeClient({
        settle: async () => {
          attempts += 1
          throw failure
        },
      })
      const port = createPort(client)
      const { resolved: _resolved, ...reserve } = reserveInput()
      const pending = runProtectedAgentCandidateModelGrant({
        port,
        resolve: {
          requested: resolvedModel.requested,
          harness: 'opencode',
          reasoningEffort: resolvedModel.reasoningEffort,
        },
        reserve,
        deadlineAtMs: EXPIRES_AT_MS - 50,
        execute: async () => 'cell-result',
      })
      const outcome = pending.then(
        () => undefined,
        (error: unknown) => error,
      )

      await vi.advanceTimersByTimeAsync(50)
      await expect(outcome).resolves.toBe(failure)
      expect(attempts).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles a callback failure as failed and preserves the callback error', async () => {
    const client = fakeClient()
    const port = createPort(client)
    const { resolved: _resolved, ...reserve } = reserveInput()
    const failure = new Error('cell failed')

    await expect(
      runProtectedAgentCandidateModelGrant({
        port,
        resolve: {
          requested: resolvedModel.requested,
          harness: 'opencode',
          reasoningEffort: resolvedModel.reasoningEffort,
        },
        reserve,
        deadlineAtMs: EXPIRES_AT_MS - 1_000,
        execute: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
    expect(client.settleInputs).toEqual([settleInput('failed')])
  })

  it('settles an activation failure as preparation-failed', async () => {
    const client = fakeClient({
      activate: async () => {
        throw new Error('activation failed')
      },
    })
    const port = createPort(client)
    const { resolved: _resolved, ...reserve } = reserveInput()

    await expect(
      runProtectedAgentCandidateModelGrant({
        port,
        resolve: {
          requested: resolvedModel.requested,
          harness: 'opencode',
          reasoningEffort: resolvedModel.reasoningEffort,
        },
        reserve,
        deadlineAtMs: EXPIRES_AT_MS - 1_000,
        execute: async () => 'unreachable',
      }),
    ).rejects.toThrow('activation failed')
    expect(client.settleInputs).toEqual([settleInput('preparation-failed')])
  })

  it('reports both callback and settlement failures without losing either cause', async () => {
    const callbackFailure = new Error('cell failed')
    const settlementFailure = new Error('settlement failed')
    const client = fakeClient({
      settle: async () => {
        throw settlementFailure
      },
    })
    const port = createPort(client)
    const { resolved: _resolved, ...reserve } = reserveInput()

    await expect(
      runProtectedAgentCandidateModelGrant({
        port,
        resolve: {
          requested: resolvedModel.requested,
          harness: 'opencode',
          reasoningEffort: resolvedModel.reasoningEffort,
        },
        reserve,
        deadlineAtMs: EXPIRES_AT_MS - 1_000,
        execute: async () => {
          throw callbackFailure
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof AggregateError &&
        error.errors[0] === callbackFailure &&
        error.errors[1] === settlementFailure
      )
    })
    expect(client.settleInputs).toEqual([settleInput('failed')])
  })
})
