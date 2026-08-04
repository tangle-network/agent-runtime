import { describe, expect, it } from 'vitest'
import {
  assertCompleteCost,
  officialOptimizerModel,
  requiredTokenPricing,
} from './official-optimizer-config.mts'

const pricingEnv = {
  OPT_INPUT_USD_PER_MILLION: '1',
  OPT_CACHED_INPUT_USD_PER_MILLION: '0.1',
  OPT_CACHE_WRITE_USD_PER_MILLION: '1.25',
  OPT_OUTPUT_USD_PER_MILLION: '5',
}

describe('official optimizer configuration', () => {
  it('builds a bounded model configuration from an arbitrary environment prefix', () => {
    const model = officialOptimizerModel({
      env: {
        ...pricingEnv,
        OPT_MAX_REQUESTS: '7',
        OPT_MAX_REQUEST_BYTES: '1000',
        OPT_MAX_RESPONSE_BYTES: '2000',
        OPT_REQUEST_TIMEOUT_MS: '3000',
      },
      envPrefix: 'OPT',
      model: 'test-model',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'test-key',
      maxCostUsd: 2,
      maxOutputTokensPerRequest: 4000,
    })

    expect(model).toMatchObject({
      model: 'test-model',
      budget: {
        maxCostUsd: 2,
        maxRequests: 7,
        maxRequestBytes: 1000,
        maxResponseBytes: 2000,
        maxOutputTokensPerRequest: 4000,
        requestTimeoutMs: 3000,
        pricing: {
          inputUsdPerMillion: 1,
          cachedInputUsdPerMillion: 0.1,
          cacheWriteUsdPerMillion: 1.25,
          outputUsdPerMillion: 5,
        },
      },
    })
    expect(model.call).toEqual(expect.any(Function))
    expect(model.callRef).toMatch(/^agent-runtime:sha256:/)
    expect(model).not.toHaveProperty('baseUrl')
    expect(model).not.toHaveProperty('apiKey')
  })

  it('executes the published optimizer callback through the exact Runtime profile', async () => {
    const requests: unknown[] = []
    const model = officialOptimizerModel({
      env: pricingEnv,
      envPrefix: 'OPT',
      model: 'test-model',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'test-key',
      maxCostUsd: 2,
      maxOutputTokensPerRequest: 4000,
      complete: async (request) => {
        requests.push(request)
        return {
          model: 'test-model',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 2,
            cost: 0.001,
            prompt_tokens_details: { cached_tokens: 1 },
            completion_tokens_details: { reasoning_tokens: 1 },
          },
        }
      },
    })

    const result = await model.call({
      callId: 'optimizer-call-1',
      request: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 4000,
      },
      endpointFormat: 'chat-completions',
      signal: new AbortController().signal,
    })

    expect(result.succeeded).toBe(true)
    if (!result.succeeded) throw new Error(result.error)
    expect(result.response).toMatchObject({
      model: 'test-model',
      content: 'ok',
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    })
    expect(result.receipt).toMatchObject({
      model: 'test-model',
      inputTokens: 2,
      cachedTokens: 1,
      outputTokens: 2,
      reasoningTokens: 1,
      actualCostUsd: 0.001,
    })
    expect(result.execution).toMatchObject({
      kind: 'agent-runtime-profile-model-call',
      executed: true,
      succeeded: true,
      model: 'test-model',
      callId: 'optimizer-call-1',
      endpointFormat: 'chat-completions',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      model: 'test-model',
      max_tokens: 4000,
    })
  })

  it('requires every token price instead of inventing cost data', () => {
    expect(() =>
      requiredTokenPricing(
        {
          ...pricingEnv,
          OPT_OUTPUT_USD_PER_MILLION: undefined,
        },
        'OPT',
      ),
    ).toThrow('env OPT_OUTPUT_USD_PER_MILLION is required')
  })

  it('rejects invalid request limits before constructing the optimizer', () => {
    expect(() =>
      officialOptimizerModel({
        env: { ...pricingEnv, OPT_MAX_REQUESTS: '0' },
        envPrefix: 'OPT',
        model: 'test-model',
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiKey: 'test-key',
        maxCostUsd: 2,
        maxOutputTokensPerRequest: 4000,
      }),
    ).toThrow('env OPT_MAX_REQUESTS must be a positive integer')
  })

  it('rejects incomplete cost records', () => {
    expect(() =>
      assertCompleteCost('official optimizer', {
        accountingComplete: false,
        incompleteReasons: ['provider omitted usage'],
      }),
    ).toThrow('official optimizer: cost accounting is incomplete: provider omitted usage')
  })
})
