/**
 * `assertModelAllowed` — a fail-loud guard that restricts a run to a chosen subset of
 * models. The two front doors (`supervise()` / `improve()`) call it once per configured
 * model at resolve time, so a run that names a model outside the allowed set throws before
 * any compute is spent — never silently swapped or silently allowed.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../../errors'

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
