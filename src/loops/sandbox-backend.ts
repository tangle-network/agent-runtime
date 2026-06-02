/**
 * @experimental
 *
 * Backend-options assembly shared by the loop kernel's `createSandboxForSpec`
 * and the sandbox planner's box creation, so the worker box and the planner box
 * boot identically. Builds the options only — the acquire path (cold-start
 * recovery) lives in the kernel, the planner calls `client.create` directly.
 */

import type { AgentProfile, CreateSandboxOptions } from '@tangle-network/sandbox'

type BackendType = NonNullable<CreateSandboxOptions['backend']>['type']
type BackendOverride = NonNullable<CreateSandboxOptions['backend']>

/**
 * Resolve the backend `type`: an explicit override wins, then the profile's
 * `metadata.backendType` hint, else the SDK's profile-driven default
 * (`'opencode'` on the platform side). A profile with no hint falls through to
 * the default rather than asserting provenance the profile never declared.
 */
function resolveBackendType(
  profile: AgentProfile,
  override: Partial<BackendOverride> | undefined,
): BackendType {
  if (override?.type) return override.type
  const explicit = profile.metadata?.backendType
  if (typeof explicit === 'string') return explicit as BackendType
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
      profile,
      ...(overrideBackend?.model ? { model: overrideBackend.model } : {}),
      ...(overrideBackend?.server ? { server: overrideBackend.server } : {}),
    },
  }
}
