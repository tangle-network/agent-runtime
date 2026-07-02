import type { SandboxEvent } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cliBridgeSandboxClient } from './cli-bridge-sandbox-client'

function mockBridge(body: Record<string, unknown>, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch,
  )
}

async function drain(
  client: ReturnType<typeof cliBridgeSandboxClient>,
  prompt: string,
): Promise<SandboxEvent[]> {
  const box = await client.create({ backend: { type: 'kimi-code', model: { model: 'kimi-k2.6' } } })
  const events: SandboxEvent[] = []
  for await (const ev of box.streamPrompt(prompt)) events.push(ev)
  return events
}

describe('cliBridgeSandboxClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('yields an llm_call with usage tokens and a result with the completion', async () => {
    mockBridge({
      choices: [{ message: { content: 'FINAL\n1040 line 1: 100' } }],
      usage: { prompt_tokens: 1234, completion_tokens: 567 },
      model: 'kimi-code/kimi-k2.6',
    })
    const events = await drain(cliBridgeSandboxClient({ bearer: 'tok' }), 'compute the return')

    const llm = events.find((e) => e.type === 'llm_call')
    expect(llm?.data).toMatchObject({ tokensIn: 1234, tokensOut: 567, costUsd: 0 })
    const result = events.find((e) => e.type === 'result')
    expect(result?.data?.finalText).toBe('FINAL\n1040 line 1: 100')
    expect(result?.data?.tokenUsage).toEqual({ inputTokens: 1234, outputTokens: 567 })
  })

  it('POSTs the per-create backend override as the harness/model bridge id', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
      text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const client = cliBridgeSandboxClient({ bearer: 'tok', url: 'http://127.0.0.1:9999' })
    const box = await client.create({
      backend: { type: 'kimi-code', model: { model: 'kimi-k2.6' } },
    })
    for await (const _ of box.streamPrompt('go')) {
      // consume
    }

    const [urlArg, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(urlArg).toBe('http://127.0.0.1:9999/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
    const sent = JSON.parse(init.body as string) as {
      model: string
      messages: { content: string }[]
    }
    expect(sent.model).toBe('kimi-code/kimi-k2.6')
    expect(sent.messages[0]?.content).toBe('go')
  })

  it('passes an already-harness-prefixed model through unchanged', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
      text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const client = cliBridgeSandboxClient({ bearer: 'tok' })
    const box = await client.create({
      backend: { type: 'opencode', model: { model: 'opencode/deepseek/deepseek-v4-flash' } },
    })
    for await (const _ of box.streamPrompt('go')) {
      // consume
    }
    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(firstCall[1].body as string) as { model: string }
    expect(sent.model).toBe('opencode/deepseek/deepseek-v4-flash')
  })

  it('fails loud when the bearer is empty', () => {
    expect(() => cliBridgeSandboxClient({ bearer: '' })).toThrow(/bearer is required/)
  })

  it('throws on a bridge HTTP error rather than recording a silent zero', async () => {
    mockBridge({ error: { message: 'model not loaded' } }, false)
    await expect(drain(cliBridgeSandboxClient({ bearer: 'tok' }), 'go')).rejects.toThrow(/HTTP 500/)
  })
})
