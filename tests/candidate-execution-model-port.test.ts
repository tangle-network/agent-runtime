import type { LlmSpan } from '@tangle-network/agent-eval'
import type { AgentCandidateResolvedModel, Sha256Digest } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  assertTraceMatchesModelSettlement,
  sealAgentCandidateModelSettlement,
} from '../src/candidate-execution/model-settlement'
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
  AgentCandidateProtectedModelCall,
  AgentCandidateProtectedModelSettlement,
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
  overrides: Partial<AgentCandidateProtectedModelCall> = {},
): AgentCandidateProtectedModelCall {
  return {
    callId: `generation-${index}`,
    traceSpanId: `agent-eval-span-${index}`,
    model: resolvedModel.model,
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsdNanos: 10_000_000,
    ...overrides,
  }
}

function settlement(
  calls: readonly AgentCandidateProtectedModelCall[] = [],
): AgentCandidateProtectedModelSettlement {
  return {
    preparationId: 'preparation-1',
    grantDigest: sha('b'),
    closed: true,
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

  it.each([
    [
      'duplicate call ids',
      [modelCall(1), modelCall(2, { callId: 'generation-1' })],
      /duplicate call ids/,
    ],
    [
      'duplicate trace span ids',
      [modelCall(1), modelCall(2, { traceSpanId: 'agent-eval-span-1' })],
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
      spanId: `agent-eval-span-${index}`,
      runId: 'run-1',
      kind: 'llm',
      name: `model-call-${index}`,
      startedAt: index,
      model: resolvedModel.model,
      messages: [],
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.01,
    })

    expect(() => assertTraceMatchesModelSettlement([], sealed)).toThrow(/do not match/)
    expect(() => assertTraceMatchesModelSettlement([span(1), span(2)], sealed)).toThrow(
      /do not match/,
    )
    expect(() => assertTraceMatchesModelSettlement([span(1)], sealed)).not.toThrow()
  })
})
