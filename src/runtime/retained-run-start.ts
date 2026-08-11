import {
  AgentEnvironmentCapabilitiesSchema,
  AgentExactRunControlRefSchema,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { assertStableText, exactControlRef, exactSession } from './retained-run-binding'
import { createRetainedRunHandle } from './retained-run-handle'
import type {
  ReconnectRetainedRunOptions,
  RetainedRunHandle,
  StartRetainedRunOptions,
} from './retained-run-types'
import { freshTurnInput } from './turn-input'

/**
 * Dispatch one detached, replayable run and return only after exact durable
 * coordinates are confirmed by the provider.
 *
 * @stable
 */
export async function startRetainedRun(
  options: StartRetainedRunOptions,
): Promise<RetainedRunHandle> {
  assertStableText(options.environment.idempotencyKey, 'environment idempotency key')
  assertStableText(options.turn.turnId, 'turn idempotency key')
  if (options.identity !== undefined) {
    assertStableText(options.identity.sessionId, 'retained session id')
    assertStableText(options.identity.executionId, 'retained execution id')
  }
  const capabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }

  const environment = await options.provider.create(options.environment)
  if (!environment.dispatch || !environment.session) {
    try {
      await environment.destroy?.()
    } catch (cleanupError) {
      throw new AggregateError(
        [
          new Error(`provider "${options.provider.name}" does not expose detached session control`),
          cleanupError,
        ],
        'retained run could not start and its unused environment could not be destroyed',
      )
    }
    throw new Error(`provider "${options.provider.name}" does not expose detached session control`)
  }

  // Once dispatch begins, its outcome may be unknown to this process. Keep the
  // idempotently-created environment so a retry or reconnect can recover the
  // retained operation instead of destroying work that may already be live.
  const reference = await environment.dispatch(
    freshTurnInput(options.turn, {
      turnId: options.turn.turnId,
      detach: true,
      ...(options.identity === undefined ? {} : options.identity),
    }),
  )
  if (reference.provider !== undefined && reference.provider !== options.provider.name) {
    throw new Error('provider dispatch returned a session reference for another provider')
  }
  const controlRef = exactControlRef(reference.controlRef, {
    provider: options.provider.name,
    environmentId: environment.id,
    sessionId: reference.id,
  })
  const exact = exactSession(environment, controlRef)
  return createRetainedRunHandle(
    environment,
    exact.session,
    exact.controlRef,
    capabilities,
    options.now,
  )
}

/** Rebuild a retained-run client without retaining any object from the starter. @stable */
export async function reconnectRetainedRun(
  options: ReconnectRetainedRunOptions,
): Promise<RetainedRunHandle | null> {
  const controlRef = AgentExactRunControlRefSchema.parse(options.controlRef)
  if (controlRef.provider !== options.provider.name) {
    throw new Error(
      `run provider "${controlRef.provider}" does not match "${options.provider.name}"`,
    )
  }
  const capabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const environment = await options.provider.get(controlRef.environmentId)
  if (!environment) return null
  const exact = exactSession(environment, controlRef)
  return createRetainedRunHandle(
    environment,
    exact.session,
    exact.controlRef,
    capabilities,
    options.now,
  )
}

export async function assertRetainedCapabilities(
  provider: AgentEnvironmentProvider,
): Promise<AgentEnvironmentCapabilities> {
  const capabilities = AgentEnvironmentCapabilitiesSchema.parse(await provider.capabilities())
  const retained = capabilities.retainedControl
  if (
    retained?.exactRunIdentity !== true ||
    retained.resultIdentity !== true ||
    retained.eventIdentity !== true ||
    retained.cancellationIdempotency !== true ||
    !capabilities.streaming.detach ||
    !capabilities.streaming.replay ||
    !capabilities.streaming.turnIdempotency
  ) {
    throw new Error(`provider "${provider.name}" cannot control a retry-safe retained run`)
  }
  return capabilities
}
