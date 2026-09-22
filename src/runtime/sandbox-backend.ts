/**
 *
 * Backend-options assembly shared by the loop kernel's `createSandboxForSpec`
 * and the sandbox planner's box creation, so the worker box and the planner box
 * boot identically. Builds the options only — the acquire path (cold-start
 * recovery) lives in the kernel, the planner calls `client.create` directly.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { CreateSandboxOptions } from '@tangle-network/sandbox'

type BackendType = NonNullable<CreateSandboxOptions['backend']>['type']
type BackendOverride = NonNullable<CreateSandboxOptions['backend']>

/**
 * Resolve the backend `type`: an explicit override wins, then the profile's
 * `metadata.backendType` hint, else the SDK's profile-driven default
 * (`'opencode'` on the platform side). A profile with no hint falls through to
 * the default rather than asserting provenance the profile never declared.
 */
export function resolveSandboxBackendType(
  profile: AgentProfile,
  override: Partial<BackendOverride> | undefined,
): BackendType {
  if (override?.type) return override.type
  if (profile.harness) return parseSandboxBackendType(profile.harness, 'AgentProfile.harness')
  const explicit = profile.metadata?.backendType
  if (explicit !== undefined)
    return parseSandboxBackendType(explicit, 'AgentProfile.metadata.backendType')
  return 'opencode' as BackendType
}

/** The narrow compatibility port between Interface's portable harness names and the sandbox
 * SDK's backend names. Keep the check here until sandbox exports its own runtime predicate. */
function parseSandboxBackendType(value: unknown, source: string): BackendType {
  switch (value) {
    case 'opencode':
    case 'claude-code':
    case 'kimi-code':
    case 'codex':
    case 'amp':
    case 'factory-droids':
    case 'pi':
    case 'hermes':
    case 'forge':
    case 'openclaw':
    case 'nanoclaw':
    case 'acp':
    case 'cursor':
    case 'cli-base':
      return value
    default:
      throw new TypeError(
        `${source} ${JSON.stringify(value)} is not supported by the sandbox backend`,
      )
  }
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
      type: resolveSandboxBackendType(profile, overrideBackend),
      profile,
      ...(overrideBackend?.model ? { model: overrideBackend.model } : {}),
      ...(overrideBackend?.server ? { server: overrideBackend.server } : {}),
    },
  }
}
