import { EventEmitter } from 'node:events'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The client uses the node:http core client (not global fetch) so a >5-min bridge
// turn is not killed by undici's fixed headers timeout. The test mocks `request`:
// a fake req captures the written body + options and drives a fake res carrying the
// mocked completion JSON.
const captured: { url?: unknown; options?: Record<string, unknown>; body?: string } = {}
let responseBody = ''
let responseStatus = 200

vi.mock('node:http', () => ({
  request: (
    url: unknown,
    options: Record<string, unknown>,
    cb: (res: EventEmitter & { statusCode: number }) => void,
  ) => {
    captured.url = url
    captured.options = options
    const req = new EventEmitter() as EventEmitter & {
      write: (b: string) => void
      end: () => void
      destroy: (e?: Error) => void
    }
    req.write = (b: string) => {
      captured.body = b
    }
    req.end = () => {
      queueMicrotask(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode: number }
        res.statusCode = responseStatus
        cb(res)
        res.emit('data', Buffer.from(responseBody, 'utf8'))
        res.emit('end')
      })
    }
    req.destroy = () => {}
    return req
  },
}))

import { cliBridgeSandboxClient } from './cli-bridge-sandbox-client'

function setResponse(body: Record<string, unknown>, status = 200): void {
  responseBody = JSON.stringify(body)
  responseStatus = status
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
  afterEach(() => {
    captured.url = undefined
    captured.options = undefined
    captured.body = undefined
  })

  it('yields an llm_call with usage tokens and a result with the completion', async () => {
    setResponse({
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

  it('POSTs the per-create backend override as the harness/model bridge id, with no idle timeout', async () => {
    setResponse({ choices: [{ message: { content: 'ok' } }], usage: {} })
    const client = cliBridgeSandboxClient({ bearer: 'tok', url: 'http://127.0.0.1:9999' })
    const box = await client.create({
      backend: { type: 'kimi-code', model: { model: 'kimi-k2.6' } },
    })
    for await (const _ of box.streamPrompt('go')) {
      // consume
    }

    expect(String(captured.url)).toBe('http://127.0.0.1:9999/v1/chat/completions')
    const headers = (captured.options?.headers ?? {}) as Record<string, string>
    expect(headers.authorization).toBe('Bearer tok')
    // No header/body idle timeout — a slow bridge is a live bridge; abort is the deadline.
    expect(captured.options?.timeout).toBe(0)
    const sent = JSON.parse(captured.body ?? '{}') as {
      model: string
      messages: { content: string }[]
    }
    expect(sent.model).toBe('kimi-code/kimi-k2.6')
    expect(sent.messages[0]?.content).toBe('go')
  })

  it('passes an already-harness-prefixed model through unchanged', async () => {
    setResponse({ choices: [{ message: { content: 'ok' } }], usage: {} })
    const client = cliBridgeSandboxClient({ bearer: 'tok' })
    const box = await client.create({
      backend: { type: 'opencode', model: { model: 'opencode/deepseek/deepseek-v4-flash' } },
    })
    for await (const _ of box.streamPrompt('go')) {
      // consume
    }
    const sent = JSON.parse(captured.body ?? '{}') as { model: string }
    expect(sent.model).toBe('opencode/deepseek/deepseek-v4-flash')
  })

  it('fails loud when the bearer is empty', () => {
    expect(() => cliBridgeSandboxClient({ bearer: '' })).toThrow(/bearer is required/)
  })

  it('throws on a bridge HTTP error rather than recording a silent zero', async () => {
    setResponse({ error: { message: 'model not loaded' } }, 500)
    await expect(drain(cliBridgeSandboxClient({ bearer: 'tok' }), 'go')).rejects.toThrow(/HTTP 500/)
  })
})
