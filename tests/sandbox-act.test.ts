import type { TraceEmitter } from '@tangle-network/agent-eval'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { type AgentRunContext, collectAgentRun, createSandboxAct } from '../src/agent'
import type { OutputAdapter, SandboxClient } from '../src/runtime'

const BASE = {
  name: 'demo-agent',
  harness: 'opencode' as const,
  model: { provider: 'offline', default: 'offline-test-model' },
  prompt: { systemPrompt: 'base' },
  mcp: { domain: { transport: 'stdio' as const, command: 'domain-mcp', enabled: true } },
}

const SCRIPT: SandboxEvent[] = [
  { type: 'message.part.updated', data: { part: { type: 'text', text: 'Hel' }, delta: 'Hel' } },
  { type: 'message.part.updated', data: { part: { type: 'text', text: 'Hello' }, delta: 'lo' } },
  { type: 'llm_call', data: { model: 'gpt', tokensIn: 5, tokensOut: 3 } },
  { type: 'result', data: { finalText: 'Hello' } },
]

const output: OutputAdapter<string> = {
  parse: (events) => {
    const result = events.find((e) => e.type === 'result')
    const data = result?.data as { finalText?: unknown } | undefined
    return typeof data?.finalText === 'string' ? data.finalText : ''
  },
}

function fakeClient(events: SandboxEvent[], opts: { throwOnStream?: boolean } = {}) {
  const captured: { createOpts?: CreateSandboxOptions; prompt?: string } = {}
  const client: SandboxClient = {
    async create(createOpts) {
      captured.createOpts = createOpts
      return {
        async *streamPrompt(message: string) {
          captured.prompt = message
          if (opts.throwOnStream) throw new Error('stream boom')
          for (const e of events) yield e
        },
      } as unknown as SandboxInstance
    },
  }
  return { client, captured }
}

function ctx(): AgentRunContext {
  return { runId: 'run-1', emitter: {} as unknown as TraceEmitter }
}

describe('createSandboxAct — prod-profile eval parity', () => {
  it('boots the sandbox with the agent profile and streams mapped events + parsed output', async () => {
    const { client, captured } = fakeClient(SCRIPT)
    const act = createSandboxAct({
      baseProfile: BASE,
      sandboxClient: client,
      buildPrompt: (p: string) => `prompt:${p}`,
      output,
    })

    const { events, output: out } = await collectAgentRun(act('persona-1', ctx()))

    const profile = captured.createOpts?.backend?.profile
    // The eval profile is the agent's own profile, unchanged — no delegation MCP injected.
    expect(Object.keys(profile?.mcp ?? {})).toEqual(['domain'])
    expect(captured.prompt).toBe('prompt:persona-1')
    expect(out).toBe('Hello')
    // text parts → text_delta, cost event → llm_call, bare result → unmapped
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'llm_call', model: 'gpt', tokensIn: 5, tokensOut: 3, usdKnown: false },
    ])
  })

  it('leaves the base profile untouched when no compose overrides are given', async () => {
    const { client, captured } = fakeClient(SCRIPT)
    const act = createSandboxAct({
      baseProfile: BASE,
      sandboxClient: client,
      buildPrompt: () => 'go',
      output,
    })
    await collectAgentRun(act('p', ctx()))
    expect(captured.createOpts?.backend?.profile?.mcp).toEqual({ domain: BASE.mcp.domain })
  })

  it('applies per-persona compose overrides (workspace-augmented system prompt)', async () => {
    const { client, captured } = fakeClient(SCRIPT)
    const act = createSandboxAct({
      baseProfile: BASE,
      sandboxClient: client,
      buildPrompt: (p: string) => p,
      output,
      compose: (p: string) => ({ systemPrompt: `augmented for ${p}` }),
    })
    await collectAgentRun(act('alice', ctx()))
    expect(captured.createOpts?.backend?.profile?.prompt?.systemPrompt).toBe('augmented for alice')
  })

  it('merges per-persona mcpConnections over the base profile mcp map', async () => {
    const { client, captured } = fakeClient(SCRIPT)
    const act = createSandboxAct({
      baseProfile: BASE,
      sandboxClient: client,
      buildPrompt: () => 'x',
      output,
      compose: () => ({
        mcpConnections: { ticketing: { transport: 'stdio', command: 'node', enabled: true } },
      }),
    })
    await collectAgentRun(act('p', ctx()))
    expect(Object.keys(captured.createOpts?.backend?.profile?.mcp ?? {})).toEqual([
      'domain',
      'ticketing',
    ])
  })

  it('parses output from the RAW stream, including events with no RuntimeStreamEvent projection', async () => {
    // The result event is unmapped to the stream but MUST reach output.parse.
    const { client } = fakeClient([{ type: 'result', data: { finalText: 'only-raw' } }])
    const act = createSandboxAct({
      baseProfile: BASE,
      sandboxClient: client,
      buildPrompt: () => 'x',
      output,
    })
    const { events, output: out } = await collectAgentRun(act('p', ctx()))
    expect(events).toEqual([])
    expect(out).toBe('only-raw')
  })

  it('rejects output and throws from the iterator when the stream errors — never a silent empty run', async () => {
    const { client } = fakeClient(SCRIPT, { throwOnStream: true })
    const act = createSandboxAct({
      baseProfile: BASE,
      sandboxClient: client,
      buildPrompt: () => 'x',
      output,
    })
    await expect(collectAgentRun(act('p', ctx()))).rejects.toThrow('stream boom')
  })

  it('fails at construction when the caller requires an unsupported custom profile axis', () => {
    const { client } = fakeClient(SCRIPT)
    expect(() =>
      createSandboxAct({
        baseProfile: BASE,
        sandboxClient: client,
        buildPrompt: () => 'x',
        output,
        requiredProfileAxes: ['custom:side-channel'],
      }),
    ).toThrow('profile materialization would drop axis changes')
  })
})
