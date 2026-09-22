import { createCliBridgeProvider } from '@tangle-network/agent-provider-cli-bridge'
import { describe, expect, it, vi } from 'vitest'
import { environmentExecutor } from '../../src/runtime/supervise/runtime'
import type { AgentSpec, ExecutorResult } from '../../src/runtime/supervise/types'

const spec: AgentSpec = {
  profile: {
    name: 'bridge-worker',
    prompt: { systemPrompt: 'Answer exactly.' },
  },
  harness: null,
}

describe('CLI Bridge provider execution', () => {
  it('runs CLI Bridge through the provider backend and preserves unknown dollar cost', async () => {
    const requests: Array<{ url: string; init?: RequestInit; body: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        init,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })
      const payload = [
        'data: {"choices":[{"delta":{"content":"done"}}]}',
        '',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n')
      return new Response(payload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })
    const provider = createCliBridgeProvider({
      baseUrl: 'http://bridge.test/',
      bearerToken: 'secret',
      defaultModel: 'opencode/glm-5',
      fetch: fetchImpl as typeof fetch,
    })
    const executor = environmentExecutor(provider, {
      provider,
      environment: { workspace: { cwd: '/repo' } },
    })(spec, { signal: new AbortController().signal, seams: {} })

    const result = (await executor.execute(
      'solve it',
      new AbortController().signal,
    )) as ExecutorResult<unknown>

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('http://bridge.test/v1/chat/completions')
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer secret',
    })
    expect(requests[0]?.body).toMatchObject({
      model: 'opencode/glm-5',
      stream: true,
      cwd: '/repo',
      messages: [
        { role: 'system', content: 'Answer exactly.' },
        { role: 'user', content: 'solve it' },
      ],
    })
    expect(result.out).toMatchObject({
      content: 'done',
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'result',
          data: expect.objectContaining({ finalText: 'done' }),
        }),
      ]),
    })
    expect(result.spent).toMatchObject({
      iterations: 1,
      tokens: { input: 0, output: 0 },
      usd: 0,
      usdKnown: false,
    })
  })
})
