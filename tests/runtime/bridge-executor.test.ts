import { PassThrough, type Readable } from 'node:stream'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecutor, inlineSandboxClient } from '../../src/runtime'

// `bridgeExecutor` POSTs each turn over the `node:http` core client, not global
// `fetch`: the bridge runs a harness CLI and streams only once it starts
// producing (first byte routinely >5 min in), and undici's fixed ~300s
// `headersTimeout` — unoverridable by any option or AbortSignal — would kill a
// live-but-slow bridge. Tests drive that transport by setting `bridgeHttpHandler`.
let bridgeHttpHandler: ((payload: Record<string, unknown>) => Readable) | null = null
let lastBridgeUrl: URL | null = null

vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http')
  return {
    ...actual,
    request: (url: URL, _opts: unknown, cb: (res: Readable) => void) => {
      lastBridgeUrl = url
      let body = ''
      return {
        write: (chunk: string) => {
          body += chunk
        },
        end: () => {
          const payload = JSON.parse(body || '{}') as Record<string, unknown>
          if (!bridgeHttpHandler) throw new Error('bridgeHttpHandler not set')
          const res = bridgeHttpHandler(payload) as Readable & { statusCode?: number }
          res.statusCode = res.statusCode ?? 200
          cb(res)
        },
        on: () => {},
        destroy: () => {},
      }
    },
  }
})

function sse(content: string, input: number, output: number): Readable {
  const stream = new PassThrough()
  stream.end(
    [
      `data: ${JSON.stringify({
        choices: [{ delta: { content } }],
        usage: { prompt_tokens: input, completion_tokens: output },
      })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n'),
  )
  return stream
}

function bridgeClient(model: string) {
  return inlineSandboxClient(
    createExecutor({
      backend: 'bridge',
      bridgeUrl: 'http://bridge.test',
      bridgeBearer: 'secret',
      model,
    }),
  )
}

async function runOnce(
  client: ReturnType<typeof bridgeClient>,
  prompt: string,
  backend?: unknown,
): Promise<{ finalText: string; tokensIn: number; tokensOut: number }> {
  const box = await client.create(backend ? ({ backend } as never) : undefined)
  let finalText = ''
  let tokensIn = 0
  let tokensOut = 0
  for await (const ev of box.streamPrompt(prompt) as AsyncIterable<SandboxEvent>) {
    const e = ev as { type: string; data?: Record<string, unknown> }
    if (e.type === 'result') {
      finalText = String(e.data?.finalText ?? '')
      const usage = e.data?.tokenUsage as
        | { inputTokens?: number; outputTokens?: number }
        | undefined
      tokensIn = usage?.inputTokens ?? 0
      tokensOut = usage?.outputTokens ?? 0
    }
  }
  return { finalText, tokensIn, tokensOut }
}

describe('bridgeExecutor over node:http', () => {
  afterEach(() => {
    bridgeHttpHandler = null
    lastBridgeUrl = null
  })

  it('streams a completion and meters the reported usage', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('done from bridge', 7, 11)
    }
    const out = await runOnce(bridgeClient('kimi-code/kimi-k2.6'), 'compute the return')
    expect(out.finalText).toBe('done from bridge')
    expect(out.tokensIn).toBe(7)
    expect(out.tokensOut).toBe(11)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.model).toBe('kimi-code/kimi-k2.6')
    expect(seen[0]?.stream).toBe(true)
    const msgs = seen[0]?.messages as Array<{ role: string; content: string }>
    expect(msgs.some((m) => m.content.includes('compute the return'))).toBe(true)
    // The bridge base URL is turned into the endpoint EXACTLY once — no doubled
    // `/v1/chat/completions` from a caller that already built the full path.
    expect(lastBridgeUrl?.pathname).toBe('/v1/chat/completions')
    expect(lastBridgeUrl?.host).toBe('bridge.test')
  })

  it('a per-create backend override targets the cell model as harness/model', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    const client = bridgeClient('kimi-code/default')
    await runOnce(client, 'go', { type: 'opencode', model: { model: 'glm-4.6' } })
    expect(seen[0]?.model).toBe('opencode/glm-4.6')
  })

  it('an already-prefixed override model passes through unchanged', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    await runOnce(bridgeClient('kimi-code/default'), 'go', {
      type: 'opencode',
      model: { model: 'opencode/glm-4.6' },
    })
    expect(seen[0]?.model).toBe('opencode/glm-4.6')
  })

  it('uses the seam model verbatim when no per-create override is given', async () => {
    const seen: Array<Record<string, unknown>> = []
    bridgeHttpHandler = (payload) => {
      seen.push(payload)
      return sse('ok', 1, 2)
    }
    await runOnce(bridgeClient('kimi-code/kimi-k2.6'), 'go')
    expect(seen[0]?.model).toBe('kimi-code/kimi-k2.6')
  })

  it('throws on a non-2xx bridge response', async () => {
    bridgeHttpHandler = () => {
      const s = new PassThrough() as PassThrough & { statusCode?: number }
      s.statusCode = 500
      s.end('boom')
      return s
    }
    await expect(runOnce(bridgeClient('kimi-code/k2'), 'go')).rejects.toThrow(/bridge 500/)
  })
})
