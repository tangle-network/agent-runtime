import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routerBrain } from '../../src/runtime/router-client'

// `routerBrain` is a same-module thin wrapper over `routerChatWithTools`, which speaks raw HTTP.
// The offline seam is therefore `fetch` (the real boundary) — stub it to drive the whole
// brain → routerChatWithTools → fetch path with no creds and no network. `routerBrain` does no
// message translation: the canonical loop already hands it OpenAI messages + ToolSpec tools, so
// it forwards both verbatim and returns `routerChatWithTools`'s parsed result.

// A priced model so `routerChatWithTools` derives a real per-turn cost the brain forwards.
const cfg = { routerBaseUrl: 'http://router.test/v1', routerKey: 'k', model: 'deepseek-v4-flash' }

let fetchMock: ReturnType<typeof vi.fn>

/** Stub `fetch` to return one OpenAI chat-completion body, and capture the request it received. */
function stubRouter(body: unknown): void {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }))
  vi.stubGlobal('fetch', fetchMock)
}

describe('routerBrain — the production ToolLoopChat seam over the router tool-calling', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('forwards the config max_tokens so a reasoning model is not truncated mid-thought', async () => {
    stubRouter({ choices: [{ message: { content: 'ok' } }] })
    // A thinking model spends this ceiling on hidden reasoning BEFORE any visible token, so a
    // caller driving one must be able to raise it above the 8192 default.
    await routerBrain({ ...cfg, maxTokens: 32_000 })([{ role: 'user', content: 'hi' }], [])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(32_000)
  })

  it('sends no ceiling when the config names none, leaving the provider default', async () => {
    stubRouter({ choices: [{ message: { content: 'ok' } }] })
    await routerBrain(cfg)([{ role: 'user', content: 'hi' }], [])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    // The tool-calling path omits max_tokens entirely rather than defaulting it, so the
    // provider's own ceiling governs — which is what truncated a reasoning model in production.
    expect('max_tokens' in body).toBe(false)
  })

  it('forwards the conversation + tools to the router (no translation) and parses tool calls back', async () => {
    stubRouter({
      choices: [
        {
          message: {
            content: 'reasoning',
            tool_calls: [
              { id: 'c1', function: { name: 'spawn_agent', arguments: '{"task":"go","n":3}' } },
            ],
          },
        },
      ],
    })

    const messages = [
      { role: 'system', content: 'SYSTEM PROMPT' },
      { role: 'user', content: 'do it' },
    ]
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'spawn_agent',
          description: 'spawn a worker',
          parameters: { type: 'object' },
        },
      },
    ]
    const result = await routerBrain(cfg)(messages, tools)

    // The request body carries the messages + tools UNCHANGED (no system-prepend, no
    // DriverMessage→OpenAI mapping) plus the default driver temperature + auto tool choice.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://router.test/v1/chat/completions')
    const sent = JSON.parse((init as { body: string }).body)
    expect(sent.messages).toEqual(messages)
    expect(sent.tools).toEqual(tools)
    expect(sent.temperature).toBe(0.4)
    expect(sent.tool_choice).toBe('auto')

    // tool_calls carry RAW JSON argument strings (the loop JSON.parses them itself).
    expect(result.content).toBe('reasoning')
    expect(result.toolCalls).toEqual([
      { id: 'c1', name: 'spawn_agent', arguments: '{"task":"go","n":3}' },
    ])
  })

  it('honors a custom temperature', async () => {
    stubRouter({ choices: [{ message: { content: 'x' } }] })
    await routerBrain(cfg, { temperature: 0.1 })([], [])
    const init = fetchMock.mock.calls[0]![1] as { body: string }
    const sent = JSON.parse(init.body)
    expect(sent.temperature).toBe(0.1)
    expect(sent.tool_choice).toBe('auto')
  })

  it('forwards the router usage + cost so the driver can meter its inference', async () => {
    stubRouter({
      choices: [{ message: { content: 'x', tool_calls: [] } }],
      usage: { prompt_tokens: 120, completion_tokens: 45 },
    })
    const result = await routerBrain(cfg)([], [])
    expect(result.usage).toEqual({ input: 120, output: 45 })
    // A priced model yields a real per-turn cost, forwarded for the driver's conserved-pool metering.
    expect(result.costUsd).toBeGreaterThan(0)
  })

  it('omits usage/cost when the router reports none (a scripted/offline turn meters nothing)', async () => {
    stubRouter({ choices: [{ message: { content: 'x', tool_calls: [] } }] })
    const result = await routerBrain(cfg)([], [])
    expect(result.usage).toBeUndefined()
    expect(result.costUsd).toBeUndefined()
  })
})

// The deleted `routerDriverChat` had cases for DriverMessage→OpenAI translation, malformed-arg
// degradation, content-omission, and a `typeof === 'number'` costUsd-0 guard. `routerBrain` does
// none of that — it forwards `routerChatWithTools`'s parsed result whole — so those cases are gone.
