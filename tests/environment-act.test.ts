import type { TraceEmitter } from '@tangle-network/agent-eval'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunContext,
  collectAgentRun,
  createEnvironmentAct,
  environmentActProfileMaterialization,
} from '../src/agent'
import type { OutputAdapter } from '../src/runtime/types'

const BASE = {
  name: 'demo-agent',
  prompt: { systemPrompt: 'base' },
  mcp: { domain: { transport: 'stdio' as const, command: 'domain-mcp', enabled: true } },
}

const SCRIPT: AgentEnvironmentEvent[] = [
  { type: 'message.part.updated', data: { delta: 'Hel' } },
  { type: 'message.part.updated', data: { delta: 'lo' } },
  { type: 'llm_call', data: { model: 'gpt', tokensIn: 5, tokensOut: 3 } },
  { type: 'result', data: { finalText: 'Hello' } },
]

const output: OutputAdapter<string> = {
  parse: (events) => {
    const result = events.find((event) => event.type === 'result')
    return typeof result?.data.finalText === 'string' ? result.data.finalText : ''
  },
}

function fakeProvider(events: AgentEnvironmentEvent[], opts: { throwOnStream?: boolean } = {}) {
  const captured: { createInput?: CreateAgentEnvironmentInput; prompt?: string } = {}
  const destroyed: string[] = []
  const provider: AgentEnvironmentProvider = {
    name: 'test',
    capabilities: () => ({
      profile: {},
      streaming: { live: true, replay: false, detach: false, turnIdempotency: false },
      sessions: { continue: false, list: false, messages: false },
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
      usage: true,
      confidential: false,
    }),
    async create(createInput) {
      captured.createInput = createInput
      return {
        id: 'environment-1',
        provider: 'test',
        status: async () => 'running',
        async *stream(input) {
          captured.prompt = input.prompt
          if (opts.throwOnStream) throw new Error('stream boom')
          for (const event of events) yield event
        },
        destroy: async () => {
          destroyed.push('environment-1')
        },
      } satisfies AgentEnvironment
    },
  }
  return { provider, captured, destroyed }
}

function profileFrom(input: CreateAgentEnvironmentInput | undefined) {
  const profile = input?.profile
  return typeof profile === 'string' ? undefined : profile
}

function ctx(): AgentRunContext {
  return { runId: 'run-1', emitter: {} as unknown as TraceEmitter }
}

describe('createEnvironmentAct', () => {
  it('publishes the current profile materialization name', () => {
    expect(environmentActProfileMaterialization.name).toBe('createEnvironmentAct')
  })

  it('uses the production profile, maps events, parses raw events, and destroys the environment', async () => {
    const { provider, captured, destroyed } = fakeProvider(SCRIPT)
    const act = createEnvironmentAct({
      baseProfile: BASE,
      environmentProvider: provider,
      buildPrompt: (persona: string) => `prompt:${persona}`,
      output,
    })

    const { events, output: result } = await collectAgentRun(act('persona-1', ctx()))

    expect(Object.keys(profileFrom(captured.createInput)?.mcp ?? {})).toEqual(['domain'])
    expect(captured.prompt).toBe('prompt:persona-1')
    expect(result).toBe('Hello')
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'llm_call', model: 'gpt', tokensIn: 5, tokensOut: 3 },
    ])
    expect(destroyed).toEqual(['environment-1'])
  })

  it('leaves the base profile untouched without compose overrides', async () => {
    const { provider, captured } = fakeProvider(SCRIPT)
    const act = createEnvironmentAct({
      baseProfile: BASE,
      environmentProvider: provider,
      buildPrompt: () => 'go',
      output,
    })
    await collectAgentRun(act('p', ctx()))
    expect(profileFrom(captured.createInput)?.mcp).toEqual({ domain: BASE.mcp.domain })
  })

  it('applies per-persona prompt overrides', async () => {
    const { provider, captured } = fakeProvider(SCRIPT)
    const act = createEnvironmentAct({
      baseProfile: BASE,
      environmentProvider: provider,
      buildPrompt: (persona: string) => persona,
      output,
      compose: (persona: string) => ({ systemPrompt: `augmented for ${persona}` }),
    })
    await collectAgentRun(act('alice', ctx()))
    expect(profileFrom(captured.createInput)?.prompt?.systemPrompt).toBe('augmented for alice')
  })

  it('merges per-persona MCP connections over the base profile', async () => {
    const { provider, captured } = fakeProvider(SCRIPT)
    const act = createEnvironmentAct({
      baseProfile: BASE,
      environmentProvider: provider,
      buildPrompt: () => 'x',
      output,
      compose: () => ({
        mcpConnections: { ticketing: { transport: 'stdio', command: 'node', enabled: true } },
      }),
    })
    await collectAgentRun(act('p', ctx()))
    expect(Object.keys(profileFrom(captured.createInput)?.mcp ?? {})).toEqual([
      'domain',
      'ticketing',
    ])
  })

  it('parses raw terminal events that have no stream projection', async () => {
    const { provider } = fakeProvider([{ type: 'result', data: { finalText: 'only-raw' } }])
    const act = createEnvironmentAct({
      baseProfile: BASE,
      environmentProvider: provider,
      buildPrompt: () => 'x',
      output,
    })
    const { events, output: result } = await collectAgentRun(act('p', ctx()))
    expect(events).toEqual([])
    expect(result).toBe('only-raw')
  })

  it('rejects the output and destroys the environment when streaming fails', async () => {
    const { provider, destroyed } = fakeProvider(SCRIPT, { throwOnStream: true })
    const act = createEnvironmentAct({
      baseProfile: BASE,
      environmentProvider: provider,
      buildPrompt: () => 'x',
      output,
    })
    await expect(collectAgentRun(act('p', ctx()))).rejects.toThrow('stream boom')
    expect(destroyed).toEqual(['environment-1'])
  })

  it('rejects unsupported profile axes before creating an environment', () => {
    const { provider } = fakeProvider(SCRIPT)
    expect(() =>
      createEnvironmentAct({
        baseProfile: BASE,
        environmentProvider: provider,
        buildPrompt: () => 'x',
        output,
        requiredProfileAxes: ['custom:side-channel'],
      }),
    ).toThrow('profile materialization would drop axis changes')
  })
})
