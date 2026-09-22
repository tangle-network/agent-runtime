import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import {
  type AgentEnvironment,
  type AgentEnvironmentEvent,
  type AgentEnvironmentProvider,
  createAgentEnvironmentProviderRegistry,
  resolveAgentEnvironmentProvider,
} from './environment-provider'
import { environmentExecutor } from './supervise/runtime'
import type { AgentSpec, ExecutorContext, ExecutorResult } from './supervise/types'

describe('environment provider adapters', () => {
  it('registers, resolves, replaces, and rejects unknown providers explicitly', () => {
    const first = fakeProvider('first')
    const replacement = fakeProvider('first')
    const registry = createAgentEnvironmentProviderRegistry([first])

    expect(resolveAgentEnvironmentProvider('first', registry)).toBe(first)
    expect(resolveAgentEnvironmentProvider(first)).toBe(first)
    expect(() => registry.register(replacement)).toThrow(/already registered/)
    registry.register(replacement, { replace: true })
    expect(registry.require('first')).toBe(replacement)
    expect(() => registry.require('missing')).toThrow(/available: first/)
    expect(() => resolveAgentEnvironmentProvider('first')).toThrow(/requires/)
  })

  it('runs a provider worker and reports real usage', async () => {
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
    const spec: AgentSpec = { profile: { name: 'worker' } as AgentProfile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = environmentExecutor(provider, { provider })(spec, ctx)

    const artifact = (await executor.execute('task', ctx.signal)) as ExecutorResult<unknown>

    expect(artifact.out).toMatchObject({
      content: 'hello world',
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'result', data: { finalText: 'hello world' } }),
      ]),
    })
    expect(artifact.spent).toMatchObject({
      iterations: 1,
      tokens: { input: 7, output: 11 },
      usd: 0.03,
    })
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
    const options = {
      provider: 'named-provider',
      registry,
      environment: {
        backend: 'codex',
        workspace: { cwd: '/repo' },
      },
    }
    const spec: AgentSpec = { profile: { name: 'worker' } as AgentProfile, harness: null }
    const ctx: ExecutorContext = { signal: new AbortController().signal, seams: {} }
    const executor = environmentExecutor(
      resolveAgentEnvironmentProvider(options.provider, registry),
      options,
    )(spec, ctx)

    const artifact = (await executor.execute('task', ctx.signal)) as ExecutorResult<unknown>

    expect(created).toMatchObject({
      profile: { name: 'worker' },
      backend: 'codex',
      workspace: { cwd: '/repo' },
    })
    expect(artifact.out).toMatchObject({
      content: 'from-named-provider',
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'result',
          data: { finalText: 'from-named-provider' },
        }),
      ]),
    })
    expect(artifact.spent).toMatchObject({ usd: 0, usdKnown: false })
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

function fakeProvider(name: string): AgentEnvironmentProvider {
  return {
    name,
    capabilities: () => fakeCapabilities(),
    async create() {
      return fakeEnvironment({
        provider: name,
        stream: async function* (): AsyncIterable<AgentEnvironmentEvent> {
          yield { type: 'result', data: { finalText: name } }
        },
      })
    },
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
