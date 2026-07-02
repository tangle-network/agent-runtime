import { afterEach, describe, expect, it, vi } from 'vitest'
import { routerChatWithTools, routerChatWithUsage } from './router-client'

// The completion-transport injection seam (`RouterConfig.complete`): when present, the chat
// clients call it with the OpenAI request body and parse what it returns, INSTEAD of `fetch`-ing
// the router. The offline-benchmark path — a deterministic in-process responder, no network.

afterEach(() => vi.unstubAllGlobals())

describe('RouterConfig.complete — the injected completion transport', () => {
  it('routerChatWithUsage uses `complete` and never touches fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const complete = vi.fn(async (body: Record<string, unknown>) => {
      // The body is the OpenAI request the client built — assert it threaded the model + messages.
      expect(body.model).toBe('deepseek-v4-flash')
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
      return {
        choices: [{ message: { content: 'pong' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }
    })
    const res = await routerChatWithUsage(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'deepseek-v4-flash',
        complete,
      },
      [{ role: 'user', content: 'hi' }],
    )
    expect(res.content).toBe('pong')
    expect(res.usage).toEqual({ input: 7, output: 3 })
    expect(complete).toHaveBeenCalledOnce()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('routerChatWithTools uses `complete` (with tool_calls) and never touches fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const complete = vi.fn(async (body: Record<string, unknown>) => {
      expect(body.tools).toHaveLength(1)
      return {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'c1', function: { name: 'increment', arguments: '{}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }
    })
    const res = await routerChatWithTools(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'deepseek-v4-flash',
        complete,
      },
      [{ role: 'user', content: 'go' }],
      [{ type: 'function', function: { name: 'increment', parameters: { type: 'object' } } }],
    )
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'increment', arguments: '{}' }])
    expect(res.usage).toEqual({ input: 5, output: 2 })
    expect(complete).toHaveBeenCalledOnce()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('without `complete`, the fetch path runs unchanged (the live router stays the default)', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'live' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      text: async () => '',
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const res = await routerChatWithUsage(
      { routerBaseUrl: 'http://router.test/v1', routerKey: 'k', model: 'deepseek-v4-flash' },
      [{ role: 'user', content: 'hi' }],
    )
    expect(res.content).toBe('live')
    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})

describe('reasoning-aware parsing and reasoning_effort forwarding', () => {
  const cfg = (complete: (body: Record<string, unknown>) => Promise<unknown>) => ({
    routerBaseUrl: 'http://router.test/v1',
    routerKey: 'k',
    model: 'qwen/qwen3-32b',
    complete,
  })

  it('forwards reasoningEffort as reasoning_effort, omits it when unset', async () => {
    const seen: Record<string, unknown>[] = []
    const complete = async (body: Record<string, unknown>) => {
      seen.push(body)
      return { choices: [{ message: { content: 'ABSTAIN' } }] }
    }
    await routerChatWithUsage(cfg(complete), [{ role: 'user', content: 'route' }], {
      reasoningEffort: 'none',
    })
    await routerChatWithUsage(cfg(complete), [{ role: 'user', content: 'route' }])
    expect(seen[0]?.reasoning_effort).toBe('none')
    expect('reasoning_effort' in (seen[1] ?? {})).toBe(false)
  })

  it('splits OpenRouter-style separate reasoning field from content', async () => {
    const complete = async () => ({
      choices: [{ message: { content: 'ABSTAIN', reasoning: 'taskFamilyMatches is false...' } }],
    })
    const res = await routerChatWithUsage(cfg(complete), [{ role: 'user', content: 'route' }])
    expect(res.content).toBe('ABSTAIN')
    expect(res.reasoning).toBe('taskFamilyMatches is false...')
  })

  it('strips Groq-style inline <think> block out of content into reasoning', async () => {
    // Before the split, a single-token parser reading content saw the reasoning prose
    // (which quotes both option tokens) and misread the decision — the same model
    // looked broken on Groq and fine on OpenRouter.
    const complete = async () => ({
      choices: [
        {
          message: {
            content:
              '<think>\nShould I EXECUTE_AUDIT? taskFamilyMatches is false, so no.\n</think>\n\nABSTAIN',
          },
        },
      ],
    })
    const res = await routerChatWithUsage(cfg(complete), [{ role: 'user', content: 'route' }])
    expect(res.content).toBe('ABSTAIN')
    expect(res.reasoning).toContain('taskFamilyMatches is false')
  })

  it('unclosed <think> (budget exhausted mid-thought) yields empty content, all reasoning', async () => {
    const complete = async () => ({
      choices: [{ message: { content: '<think>\nstill thinking about the features' } }],
    })
    const res = await routerChatWithUsage(cfg(complete), [{ role: 'user', content: 'route' }])
    expect(res.content).toBe('')
    expect(res.reasoning).toContain('still thinking')
  })

  it('reasoning_content (DeepSeek/Kimi field name) is honored', async () => {
    const complete = async () => ({
      choices: [{ message: { content: 'EXECUTE_AUDIT', reasoning_content: 'all four true' } }],
    })
    const res = await routerChatWithUsage(cfg(complete), [{ role: 'user', content: 'route' }])
    expect(res.content).toBe('EXECUTE_AUDIT')
    expect(res.reasoning).toBe('all four true')
  })

  it('non-thinking responses are unchanged (no reasoning key)', async () => {
    const complete = async () => ({
      choices: [{ message: { content: 'pong' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const res = await routerChatWithUsage(cfg(complete), [{ role: 'user', content: 'hi' }])
    expect(res.content).toBe('pong')
    expect('reasoning' in res).toBe(false)
  })
})
