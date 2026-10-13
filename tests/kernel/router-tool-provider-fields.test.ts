import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecutor, streamAgentTurn } from '../../src/runtime'
import { routerBrain, routerChatWithTools, type ToolSpec } from '../../src/runtime/router-client'
import { supervise } from '../../src/runtime/supervise/supervise'
import { runBrainLoop } from '../../src/runtime/tool-loop'
import { runtimeToolDeclarations } from './test-agent-profile'

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

/** Exercise the actual HTTP parsing boundary. Every response gets a new readable body, and SSE
 * frames are split inside JSON strings rather than only at event boundaries. */
function stubTurns(stream: boolean, content: '' | null): Record<string, unknown>[] {
  const requests: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      const first = requests.length === 1
      if (!stream) {
        return new Response(
          JSON.stringify({
            model: cfg.model,
            choices: [{ message: first ? { content, tool_calls: calls } : { content: 'done' } }],
            usage,
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      const chunks = first
        ? [
            { choices: [{ delta: { content } }] },
            // Calls arrive interleaved and the second index arrives first.
            ...[1, 0].map((index) => ({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index,
                        id: calls[index]!.id,
                        type: 'function',
                        function: { name: 'echo', arguments: '{"value":' },
                        provider_tag: calls[index]!.provider_tag,
                      },
                    ],
                  },
                },
              ],
            })),
            ...[0, 1].map((index) => ({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index,
                        function: { arguments: `${index + 1}}` },
                        extra_content: calls[index]!.extra_content,
                      },
                    ],
                  },
                },
              ],
            })),
          ]
        : [{ choices: [{ delta: { content: 'done' } }] }]
      const wire = `${[
        ...chunks,
        { choices: [{ delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }], usage },
      ]
        .map((chunk) => `data: ${JSON.stringify({ model: cfg.model, ...chunk })}\n\n`)
        .join('')}data: [DONE]\n\n`
      const bytes = new TextEncoder().encode(wire)
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let start = 0; start < bytes.length; start += 17) {
              controller.enqueue(bytes.slice(start, start + 17))
            }
            controller.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    }),
  )
  return requests
}

describe('provider tool-call fields through maintained Runtime loops', () => {
  for (const path of ['executor', 'brain', 'supervisor'] as const) {
    for (const stream of [false, true]) {
      it.each(['', null] as const)(
        `${path} replays distinct signatures over ${stream ? 'split SSE' : 'buffered HTTP'} with content=%s`,
        async (content) => {
          const requests = stubTurns(stream, content)
          const execute = vi.fn(async (_name: string, args: Record<string, unknown>) => args)
          if (path === 'executor') {
            const profile: AgentProfile = {
              name: 'provider-fields',
              harness: 'cli-base',
              model: {
                provider: 'tangle-router',
                default: cfg.model,
                metadata: { stream, maxTurns: 3 },
              },
              tools: { echo: true },
            }
            const factory = createExecutor({
              backend: 'router-tools',
              routerBaseUrl: cfg.routerBaseUrl,
              routerKey: cfg.routerKey,
              tools: [tool],
              executeToolCall: async (name, args) => JSON.stringify(await execute(name, args)),
            })
            for await (const _event of streamAgentTurn(
              { kind: 'executor', factory, profile },
              { prompt: 'Echo 1 and 2, then finish.' },
            )) {
              // Drain the public execution path, including the terminal outcome.
            }
          } else if (path === 'supervisor') {
            await supervise(
              {
                name: 'provider-fields-root',
                harness: 'cli-base',
                model: {
                  provider: 'tangle-router',
                  default: cfg.model,
                  metadata: { stream, maxTurns: 3 },
                },
                tools: runtimeToolDeclarations('echo'),
              },
              'Echo 1 and 2, then finish.',
              {
                budget: { maxIterations: 20, maxTokens: 10_000, deadlineMs: 5_000 },
                router: { routerBaseUrl: cfg.routerBaseUrl, routerKey: cfg.routerKey },
                backend: {
                  backend: 'router',
                  routerBaseUrl: cfg.routerBaseUrl,
                  routerKey: cfg.routerKey,
                },
                extraTools: [
                  {
                    name: 'echo',
                    parameters: { type: 'object', properties: { value: { type: 'integer' } } },
                  },
                ],
                executeExtraTool: async (name, args) => JSON.stringify(await execute(name, args)),
              },
            )
          } else {
            const result = await runBrainLoop({
              chat: routerBrain({ ...cfg, stream }),
              tools: [tool],
              execute,
              initialMessages: [{ role: 'user', content: 'Echo 1 and 2, then finish.' }],
              maxTurns: 3,
            })
            expect(result.final).toBe('done')
            expect(result.toolCalls).toBe(2)
          }
          expect(requests).toHaveLength(2)
          expect(requests[0]?.stream ?? false).toBe(stream)
          expect(execute.mock.calls.map(([name, args]) => [name, args])).toEqual([
            ['echo', { value: 1 }],
            ['echo', { value: 2 }],
          ])
          const messages = requests[1]!.messages as Array<Record<string, unknown>>
          const assistant = messages.find((message) => message.role === 'assistant')
          expect(assistant).toMatchObject({ content: '', tool_calls: calls })
          expect(assistant?.tool_calls).toEqual(calls)
          expect(
            messages
              .filter((message) => message.role === 'tool')
              .map((message) => message.tool_call_id),
          ).toEqual(['call-1', 'call-2'])
          for (const call of assistant!.tool_calls as Array<Record<string, unknown>>) {
            expect(call).not.toHaveProperty('index')
            expect(call).not.toHaveProperty('providerFields')
          }
        },
      )
    }
  }

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
