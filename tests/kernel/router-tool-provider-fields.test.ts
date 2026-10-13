import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  routerChatWithTools,
  streamRouterChatWithTools,
  type ToolSpec,
} from '../../src/runtime/router-client'
import { runBrainLoop } from '../../src/runtime/tool-loop'

const tool: ToolSpec = {
  type: 'function',
  function: {
    name: 'echo',
    parameters: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] },
  },
}
const cfg = { routerBaseUrl: 'http://router.test/v1', routerKey: 'offline', model: 'offline-model' }
const usage = { prompt_tokens: 7, completion_tokens: 3, cost: 0 }
const calls = [1, 2].map((value) => ({
  id: `call-${value}`,
  type: 'function',
  function: { name: 'echo', arguments: JSON.stringify({ value }) },
  extra_content: { google: { thought_signature: `signature-${value}` } },
  provider_tag: `tag-${value}`,
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('provider tool-call field edge cases', () => {
  // The packed-consumer fixture owns complete executor/supervisor HTTP replay. This
  // controlled response fixes reader chunk boundaries that real TCP may coalesce.
  it('assembles byte-split interleaved SSE and replaces complete provider fields', async () => {
    const deltas = [
      { content: null },
      ...[1, 0].map((index) => ({
        tool_calls: [
          {
            index,
            id: calls[index]!.id,
            type: 'function',
            function: { name: 'echo', arguments: '{"value":' },
            provider_tag: calls[index]!.provider_tag,
            extra_content: { google: { thought_signature: 'replaced' }, stale: true },
          },
        ],
      })),
      ...[0, 1].map((index) => ({
        tool_calls: [
          {
            index,
            function: { arguments: `${index + 1}}` },
            extra_content: calls[index]!.extra_content,
          },
        ],
      })),
    ]
    const wire = `${[
      ...deltas.map((delta) => ({ model: cfg.model, choices: [{ delta }] })),
      { model: cfg.model, choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join('')}data: [DONE]\n\n`
    const bytes = new TextEncoder().encode(wire)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                for (let offset = 0; offset < bytes.length; offset += 17) {
                  controller.enqueue(bytes.slice(offset, offset + 17))
                }
                controller.close()
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    )
    const result = await streamRouterChatWithTools(cfg, [{ role: 'user', content: 'go' }], [tool])
    expect(result.toolCalls).toEqual(
      calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        providerFields: { extra_content: call.extra_content, provider_tag: call.provider_tag },
      })),
    )
  })

  it('keeps canonical call identity and function authoritative over supplied extensions', async () => {
    const messagesSeen: Array<ReadonlyArray<Record<string, unknown>>> = []
    await runBrainLoop({
      chat: async (messages) => {
        messagesSeen.push(structuredClone(messages))
        return messagesSeen.length === 1
          ? {
              content: '',
              toolCalls: [
                {
                  id: 'canonical',
                  name: 'echo',
                  arguments: '{"value":1}',
                  providerFields: {
                    id: 'substituted',
                    type: 'other',
                    function: { name: 'forbidden', arguments: '{}' },
                    extra_content: calls[0]!.extra_content,
                  },
                },
              ],
            }
          : { content: 'done', toolCalls: [] }
      },
      tools: [tool],
      execute: async () => 'ok',
      initialMessages: [{ role: 'user', content: 'go' }],
    })
    expect(messagesSeen[1]!.find((message) => message.role === 'assistant')?.tool_calls).toEqual([
      {
        id: 'canonical',
        type: 'function',
        function: { name: 'echo', arguments: '{"value":1}' },
        extra_content: calls[0]!.extra_content,
      },
    ])
  })

  it('leaves an ordinary call without extensions in its existing result shape', async () => {
    const result = await routerChatWithTools(
      {
        ...cfg,
        complete: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'ordinary',
                    type: 'function',
                    function: { name: 'echo', arguments: '{}' },
                  },
                ],
              },
            },
          ],
          usage,
        }),
      },
      [{ role: 'user', content: 'go' }],
      [tool],
    )
    expect(result.toolCalls).toEqual([{ id: 'ordinary', name: 'echo', arguments: '{}' }])
  })
})
