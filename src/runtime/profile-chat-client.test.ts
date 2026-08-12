import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { describe, expect, it, vi } from 'vitest'
import {
  profileChatClient,
  profileOptimizerModelCall,
  terminalDurationMs,
} from './profile-chat-client'

const profile: AgentProfile = {
  name: 'exact-chat-client',
  harness: 'cli-base',
  model: {
    provider: 'tangle-router',
    default: 'deepseek-v4-flash',
  },
  prompt: { systemPrompt: 'Answer exactly.' },
}

function clientWith(
  complete: (
    body: Record<string, unknown>,
    request?: { headers: Readonly<Record<string, string>>; signal?: AbortSignal },
  ) => Promise<unknown>,
) {
  return profileChatClient({
    profile,
    context: 'profile chat test',
    executor: {
      backend: 'router',
      routerBaseUrl: 'http://injected.invalid/v1',
      routerKey: 'injected-transport',
      complete,
    },
  })
}

const request = {
  messages: [
    { role: 'system' as const, content: 'Answer exactly.' },
    { role: 'user' as const, content: 'hello' },
  ],
}

describe('profileChatClient exact Runtime adapter', () => {
  it('returns only provider-observed model and billed usage, including prompt-cache accounting', async () => {
    const response = await clientWith(async () => ({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'hello back' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 7,
        completion_tokens: 3,
        cost: 0.002,
        prompt_cache_hit_tokens: 5,
      },
    })).chat(request)

    expect(response).toMatchObject({
      content: 'hello back',
      model: 'deepseek-v4-flash',
      costUsd: 0.002,
      usage: {
        promptTokens: 7,
        completionTokens: 3,
        totalTokens: 10,
        cachedPromptTokens: 5,
      },
      finishReason: 'stop',
      contentEmpty: false,
      raw: { promptCache: { readTokens: 5 }, transportAttempts: 1 },
    })
    expect(response.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('accepts a provider snapshot suffix and keeps it in the optimizer receipt', async () => {
    const responseModel = 'deepseek-v4-flash@fp_a18b46594c_prod0820_fp8_kvcache_20260402'
    const call = profileOptimizerModelCall({
      profile,
      context: 'profile snapshot identity test',
      executor: {
        backend: 'router',
        routerBaseUrl: 'http://injected.invalid/v1',
        routerKey: 'injected-transport',
        complete: async () => ({
          model: responseModel,
          choices: [{ message: { content: 'snapshot response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.001 },
        }),
      },
    })

    const result = await call({
      callId: 'snapshot-identity-1',
      request: { ...request, model: 'deepseek-v4-flash' },
      endpointFormat: 'chat-completions',
      signal: new AbortController().signal,
    })

    expect(result.succeeded).toBe(true)
    if (!result.succeeded) throw new Error(result.error)
    expect(result.response.model).toBe(responseModel)
    expect(result.receipt).toMatchObject({
      model: responseModel,
      inputTokens: 3,
      outputTokens: 2,
    })
    expect(result.execution).toMatchObject({ model: responseModel })
  })

  it('carries the exact profile retry policy through the injected Router transport', async () => {
    let attempts = 0
    const complete = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed: injected reset')
      return {
        model: 'deepseek-v4-flash',
        choices: [{ message: { content: 'retried response' } }],
      }
    })
    const client = profileChatClient({
      profile: {
        ...profile,
        model: {
          ...profile.model,
          metadata: {
            retry: {
              maxAttempts: 2,
              initialBackoffMs: 0,
              maxBackoffMs: 0,
              jitter: 0,
              requestTimeoutMs: 0,
            },
          },
        },
      },
      context: 'profile retry test',
      executor: {
        backend: 'router',
        routerBaseUrl: 'http://injected.invalid/v1',
        routerKey: 'injected-transport',
        complete,
      },
    })

    const response = await client.chat(request)

    expect(client.maximumAttempts).toBe(2)
    expect(response.content).toBe('retried response')
    expect(response.raw).toMatchObject({ transportAttempts: 2 })
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('refuses a provider-reported model different from the exact profile', async () => {
    await expect(
      clientWith(async () => ({
        model: 'some-other-model',
        choices: [{ message: { content: 'wrong route' } }],
      })).chat(request),
    ).rejects.toThrow(/provider reported model "some-other-model".*requires "deepseek-v4-flash"/u)
  })

  it('refuses to claim the requested model when the provider did not report an actual model', async () => {
    await expect(
      clientWith(async () => ({
        choices: [{ message: { content: 'unidentified route' } }],
      })).chat(request),
    ).rejects.toThrow(/did not report the model actually used/u)
  })

  it('propagates stable paid-call and correlation ids to the Router request', async () => {
    const complete = vi.fn(
      async (
        _: Record<string, unknown>,
        transport?: { headers: Readonly<Record<string, string>> },
      ) => {
        expect(transport?.headers).toMatchObject({
          'idempotency-key': 'paid-call-1',
          'x-correlation-id': 'corr-1',
        })
        return {
          model: 'deepseek-v4-flash',
          choices: [{ message: { content: 'identified' } }],
        }
      },
    )
    await clientWith(complete).chat(request, {
      idempotencyKey: 'paid-call-1',
      correlationId: 'corr-1',
    })
    expect(complete).toHaveBeenCalledOnce()
  })

  it('keeps the profile policy first and preserves a task-specific system message after it', async () => {
    const complete = vi.fn(async (body: Record<string, unknown>) => {
      expect(body.messages).toEqual([
        { role: 'system', content: 'Answer exactly.' },
        { role: 'system', content: 'Optimize this candidate using the examples.' },
        { role: 'user', content: 'candidate text' },
      ])
      return {
        model: 'deepseek-v4-flash',
        choices: [{ message: { content: 'improved candidate' } }],
      }
    })
    await clientWith(complete).chat({
      messages: [
        { role: 'system', content: 'Optimize this candidate using the examples.' },
        { role: 'user', content: 'candidate text' },
      ],
    })
    expect(complete).toHaveBeenCalledOnce()
  })

  it('materializes profile instructions once instead of duplicating the system prompt', async () => {
    const complete = vi.fn(async (body: Record<string, unknown>) => {
      expect(body.messages).toEqual([
        { role: 'system', content: 'Base policy.\nStanding rule.' },
        { role: 'system', content: 'Task-specific context.' },
        { role: 'user', content: 'candidate text' },
      ])
      return {
        model: 'deepseek-v4-flash',
        choices: [{ message: { content: 'improved candidate' } }],
      }
    })
    const client = profileChatClient({
      profile: {
        ...profile,
        prompt: { systemPrompt: 'Base policy.', instructions: ['Standing rule.'] },
      },
      context: 'profile prompt materialization test',
      executor: {
        backend: 'router',
        routerBaseUrl: 'http://injected.invalid/v1',
        routerKey: 'injected-transport',
        complete,
      },
    })

    await client.chat({
      messages: [
        { role: 'system', content: 'Task-specific context.' },
        { role: 'user', content: 'candidate text' },
      ],
    })
    expect(complete).toHaveBeenCalledOnce()
  })

  it('fails loud on unenforced maxCostUsd instead of silently treating it as a limit', async () => {
    const complete = vi.fn(async () => ({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'must not run' } }],
    }))
    await expect(clientWith(complete).chat(request, { maxCostUsd: 1 })).rejects.toThrow(/refusing/u)
    expect(complete).not.toHaveBeenCalled()
  })

  it('rejects caller reasoning that conflicts with the profile before transport', async () => {
    const complete = vi.fn(async () => ({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'must not run' } }],
    }))
    const client = profileChatClient({
      profile: {
        ...profile,
        model: { ...profile.model, reasoningEffort: 'high' },
      },
      context: 'profile chat test',
      executor: {
        backend: 'router',
        routerBaseUrl: 'http://injected.invalid/v1',
        routerKey: 'injected-transport',
        complete,
      },
    })

    await expect(client.chat({ ...request, thinking: 'disabled' })).rejects.toThrow(
      /request thinking conflicts with AgentProfile\.model\.reasoningEffort/u,
    )
    expect(complete).not.toHaveBeenCalled()
  })

  it('adapts Eval optimizer calls to the same exact Runtime path with measured evidence', async () => {
    const complete = vi.fn(
      async (
        _: Record<string, unknown>,
        transport?: { headers: Readonly<Record<string, string>> },
      ) => {
        expect(transport?.headers).toMatchObject({
          'idempotency-key': 'optimizer-call-1',
          'x-correlation-id': 'optimizer-call-1',
        })
        return {
          model: 'deepseek-v4-flash',
          choices: [{ message: { content: 'optimizer response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.001 },
        }
      },
    )
    const call = profileOptimizerModelCall({
      profile: {
        ...profile,
        model: { ...profile.model, metadata: { maxTokens: 100 } },
      },
      context: 'profile optimizer test',
      executor: {
        backend: 'router',
        routerBaseUrl: 'http://injected.invalid/v1',
        routerKey: 'injected-transport',
        complete,
      },
    })

    const result = await call({
      callId: 'optimizer-call-1',
      request: { ...request, model: 'deepseek-v4-flash', maxTokens: 100 },
      endpointFormat: 'chat-completions',
      signal: new AbortController().signal,
    })

    expect(result.succeeded).toBe(true)
    if (!result.succeeded) throw new Error(result.error)
    expect(result.response).toMatchObject({
      content: 'optimizer response',
      model: 'deepseek-v4-flash',
    })
    expect(result.receipt).toMatchObject({
      model: 'deepseek-v4-flash',
      inputTokens: 3,
      outputTokens: 2,
      actualCostUsd: 0.001,
    })
    expect(result.execution).toMatchObject({
      kind: 'agent-runtime-profile-model-call',
      callId: 'optimizer-call-1',
      endpointFormat: 'chat-completions',
      executed: true,
      succeeded: true,
      model: 'deepseek-v4-flash',
    })
    expect(complete).toHaveBeenCalledOnce()
  })

  it('captures the profile and reusable transport before caller mutation', async () => {
    const providerOptions = { mode: 'before' }
    const mutableProfile: AgentProfile = {
      ...profile,
      model: {
        ...profile.model,
        metadata: { extraBody: { provider_options: providerOptions } },
      },
    }
    const expectedProfileDigest = canonicalAgentProfileDigest(mutableProfile)
    let sent: Record<string, unknown> | undefined
    const originalComplete = vi.fn(async (body: Record<string, unknown>) => {
      sent = body
      providerOptions.mode = 'during-call'
      return {
        model: 'deepseek-v4-flash',
        choices: [{ message: { content: 'stable response' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }
    })
    const replacementComplete = vi.fn(async (_body: Record<string, unknown>) => ({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'wrong transport' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }))
    const executor = {
      backend: 'router' as const,
      routerBaseUrl: 'http://injected.invalid/v1',
      routerKey: 'injected-transport',
      complete: originalComplete,
    }
    const call = profileOptimizerModelCall({
      profile: mutableProfile,
      context: 'profile optimizer snapshot test',
      executor,
    })

    providerOptions.mode = 'after-bind'
    executor.complete = replacementComplete
    const result = await call({
      callId: 'optimizer-snapshot',
      request: { ...request, model: 'deepseek-v4-flash' },
      endpointFormat: 'chat-completions',
      signal: new AbortController().signal,
    })

    expect(result.succeeded).toBe(true)
    expect(originalComplete).toHaveBeenCalledOnce()
    expect(replacementComplete).not.toHaveBeenCalled()
    expect(sent).toMatchObject({ provider_options: { mode: 'before' } })
    expect(result.execution).toMatchObject({ profileDigest: expectedProfileDigest })
  })

  it('returns the same custom-priced cost in the optimizer response and receipt', async () => {
    const pricing = { inputUsdPerMillion: 2, outputUsdPerMillion: 4 }
    const call = profileOptimizerModelCall({
      profile: {
        ...profile,
        model: { provider: 'custom-provider', default: 'unpriced-custom-model' },
      },
      context: 'profile optimizer custom pricing test',
      executor: {
        backend: 'router',
        routerBaseUrl: 'http://injected.invalid/v1',
        routerKey: 'injected-transport',
        complete: async () => ({
          model: 'unpriced-custom-model',
          choices: [{ message: { content: 'priced response' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      },
      pricing,
    })

    const result = await call({
      callId: 'optimizer-custom-pricing',
      request: { ...request, model: 'unpriced-custom-model' },
      endpointFormat: 'chat-completions',
      signal: new AbortController().signal,
    })

    expect(result.succeeded).toBe(true)
    if (!result.succeeded) throw new Error(result.error)
    expect(result.receipt).toMatchObject({ customTokenPricing: pricing })
    expect(result.response.costUsd).toBeCloseTo(0.000014)
  })

  it('keeps paid-call evidence when cache classification fails after transport', async () => {
    const complete = vi.fn(async () => ({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: 'paid response' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
        cost: 0.001,
        prompt_cache_hit_tokens: 4,
      },
    }))
    const call = profileOptimizerModelCall({
      profile,
      context: 'profile optimizer post-call evidence test',
      executor: {
        backend: 'router',
        routerBaseUrl: 'http://injected.invalid/v1',
        routerKey: 'injected-transport',
        complete,
      },
    })

    const result = await call({
      callId: 'optimizer-paid-invalid-cache',
      request: { ...request, model: 'deepseek-v4-flash' },
      endpointFormat: 'chat-completions',
      signal: new AbortController().signal,
    })

    expect(result.succeeded).toBe(false)
    if (result.succeeded) throw new Error('expected post-call receipt failure')
    expect(result.error).toMatch(/receipt normalization failed after execution/u)
    expect(result.receipt).toMatchObject({
      model: 'deepseek-v4-flash',
      inputTokens: 3,
      outputTokens: 2,
      actualCostUsd: 0.001,
    })
    expect(result.execution).toMatchObject({
      executed: true,
      succeeded: false,
      model: 'deepseek-v4-flash',
    })
    expect(complete).toHaveBeenCalledOnce()
  })
})

describe('terminalDurationMs', () => {
  it('uses the measured wall time when terminal transport timing is absent', () => {
    expect(terminalDurationMs([{ type: 'final' }], 12.5)).toBe(12.5)
  })

  it('prefers valid terminal transport timing over the outer measurement', () => {
    expect(
      terminalDurationMs([{ type: 'final', metadata: { timing: { durationMs: 8 } } }], 12.5),
    ).toBe(8)
  })
})
