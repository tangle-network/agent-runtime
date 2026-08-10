/**
 * `assertModelAllowed` — a fail-loud guard that restricts a run to a chosen subset of
 * models. The two front doors (`supervise()` / `improve()`) call it once per configured
 * model at resolve time, so a run that names a model outside the allowed set throws before
 * any compute is spent — never silently swapped or silently allowed.
 */
import { HARNESS_NATIVE_MODEL } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../../errors'
import { agentHarness } from '../harness-role'
import { type ResolvedRouterRetryPolicy, resolveRouterRetryPolicy } from '../router-retry-policy'

/**
 * Return the model id an executor may send to a provider.
 *
 * Eval stamps {@link HARNESS_NATIVE_MODEL} into a profile when model selection is deliberately
 * delegated to the configured runtime. That marker belongs in experiment identity and cost
 * admission; it is not a provider model id.
 */
export function concreteModelId(model: string | undefined): string | undefined {
  if (model === undefined) return undefined
  const id = model.trim()
  return id.length > 0 && !isHarnessNativeModel(id) ? id : undefined
}

/** Whether a model value delegates selection to the chosen execution system. */
export function isHarnessNativeModel(model: string | undefined): boolean {
  return model?.trim() === HARNESS_NATIVE_MODEL
}

/** Return a profile's explicitly selected provider model, if it has one. */
export function concreteProfileModel(profile: Pick<AgentProfile, 'model'>): string | undefined {
  return concreteModelId(profile.model?.default)
}

/** The provider-facing model id declared by a profile. Direct Router execution uses this form:
 * the endpoint already selects the provider, so the model id itself is not harness-prefixed. */
export function profileProviderModel(profile: Pick<AgentProfile, 'model'>): string | undefined {
  return concreteProfileModel(profile)
}

/** The full cli-bridge wire id declared by a profile: harness/provider/model. */
export function profileBridgeWireModel(
  profile: Pick<AgentProfile, 'harness' | 'model'>,
): string | undefined {
  const model = concreteProfileModel(profile)
  const provider = profile.model?.provider
  const harness = agentHarness(profile.harness)
  const modelWithoutHarness =
    model && harness && model.startsWith(`${harness}/`) ? model.slice(harness.length + 1) : model
  const providerModel = modelWithoutHarness
    ? provider && !modelWithoutHarness.startsWith(`${provider}/`)
      ? `${provider}/${modelWithoutHarness}`
      : modelWithoutHarness
    : undefined
  if (!harness) return providerModel
  if (!providerModel) return harness
  return providerModel.startsWith(`${harness}/`) ? providerModel : `${harness}/${providerModel}`
}

/**
 * Refuse an incomplete execution identity before any backend may fill it from ambient config.
 * `AgentProfile` is the sole behavioral authority: harness, provider, and concrete model all
 * participate in its digest. Eval's runtime-selected marker is a matrix-planning value, never an
 * executable model.
 */
export function assertExecutableAgentProfile(profile: AgentProfile, context: string): void {
  if (profile.harness === undefined) {
    throw new ConfigError(`${context}: AgentProfile.harness must be explicit before execution`)
  }
  const declared = profile.model?.default
  const model = concreteModelId(declared)
  if (!model) {
    const reason = isHarnessNativeModel(declared) ? 'runtime-selected' : 'missing'
    throw new ConfigError(
      `${context}: AgentProfile.model.default is ${reason}; execution requires a concrete model`,
    )
  }
  if (!profile.model?.provider?.trim()) {
    throw new ConfigError(
      `${context}: AgentProfile.model.provider must be explicit before execution`,
    )
  }
}

/** Generation and loop controls that may affect one model execution. */
export interface ProfileModelExecutionSettings {
  readonly temperature?: number
  readonly maxTokens?: number
  readonly retry?: ResolvedRouterRetryPolicy
  readonly seed?: number
  readonly toolChoice?: 'auto' | 'required' | 'none'
  readonly extraBody?: Readonly<Record<string, unknown>>
  /** Zero means no turn-count cap; conserved budgets and deadlines still apply. */
  readonly maxTurns?: number
  readonly stream?: boolean
}

const PROFILE_MODEL_METADATA_KEYS = new Set([
  'extraBody',
  'maxTokens',
  'maxTurns',
  'retry',
  'seed',
  'stream',
  'temperature',
  'toolChoice',
])

/**
 * Read every Router-affecting control from the exact profile and reject unknown controls.
 * Backends receive endpoint/auth and executable ports only; they cannot silently alter behavior.
 */
export function profileModelExecutionSettings(
  profile: Pick<AgentProfile, 'model'>,
  context: string,
): ProfileModelExecutionSettings {
  const metadata = profile.model?.metadata ?? {}
  const unknown = Object.keys(metadata).filter((key) => !PROFILE_MODEL_METADATA_KEYS.has(key))
  if (unknown.length > 0) {
    throw new ConfigError(
      `${context}: unsupported AgentProfile.model.metadata fields: ${unknown.join(', ')}`,
    )
  }
  const temperature = finiteNumber(metadata.temperature, `${context}: temperature`)
  const maxTokens = positiveInteger(metadata.maxTokens, `${context}: maxTokens`)
  const retryInput = metadata.retry
  const retry =
    retryInput === undefined
      ? undefined
      : resolveRouterRetryPolicy(retryInput, `${context}: AgentProfile.model.metadata.retry`)
  const seed = safeInteger(metadata.seed, `${context}: seed`)
  const maxTurns = nonnegativeInteger(metadata.maxTurns, `${context}: maxTurns`)
  const stream = optionalBoolean(metadata.stream, `${context}: stream`)
  const toolChoice = metadata.toolChoice
  if (
    toolChoice !== undefined &&
    toolChoice !== 'auto' &&
    toolChoice !== 'required' &&
    toolChoice !== 'none'
  ) {
    throw new ConfigError(`${context}: toolChoice must be auto, required, or none`)
  }
  const extraBody = metadata.extraBody
  if (
    extraBody !== undefined &&
    (typeof extraBody !== 'object' || extraBody === null || Array.isArray(extraBody))
  ) {
    throw new ConfigError(`${context}: extraBody must be an object`)
  }
  return {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(retry !== undefined ? { retry } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(toolChoice !== undefined ? { toolChoice } : {}),
    ...(extraBody !== undefined
      ? { extraBody: Object.freeze({ ...(extraBody as Record<string, unknown>) }) }
      : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(stream !== undefined ? { stream } : {}),
  }
}

function finiteNumber(value: unknown, context: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`${context} must be a finite number`)
  }
  return value
}

function safeInteger(value: unknown, context: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value)) throw new ConfigError(`${context} must be a safe integer`)
  return value as number
}

function positiveInteger(value: unknown, context: string): number | undefined {
  const parsed = safeInteger(value, context)
  if (parsed !== undefined && parsed < 1) {
    throw new ConfigError(`${context} must be positive`)
  }
  return parsed
}

function nonnegativeInteger(value: unknown, context: string): number | undefined {
  const parsed = safeInteger(value, context)
  if (parsed !== undefined && parsed < 0) {
    throw new ConfigError(`${context} must be nonnegative`)
  }
  return parsed
}

function optionalBoolean(value: unknown, context: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new ConfigError(`${context} must be boolean`)
  return value
}

/**
 * Throw a `ConfigError` when `allowed` is set, `model` is defined, and `model` is not a
 * member of `allowed`. No-op when `allowed` is unset (the unrestricted default) or when
 * `model` is undefined (nothing was configured to check).
 */
export function assertModelAllowed(
  model: string | undefined,
  allowed: readonly string[] | undefined,
): void {
  if (!allowed || model === undefined) return
  if (!allowed.includes(model)) {
    throw new ConfigError(
      `model ${JSON.stringify(model)} is not in the allowed set ${JSON.stringify([...allowed])}`,
    )
  }
}

/** Check every canonical model-bearing field in a complete profile, including the models a
 * backend may select for cheap work, named subagents, or modes. */
export function assertProfileModelsAllowed(
  profile: AgentProfile,
  allowed: readonly string[] | undefined,
): void {
  assertModelAllowed(profile.model?.default, allowed)
  assertModelAllowed(profile.model?.small, allowed)
  for (const subagent of Object.values(profile.subagents ?? {})) {
    assertModelAllowed(subagent.model, allowed)
  }
  for (const mode of Object.values(profile.modes ?? {})) {
    assertModelAllowed(mode.model, allowed)
  }
}
