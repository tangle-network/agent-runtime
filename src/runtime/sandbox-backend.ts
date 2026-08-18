/**
 *
 * Backend-options assembly shared by the loop kernel's `createSandboxForSpec`
 * and the sandbox planner's box creation, so the worker box and the planner box
 * boot identically. Builds the options only — the acquire path (cold-start
 * recovery) lives in the kernel, the planner calls `client.create` directly.
 *
 * @experimental
 */

import type { AgentProfile, HarnessType } from '@tangle-network/agent-interface'
import type { CreateSandboxOptions } from '@tangle-network/sandbox'
import { assertExecutableAgentProfile, concreteProfileModel } from './supervise/model-policy'

type BackendType = NonNullable<CreateSandboxOptions['backend']>['type']
type BackendOverride = NonNullable<CreateSandboxOptions['backend']>

/**
 * Harnesses the sandbox accepts as a `backend.type`. `gemini` is a
 * `HarnessType` with no sandbox backend, so it is absent here and a profile
 * declaring it cannot run through this path.
 *
 * The double `satisfies` pins both directions: an entry the sandbox drops stops
 * compiling, and an entry that is not a harness stops compiling.
 */
const harnessBackends = [
  'claude-code',
  'nanoclaw',
  'codex',
  'opencode',
  'kimi-code',
  'pi',
  'prime',
  'hermes',
  'openclaw',
  'amp',
  'factory-droids',
  'acp',
  'cli-base',
] as const satisfies readonly HarnessType[] satisfies readonly BackendType[]

function harnessAsBackendType(harness: HarnessType): BackendType | undefined {
  return (harnessBackends as readonly string[]).includes(harness)
    ? (harness as BackendType)
    : undefined
}

/**
 * Resolve the backend `type` from the exact profile's declared `harness`.
 *
 * A declared `harness` the sandbox cannot run throws rather than falling
 * through: silently running a `gemini` profile on opencode returns a result
 * that means something other than it appears to, which is worse than no result.
 */
function resolveBackendType(
  profile: AgentProfile,
  override: Partial<BackendOverride> | undefined,
): BackendType {
  const declared = profile.harness
  const selected = declared === undefined ? undefined : harnessAsBackendType(declared)
  if (selected === undefined) {
    throw new Error(
      `buildBackendOptions: profile declares harness ${JSON.stringify(declared)}, which the sandbox has no backend for. ` +
        `Runnable harnesses: ${harnessBackends.join(', ')}.`,
    )
  }
  if (override?.type && selected && override.type !== selected) {
    throw new Error(
      `buildBackendOptions: backend override ${JSON.stringify(override.type)} conflicts with AgentProfile backend ${JSON.stringify(selected)}`,
    )
  }
  return selected
}

/**
 * Build `CreateSandboxOptions` for `profile`, merging `overrides` and setting
 * `backend.profile`. The exact profile model always rides the create request;
 * an omitted model would let the sandbox silently select an environmental
 * default while Runtime recorded the profile model as the executed instrument.
 * Other model/server override fields pass through after exact-model validation.
 */
export function buildBackendOptions(
  profile: AgentProfile,
  overrides: Partial<CreateSandboxOptions> | undefined,
): CreateSandboxOptions {
  assertExecutableAgentProfile(profile, 'buildBackendOptions')
  const base = overrides ?? {}
  const overrideBackend = base.backend
  const overrideModel = overrideBackend?.model?.model
  const profileModel = concreteProfileModel(profile)
  if (overrideModel !== undefined && overrideModel !== profileModel) {
    throw new Error(
      `buildBackendOptions: backend model ${JSON.stringify(overrideModel)} conflicts with AgentProfile model ${JSON.stringify(profileModel)}`,
    )
  }
  return {
    ...base,
    backend: {
      type: resolveBackendType(profile, overrideBackend),
      profile,
      model: {
        ...overrideBackend?.model,
        model: profileModel,
      },
      ...(overrideBackend?.server ? { server: overrideBackend.server } : {}),
    },
  }
}
