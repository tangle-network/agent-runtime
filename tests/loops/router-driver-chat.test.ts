import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriverMessage } from '../../src/runtime/supervise/coordination-driver'

// Mock the router client so the adapter is tested OFFLINE — no fetch, no creds. `vi.hoisted` lets
// the (hoisted) mock factory reference the spy we assert on.
const { routerMock } = vi.hoisted(() => ({ routerMock: vi.fn() }))
vi.mock('../../src/runtime/router-client', () => ({ routerChatWithTools: routerMock }))

import { routerDriverChat } from '../../src/runtime/supervise/router-driver-chat'

const cfg = { routerBaseUrl: 'http://router.test', routerKey: 'k', model: 'm' }

describe('routerDriverChat — the production DriverChat seam over the router tool-calling', () => {
  beforeEach(() => routerMock.mockReset())

  it('shapes system+messages+tools for the router and folds tool calls back with parsed args', async () => {
    routerMock.mockResolvedValue({
      content: 'reasoning',
      toolCalls: [{ id: 'c1', name: 'spawn_worker', arguments: '{"task":"go","n":3}' }],
    })

    const turn = await routerDriverChat(cfg).next({
      system: 'SYSTEM PROMPT',
      messages: [{ role: 'user', content: 'do it' }],
      tools: [
        { name: 'spawn_worker', description: 'spawn a worker', parameters: { type: 'object' } },
      ],
    })

    // The router saw: system prepended, the user message, and the tool as an OpenAI function tool.
    expect(routerMock).toHaveBeenCalledTimes(1)
    const [passedCfg, messages, tools, opts] = routerMock.mock.calls[0]!
    expect(passedCfg).toBe(cfg)
    expect(messages).toEqual([
      { role: 'system', content: 'SYSTEM PROMPT' },
      { role: 'user', content: 'do it' },
    ])
    expect(tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'spawn_worker',
          description: 'spawn a worker',
          parameters: { type: 'object' },
        },
      },
    ])
    // Default driver temperature + auto tool choice so the model decides each turn.
    expect(opts).toEqual({ temperature: 0.4, toolChoice: 'auto' })

    // The DriverTurn carries the assistant text and the tool call with PARSED arguments.
    expect(turn).toEqual({
      content: 'reasoning',
      toolCalls: [{ id: 'c1', name: 'spawn_worker', arguments: { task: 'go', n: 3 } }],
    })
  })

  it('round-trips assistant-with-tool_calls and tool-result messages into OpenAI shape', async () => {
    routerMock.mockResolvedValue({ content: null, toolCalls: [] })

    const messages: DriverMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'spawn_worker', arguments: { task: 'x' } }],
      },
      { role: 'tool', toolCallId: 'c1', name: 'spawn_worker', content: '{"workerId":"w0"}' },
    ]
    await routerDriverChat(cfg).next({ system: 'S', messages, tools: [] })

    const [, oaMessages] = routerMock.mock.calls[0]!
    expect(oaMessages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'spawn_worker', arguments: '{"task":"x"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"workerId":"w0"}' },
    ])
  })

  it('degrades malformed tool-call arguments to {} (fail-soft on the model, never throw) and omits null content', async () => {
    routerMock.mockResolvedValue({
      content: null,
      toolCalls: [{ id: 'c2', name: 'broken', arguments: 'not valid json' }],
    })

    const turn = await routerDriverChat(cfg).next({ system: 'S', messages: [], tools: [] })
    expect(turn.content).toBeUndefined()
    expect(turn.toolCalls).toEqual([{ id: 'c2', name: 'broken', arguments: {} }])
  })

  it('omits empty-string content (truthy check), not just null', async () => {
    routerMock.mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'c1', name: 'await_next', arguments: '{}' }],
    })
    const turn = await routerDriverChat(cfg).next({ system: 'S', messages: [], tools: [] })
    expect(turn.content).toBeUndefined()
    expect(turn.toolCalls).toEqual([{ id: 'c1', name: 'await_next', arguments: {} }])
  })

  it('honors a custom temperature', async () => {
    routerMock.mockResolvedValue({ content: 'x', toolCalls: [] })
    await routerDriverChat(cfg, { temperature: 0.1 }).next({ system: 'S', messages: [], tools: [] })
    const [, , , opts] = routerMock.mock.calls[0]!
    expect(opts).toEqual({ temperature: 0.1, toolChoice: 'auto' })
  })

  it('forwards the router usage + costUsd so the driver can meter its inference', async () => {
    routerMock.mockResolvedValue({
      content: 'x',
      toolCalls: [],
      usage: { input: 120, output: 45 },
      costUsd: 0.013,
    })
    const turn = await routerDriverChat(cfg).next({ system: 'S', messages: [], tools: [] })
    expect(turn.usage).toEqual({ input: 120, output: 45 })
    expect(turn.costUsd).toBe(0.013)
  })

  it('omits usage/costUsd when the router reports none (a scripted/offline turn meters nothing)', async () => {
    routerMock.mockResolvedValue({ content: 'x', toolCalls: [] })
    const turn = await routerDriverChat(cfg).next({ system: 'S', messages: [], tools: [] })
    expect(turn.usage).toBeUndefined()
    expect(turn.costUsd).toBeUndefined()
  })
})
