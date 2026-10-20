import type { SpawnPreflight } from '../../mcp/tools/coordination'
import type { AgentEnvironmentProvider } from '../environment-provider'
import { profileBridgeWireModel } from './model-policy'
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
import { providerAcceptsCoordinationAttachments } from './supervise-runtime-attachments'
import {
  type CoordinationBinding,
  coordinationProfileToolPrefix,
  declaredRuntimeToolNames,
  runtimeToolDeclarationError,
} from './supervisor-agent'

/**
 * The pre-flight `supervise` installs for a bridge backend. No new knob: the backend already says
 * where the bridge is, and these are the questions only the bridge can answer.
 *
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
    const result = await validate(profile)
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

/** Refuse a Runtime-managed child whose declared tools cannot exist on its execution path. */
export function profileToolSpawnPreflight(
  runtimeOwnsManager: boolean,
  canResolveProductTools: boolean,
): SpawnPreflight {
  return async (profile) => {
    // A caller-owned worker factory is the execution port. It receives the exact profile and owns
    // its own native tool mount, just as it owns retry and completion behavior; Runtime cannot
    // truthfully infer that mount from a function value.
    if (!runtimeOwnsManager) return undefined
    const declarationError = runtimeToolDeclarationError(profile, canResolveProductTools)
    if (declarationError !== undefined) {
      return {
        cause: 'unmountable-tool',
        detail: declarationError,
      }
    }
    return undefined
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
      return (await providerAcceptsCoordinationAttachments(managerBackend))
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
