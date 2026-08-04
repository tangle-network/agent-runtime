import type {
  OpenAICompatibleOptimizerModel,
  OptimizerModelBudget,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { profileOptimizerModelCall } from '../../src/runtime/profile-chat-client'
import type { RouterSeam } from '../../src/runtime/supervise/runtime'

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
  prefix: string,
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
  envPrefix?: string
  provider?: string
  temperature?: number
  reasoningEffort?: NonNullable<AgentProfile['model']>['reasoningEffort']
  callRef?: string
  complete?: RouterSeam['complete']
}): OpenAICompatibleOptimizerModel {
  const { env } = options
  const envPrefix = options.envPrefix ?? 'REFLECT'
  const budget: OptimizerModelBudget = {
    maxCostUsd: options.maxCostUsd,
    maxRequests: positiveInteger(env, `${envPrefix}_MAX_REQUESTS`, 100),
    maxRequestBytes: positiveInteger(env, `${envPrefix}_MAX_REQUEST_BYTES`, 2_000_000),
    maxResponseBytes: positiveInteger(env, `${envPrefix}_MAX_RESPONSE_BYTES`, 2_000_000),
    maxOutputTokensPerRequest: options.maxOutputTokensPerRequest,
    requestTimeoutMs: positiveInteger(env, `${envPrefix}_REQUEST_TIMEOUT_MS`, 300_000),
    pricing: requiredTokenPricing(env, envPrefix),
  }
  const profile: AgentProfile = {
    name: 'official-optimizer-model',
    harness: 'cli-base',
    model: {
      provider: options.provider ?? new URL(options.baseUrl).hostname,
      default: options.model,
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      metadata: {
        maxTokens: options.maxOutputTokensPerRequest,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    },
  }
  const profileDigest = canonicalAgentProfileDigest(profile)
  const executor: RouterSeam & { backend: 'router' } = {
    backend: 'router',
    routerBaseUrl: options.baseUrl,
    routerKey: options.apiKey,
    ...(options.complete ? { complete: options.complete } : {}),
  }
  const call = profileOptimizerModelCall({
    profile,
    context: 'official optimizer model',
    executor,
    pricing: budget.pricing,
  })
  return {
    model: options.model,
    callRef:
      options.callRef ??
      `agent-runtime:${canonicalCandidateDigest({
        profileDigest,
        endpoint: new URL(options.baseUrl).origin,
      })}`,
    call,
    budget,
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
