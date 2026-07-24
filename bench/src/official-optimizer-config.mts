function requiredNonNegativeNumber(
  env: NodeJS.ProcessEnv,
  name: string,
): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') {
    throw new Error(`env ${name} is required`)
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`env ${name} must be a finite non-negative number`)
  }
  return value
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = Number(env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`env ${name} must be a positive integer`)
  }
  return value
}

export function requiredTokenPricing(
  env: NodeJS.ProcessEnv,
  prefix: 'WORKER' | 'REFLECT',
) {
  return {
    inputUsdPerMillion: requiredNonNegativeNumber(
      env,
      `${prefix}_INPUT_USD_PER_MILLION`,
    ),
    cachedInputUsdPerMillion: requiredNonNegativeNumber(
      env,
      `${prefix}_CACHED_INPUT_USD_PER_MILLION`,
    ),
    cacheWriteUsdPerMillion: requiredNonNegativeNumber(
      env,
      `${prefix}_CACHE_WRITE_USD_PER_MILLION`,
    ),
    outputUsdPerMillion: requiredNonNegativeNumber(
      env,
      `${prefix}_OUTPUT_USD_PER_MILLION`,
    ),
  }
}

export function officialOptimizerModel(options: {
  env: NodeJS.ProcessEnv
  model: string
  baseUrl: string
  apiKey: string
  maxCostUsd: number
  maxOutputTokensPerRequest: number
}) {
  const { env } = options
  return {
    model: options.model,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    budget: {
      maxCostUsd: options.maxCostUsd,
      maxRequests: positiveInteger(env, 'REFLECT_MAX_REQUESTS', 100),
      maxRequestBytes: positiveInteger(env, 'REFLECT_MAX_REQUEST_BYTES', 2_000_000),
      maxResponseBytes: positiveInteger(env, 'REFLECT_MAX_RESPONSE_BYTES', 2_000_000),
      maxOutputTokensPerRequest: options.maxOutputTokensPerRequest,
      requestTimeoutMs: positiveInteger(env, 'REFLECT_REQUEST_TIMEOUT_MS', 300_000),
      pricing: requiredTokenPricing(env, 'REFLECT'),
    },
  }
}

export function assertCompleteCost(
  label: string,
  cost: { accountingComplete: boolean; incompleteReasons: readonly string[] },
): void {
  if (cost.accountingComplete) return
  const reasons =
    cost.incompleteReasons.length > 0
      ? cost.incompleteReasons.join('; ')
      : 'no incomplete reason was recorded'
  throw new Error(`${label}: cost accounting is incomplete: ${reasons}`)
}
