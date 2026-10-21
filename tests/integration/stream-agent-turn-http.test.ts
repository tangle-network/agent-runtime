import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { collectAgentTurn, createExecutor, streamAgentTurn } from '../../src/runtime'

function bounded<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

it('settles an exact HTTP SSE turn with observed usage and cancels an unfinished response', async () => {
  const profile: AgentProfile = {
    name: 'stream-turn-http-proof',
    harness: 'cli-base',
    model: {
      provider: 'tangle-router',
      default: 'turn-proof-model',
      metadata: { stream: true, retry: { maxAttempts: 1, requestTimeoutMs: 0 } },
    },
    tools: { report: true },
  }
  const requests: Array<{ body: Record<string, unknown>; callId: string | undefined }> = []
  let receivedUnfinished!: () => void
  const unfinishedStarted = new Promise<void>((resolve) => {
    receivedUnfinished = resolve
  })
  let closedUnfinished!: () => void
  const unfinishedClosed = new Promise<void>((resolve) => {
    closedUnfinished = resolve
  })
  const serverErrors: unknown[] = []
  const controller = new AbortController()
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/chat/completions') {
        response.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      requests.push({
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        callId: request.headers['idempotency-key'] as string | undefined,
      })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if (requests.length === 2) {
        response.once('close', closedUnfinished)
        response.write(
          `data: ${JSON.stringify({ model: 'turn-proof-model', choices: [{ delta: { content: 'unfinished' } }] })}\n\n`,
        )
        receivedUnfinished()
        return
      }
      const frames = [
        {
          model: 'turn-proof-model',
          choices: [
            {
              delta: {
                content: 'hel',
                tool_calls: [
                  { index: 0, id: 'report-1', function: { name: 'report', arguments: '{"ok":' } },
                ],
              },
            },
          ],
        },
        {
          model: 'turn-proof-model',
          choices: [
            {
              delta: {
                content: 'lo',
                tool_calls: [{ index: 0, function: { arguments: 'true}' } }],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
        {
          model: 'turn-proof-model',
          choices: [],
          usage: {
            prompt_tokens: 7,
            completion_tokens: 3,
            prompt_tokens_details: { cached_tokens: 2 },
            completion_tokens_details: { reasoning_tokens: 1 },
            cost: 0.01,
          },
        },
      ]
      for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`)
      response.end('data: [DONE]\n\n')
    })().catch((error) => {
      serverErrors.push(error)
      response.destroy(error instanceof Error ? error : new Error(String(error)))
    })
  })
  try {
    await bounded(
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      }),
      1_000,
      'loopback server startup',
    )
    const { port } = server.address() as AddressInfo
    const factory = createExecutor({
      backend: 'router',
      routerBaseUrl: `http://127.0.0.1:${port}`,
      routerKey: 'loopback-only',
      tools: [{ type: 'function', function: { name: 'report', parameters: { type: 'object' } } }],
    })
    const completed = await bounded(
      collectAgentTurn(
        streamAgentTurn(
          { kind: 'executor', factory, profile },
          { prompt: 'report the result' },
          { callId: 'completed-turn', correlationId: 'loopback-proof', timeoutMs: 2_000 },
        ),
      ),
      3_000,
      'completed public turn',
    )
    expect(completed).toMatchObject({
      status: 'completed',
      finalText: 'hello',
      usage: {
        input: 7,
        output: 3,
        costUsd: 0.01,
        model: 'turn-proof-model',
        reasoningTokens: 1,
        promptCache: { readTokens: 2 },
      },
      transportAttempts: 1,
      toolCalls: [{ id: 'report-1', name: 'report', arguments: '{"ok":true}' }],
    })
    expect(completed.usage.tokensKnown).toBeUndefined()
    expect(completed.usage.usdKnown).toBeUndefined()
    expect(completed.events.map((event) => event.type)).toEqual([
      'backend_start',
      'llm_call',
      'tool_call',
      'artifact',
      'final',
    ])
    const startEvent = completed.events[0]
    const finalEvent = completed.events.at(-1)
    if (startEvent?.type !== 'backend_start' || finalEvent?.type !== 'final') {
      throw new Error('the public turn lost its start/final envelope')
    }
    const startMetadata = startEvent.metadata
    const finalMetadata = finalEvent.metadata
    expect(startMetadata?.identity).toMatchObject({
      profileDigest: expect.any(String),
      taskDigest: expect.any(String),
      correlation: { callId: 'completed-turn', correlationId: 'loopback-proof' },
    })
    expect(finalMetadata?.identity).toEqual(startMetadata?.identity)
    expect(finalMetadata).toMatchObject({
      materialization: { status: 'known' },
      executionBindings: [{ status: 'known' }],
    })
    expect(requests[0]).toMatchObject({
      callId: 'completed-turn',
      body: {
        model: 'turn-proof-model',
        stream: true,
        stream_options: { include_usage: true },
      },
    })

    const interrupted = bounded(
      collectAgentTurn(
        streamAgentTurn(
          { kind: 'executor', factory, profile },
          { prompt: 'keep this response open' },
          { signal: controller.signal, callId: 'interrupted-turn', timeoutMs: 2_000 },
        ),
      ),
      3_000,
      'cancelled public turn',
    )
    await bounded(unfinishedStarted, 1_000, 'unfinished HTTP response')
    controller.abort(new Error('stop live turn'))
    const aborted = await interrupted
    expect(aborted.status).toBe('aborted')
    expect(aborted.events.filter((event) => event.type === 'final')).toHaveLength(1)
    expect(aborted.events.at(-1)).toMatchObject({ type: 'final', status: 'aborted' })
    expect(aborted.events.some((event) => event.type === 'backend_error')).toBe(true)
    expect(aborted.usage.tokensKnown).toBe(false)
    expect(aborted.usage.usdKnown).toBe(false)
    await bounded(unfinishedClosed, 500, 'cancelled response socket closure')
    expect(requests).toHaveLength(2)
    expect(requests[1]?.callId).toBe('interrupted-turn')
    expect(serverErrors).toEqual([])
  } finally {
    controller.abort(new Error('loopback fixture cleanup'))
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    server.closeAllConnections()
    await bounded(closed, 500, 'loopback server shutdown')
  }
}, 8_000)
