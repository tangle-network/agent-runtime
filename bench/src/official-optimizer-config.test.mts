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

    expect(model).toEqual({
      model: 'test-model',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'test-key',
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
