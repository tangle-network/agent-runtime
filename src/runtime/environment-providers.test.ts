import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inlineEnvironmentProvider } from './inline-environment-provider'
import { localEnvironmentProvider } from './local-environment-provider'
import { routerEnvironmentProvider } from './router-environment-provider'
import type { ExecutorFactory } from './supervise/types'

describe('inlineEnvironmentProvider', () => {
  it('supports repeated turns in one environment', async () => {
    let turns = 0
    const provider = inlineEnvironmentProvider(() => ({
      runtime: 'test',
      async execute(task) {
        turns += 1
        return {
          outRef: `result-${turns}`,
          out: { content: `${turns}:${String(task)}` },
          spent: {
            iterations: 1,
            tokens: { input: 0, output: 0 },
            usd: 0,
            ms: 0,
          },
        }
      },
      async teardown() {
        return { destroyed: true }
      },
      resultArtifact() {
        throw new Error('one-shot executor has no deferred artifact')
      },
    }))
    const environment = await provider.create({ profile: {} })

    expect((await provider.capabilities()).sessions.continue).toBe(true)
    expect((await collect(environment.stream({ prompt: 'first' }))).at(-1)?.data.finalText).toBe(
      '1:first',
    )
    expect((await collect(environment.stream({ prompt: 'second' }))).at(-1)?.data.finalText).toBe(
      '2:second',
    )
  })

  it('passes the validated profile, emits usage, and tears down after a turn', async () => {
    const teardown = vi.fn(async () => ({ destroyed: true }))
    const factory: ExecutorFactory<unknown> = (spec) => ({
      runtime: 'test',
      async execute(task) {
        return {
          outRef: 'result',
          out: { content: `${spec.profile.name}:${String(task)}` },
          spent: {
            iterations: 1,
            tokens: { input: 7, output: 3 },
            usd: 0.002,
            ms: 5,
          },
        }
      },
      teardown,
      resultArtifact() {
        throw new Error('one-shot executor has no deferred artifact')
      },
    })
    const provider = inlineEnvironmentProvider(factory)
    const environment = await provider.create({ profile: { name: 'worker' } })

    const events = await collect(environment.stream({ prompt: 'hello' }))

    expect(events[0]?.usage).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      cost: 0.002,
    })
    expect(events.at(-1)?.data.finalText).toBe('worker:hello')
    expect(teardown).toHaveBeenCalledOnce()
  })

  it('does not report unknown dollar cost as zero', async () => {
    const factory: ExecutorFactory<unknown> = () => ({
      runtime: 'test',
      async execute() {
        return {
          outRef: 'result',
          out: 'done',
          spent: {
            iterations: 1,
            tokens: { input: 1, output: 1 },
            usdKnown: false,
            usd: 0,
            ms: 1,
          },
        }
      },
      async teardown() {
        return { destroyed: true }
      },
      resultArtifact() {
        throw new Error('one-shot executor has no deferred artifact')
      },
    })
    const provider = inlineEnvironmentProvider(factory)
    const environment = await provider.create({ profile: {} })

    const events = await collect(environment.stream({ prompt: 'hello' }))

    expect(events[0]?.usage).toEqual({ inputTokens: 1, outputTokens: 1 })
    expect(events[0]?.data).not.toHaveProperty('costUsd')
    expect(events.at(-1)?.data).not.toHaveProperty('costUsd')
  })

  it('aborts an uncooperative executor and shares one teardown across destroy calls', async () => {
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let finishTeardown!: () => void
    const teardownReady = new Promise<void>((resolve) => {
      finishTeardown = resolve
    })
    const teardown = vi.fn(async () => {
      await teardownReady
      return { destroyed: true }
    })
    const factory: ExecutorFactory<unknown> = () => ({
      runtime: 'test',
      execute() {
        markStarted()
        return new Promise<never>(() => {})
      },
      teardown,
      resultArtifact() {
        throw new Error('executor did not settle')
      },
    })
    const provider = inlineEnvironmentProvider(factory)
    const environment = await provider.create({ profile: {} })
    const running = collect(environment.stream({ prompt: 'wait' }))
    await started

    const firstDestroy = environment.destroy?.()
    const secondDestroy = environment.destroy?.()

    expect(firstDestroy).toBe(secondDestroy)
    await Promise.resolve()
    expect(teardown).toHaveBeenCalledOnce()
    finishTeardown()
    await firstDestroy
    await secondDestroy
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('localEnvironmentProvider', () => {
  it('rejects incomplete router configuration', () => {
    expect(() =>
      localEnvironmentProvider({
        router: { baseUrl: 'https://router.invalid', key: '', model: 'model' },
      }),
    ).toThrow(/router\.baseUrl, router\.key, and router\.model/)
  })

  it('creates and destroys an official local environment without MCP processes', async () => {
    const provider = localEnvironmentProvider({
      router: { baseUrl: 'https://router.invalid', key: 'unused', model: 'unused' },
    })
    const environment = await provider.create({ profile: {}, name: 'local-test' })

    expect(provider.name).toBe('local')
    expect(environment).toMatchObject({
      id: 'local-0',
      provider: 'local',
      name: 'local-test',
    })
    expect(await environment.status()).toBe('running')
    expect(await environment.placement?.()).toEqual({ kind: 'local' })

    const firstDestroy = environment.destroy?.()
    const secondDestroy = environment.destroy?.()
    expect(firstDestroy).toBe(secondDestroy)
    await firstDestroy
    expect(await environment.status()).toBe('stopped')
  })

  it('accepts implicit stdio only for the exact trusted profile', async () => {
    const trustedProfile: AgentProfile = {
      mcp: {
        tools: {
          command: 'node',
          args: ['trusted-server.mjs'],
        },
      },
    }
    const provider = localEnvironmentProvider({
      router: { baseUrl: 'https://router.invalid', key: 'unused', model: 'unused' },
      trustedProfile,
      profileSecurityPolicy: {
        allowLocalMcp: true,
        allowHooks: false,
      },
    })

    const trusted = await provider.validateProfile?.(trustedProfile)
    const untrusted = await provider.validateProfile?.({
      mcp: {
        tools: {
          command: 'node',
          args: ['different-server.mjs'],
        },
      },
    })

    expect(trusted?.ok).toBe(true)
    expect(untrusted?.ok).toBe(false)
    expect(untrusted?.issues.map((issue) => issue.code)).toContain('BLOCKED_LOCAL_MCP')
  })
})

describe('routerEnvironmentProvider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('runs a router response through the environment contract', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'READY' } }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const provider = routerEnvironmentProvider({
      routerBaseUrl: 'https://router.invalid/v1',
      routerKey: 'key',
      model: 'model',
    })
    const environment = await provider.create({ profile: { name: 'worker' } })

    const events = await collect(environment.stream({ prompt: 'respond' }))

    expect(events.at(-1)?.data.finalText).toBe('READY')
    expect(events[0]?.usage).toMatchObject({ inputTokens: 3, outputTokens: 1 })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('requires an implementation when tools are configured', () => {
    expect(() =>
      routerEnvironmentProvider({
        routerBaseUrl: 'https://router.invalid/v1',
        routerKey: 'key',
        model: 'model',
        tools: [
          {
            type: 'function',
            function: { name: 'search', parameters: { type: 'object' } },
          },
        ],
      }),
    ).toThrow(/tools require executeToolCall/)
  })
})

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}
