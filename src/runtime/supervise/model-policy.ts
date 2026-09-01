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

/**
 * Return the model id for a direct provider request.
 *
 * A portable profile can qualify its model with the selected provider. The direct endpoint already
 * selects that provider, so remove only the exact matching prefix. Preserve every other prefix
 * because it can identify a provider-owned nested route, such as `anthropic/claude-sonnet`.
 */
export function profileProviderModel(profile: Pick<AgentProfile, 'model'>): string | undefined {
  const model = concreteProfileModel(profile)
  const provider = profile.model?.provider?.trim()
  if (!model || !provider || !model.startsWith(`${provider}/`)) return model
  return concreteModelId(model.slice(provider.length + 1))
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

/**
 * Separate completion ceilings an exact profile may request.
 *
 * They are distinct because providers do not share one meaning for a single number: measured
 * through the Tangle Router on 2026-08-10, `glm-5.2` accepted `max_tokens: 8` and still billed 135
 * completion tokens — 132 reasoning, 3 visible — while `max_completion_tokens: 256` bounded the
 * total. A path that cannot enforce a requested ceiling refuses the run instead of sending a
 * number that means something else there.
 */
export interface ProfileTokenLimits {
  /** Visible answer tokens, from `AgentProfile.model.maxVisibleOutputTokens`. */
  readonly visible?: number
  /** Hidden reasoning tokens, from `AgentProfile.model.maxReasoningTokens`. */
  readonly reasoning?: number
  /** Visible and reasoning tokens together, from `AgentProfile.model.maxTotalOutputTokens`. */
  readonly total?: number
}

/** The ceilings one execution path actually sends, in the request fields it sends them as. */
export interface AppliedTokenLimits {
  /** Sent as `max_tokens`. */
  readonly maxTokens?: number
  /** Sent as `max_completion_tokens`. */
  readonly maxCompletionTokens?: number
}

/** What a path was asked to enforce and what it sent, for the execution receipt. */
export interface TokenLimitDecision {
  readonly requested: ProfileTokenLimits
  readonly applied: AppliedTokenLimits
}

/** The execution paths that lower a profile into a provider request. */
export type ModelExecutionPath = 'router' | 'bridge' | 'sandbox' | 'provider'

/** Generation and loop controls that may affect one model execution. */
export interface ProfileModelExecutionSettings {
  readonly temperature?: number
  /** Completion ceilings the profile requested. Empty when it requested none. */
  readonly tokenLimits: ProfileTokenLimits
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
  if (metadata.maxTokens !== undefined) {
    throw new ConfigError(
      `${context}: AgentProfile.model.metadata.maxTokens is ambiguous across providers; declare AgentProfile.model.maxVisibleOutputTokens, maxReasoningTokens, or maxTotalOutputTokens instead`,
    )
  }
  const unknown = Object.keys(metadata).filter((key) => !PROFILE_MODEL_METADATA_KEYS.has(key))
  if (unknown.length > 0) {
    throw new ConfigError(
      `${context}: unsupported AgentProfile.model.metadata fields: ${unknown.join(', ')}`,
    )
  }
  const temperature = finiteNumber(metadata.temperature, `${context}: temperature`)
  const tokenLimits = profileTokenLimits(profile, context)
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
    tokenLimits,
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

/**
 * Read the completion ceilings an exact profile declares. The Interface schema already refines
 * these fields, but a profile can reach an executor without a parse, so the same rules are
 * enforced here: positive integers, and no single ceiling above the total.
 */
export function profileTokenLimits(
  profile: Pick<AgentProfile, 'model'>,
  context: string,
): ProfileTokenLimits {
  const model = profile.model
  const visible = positiveInteger(
    model?.maxVisibleOutputTokens,
    `${context}: maxVisibleOutputTokens`,
  )
  const reasoning = positiveInteger(model?.maxReasoningTokens, `${context}: maxReasoningTokens`)
  const total = positiveInteger(model?.maxTotalOutputTokens, `${context}: maxTotalOutputTokens`)
  if (total !== undefined) {
    for (const [name, value] of [
      ['maxVisibleOutputTokens', visible],
      ['maxReasoningTokens', reasoning],
    ] as const) {
      if (value !== undefined && value > total) {
        throw new ConfigError(
          `${context}: AgentProfile.model.${name} (${value}) exceeds maxTotalOutputTokens (${total})`,
        )
      }
    }
  }
  return {
    ...(visible !== undefined ? { visible } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(total !== undefined ? { total } : {}),
  }
}

/**
 * Lower the requested ceilings onto one execution path, or refuse the run before any paid
 * transport.
 *
 * - Router and OpenAI-compatible routes send the visible ceiling as `max_tokens` and the total as
 *   `max_completion_tokens`.
 * - The CLI Bridge lowers ONE completion cap into the run's model catalog, so it carries the total
 *   as `max_tokens` and cannot bound the visible half on its own.
 * - The Sandbox and environment-provider paths expose no completion cap at all.
 * - No route publishes a reasoning-token budget, so a reasoning ceiling is refused everywhere.
 *   `AgentProfile.model.reasoningEffort` is an intensity dial, not a token bound.
 */
export function enforceTokenLimits(
  limits: ProfileTokenLimits,
  path: ModelExecutionPath,
  context: string,
): TokenLimitDecision {
  const refuse = (field: string, reason: string): never => {
    throw new ConfigError(
      `${context}: AgentProfile.model.${field} cannot be enforced on the ${path} path (${reason}); remove the ceiling or select a path that enforces it`,
    )
  }
  if (limits.reasoning !== undefined) {
    refuse('maxReasoningTokens', 'no route exposes a reasoning-token budget')
  }
  if (path === 'router') {
    return {
      requested: limits,
      applied: {
        ...(limits.visible !== undefined ? { maxTokens: limits.visible } : {}),
        ...(limits.total !== undefined ? { maxCompletionTokens: limits.total } : {}),
      },
    }
  }
  if (path === 'bridge') {
    if (limits.visible !== undefined) {
      refuse('maxVisibleOutputTokens', 'the bridge lowers one completion cap covering both halves')
    }
    return {
      requested: limits,
      applied: {
        ...(limits.total !== undefined ? { maxTokens: limits.total } : {}),
      },
    }
  }
  if (limits.visible !== undefined) refuse('maxVisibleOutputTokens', 'the backend accepts no cap')
  if (limits.total !== undefined) refuse('maxTotalOutputTokens', 'the backend accepts no cap')
  return { requested: limits, applied: {} }
}

/** The receipt form of one path's ceilings: what was asked for, and what was sent. */
export function tokenLimitReceipt(decision: TokenLimitDecision): {
  readonly requested: ProfileTokenLimits
  readonly applied: AppliedTokenLimits
} {
  return { requested: decision.requested, applied: decision.applied }
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
 * backend may select for cheap work, named subagents, or modes.
 *
 * Every compared value is a bare model id. The composed `harness/provider/model` wire id
 * (`profileBridgeWireModel`) is neither built nor compared here, so this admits any route that
 * declares an allowed id, and a qualified entry in `allowed` matches nothing. Route pinning
 * belongs to `SuperviseOptions.authorizeSpawn`. */
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
