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

/**
 * Check every typed model route in an AgentProfile.
 *
 * Backend-specific extension values are not model routes in the portable profile contract and are
 * therefore outside this check. Executors remain responsible for validating private materialized
 * configuration that is not represented by AgentProfile.
 */
export function assertProfileModelsAllowed(
  profile: AgentProfile,
  allowed: readonly string[] | null,
): void {
  const allowedModels = allowed ?? undefined
  assertModelAllowed(profile.model?.default, allowedModels)
  assertModelAllowed(profile.model?.small, allowedModels)
  for (const mode of Object.values(profile.modes ?? {})) {
    assertModelAllowed(mode.model, allowedModels)
  }
  for (const subagent of Object.values(profile.subagents ?? {})) {
    assertModelAllowed(subagent.model, allowedModels)
  }
}
