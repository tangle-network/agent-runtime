import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { ConfigError } from '../../errors'
import type { SpawnPreflight } from '../../mcp/tools/coordination-contracts'
import { coordinationVerbNames } from '../../mcp/tools/coordination-events'
import { resolveAgentEnvironmentProvider } from '../environment-provider/provider-registry'
import { unservedToolsRefusal } from './coordination-mcp-tools'
import { profileBridgeWireModel, profileModelExecutionSettings } from './model-policy'
import { providerVisibleProfile } from './provider-visible-profile'
import {
  type BridgeSeam,
  bridgeAdmissionRefusal,
  bridgeModelRouteRefusal,
  type ExecutorConfig,
} from './runtime'
import {
  automaticDriverBackendSupported,
  isExternalSupervisor,
} from './supervise-profile-admission'
import {
  type CoordinationBinding,
  coordinationProfileToolPrefix,
  declaredRuntimeToolNames,
  runtimeToolDeclarationError,
} from './supervisor-agent'

/**
 * Probe the bridge's model route and profile tools before dispatch.
 * Two bridge causes, after the profile-owned tool preflight:
 *
 * - `model-route` — `GET /v1/capabilities?model=<wire id>`. The bridge answers exactly this
 *   question and 404s `no backend matches model "…"`. FAIL CLOSED: any answer that is not a route
 *   refuses, including a transport error or an unexpected status, because a pre-flight that skips
 *   itself on an error is the silent admission it exists to remove.
 * - `bridge-full` — `GET /health` checks the bulk lane that an unreserved Runtime request uses.
 *   Older bridges fall back to the overall admission counters. Capacity is advisory, so only a
 *   positive reading of fullness refuses the spawn.
 */
export function bridgeSpawnPreflight(seam: BridgeSeam): SpawnPreflight {
  return async (profile) => {
    const wireModel = profileBridgeWireModel(profile)
    if (wireModel === undefined) {
      return {
        cause: 'model-route',
        detail: 'the child AgentProfile resolves no bridge wire model (harness + provider + model)',
      }
    }
    const routeRefusal = await bridgeModelRouteRefusal(seam, wireModel)
    if (routeRefusal !== undefined) return { cause: 'model-route', detail: routeRefusal.detail }
    const admissionRefusal = await bridgeAdmissionRefusal(seam)
    if (admissionRefusal !== undefined) return { cause: 'bridge-full', detail: admissionRefusal }
    return undefined
  }
}

/**
 * The pre-flight for a provider backend: the provider's own `validateProfile`, before any box
 * exists. A profile the provider could never provision is refused here, and the refusal reaches
 * the manager's `spawn_worker` call naming each error's code and path, so the manager fixes the
 * profile instead of losing the worker. On Discovery run queens21-h22-capture-root-1-20261019c the
 * root wrote child profiles that mounted `/work/queens21_count.c` on a read-only root filesystem,
 * and 154 attempts across 4 workers each provisioned a box that could not take the mount.
 */
export function providerSpawnPreflight(
  provider: AgentEnvironmentProvider,
): SpawnPreflight | undefined {
  const validate = provider.validateProfile?.bind(provider)
  if (validate === undefined) return undefined
  return async (profile) => {
    // Judge what create receives. Seats and coordination grants are Runtime's and never reach the
    // provider; judging them refused every worker the Lab's own example profile describes.
    const result = await validate(providerVisibleProfile(profile))
    const errors = result.issues.filter((issue) => issue.level === 'error')
    if (result.ok && errors.length === 0) return undefined
    const named = errors.map(
      (issue) =>
        `${issue.code}${issue.path === undefined ? '' : ` at ${issue.path}`}: ${issue.message}`,
    )
    return {
      cause: 'unprovisionable-profile',
      detail: `provider ${provider.name} cannot provision this profile: ${named.length > 0 ? named.join('; ') : 'validation failed without a named error'}`,
    }
  }
}

/** Refuse a Runtime-managed child whose model controls its executor would refuse at its first
 *  attempt (an unknown `model.metadata` key, an ambiguous `maxTokens`): the same check, at the call. */
export function modelSettingsSpawnPreflight(
  runtimeOwnsManager: boolean,
  path: 'router' | 'provider',
): SpawnPreflight | undefined {
  if (!runtimeOwnsManager) return undefined
  return async (profile) => {
    try {
      profileModelExecutionSettings(profile, 'spawn_worker', path)
      return undefined
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error
      return { cause: 'unprovisionable-profile', detail: error.message }
    }
  }
}

/** Refuse a Runtime-managed child whose declared tools cannot exist on its execution path. */
export function profileToolSpawnPreflight(
  runtimeOwnsManager: boolean,
  canResolveProductTools: boolean,
): SpawnPreflight {
  return async (profile, { nodeToolNames }) => {
    // A caller-owned worker factory is the execution port. It receives the exact profile and owns
    // its own native tool mount, just as it owns retry and completion behavior; Runtime cannot
    // truthfully infer that mount from a function value.
    if (!runtimeOwnsManager) return undefined
    // A child is served coordination verbs and the node tools its manager's resolver gives; any
    // other name would settle it down after its sandbox exists (canary-chain-20261109d).
    const served = nodeToolNames && [...coordinationVerbNames, ...nodeToolNames]
    const detail =
      runtimeToolDeclarationError(profile, canResolveProductTools) ??
      (served && unservedToolsRefusal(declaredRuntimeToolNames(profile), served))
    return detail === undefined ? undefined : { cause: 'unmountable-tool', detail }
  }
}

/**
 * Refuse a harness-brained child that declares Runtime coordination tools when nothing can carry
 * the coordination server to it. Such a child runs as a nested manager through `driveHarness`, and
 * the automatic driver reaches Runtime's loopback coordination MCP only through the bridge's
 * runtime-attachments seam (`automaticDriverBackendSupported`). The worker factory throws the same
 * fault, but only after a live-worker permit and a budget reservation were taken and as an unnamed
 * tool error; here it is a pre-flight cause the manager can re-author against, and neither an
 * environment nor a reservation exists yet. A router-brained child holds the same tools in-process
 * and needs no channel.
 */
export function coordinationChannelSpawnPreflight(
  runtimeOwnsManager: boolean,
  hasCustomDriveHarness: boolean,
  managerBackend: ExecutorConfig | undefined,
  coordination: CoordinationBinding | undefined,
): SpawnPreflight | undefined {
  if (!runtimeOwnsManager || hasCustomDriveHarness) return undefined
  if (
    managerBackend !== undefined &&
    automaticDriverBackendSupported(managerBackend, coordination)
  ) {
    if (managerBackend.backend !== 'provider') return undefined
    return async (profile) => {
      if (!isExternalSupervisor(profile) || declaredRuntimeToolNames(profile).length === 0)
        return undefined
      const { provider, registry } = managerBackend
      const capabilities = await resolveAgentEnvironmentProvider(provider, registry).capabilities()
      return capabilities.create?.runtimeAttachments?.mcp === true
        ? undefined
        : {
            cause: 'unmountable-tool',
            detail:
              "the 'provider' backend does not advertise create.runtimeAttachments.mcp; Runtime cannot mount this manager's coordination tools before dispatch",
          }
    }
  }
  const missingChannel =
    managerBackend === undefined
      ? 'this run has no driverBackend'
      : `the '${managerBackend.backend}' backend has no coordination channel`
  return async (profile) => {
    if (!isExternalSupervisor(profile)) return undefined
    const declared = declaredRuntimeToolNames(profile)
    if (declared.length === 0) return undefined
    return {
      cause: 'unmountable-tool',
      detail:
        `the profile declares ${declared
          .map((name) => JSON.stringify(`${coordinationProfileToolPrefix}${name}`))
          .join(', ')} with harness ${JSON.stringify(profile.harness)}, but ${missingChannel}: ` +
        'Use a local bridge, or a provider with runtime MCP attachments and an authenticated ' +
        'coordination.publicUrl this child can reach; an explicit driveHarness may supply its own channel',
    }
  }
}

export function composeSpawnPreflights(
  ...preflights: ReadonlyArray<SpawnPreflight | undefined>
): SpawnPreflight | undefined {
  const active = preflights.filter(
    (preflight): preflight is SpawnPreflight => preflight !== undefined,
  )
  if (active.length === 0) return undefined
  return async (profile, context) => {
    for (const preflight of active) {
      const refusal = await preflight(profile, context)
      if (refusal !== undefined) return refusal
    }
    return undefined
  }
}

/** Refuse a `spawn_worker` machine request that the backend's `maxWorkerResources` does not admit
 *  (#1277): a request is refused, never clamped, and the refusal names the ceiling. */
export function resourceSpawnPreflight(backend: ExecutorConfig | undefined): SpawnPreflight {
  return async (_profile, { resources }) => {
    if (resources === undefined) return undefined
    const ceiling = backend?.backend === 'provider' ? backend.maxWorkerResources : undefined
    const over = (['cpu', 'memoryMb', 'diskMb', 'gpu'] as const).filter(
      (k) =>
        resources[k] !== undefined &&
        (k === 'gpu'
          ? resources.gpu !== ceiling?.gpu
          : !((resources[k] as number) <= (ceiling?.[k] ?? 0))),
    )
    if (over.length === 0) return undefined
    return {
      cause: 'unprovisionable-profile',
      detail: `resources ${over.map((k) => `${k}=${resources[k]}`).join(', ')} exceed this run's maxWorkerResources ${JSON.stringify(ceiling ?? {})}`,
    }
  }
}
