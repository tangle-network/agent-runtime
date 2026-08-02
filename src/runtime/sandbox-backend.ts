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

type BackendType = NonNullable<CreateSandboxOptions['backend']>['type']
type BackendOverride = NonNullable<CreateSandboxOptions['backend']>

/** The AgentProfile type as @tangle-network/sandbox declares it — compiled
 *  against agent-interface 0.38, not this package's 0.40. */
export type SandboxAgentProfile = NonNullable<BackendOverride['profile']>

/**
 * Version-skew boundary: sandbox 0.16.0 types profiles against interface 0.38
 * (MCP `args`/`env`/`headers` as plain strings), while this runtime is on 0.40
 * (`AgentProfileConfigValue` objects). No published sandbox release is typed
 * against 0.40 yet, and the profile crosses this boundary as data — the values
 * are forwarded, not reinterpreted — so the only conversion is the nominal type
 * hop. This is the ONE sanctioned cast for that skew; remove both adapters when
 * sandbox releases against interface 0.40.
 */
export function profileAsSandboxProfile(profile: AgentProfile): SandboxAgentProfile {
  return profile as unknown as SandboxAgentProfile
}

/** Reverse hop of the same skew boundary — see `profileAsSandboxProfile`. */
export function sandboxProfileAsProfile(profile: SandboxAgentProfile): AgentProfile {
  return profile as unknown as AgentProfile
}

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
 * Resolve the backend `type`: an explicit override wins, then the profile's
 * `metadata.backendType` hint, then the profile's declared `harness`, else the
 * SDK's profile-driven default (`'opencode'` on the platform side).
 *
 * A declared `harness` the sandbox cannot run throws rather than falling
 * through: silently running a `gemini` profile on opencode returns a result
 * that means something other than it appears to, which is worse than no result.
 */
function resolveBackendType(
  profile: AgentProfile,
  override: Partial<BackendOverride> | undefined,
): BackendType {
  if (override?.type) return override.type
  const explicit = profile.metadata?.backendType
  if (typeof explicit === 'string') return explicit as BackendType
  const declared = profile.harness
  if (declared !== undefined) {
    const backend = harnessAsBackendType(declared)
    if (backend === undefined) {
      throw new Error(
        `buildBackendOptions: profile declares harness "${declared}", which the sandbox has no backend for. ` +
          `Runnable harnesses: ${harnessBackends.join(', ')}. ` +
          'Set metadata.backendType to run it on a different backend deliberately.',
      )
    }
    return backend
  }
  return 'opencode' as BackendType
}

/**
 * Build `CreateSandboxOptions` for `profile`, merging `overrides` and setting
 * `backend.profile`. `model`/`server` from an override backend pass through.
 */
export function buildBackendOptions(
  profile: AgentProfile,
  overrides: Partial<CreateSandboxOptions> | undefined,
): CreateSandboxOptions {
  const base = overrides ?? {}
  const overrideBackend = base.backend
  return {
    ...base,
    backend: {
      type: resolveBackendType(profile, overrideBackend),
      profile: profileAsSandboxProfile(profile),
      ...(overrideBackend?.model ? { model: overrideBackend.model } : {}),
      ...(overrideBackend?.server ? { server: overrideBackend.server } : {}),
    },
  }
}
