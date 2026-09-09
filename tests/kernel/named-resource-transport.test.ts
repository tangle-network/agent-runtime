import { afterEach, expect, it, vi } from 'vitest'
import {
  routerChatWithTools,
  routerChatWithUsage,
  streamRouterChatWithTools,
} from '../../src/runtime/router-client'
import {
  routerInlineExecutor,
  routerToolsInlineExecutor,
} from '../../src/runtime/supervise/runtime'
import { testAgentProfile } from './test-agent-profile'

const resources = {
  compute: { unit: 'millisecond', amount: 2, known: true },
  transfer: { unit: 'byte', amount: 0, known: true },
}
const config = {
  routerBaseUrl: 'http://unused.invalid/v1',
  routerKey: 'offline',
  model: 'offline-test-model',
}
afterEach(() => vi.unstubAllGlobals())

it('preserves resource-only scalar receipts and rejects malformed measurements', async () => {
  const complete = async () => ({
    choices: [{ message: { content: 'done' } }],
    usage: { resources },
  })
  expect((await routerChatWithUsage({ ...config, complete }, [])).resources).toEqual(resources)
  await expect(
    routerChatWithUsage(
      {
        ...config,
        complete: async () => ({
          choices: [{ message: { content: 'done' } }],
          usage: { resources: { compute: { unit: 'millisecond', amount: -1, known: true } } },
        }),
      },
      [],
    ),
  ).rejects.toThrow('resource spend')
})

it('normalizes the same receipt from a terminal SSE usage frame', async () => {
  const frame = JSON.stringify({
    choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, resources },
  })
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(`data: ${frame}\n\ndata: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      }),
  )
  expect((await streamRouterChatWithTools(config, [], [])).resources).toEqual(resources)
})

it('preserves scalar executor resource totals', async () => {
  const executor = routerInlineExecutor(
    { profile: testAgentProfile('leaf', { harness: 'cli-base' }), harness: null },
    {
      signal: new AbortController().signal,
      seams: {
        router: {
          ...config,
          complete: async () => ({
            model: config.model,
            choices: [{ message: { content: 'done' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, resources },
          }),
        },
      },
    },
  )
  const result = await executor.execute('task', new AbortController().signal)
  if (!('spent' in result)) throw new Error('expected terminal executor result')
  expect(result.spent.resources).toEqual(resources)
  await executor.teardown()
})

it.each(['complete', 'missing-first', 'missing-last'])(
  'sums inline tool turns and preserves omissions: complete=%s',
  async (mode) => {
    const completeReceipt = mode === 'complete'
    let turn = 0
    const executor = routerToolsInlineExecutor(
      {
        profile: testAgentProfile('leaf', {
          harness: 'cli-base',
          tools: { tick: true },
          model: { metadata: { maxTurns: 2 } },
        }),
        harness: null,
      },
      {
        signal: new AbortController().signal,
        seams: {
          'router-tools': {
            ...config,
            tools: [
              { type: 'function', function: { name: 'tick', parameters: { type: 'object' } } },
            ],
            executeToolCall: async () => 'done',
            complete: async () => {
              const first = turn++ === 0
              return {
                model: config.model,
                choices: [
                  {
                    message: {
                      content: 'done',
                      tool_calls: first
                        ? [{ id: 'tick', function: { name: 'tick', arguments: '{}' } }]
                        : [],
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  ...(completeReceipt || (mode === 'missing-first' ? !first : first)
                    ? { resources }
                    : {}),
                },
              }
            },
          },
        },
      },
    )
    const result = await executor.execute('task', new AbortController().signal)
    if (!('spent' in result)) throw new Error('expected terminal executor result')
    expect(turn).toBe(2)
    expect(result.spent.resources?.compute).toEqual({
      unit: 'millisecond',
      amount: completeReceipt ? 4 : 2,
      known: completeReceipt,
    })
    await executor.teardown()
  },
)

it.each(['scalar', 'tools', 'stream'] as const)(
  'marks retried %s resource totals unknown while preserving the measured subtotal',
  async (mode) => {
    let attempts = 0
    const receipt = {
      model: config.model,
      choices: [{ message: { content: 'done' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, resources },
    }
    const retry = { maxAttempts: 2, initialBackoffMs: 0, maxBackoffMs: 0, jitter: 0 }
    const complete = async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed after dispatch')
      return receipt
    }
    vi.stubGlobal('fetch', async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed after dispatch')
      const frame = { ...receipt, choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }
      return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      })
    })
    const result =
      mode === 'scalar'
        ? await routerChatWithUsage({ ...config, retry, complete }, [])
        : mode === 'tools'
          ? await routerChatWithTools({ ...config, retry, complete }, [], [])
          : await streamRouterChatWithTools({ ...config, retry }, [], [])
    expect(attempts).toBe(2)
    expect(result.transportAttempts).toBe(2)
    expect(result.resources).toEqual({
      compute: { ...resources.compute, known: false },
      transfer: { ...resources.transfer, known: false },
    })
    expect(resources.compute.known).toBe(true)
    expect(resources.transfer.known).toBe(true)
  },
)
