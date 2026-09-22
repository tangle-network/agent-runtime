import type { AgentProfile, AgentRunControlRef } from '@tangle-network/agent-interface'
import type {
  BackendType,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentEnvironment,
  type AgentEnvironmentEvent,
  type AgentEnvironmentProvider,
  type AgentSession,
  type AgentTurnInput,
  type AgentTurnResult,
  createAgentEnvironmentProviderRegistry,
  providerAsExecutor,
  providerAsSandboxClient,
  sandboxClientAsProvider,
} from './environment-provider'
import { createExecutor } from './supervise/runtime'
import type { AgentSpec, ExecutorContext, UsageEvent } from './supervise/types'
import type { SandboxClient } from './types'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const value of iterable) out.push(value)
  return out
}

describe('environment provider adapters', () => {
  it('round-trips the exact control reference and execution selector through the legacy Sandbox port', async () => {
    const controlRef: AgentRunControlRef = {
      runId: 'run-neutral',
      provider: 'fake-provider',
      environmentId: 'environment-neutral',
      sessionId: 'session-neutral',
      executionId: 'execution-neutral',
    }
    let eventOptions: unknown
    let resultOptions: unknown
    let cancelOptions: unknown
    const session = {
      id: controlRef.sessionId!,
      controlRef,
      status: async () => 'running',
      async *events(options) {
        eventOptions = options
        yield { type: 'result', data: { finalText: 'exact' } }
      },
      async result(options?: { executionId?: string }) {
        resultOptions = options
        return {
          text: 'exact',
          success: true,
          sessionId: controlRef.sessionId,
          metadata: { executionId: controlRef.executionId },
        }
      },
      prompt: async () => ({ text: 'unused', success: true }),
      async cancel(options?: { executionId?: string }) {
        cancelOptions = options
      },
    } as AgentSession & {
      result(options?: { executionId?: string }): Promise<AgentTurnResult>
      cancel(options?: { executionId?: string }): Promise<void>
    }
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          id: controlRef.environmentId,
          stream: async function* () {
            yield* []
          },
          dispatch: async () => ({ id: session.id, provider: provider.name, controlRef }),
          session: () => session,
        })
      },
    }
    const box = await providerAsSandboxClient(provider).create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
    })
    const dispatched = await box.dispatchPrompt?.('go', {
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
      turnId: controlRef.runId,
      detach: true,
    })
    expect(dispatched).toMatchObject({
      sessionId: controlRef.sessionId,
      executionId: controlRef.executionId,
      controlRef,
    })
    const resumed = box.session(controlRef.sessionId!)
    await collect(resumed.events({ since: 'cursor-0', executionId: controlRef.executionId }))
    await resumed.result({ executionId: controlRef.executionId })
    await resumed.interrupt({ executionId: controlRef.executionId })
    expect(eventOptions).toEqual({ since: 'cursor-0', executionId: controlRef.executionId })
    expect(resultOptions).toEqual({ executionId: controlRef.executionId })
    expect(cancelOptions).toEqual({ executionId: controlRef.executionId })
  })

  it('round-trips Sandbox execution identity into the shared session reference', async () => {
    let dispatchOptions: unknown
    let eventOptions: unknown
    let resultOptions: unknown
    let interruptOptions: unknown
    const box = {
      id: 'sandbox-exact',
      status: 'running',
      async dispatchPrompt(_message: string, options: unknown) {
        dispatchOptions = options
        return {
          sessionId: 'session-exact',
          executionId: 'execution-exact',
          controlRef: {
            runId: 'run-exact',
            provider: 'tangle-sandbox',
            environmentId: 'sandbox-exact',
            sessionId: 'session-exact',
            executionId: 'execution-exact',
          },
          status: 'running',
          alreadyExisted: false,
          dispatched: true,
        }
      },
      session(id: string) {
        return {
          id,
          async status() {
            return { status: 'running' }
          },
          async *events(options: unknown) {
            eventOptions = options
            yield {
              type: 'status',
              id: 'event-exact',
              data: { status: 'running', executionId: 'execution-exact' },
            }
          },
          async result(options: unknown) {
            resultOptions = options
            return { response: 'exact', success: true, executionId: 'execution-exact' }
          },
          async prompt() {
            return { response: 'unused', success: true }
          },
          async interrupt(options: unknown) {
            interruptOptions = options
            return { cancelled: true }
          },
        }
      },
      async *streamPrompt() {
        yield { type: 'result', data: { finalText: 'unused' } }
      },
    } as unknown as SandboxInstance
    const provider = sandboxClientAsProvider(
      {
        create: async () => box,
      },
      { exactControlRef: true },
    )
    const environment = await provider.create({ profile: { name: 'worker' } })
    const reference = await environment.dispatch?.({
      prompt: 'go',
      turnId: 'run-exact',
      executionId: 'execution-exact',
      detach: true,
    })
    expect(dispatchOptions).toMatchObject({
      turnId: 'run-exact',
      executionId: 'execution-exact',
      detach: true,
    })
    expect(reference?.controlRef).toEqual({
      runId: 'run-exact',
      provider: 'tangle-sandbox',
      environmentId: 'sandbox-exact',
      sessionId: 'session-exact',
      executionId: 'execution-exact',
    })
    if (!reference?.controlRef) throw new Error('expected an exact control reference')
    expect(() => environment.session?.('session-exact')).toThrow(
      'requires the exact provider-owned control reference',
    )
    const session = environment.session?.('session-exact', { controlRef: reference.controlRef })
    if (!session) throw new Error('expected a session')
    await expect(
      collect(session.events({ since: 'event-0', executionId: 'execution-exact' })),
    ).rejects.toThrow('cannot admit session replay cursors')
    await collect(session.events({ executionId: 'execution-exact' }))
    await session.result()
    await session.cancel()
    expect(eventOptions).toEqual({ executionId: 'execution-exact' })
    expect(resultOptions).toEqual({ executionId: 'execution-exact' })
    expect(interruptOptions).toEqual({ executionId: 'execution-exact' })
  })

  it('rejects a caller-supplied Sandbox control reference that this provider never issued', async () => {
    const box = {
      id: 'sandbox-forged-reference',
      status: 'running',
      session() {
        return {
          id: 'session-forged-reference',
          async status() {
            return { status: 'running' }
          },
          async *events(): AsyncIterable<SandboxEvent> {},
          async result() {
            return { response: 'unused', success: true }
          },
          async prompt() {
            return { response: 'unused', success: true }
          },
          async interrupt() {
            return { cancelled: true }
          },
        }
      },
    } as unknown as SandboxInstance
    const provider = sandboxClientAsProvider({ create: async () => box })
    const environment = await provider.create({ profile: { name: 'worker' } })

    expect(() =>
      environment.session?.('session-forged-reference', {
        controlRef: {
          runId: 'caller-run',
          provider: 'tangle-sandbox',
          environmentId: box.id,
          sessionId: 'session-forged-reference',
        },
      }),
    ).toThrow('not returned by this provider')
  })

  it('downgrades unsupported Sandbox replay/context transfer before dispatch', async () => {
    let dispatches = 0
    const provider = sandboxClientAsProvider({
      create: async () =>
        ({
          id: 'sandbox-unsupported',
          status: 'running',
          async dispatchPrompt() {
            dispatches += 1
            return {
              sessionId: 'session-unsupported',
              executionId: 'execution-unsupported',
              status: 'running',
              alreadyExisted: false,
            }
          },
          async *streamPrompt() {
            yield { type: 'result', data: { finalText: 'unused' } }
          },
        }) as unknown as SandboxInstance,
    })
    await expect(provider.capabilities()).resolves.toMatchObject({
      streaming: { replay: false, detach: false },
      sessions: { continue: false },
    })
    const environment = await provider.create({ profile: { name: 'worker' } })
    await expect(
      environment.dispatch?.({
        prompt: 'must not send',
        turnId: 'transfer-operation',
        contextTransfer: { unsupported: true } as never,
      }),
    ).rejects.toThrow(/cannot admit canonical context transfer/)
    expect(dispatches).toBe(0)
  })

  it('rejects unsupported Sandbox detach and replay fields before streaming', async () => {
    let streams = 0
    const provider = sandboxClientAsProvider({
      create: async () =>
        ({
          id: 'sandbox-replay-unsupported',
          status: 'running',
          async *streamPrompt() {
            streams += 1
            yield { type: 'result', data: { finalText: 'must not send' } }
          },
        }) as unknown as SandboxInstance,
    })
    const environment = await provider.create({ profile: { name: 'worker' } })

    await expect(
      collect(environment.stream({ prompt: 'must not send', detach: true })),
    ).rejects.toThrow(/cannot admit detached turns/)
    await expect(
      collect(environment.stream({ prompt: 'must not send', lastEventId: 'event-1' })),
    ).rejects.toThrow(/cannot admit replay cursors/)
    expect(streams).toBe(0)
  })

  it('cannot override installed Sandbox capability downgrades', async () => {
    const provider = sandboxClientAsProvider(
      {
        create: async () =>
          ({
            id: 'sandbox-claimed',
            status: 'running',
            async *streamPrompt() {
              yield { type: 'result', data: { finalText: 'unused' } }
            },
          }) as unknown as SandboxInstance,
      },
      {
        capabilities: fakeCapabilities,
        stableEventIdentity: true,
        exactControlRef: true,
      },
    )

    await expect(provider.capabilities()).resolves.toMatchObject({
      streaming: { replay: false, detach: false, turnIdempotency: false },
      sessions: { continue: false },
    })
  })

  it('adapts a neutral provider to SandboxClient without losing profile/backend/dispatch data', async () => {
    let created: unknown
    let turn: AgentTurnInput | undefined
    let sessionPrompt: AgentTurnInput | undefined
    let cancelled = 0
    const session: AgentSession = {
      id: 'provider-session',
      async status() {
        return 'running'
      },
      async *events(): AsyncIterable<AgentEnvironmentEvent> {
        yield { type: 'result', data: { finalText: 'detached result' } }
      },
      async result() {
        return {
          text: 'detached result',
          success: true,
          usage: { inputTokens: 3, outputTokens: 5, cost: 0.02 },
        }
      },
      async prompt(input) {
        sessionPrompt = input
        return { text: 'continued', success: true }
      },
      async cancel() {
        cancelled += 1
      },
    }
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        created = input
        return fakeEnvironment({
          dispatch: async () => ({
            id: 'provider-session',
            provider: 'fake-provider',
            metadata: { status: 'running', alreadyExisted: true },
          }),
          session(id) {
            if (id !== session.id) throw new Error(`unexpected session ${id}`)
            return session
          },
          stream: async function* (input: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
            turn = input
            yield {
              type: 'result',
              data: { finalText: `ok:${input.prompt}` },
              usage: {
                inputTokens: 2,
                outputTokens: 3,
                totalTokens: 7,
                cacheReadInputTokens: 4,
                cacheCreationInputTokens: 1,
                reasoningTokens: 2,
                cost: 0.01,
              },
            }
          },
        })
      },
    }

    const client = providerAsSandboxClient(provider)
    const box = await client.create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
      environment: 'universal',
      git: { url: 'https://example.com/repo.git', ref: 'main' },
      env: { A: '1' },
      name: 'box-name',
      idempotencyKey: 'create-1',
    })
    const events = await collect(box.streamPrompt('hello', { sessionId: 's1', turnId: 't1' }))
    const dispatched = await box.dispatchPrompt?.('detached')

    expect(created).toMatchObject({
      profile: { name: 'worker' },
      backend: 'codex',
      workspace: {
        environment: 'universal',
        repoUrl: 'https://example.com/repo.git',
        gitRef: 'main',
      },
      env: { A: '1' },
      name: 'box-name',
      idempotencyKey: 'create-1',
    })
    expect(turn).toMatchObject({ prompt: 'hello', sessionId: 's1', turnId: 't1' })
    expect(dispatched).toMatchObject({
      sessionId: 'provider-session',
      status: 'running',
      alreadyExisted: true,
    })
    const resumed = box.session('provider-session')
    await expect(resumed.status()).resolves.toMatchObject({
      id: 'provider-session',
      status: 'running',
    })
    expect(await collect(resumed.events())).toMatchObject([
      { type: 'result', data: { finalText: 'detached result' } },
    ])
    await expect(resumed.result()).resolves.toMatchObject({
      response: 'detached result',
      success: true,
      status: 'success',
    })
    await resumed.prompt('continue')
    expect(sessionPrompt).toMatchObject({ prompt: 'continue' })
    await resumed.interrupt()
    expect(cancelled).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'result',
      data: {
        finalText: 'ok:hello',
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 7,
          cacheReadInputTokens: 4,
          cacheCreationInputTokens: 1,
          reasoningTokens: 2,
          totalCostUsd: 0.01,
        },
      },
    })
  })

  it('adapts a SandboxClient to a neutral provider with create/stream/workspace methods', async () => {
    let createOptions: CreateSandboxOptions | undefined
    let streamedPrompt: unknown
    const box = {
      id: 'sbx-1',
      name: 'sandbox-one',
      status: 'running',
      metadata: { team: 'eng' },
      async *streamPrompt(prompt: string): AsyncIterable<SandboxEvent> {
        streamedPrompt = prompt
        yield {
          type: 'result',
          data: {
            finalText: 'sandbox-result',
            usage: { inputTokens: 4, outputTokens: 5, totalCostUsd: 0.02 },
          },
        } as SandboxEvent
      },
      async read(path: string): Promise<string> {
        return `read:${path}`
      },
      async write(): Promise<void> {},
      async exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
        return { exitCode: 0, stdout: `ran:${command}`, stderr: '' }
      },
      async dispatchPrompt(): Promise<unknown> {
        return { sessionId: 'sandbox-session', status: 'running', alreadyExisted: false }
      },
      async delete(): Promise<void> {},
    } as unknown as SandboxInstance
    const client: SandboxClient = {
      async create(options?: CreateSandboxOptions): Promise<SandboxInstance> {
        createOptions = options
        return box
      },
      describePlacement() {
        return { kind: 'sibling', sandboxId: 'sbx-1' }
      },
    }

    const provider = sandboxClientAsProvider(client)
    const environment = await provider.create({
      profile: { name: 'worker' },
      backend: 'codex',
      workspace: {
        environment: 'universal',
        repoUrl: 'https://example.com/repo.git',
        gitRef: 'main',
      },
      env: { A: '1' },
      secrets: ['SECRET_NAME'],
      idempotencyKey: 'create-2',
    })
    const events = await collect(environment.stream({ prompt: 'go' }))

    expect(createOptions).toMatchObject({
      backend: { type: 'codex', profile: { name: 'worker' } },
      environment: 'universal',
      git: { url: 'https://example.com/repo.git', ref: 'main' },
      env: { A: '1' },
      secrets: ['SECRET_NAME'],
      idempotencyKey: 'create-2',
    })
    expect(streamedPrompt).toBe('go')
    expect(events[0]).toMatchObject({
      type: 'result',
      usage: { inputTokens: 4, outputTokens: 5, cost: 0.02 },
    })
    expect(await environment.read?.('out.txt')).toBe('read:out.txt')
    expect(await environment.exec?.('echo hi')).toMatchObject({
      exitCode: 0,
      stdout: 'ran:echo hi',
    })
    await expect(environment.dispatch?.({ prompt: 'detached' })).resolves.toMatchObject({
      id: 'sandbox-session',
      provider: 'tangle-sandbox',
      metadata: { status: 'running', alreadyExisted: false },
    })
    expect(await environment.placement?.()).toMatchObject({ kind: 'sandbox', sandboxId: 'sbx-1' })
  })

  it('requires explicit resolution for named profiles before calling current Sandbox', async () => {
    let createCalls = 0
    let createOptions: CreateSandboxOptions | undefined
    const box = {
      id: 'sbx-profile',
      status: 'running',
      async *streamPrompt(): AsyncIterable<SandboxEvent> {
        yield { type: 'result', data: { finalText: 'ok' } } as SandboxEvent
      },
    } as unknown as SandboxInstance
    const client: SandboxClient = {
      async create(options?: CreateSandboxOptions): Promise<SandboxInstance> {
        createCalls += 1
        createOptions = options
        return box
      },
    }

    const unresolved = sandboxClientAsProvider(client)
    await expect(unresolved.capabilities()).resolves.toMatchObject({
      profile: { namedProfiles: false },
    })
    await expect(unresolved.create({ profile: 'catalog/researcher' })).rejects.toThrow(
      /requires an inline AgentProfile/,
    )
    expect(createCalls).toBe(0)

    const resolved = sandboxClientAsProvider(client, {
      resolveProfile: async (profileId) => ({ name: `resolved:${profileId}` }),
    })
    await expect(resolved.capabilities()).resolves.toMatchObject({
      profile: { namedProfiles: true },
    })
    await resolved.create({ profile: 'catalog/researcher' })

    expect(createOptions).toMatchObject({
      backend: { profile: { name: 'resolved:catalog/researcher' } },
    })
  })

  it.each([
    ['a record', { API_TOKEN: 'secret-value' }],
    ['an object in an array', [{ API_TOKEN: 'secret-value' }]],
    ['a number in an array', [42]],
    ['an empty name', ['']],
    ['a whitespace-only name', ['  ']],
  ])('rejects %s in top-level secrets before calling Sandbox', async (_label, secrets) => {
    let createCalls = 0
    const client: SandboxClient = {
      async create(): Promise<SandboxInstance> {
        createCalls += 1
        throw new Error('must not create')
      },
    }

    await expect(
      sandboxClientAsProvider(client).create({
        profile: { name: 'worker' },
        secrets: secrets as unknown as string[],
      }),
    ).rejects.toThrow(/secret names must be non-empty strings/)
    expect(createCalls).toBe(0)
  })

  it.each([
    ['a record', { API_TOKEN: 'secret-value' }],
    ['an object in an array', [{ API_TOKEN: 'secret-value' }]],
    ['a number in an array', [42]],
    ['an empty name', ['']],
    ['a whitespace-only name', ['  ']],
  ])('rejects %s hidden in Sandbox passthrough options', async (_label, secrets) => {
    let createCalls = 0
    let resolveCalls = 0
    const client: SandboxClient = {
      async create(): Promise<SandboxInstance> {
        createCalls += 1
        throw new Error('must not create')
      },
    }
    const provider = sandboxClientAsProvider(client, {
      async resolveProfile() {
        resolveCalls += 1
        return { name: 'resolved-worker' }
      },
    })

    await expect(
      provider.create({
        profile: 'catalog/worker',
        providerOptions: {
          sandboxCreateOptions: {
            secrets: secrets as unknown as string[],
          },
        },
      }),
    ).rejects.toThrow(/secret names must be non-empty strings/)
    expect({ createCalls, resolveCalls }).toEqual({ createCalls: 0, resolveCalls: 0 })
  })

  it('uses current Sandbox environment for a workspace image and rejects ambiguous workspace values', async () => {
    let createOptions: CreateSandboxOptions | undefined
    const box = {
      id: 'sbx-environment',
      status: 'running',
      async *streamPrompt(): AsyncIterable<SandboxEvent> {
        yield { type: 'result', data: { finalText: 'ok' } } as SandboxEvent
      },
    } as unknown as SandboxInstance
    const client: SandboxClient = {
      async create(options?: CreateSandboxOptions): Promise<SandboxInstance> {
        createOptions = options
        return box
      },
    }
    const provider = sandboxClientAsProvider(client)

    await provider.create({
      profile: { name: 'worker' },
      workspace: { image: 'ghcr.io/example/runner@sha256:abc' },
    })
    expect(createOptions).toMatchObject({ environment: 'ghcr.io/example/runner@sha256:abc' })

    await expect(
      provider.create({
        profile: { name: 'worker' },
        workspace: { environment: 'universal', image: 'ghcr.io/example/runner@sha256:abc' },
      }),
    ).rejects.toThrow(/must match/)
  })

  it('maps only prompt parts representable by current Sandbox', async () => {
    let streamedPrompt: unknown
    const box = {
      id: 'sbx-parts',
      status: 'running',
      async *streamPrompt(prompt: unknown): AsyncIterable<SandboxEvent> {
        streamedPrompt = prompt
        yield { type: 'result', data: { finalText: 'ok' } } as SandboxEvent
      },
    } as unknown as SandboxInstance
    const client: SandboxClient = {
      async create(): Promise<SandboxInstance> {
        return box
      },
    }
    const environment = await sandboxClientAsProvider(client).create({
      profile: { name: 'worker' },
    })

    await collect(
      environment.stream({
        parts: [
          { type: 'text', text: 'read this' },
          { type: 'image', url: 'https://example.com/diagram.png' },
          { type: 'file', filename: 'task.md', url: 'https://example.com/task.md' },
        ],
      }),
    )
    expect(streamedPrompt).toEqual([
      { type: 'text', text: 'read this' },
      { type: 'image', url: 'https://example.com/diagram.png' },
      { type: 'file', filename: 'task.md', url: 'https://example.com/task.md' },
    ])

    await expect(
      collect(
        environment.stream({
          parts: [{ type: 'file', filename: 'task.md', content: 'inline source' }],
        }),
      ),
    ).rejects.toThrow(/not representable/)
  })

  it('maps current Sandbox interrupt to neutral session cancellation', async () => {
    let interrupted = 0
    const box = {
      id: 'sbx-session',
      status: 'running',
      session() {
        return {
          id: 'session-1',
          async status() {
            return { status: 'running' }
          },
          async *events(): AsyncIterable<SandboxEvent> {},
          async result() {
            return { response: '', success: true }
          },
          async prompt() {
            return { response: '', success: true }
          },
          async interrupt() {
            interrupted += 1
            return { cancelled: true }
          },
        }
      },
      async *streamPrompt(): AsyncIterable<SandboxEvent> {
        yield { type: 'result', data: { finalText: 'ok' } } as SandboxEvent
      },
    } as unknown as SandboxInstance
    const client: SandboxClient = {
      async create(): Promise<SandboxInstance> {
        return box
      },
    }
    const environment = await sandboxClientAsProvider(client).create({
      profile: { name: 'worker' },
    })

    await environment.session?.('session-1').cancel()
    expect(interrupted).toBe(1)
  })

  it('fails closed when a neutral session only reports stopped', async () => {
    const session: AgentSession = {
      id: 'stopped-session',
      status: async () => 'stopped',
      events: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
      result: async () => ({ text: '', success: false }),
      prompt: async () => ({ text: '', success: false }),
      cancel: async () => {},
    }
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          session: () => session,
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
        })
      },
    }
    const box = await providerAsSandboxClient(provider).create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
    })

    await expect(box.session('stopped-session').status()).resolves.toEqual({
      id: 'stopped-session',
      status: 'failed',
    })
  })

  it('fails loudly when a sandbox exec result has no exit code', async () => {
    const box = {
      id: 'sbx-1',
      status: 'running',
      async *streamPrompt(): AsyncIterable<SandboxEvent> {
        yield { type: 'result', data: { finalText: 'ok' } } as SandboxEvent
      },
      async exec(): Promise<unknown> {
        return { stdout: 'missing code' }
      },
    } as unknown as SandboxInstance
    const client: SandboxClient = {
      async create(): Promise<SandboxInstance> {
        return box
      },
    }

    const environment = await sandboxClientAsProvider(client).create({
      profile: { name: 'worker' },
    })

    await expect(environment.exec?.('echo hi')).rejects.toThrow(/no exit code/)
  })

  it('rejects provider prompt streams that end without a terminal event', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'message.part.updated', data: { delta: 'partial' } }
          },
        })
      },
    }
    const client = providerAsSandboxClient(provider)
    const box = await client.create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
    })

    await expect(box.prompt('hello')).rejects.toThrow(/terminal result/)
  })

  it('preserves a failed terminal event as a failed Sandbox prompt result', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'failing-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'status', data: { status: 'failed', error: 'backend failed' } }
          },
        })
      },
    }
    const box = await providerAsSandboxClient(provider).create({
      backend: { type: 'codex' as BackendType, profile: { name: 'worker' } },
    })

    await expect(box.prompt('hello')).resolves.toMatchObject({
      success: false,
      status: 'failed',
      error: 'backend failed',
    })
  })

  it('destroys an environment that cannot satisfy a required session', async () => {
    let destroyed = 0
    const provider: AgentEnvironmentProvider = {
      name: 'stream-only-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
          async destroy() {
            destroyed += 1
          },
        })
      },
    }

    await expect(
      providerAsSandboxClient(provider, { requireSession: true }).create({
        backend: { type: 'pi', profile: { name: 'worker' } },
      }),
    ).rejects.toThrow(/session\(\) is required/)
    expect(destroyed).toBe(1)
  })

  it('rejects providers that cannot support live continuation before creating an environment', async () => {
    for (const disabled of ['continuation', 'live-streaming'] as const) {
      const capabilities = fakeCapabilities()
      if (disabled === 'continuation') capabilities.sessions.continue = false
      else capabilities.streaming.live = false
      let createCalls = 0
      const provider: AgentEnvironmentProvider = {
        name: `no-${disabled}`,
        capabilities: () => capabilities,
        async create() {
          createCalls += 1
          return fakeEnvironment({
            session: () => ({
              id: 'session',
              status: async () => 'running',
              events: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
              result: async () => ({ text: '', success: true }),
              prompt: async () => ({ text: '', success: true }),
              cancel: async () => {},
            }),
            stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
          })
        },
      }

      await expect(
        providerAsSandboxClient(provider, { requireSession: true }).create({
          backend: { type: 'pi', profile: { name: 'worker' } },
        }),
      ).rejects.toThrow(/live session continuation is required/)
      expect(createCalls).toBe(0)
    }
  })

  it.each([
    [
      'continuation',
      (capabilities: ReturnType<typeof fakeCapabilities>) => {
        capabilities.sessions.continue = false
      },
    ],
    [
      'live streaming',
      (capabilities: ReturnType<typeof fakeCapabilities>) => {
        capabilities.streaming.live = false
      },
    ],
  ])(
    'rejects a steerable provider executor without %s before creating an environment',
    async (_label, disable) => {
      const capabilities = fakeCapabilities()
      disable(capabilities)
      let createCalls = 0
      const provider: AgentEnvironmentProvider = {
        name: 'missing-live-capability',
        capabilities: () => capabilities,
        async create() {
          createCalls += 1
          throw new Error('must not create')
        },
      }
      const factory = createExecutor({
        backend: 'provider',
        provider,
        steering: {
          maxTurns: 1,
          activityWindow: 4,
          turnTimeoutMs: 10_000,
        },
      })
      const spec: AgentSpec = {
        profile: { name: 'pi-worker', harness: 'pi' },
        harness: null,
      }
      const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
      const executor = factory(spec, ctx)

      await expect(
        collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>),
      ).rejects.toThrow(/live session continuation is required/)
      expect(createCalls).toBe(0)
    },
  )

  it('adapts a provider to an ExecutorFactory and reports real usage', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'fake-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'message.part.updated', data: { delta: 'hello ' } }
            yield {
              type: 'result',
              data: { finalText: 'hello world' },
              usage: { inputTokens: 7, outputTokens: 11, reasoningTokens: 5, cost: 0.03 },
            }
          },
        })
      },
    }
    const factory = providerAsExecutor(provider)
    const spec: AgentSpec = { profile: { name: 'worker' } as AgentProfile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    const usage = await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)
    const artifact = executor.resultArtifact()

    expect(usage).toEqual([
      { kind: 'tokens', input: 7, output: 16 },
      { kind: 'cost', usd: 0.03 },
      { kind: 'iteration' },
    ])
    expect(artifact.out).toMatchObject({ content: 'hello world' })
    expect(artifact.spent).toMatchObject({
      iterations: 1,
      tokens: { input: 7, output: 16 },
      usd: 0.03,
    })
  })

  it('preserves the caller abort reason through the provider executor', async () => {
    let observedSignal: AbortSignal | undefined
    let destroyed = 0
    const provider: AgentEnvironmentProvider = {
      name: 'abort-reason-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (input: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
            const signal = input.signal
            if (!signal) throw new Error('provider stream signal is required')
            observedSignal = signal
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve()
              else signal.addEventListener('abort', () => resolve(), { once: true })
            })
            throw signal.reason
          },
          destroy: async () => {
            destroyed += 1
          },
        })
      },
    }
    const caller = new AbortController()
    const factory = providerAsExecutor(provider)
    const ctx: ExecutorContext = { signal: caller.signal, seams: {} }
    const executor = factory(
      { profile: { name: 'abort-reason' } as AgentProfile, harness: null },
      ctx,
    )
    const running = collect(executor.execute('task', caller.signal) as AsyncIterable<UsageEvent>)
    while (!observedSignal) await Promise.resolve()

    const reason = new Error('caller chose stop')
    caller.abort(reason)

    await expect(running).rejects.toBe(reason)
    expect(observedSignal?.reason).toBe(reason)
    expect(destroyed).toBe(1)
  })

  it('interrupts a provider stream iterator that ignores abort and destroys the environment', async () => {
    const entered = deferred()
    let closed = 0
    let destroyed = 0
    const provider: AgentEnvironmentProvider = {
      name: 'non-cooperative-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: () => ({
            [Symbol.asyncIterator]() {
              return {
                next: () => {
                  entered.resolve()
                  return new Promise<IteratorResult<AgentEnvironmentEvent>>(() => {})
                },
                return: async () => {
                  closed += 1
                  return { done: true, value: undefined }
                },
              }
            },
          }),
          destroy: async () => {
            destroyed += 1
          },
        })
      },
    }
    const caller = new AbortController()
    const executor = providerAsExecutor(provider)(
      { profile: { name: 'non-cooperative' } as AgentProfile, harness: null },
      { signal: caller.signal, seams: {} },
    )
    const running = collect(executor.execute('task', caller.signal) as AsyncIterable<UsageEvent>)
    await entered.promise
    const reason = new Error('stop the provider')
    caller.abort(reason)

    await expect(running).rejects.toBe(reason)
    expect(closed).toBe(1)
    expect(destroyed).toBe(1)
  })

  it('does not wait for a non-cooperative environment destroy after abort', async () => {
    const entered = deferred()
    const destroyStarted = deferred()
    let closed = 0
    const provider: AgentEnvironmentProvider = {
      name: 'non-cooperative-destroy-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: () => ({
            [Symbol.asyncIterator]() {
              return {
                next: () => {
                  entered.resolve()
                  return new Promise<IteratorResult<AgentEnvironmentEvent>>(() => {})
                },
                return: async () => {
                  closed += 1
                  return { done: true, value: undefined }
                },
              }
            },
          }),
          destroy: async () => {
            destroyStarted.resolve()
            return new Promise<never>(() => {})
          },
        })
      },
    }
    const caller = new AbortController()
    const executor = providerAsExecutor(provider)(
      { profile: { name: 'non-cooperative-destroy' } as AgentProfile, harness: null },
      { signal: caller.signal, seams: {} },
    )
    const running = collect(executor.execute('task', caller.signal) as AsyncIterable<UsageEvent>)
    await entered.promise
    const reason = new Error('stop before destroy settles')
    caller.abort(reason)

    await expect(running).rejects.toBe(reason)
    await destroyStarted.promise
    expect(closed).toBe(1)
  })

  it('composes a profile-only supervisor spec through one steerable CLI-bridge-like Pi session', async () => {
    const firstTurnStreaming = deferred()
    const finishFirstTurn = deferred()
    const secondTurnStreaming = deferred()
    const secondTurnCancelled = deferred()
    const turns: AgentTurnInput[] = []
    let created: Parameters<AgentEnvironmentProvider['create']>[0] | undefined
    let cancellations = 0
    let destroyed = 0
    const session: AgentSession = {
      id: 'provider-session',
      async status() {
        return 'running'
      },
      async *events(): AsyncIterable<AgentEnvironmentEvent> {},
      async result() {
        return { text: '', success: true }
      },
      async prompt() {
        return { text: '', success: true }
      },
      async cancel() {
        cancellations += 1
        secondTurnCancelled.resolve()
        throw new Error('provider reported cancellation after stopping the turn')
      },
    }
    const provider: AgentEnvironmentProvider = {
      name: 'session-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        created = input
        return fakeEnvironment({
          session(id) {
            if (id !== session.id && id !== turns[0]?.sessionId) {
              throw new Error(`unexpected session ${id}`)
            }
            return session
          },
          async *stream(input): AsyncIterable<AgentEnvironmentEvent> {
            turns.push(input)
            if (turns.length === 1) {
              yield {
                type: 'message.part.updated',
                data: {
                  part: {
                    type: 'tool',
                    tool: 'read',
                    callID: 'call-1',
                    state: {
                      status: 'completed',
                      input: { path: 'src/index.ts' },
                      output: 'source',
                    },
                  },
                },
              }
              firstTurnStreaming.resolve()
              await finishFirstTurn.promise
              yield {
                type: 'result',
                data: { finalText: 'first answer' },
                usage: {
                  inputTokens: 2,
                  outputTokens: 3,
                  reasoningTokens: 4,
                  cacheReadInputTokens: 11,
                  cost: 0.1,
                },
              }
              return
            }
            if (turns.length === 2) {
              secondTurnStreaming.resolve()
              await secondTurnCancelled.promise
              throw new Error('provider-specific interrupted turn')
            }
            yield {
              type: 'usage',
              data: {},
              usage: {
                inputTokens: 5,
                outputTokens: 7,
                reasoningTokens: 6,
                cacheCreationInputTokens: 2,
                cost: 0.2,
              },
            }
            yield { type: 'result', data: { finalText: 'changed direction' } }
          },
          async destroy() {
            destroyed += 1
          },
        })
      },
    }
    const profile = {
      name: 'full-worker',
      prompt: {
        systemPrompt: 'Lead the investigation.',
        instructions: ['Keep exact evidence.'],
      },
      model: {
        default: 'zai/glm-5.2',
        reasoningEffort: 'high',
      },
      harness: 'pi',
      permissions: { shell: 'allow' },
      tools: { shell: true, web: true },
      mcp: {
        papers: { transport: 'http', url: 'https://papers.example.test/mcp' },
      },
      subagents: { critic: { prompt: 'Find the strongest counterexample.' } },
      resources: {
        instructions: 'Use the attached protocol.',
        skills: [{ kind: 'inline', name: 'falsify', content: 'Try to disprove the claim.' }],
      },
      hooks: { afterTool: [{ command: './capture-result' }] },
      modes: { adversarial: { prompt: 'Try the opposite mechanism.' } },
      metadata: { lineage: 'materials-v1' },
      extensions: { pi: { autoApprove: true } },
    } as unknown as AgentProfile
    const factory = createExecutor({
      backend: 'provider',
      provider,
      defaults: {
        workspace: { cwd: '/repo' },
        providerOptions: { region: 'us-west', tenancy: 'team-a' },
      },
      steering: {
        maxTurns: 4,
        activityWindow: 8,
        turnTimeoutMs: 10_000,
      },
    })
    const spec = { profile } as AgentSpec
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    const running = collect(
      executor.execute('investigate', ctx.signal) as AsyncIterable<UsageEvent>,
    )
    await firstTurnStreaming.promise
    expect(executor.progress?.()).toMatchObject({
      turns: 0,
      pendingMessages: 0,
      recentActivity: [
        {
          kind: 'tool',
          label: 'read',
          status: 'ok',
          detail: 'src/index.ts',
        },
      ],
    })
    executor.deliver?.({ steer: 'Test the opposite mechanism.', interrupt: false })
    finishFirstTurn.resolve()
    await secondTurnStreaming.promise
    executor.deliver?.({ steer: 'Stop and change direction.', interrupt: true })
    const usage = await running

    expect(executor.runtime).toBe('session-provider')
    expect(created?.profile).toBe(profile)
    expect(created).toMatchObject({
      backend: 'pi',
      workspace: { cwd: '/repo' },
      signal: ctx.signal,
      providerOptions: {
        region: 'us-west',
        tenancy: 'team-a',
        sandboxCreateOptions: { backend: { type: 'pi' } },
      },
    })
    expect(usage).toEqual([
      { kind: 'tokens', input: 2, output: 7 },
      { kind: 'cost', usd: 0.1 },
      { kind: 'iteration' },
      { kind: 'tokens', input: 5, output: 13 },
      { kind: 'cost', usd: 0.2 },
      { kind: 'iteration' },
    ])
    expect(turns).toHaveLength(3)
    expect(turns[0]).toMatchObject({ prompt: 'investigate' })
    expect(turns[1]?.prompt).toContain('Test the opposite mechanism.')
    expect(turns[2]?.prompt).toContain('Stop and change direction.')
    expect(new Set(turns.map((turn) => turn.sessionId)).size).toBe(1)
    expect(turns[0]?.sessionId).toBeTruthy()
    expect(cancellations).toBe(1)
    expect(destroyed).toBe(1)
    await expect(executor.traceSource?.()?.collect()).resolves.toMatchObject([
      { toolName: 'read', args: { path: 'src/index.ts' }, status: 'ok' },
    ])
    const artifact = executor.resultArtifact()
    expect(artifact).toMatchObject({
      out: {
        content: 'changed direction',
        turns: 2,
        toolCalls: ['read'],
      },
      spent: {
        iterations: 2,
        tokens: { input: 7, output: 20 },
      },
    })
    expect(artifact.spent.usd).toBeCloseTo(0.3)
  })

  it('uses the exact profile harness while normalizing provider events', async () => {
    let created: Parameters<AgentEnvironmentProvider['create']>[0] | undefined
    const provider: AgentEnvironmentProvider = {
      name: 'native-default-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        created = input
        return fakeEnvironment({
          session: (id) => ({
            id,
            status: async () => 'running',
            events: async function* (): AsyncIterable<AgentEnvironmentEvent> {},
            result: async () => ({ text: '', success: true }),
            prompt: async () => ({ text: '', success: true }),
            cancel: async () => {},
          }),
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield {
              type: 'vendor.tool.finished',
              data: { opaque: true },
              normalized: {
                type: 'message.part.updated',
                part: {
                  id: 'tool-part',
                  sessionID: 'session',
                  messageID: 'message',
                  type: 'tool',
                  tool: 'read',
                  callID: 'normalized-call',
                  state: {
                    status: 'completed',
                    input: { path: 'README.md' },
                    output: 'source',
                  },
                },
              },
            }
            yield {
              type: 'vendor.text.delta',
              data: { opaque: true },
              normalized: {
                type: 'message.part.updated',
                part: {
                  id: 'text-part',
                  sessionID: 'session',
                  messageID: 'message',
                  type: 'text',
                  text: 'provider default',
                },
                delta: 'provider default',
              },
            }
            yield {
              type: 'vendor.turn.finished',
              data: { opaque: true },
              usage: { inputTokens: 2, outputTokens: 3, cost: 0 },
              normalized: { type: 'status', status: 'completed' },
            }
          },
        })
      },
    }
    const factory = createExecutor({
      backend: 'provider',
      provider,
      steering: {
        maxTurns: 1,
        activityWindow: 4,
        turnTimeoutMs: 10_000,
      },
    })
    const spec: AgentSpec = {
      profile: {
        name: 'normalized-worker',
        harness: 'pi',
        metadata: { backendType: 'codex' },
      },
      harness: null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)

    expect(created).toMatchObject({
      backend: 'pi',
      profile: spec.profile,
      providerOptions: { sandboxCreateOptions: { backend: { type: 'pi' } } },
    })
    expect(executor.progress?.()).toMatchObject({
      recentActivity: [
        {
          at: expect.any(Number),
          kind: 'tool',
          label: 'read',
          status: 'ok',
          detail: 'README.md',
        },
        {
          at: expect.any(Number),
          kind: 'turn',
          label: 'turn 0',
        },
      ],
    })
    await expect(executor.traceSource?.()?.collect()).resolves.toMatchObject([
      { toolName: 'read', args: { path: 'README.md' }, status: 'ok' },
    ])
    expect(executor.resultArtifact().out).toMatchObject({
      content: 'provider default',
      toolCalls: ['read'],
    })
  })

  it('rejects a missing profile harness before probing or creating the provider', () => {
    let capabilityCalls = 0
    let createCalls = 0
    const provider: AgentEnvironmentProvider = {
      name: 'must-not-run',
      capabilities() {
        capabilityCalls += 1
        return fakeCapabilities()
      },
      async create() {
        createCalls += 1
        throw new Error('must not create')
      },
    }
    const factory = createExecutor({
      backend: 'provider',
      provider,
      steering: {
        maxTurns: 1,
        activityWindow: 4,
        turnTimeoutMs: 10_000,
      },
    })
    const spec: AgentSpec = {
      profile: {
        name: 'missing-harness',
        metadata: { backendType: 'pi' },
      },
      harness: null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }

    expect(() => factory(spec, ctx)).toThrow(/AgentProfile\.harness is required/)
    expect({ capabilityCalls, createCalls }).toEqual({ capabilityCalls: 0, createCalls: 0 })
  })

  it.each([
    ['AgentSpec harness', { specHarness: 'codex' as BackendType }],
    ['provider default backend', { defaultBackend: 'codex' }],
  ])('rejects a conflicting %s before provider execution', (_label, conflict) => {
    let capabilityCalls = 0
    let createCalls = 0
    const provider: AgentEnvironmentProvider = {
      name: 'must-not-run-conflict',
      capabilities() {
        capabilityCalls += 1
        return fakeCapabilities()
      },
      async create() {
        createCalls += 1
        throw new Error('must not create')
      },
    }
    const factory = createExecutor({
      backend: 'provider',
      provider,
      ...('defaultBackend' in conflict ? { defaults: { backend: conflict.defaultBackend } } : {}),
      steering: {
        maxTurns: 1,
        activityWindow: 4,
        turnTimeoutMs: 10_000,
      },
    })
    const spec: AgentSpec = {
      profile: { name: 'pi-worker', harness: 'pi' },
      harness: 'specHarness' in conflict ? conflict.specHarness : null,
    }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }

    expect(() => factory(spec, ctx)).toThrow(/conflicts with AgentProfile\.harness "pi"/)
    expect({ capabilityCalls, createCalls }).toEqual({ capabilityCalls: 0, createCalls: 0 })
  })

  it('plugs a provider into createExecutor as backend data', async () => {
    const provider: AgentEnvironmentProvider = {
      name: 'package-provider',
      capabilities: () => fakeCapabilities(),
      async create() {
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'result', data: { finalText: 'from-package' } }
          },
        })
      },
    }
    const factory = createExecutor({ backend: 'provider', provider })
    const spec: AgentSpec = { profile: { name: 'worker' } as AgentProfile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)

    expect(executor.resultArtifact().out).toMatchObject({ content: 'from-package' })
  })

  it('resolves a named provider through the runtime registry', async () => {
    let created: unknown
    const provider: AgentEnvironmentProvider = {
      name: 'named-provider',
      capabilities: () => fakeCapabilities(),
      async create(input) {
        created = input
        return fakeEnvironment({
          stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
            yield { type: 'result', data: { finalText: 'from-named-provider' } }
          },
        })
      },
    }
    const registry = createAgentEnvironmentProviderRegistry([provider])
    const factory = createExecutor({
      backend: 'provider',
      provider: 'named-provider',
      registry,
      defaults: {
        backend: 'codex',
        workspace: { cwd: '/repo' },
      },
    })
    const spec: AgentSpec = { profile: { name: 'worker' } as AgentProfile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = factory(spec, ctx)

    await collect(executor.execute('task', ctx.signal) as AsyncIterable<UsageEvent>)

    expect(created).toMatchObject({
      profile: { name: 'worker' },
      backend: 'codex',
      workspace: { cwd: '/repo' },
    })
    expect(executor.resultArtifact().out).toMatchObject({ content: 'from-named-provider' })
    expect(registry.names()).toEqual(['named-provider'])
  })
})

function fakeEnvironment(
  overrides: Partial<AgentEnvironment> & Pick<AgentEnvironment, 'stream'>,
): AgentEnvironment {
  const { stream, ...rest } = overrides
  return {
    id: 'env-1',
    provider: 'fake-provider',
    status: async () => 'running',
    destroy: async () => {},
    ...rest,
    stream,
  }
}

function fakeCapabilities() {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: true,
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
    workspace: { read: true, write: true, exec: true, git: true, upload: true, download: true },
    branching: { checkpoint: true, fork: true },
    placement: true,
    usage: true,
    confidential: true,
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
