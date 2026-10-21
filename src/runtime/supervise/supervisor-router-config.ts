import { ValidationError } from '../../errors'
import { routerBrain } from '../router-client'
import type { RouterTransportConfig } from '../router-http-transport'
import type { RouterRouting } from '../router-request-body'
import type { ToolLoopChat } from '../tool-loop'
import { assertCoordinationTransport } from './coordination-mcp'
import { enforceTokenLimits, profileModelExecutionSettings } from './model-policy'
import type { CoordinationBinding } from './supervisor-agent-contracts'
import { resolveSupervisorModelId, type SupervisorProfile } from './supervisor-agent-profile'

/** Validate a manager's coordination authentication and request limits before execution. */
export function assertCoordinationBinding(binding: CoordinationBinding | undefined): void {
  assertCoordinationTransport(binding ?? {})
}

const ROUTER_TRANSPORT_FIELDS = new Set(['routerBaseUrl', 'routerKey', 'complete', 'routing'])

/** Capture the transport-only Router seam before any profile lowering. TypeScript excess-property
 * checks are not a runtime boundary: JavaScript and widened objects can otherwise smuggle private
 * generation/retry fields through a spread and override an AgentProfile that omitted them. */
export function snapshotRouterTransportConfig(input: RouterTransportConfig): RouterTransportConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('supervisorAgent: deps.router must be a RouterTransportConfig object')
  }
  const unsupported = Object.keys(input).filter((field) => !ROUTER_TRANSPORT_FIELDS.has(field))
  if (unsupported.length > 0) {
    throw new ValidationError(
      `supervisorAgent: deps.router contains unsupported behavioral fields: ${unsupported.sort().join(', ')}`,
    )
  }
  if (typeof input.routerBaseUrl !== 'string' || input.routerBaseUrl.length === 0) {
    throw new ValidationError(
      'supervisorAgent: deps.router.routerBaseUrl must be a non-empty string',
    )
  }
  if (typeof input.routerKey !== 'string' || input.routerKey.length === 0) {
    throw new ValidationError('supervisorAgent: deps.router.routerKey must be a non-empty string')
  }
  if (input.complete !== undefined && typeof input.complete !== 'function') {
    throw new ValidationError(
      'supervisorAgent: deps.router.complete must be a function when provided',
    )
  }
  return Object.freeze({
    routerBaseUrl: input.routerBaseUrl,
    routerKey: input.routerKey,
    ...(input.complete !== undefined ? { complete: input.complete } : {}),
    ...(input.routing !== undefined ? { routing: snapshotRouterRouting(input.routing) } : {}),
  })
}

/** Copy provider routing after checking its shape, so a malformed field fails before any turn. */
function snapshotRouterRouting(input: RouterRouting): RouterRouting {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('supervisorAgent: deps.router.routing must be an object')
  }
  const { only, allowFallbacks, requireModel } = input
  if (
    only !== undefined &&
    (!Array.isArray(only) || only.some((name) => typeof name !== 'string' || name.length === 0))
  ) {
    throw new ValidationError(
      'supervisorAgent: deps.router.routing.only must be an array of provider names',
    )
  }
  for (const [name, value] of [
    ['allowFallbacks', allowFallbacks],
    ['requireModel', requireModel],
  ] as const) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new ValidationError(`supervisorAgent: deps.router.routing.${name} must be a boolean`)
    }
  }
  return Object.freeze({
    ...(only !== undefined ? { only: Object.freeze([...only]) } : {}),
    ...(allowFallbacks !== undefined ? { allowFallbacks } : {}),
    ...(requireModel !== undefined ? { requireModel } : {}),
  })
}

export function routerBrainFromProfile(
  profile: SupervisorProfile,
  router: RouterTransportConfig | undefined,
): ToolLoopChat {
  if (!router) {
    throw new ValidationError(
      'supervisorAgent: a router-brained supervisor (harness omitted or cli-base) needs deps.router',
    )
  }
  const modelId = resolveSupervisorModelId(profile)
  const settings = profileModelExecutionSettings(profile, 'supervisorAgent')
  return routerBrain(
    {
      routerBaseUrl: router.routerBaseUrl,
      routerKey: router.routerKey,
      ...(router.complete !== undefined ? { complete: router.complete } : {}),
      ...(router.routing !== undefined ? { routing: router.routing } : {}),
      model: modelId,
      ...(settings.retry !== undefined ? { retry: settings.retry } : {}),
      ...enforceTokenLimits(settings.tokenLimits, 'router', 'supervisorAgent').applied,
      ...(settings.stream !== undefined ? { stream: settings.stream } : {}),
    },
    {
      ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
      ...(settings.toolChoice !== undefined ? { toolChoice: settings.toolChoice } : {}),
      ...(settings.extraBody !== undefined ? { extraBody: settings.extraBody } : {}),
      ...(profile.model?.reasoningEffort ? { reasoningEffort: profile.model.reasoningEffort } : {}),
    },
  )
}
