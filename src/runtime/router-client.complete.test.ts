import { afterEach, describe, expect, it, vi } from 'vitest'
import { routerChatWithTools, routerChatWithUsage } from './router-client'

// The completion-transport injection seam (`RouterConfig.complete`): when present, the chat
// clients call it with the OpenAI request body and parse what it returns, INSTEAD of `fetch`-ing
// the router. The offline-benchmark path — a deterministic in-process responder, no network.

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RouterConfig.complete — the injected completion transport', () => {
  it('routerChatWithUsage uses `complete` and never touches fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const complete = vi.fn(async (body: Record<string, unknown>) => {
      // The body is the OpenAI request the client built — assert it threaded the model + messages.
      expect(body.model).toBe('deepseek-v4-flash')
      expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
      expect(body).not.toHaveProperty('max_tokens')
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
    expect(res.transportAttempts).toBe(1)
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
    expect(res.transportAttempts).toBe(1)
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
    expect(res.transportAttempts).toBe(1)
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('buffered chat retries a thrown network failure and reports the exact attempt count', async () => {
    let calls = 0
    const idempotencyKeys: string[] = []
    const fetchSpy = vi.fn(async (_url: unknown, init: RequestInit) => {
      idempotencyKeys.push((init.headers as Record<string, string>)['idempotency-key'] ?? '')
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed: socket reset')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'recovered' } }],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
        text: async (): Promise<string> => '',
      }
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await routerChatWithUsage(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'deepseek-v4-flash',
        retry: {
          maxAttempts: 2,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          jitter: 0,
          requestTimeoutMs: 0,
        },
      },
      [{ role: 'user', content: 'recover' }],
    )

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(idempotencyKeys[0]).toMatch(/^idem_/u)
    expect(idempotencyKeys).toEqual([idempotencyKeys[0], idempotencyKeys[0]])
    expect(result.transportAttempts).toBe(2)
    expect(result.content).toBe('recovered')
  })

  it('keeps a caller-supplied logical-call id authoritative across retries', async () => {
    const seen: string[] = []
    let calls = 0
    const complete = vi.fn(
      async (
        _body: Record<string, unknown>,
        request?: { headers: Readonly<Record<string, string>> },
      ) => {
        seen.push(request?.headers['idempotency-key'] ?? '')
        calls += 1
        if (calls === 1) throw new TypeError('fetch failed: accepted response lost')
        return { choices: [{ message: { content: 'recovered' } }] }
      },
    )

    await routerChatWithUsage(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'deepseek-v4-flash',
        complete,
        retry: {
          maxAttempts: 2,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          jitter: 0,
          requestTimeoutMs: 0,
        },
      },
      [{ role: 'user', content: 'recover' }],
      { callId: 'trusted-call-1' },
    )

    expect(seen).toEqual(['trusted-call-1', 'trusted-call-1'])
  })

  it.each(['', '   ', null])(
    'rejects an invalid supplied logical-call id %j before transport',
    async (callId) => {
      const complete = vi.fn(async () => ({ choices: [{ message: { content: 'unused' } }] }))

      await expect(
        routerChatWithUsage(
          {
            routerBaseUrl: 'http://router.test/v1',
            routerKey: 'k',
            model: 'deepseek-v4-flash',
            complete,
          },
          [{ role: 'user', content: 'do not dispatch' }],
          { callId: callId as string },
        ),
      ).rejects.toThrow(/callId must be a non-empty, non-whitespace string/u)
      expect(complete).not.toHaveBeenCalled()
    },
  )

  it('fails loud with the final network cause after the configured attempts are exhausted', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('fetch failed: connection refused')
    })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(
      routerChatWithUsage(
        {
          routerBaseUrl: 'http://router.test/v1',
          routerKey: 'k',
          model: 'deepseek-v4-flash',
          retry: {
            maxAttempts: 2,
            initialBackoffMs: 0,
            maxBackoffMs: 0,
            jitter: 0,
            requestTimeoutMs: 0,
          },
        },
        [{ role: 'user', content: 'cannot connect' }],
      ),
    ).rejects.toThrow(/router network failure: fetch failed: connection refused/u)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('enforces the per-attempt header timeout and retries the timed-out request', async () => {
    let calls = 0
    const fetchSpy = vi.fn(async (_url: unknown, init: { signal?: AbortSignal }) => {
      calls += 1
      if (calls === 1) {
        return new Promise<never>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason ?? new Error('aborted')),
            { once: true },
          )
        })
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'after timeout' } }] }),
      }
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await routerChatWithUsage(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'deepseek-v4-flash',
        retry: {
          maxAttempts: 2,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          jitter: 0,
          requestTimeoutMs: 10,
        },
      },
      [{ role: 'user', content: 'timeout once' }],
    )

    expect(result.content).toBe('after timeout')
    expect(result.transportAttempts).toBe(2)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('passes initial delay, exponential cap, and jitter to the shared retry primitive', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const timerSpy = vi.spyOn(globalThis, 'setTimeout')
    let calls = 0
    const fetchSpy = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new TypeError('fetch failed')
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'third try' } }] }),
      }
    })
    vi.stubGlobal('fetch', fetchSpy)

    await routerChatWithUsage(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'deepseek-v4-flash',
        retry: {
          maxAttempts: 3,
          initialBackoffMs: 10,
          maxBackoffMs: 15,
          jitter: 0.2,
          requestTimeoutMs: 0,
        },
      },
      [{ role: 'user', content: 'back off' }],
    )

    expect(timerSpy.mock.calls.map((call) => call[1])).toEqual([12, 18])
  })

  it('cancels pending backoff and never starts another request after caller abort', async () => {
    const controller = new AbortController()
    const timerSpy = vi.spyOn(globalThis, 'setTimeout')
    let firstAttemptStarted = () => {}
    const started = new Promise<void>((resolve) => {
      firstAttemptStarted = resolve
    })
    const fetchSpy = vi.fn(async () => {
      firstAttemptStarted()
      throw new TypeError('fetch failed: offline')
    })
    vi.stubGlobal('fetch', fetchSpy)

    const pending = routerChatWithUsage(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'deepseek-v4-flash',
        retry: {
          maxAttempts: 3,
          initialBackoffMs: 60_000,
          maxBackoffMs: 60_000,
          jitter: 0,
          requestTimeoutMs: 0,
        },
      },
      [{ role: 'user', content: 'stop retrying' }],
      { signal: controller.signal },
    )
    await started
    await Promise.resolve()
    await Promise.resolve()
    expect(timerSpy).toHaveBeenCalledWith(expect.any(Function), 60_000)
    controller.abort(new Error('caller stopped'))

    await expect(pending).rejects.toThrow(/caller stopped/u)
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxAttempts %s before dispatch',
    async (maxAttempts) => {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      await expect(
        routerChatWithUsage(
          {
            routerBaseUrl: 'http://router.test/v1',
            routerKey: 'k',
            model: 'deepseek-v4-flash',
            retry: { maxAttempts },
          },
          [{ role: 'user', content: 'do not dispatch' }],
        ),
      ).rejects.toThrow(/maxAttempts must be a positive safe integer/u)
      expect(fetchSpy).not.toHaveBeenCalled()
    },
  )

  it('uses the caller ceiling when set and otherwise leaves the provider default unrestricted', async () => {
    const seen: Record<string, unknown>[] = []
    const complete = async (body: Record<string, unknown>) => {
      seen.push(body)
      return { choices: [{ message: { content: 'done' } }] }
    }
    const config = {
      routerBaseUrl: 'http://router.test/v1',
      routerKey: 'k',
      model: 'deepseek-v4-flash',
      complete,
    }
    await routerChatWithUsage(config, [{ role: 'user', content: 'default' }])
    await routerChatWithUsage({ ...config, maxTokens: 16_384 }, [
      { role: 'user', content: 'configured' },
    ])
    await routerChatWithUsage(config, [{ role: 'user', content: 'per-call' }], {
      maxTokens: 32_768,
    })

    expect(seen[0]).not.toHaveProperty('max_tokens')
    expect(seen[1]?.max_tokens).toBe(16_384)
    expect(seen[2]?.max_tokens).toBe(32_768)
  })

  it('sends the total completion ceiling as max_completion_tokens beside max_tokens', async () => {
    // A reasoning model can spend a whole `max_tokens` budget on hidden thinking, so the two
    // ceilings must reach the provider as two different fields.
    const seen: Array<Record<string, unknown>> = []
    const complete = async (body: Record<string, unknown>) => {
      seen.push(body)
      return { choices: [{ message: { content: 'done' } }] }
    }
    await routerChatWithUsage(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'glm-5.2',
        complete,
        maxTokens: 8,
        maxCompletionTokens: 256,
      },
      [{ role: 'user', content: 'bounded' }],
    )
    expect(seen[0]).toMatchObject({ max_tokens: 8, max_completion_tokens: 256 })
  })

  it('accepts multimodal messages and provider fields without letting extras replace canonical fields', async () => {
    const content = [
      { type: 'text', text: 'describe this image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } },
    ]
    const complete = vi.fn(async (body: Record<string, unknown>) => {
      expect(body).toMatchObject({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content }],
        temperature: 0.4,
        max_tokens: 32_768,
        seed: 7,
        thinking: { type: 'enabled' },
      })
      return { choices: [{ message: { content: 'image' } }] }
    })

    await routerChatWithUsage(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'deepseek-v4-flash',
        complete,
      },
      [{ role: 'user', content }],
      {
        temperature: 0.4,
        maxTokens: 32_768,
        seed: 7,
        extraBody: {
          model: 'must-not-win',
          messages: [],
          temperature: 999,
          max_tokens: 1,
          thinking: { type: 'enabled' },
        },
      },
    )
    expect(complete).toHaveBeenCalledOnce()
  })

  it('omits tool fields for a no-tool request and protects canonical fields from provider extras', async () => {
    const complete = vi.fn(async (body: Record<string, unknown>) => {
      expect(body).toMatchObject({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'answer' }],
        temperature: 0.1,
        thinking: { type: 'enabled' },
      })
      expect(body).not.toHaveProperty('tools')
      expect(body).not.toHaveProperty('tool_choice')
      return { choices: [{ message: { content: 'done' } }] }
    })

    const result = await routerChatWithTools(
      {
        routerBaseUrl: 'http://router.test/v1',
        routerKey: 'k',
        model: 'deepseek-v4-flash',
        complete,
      },
      [{ role: 'user', content: 'answer' }],
      [],
      {
        temperature: 0.1,
        extraBody: {
          model: 'must-not-win',
          messages: [],
          tools: [{ type: 'function' }],
          tool_choice: 'required',
          thinking: { type: 'enabled' },
        },
      },
    )
    expect(result.content).toBe('done')
    expect(complete).toHaveBeenCalledOnce()
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
