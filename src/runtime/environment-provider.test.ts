import type { AgentProfile } from '@tangle-network/agent-interface'
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
              usage: { inputTokens: 2, outputTokens: 3, cost: 0.01 },
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
    expect(events[0]).toMatchObject({
      type: 'llm_call',
      data: { inputTokens: 2, outputTokens: 3, totalCostUsd: 0.01 },
    })
    expect(events.at(-1)).toMatchObject({ type: 'result', data: { finalText: 'ok:hello' } })
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
              usage: { inputTokens: 7, outputTokens: 11, cost: 0.03 },
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
      { kind: 'tokens', input: 7, output: 11 },
      { kind: 'cost', usd: 0.03 },
      { kind: 'iteration' },
    ])
    expect(artifact.out).toMatchObject({ content: 'hello world' })
    expect(artifact.spent).toMatchObject({
      iterations: 1,
      tokens: { input: 7, output: 11 },
      usd: 0.03,
    })
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
