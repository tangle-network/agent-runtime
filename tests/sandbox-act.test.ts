import type { TraceEmitter } from '@tangle-network/agent-eval'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { type AgentRunContext, collectAgentRun, createSandboxAct } from '../src/agent'
import { DELEGATION_MCP_SERVER_KEY } from '../src/mcp/delegation-profile'
import type { LoopSandboxClient, OutputAdapter } from '../src/runtime'

const BASE = {
  name: 'demo-agent',
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
  const client: LoopSandboxClient = {
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
  it('boots the sandbox with the composed PRODUCTION profile (delegation MCP merged when keyed)', async () => {
    const { client, captured } = fakeClient(SCRIPT)
    const act = createSandboxAct({
      baseProfile: BASE,
      sandboxClient: client,
      buildPrompt: (p: string) => `prompt:${p}`,
      output,
      env: { TANGLE_API_KEY: 'sk' },
    })

    const { events, output: out } = await collectAgentRun(act('persona-1', ctx()))

    const profile = captured.createOpts?.backend?.profile
    expect(Object.keys(profile?.mcp ?? {})).toEqual(['domain', DELEGATION_MCP_SERVER_KEY])
    expect(captured.prompt).toBe('prompt:persona-1')
    expect(out).toBe('Hello')
    // text parts → text_delta, cost event → llm_call, bare result → unmapped
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'llm_call', model: 'gpt', tokensIn: 5, tokensOut: 3 },
    ])
  })

  it('omits the delegation MCP when no sandbox key resolves — eval profile stays a clean local profile', async () => {
    const { client, captured } = fakeClient(SCRIPT)
    const act = createSandboxAct({
      baseProfile: BASE,
      sandboxClient: client,
      buildPrompt: () => 'go',
      output,
      env: {},
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
      env: {},
      compose: (p: string) => ({ systemPrompt: `augmented for ${p}` }),
    })
    await collectAgentRun(act('alice', ctx()))
    expect(captured.createOpts?.backend?.profile?.prompt?.systemPrompt).toBe('augmented for alice')
  })

  it('parses output from the RAW stream, including events with no RuntimeStreamEvent projection', async () => {
    // The result event is unmapped to the stream but MUST reach output.parse.
    const { client } = fakeClient([{ type: 'result', data: { finalText: 'only-raw' } }])
    const act = createSandboxAct({
      baseProfile: BASE,
      sandboxClient: client,
      buildPrompt: () => 'x',
      output,
      env: {},
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
      env: {},
    })
    await expect(collectAgentRun(act('p', ctx()))).rejects.toThrow('stream boom')
  })
})
