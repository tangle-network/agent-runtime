/**
 * `assertModelAllowed` — a fail-loud guard that restricts a run to a chosen subset of
 * models. The two front doors (`supervise()` / `improve()`) call it once per configured
 * model at resolve time, so a run that names a model outside the allowed set throws before
 * any compute is spent — never silently swapped or silently allowed.
 */
import { HARNESS_NATIVE_MODEL } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../../errors'

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
 * Remove only Eval's runtime-selected model marker before a profile crosses an execution boundary.
 * Every other model hint remains intact, including provider, reasoning effort, and small-model
 * preferences. The input profile is never mutated.
 */
export function profileForExecution(profile: AgentProfile): AgentProfile {
  const model = profile.model
  if (!isHarnessNativeModel(model?.default) || model === undefined) return profile
  const { default: _runtimeSelected, ...remainingModel } = model
  const { model: _model, ...remainingProfile } = profile
  return Object.keys(remainingModel).length > 0
    ? { ...remainingProfile, model: remainingModel }
    : remainingProfile
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
