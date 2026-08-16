import {
  AgentEnvironmentCapabilitiesSchema,
  AgentExactRunControlRefSchema,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
  AgentSession,
} from '@tangle-network/agent-interface/environment-provider'
import {
  RetainedInteractiveAdmissionError,
  RetainedRunAdmissionError,
  RetainedRunDispatchBindingError,
} from '../errors'
import { assertRequestedInteractionCapabilities } from './interaction-capabilities'
import {
  assertStableText,
  exactControlRef,
  exactSession,
  freezeControlRef,
} from './retained-run-binding'
import { createRetainedRunHandle } from './retained-run-handle'
import type {
  ReconnectRetainedRunOptions,
  RecoverRetainedRunOptions,
  RecoverRetainedRunResult,
  RetainedInteractiveAdmission,
  RetainedRunAdmission,
  RetainedRunAdmissionHook,
  RetainedRunHandle,
  StartRetainedRunInEnvironmentOptions,
  StartRetainedRunOptions,
} from './retained-run-types'
import { detachedSnapshot } from './supervise/snapshot'
import { freshTurnInput } from './turn-input'

/**
 * Mint deterministic dispatch coordinates from the two caller-supplied keys.
 * The same `(idempotencyKey, turnId)` pair yields the same coordinates in
 * every process, so a pre-dispatch admission record always names the exact
 * session and execution the dispatch will request. Format is readable, not
 * hashed, following `deriveExecutionId`: components are URL-encoded so
 * delimiters inside caller keys cannot collapse distinct pairs, and the
 * result stays inside the 256-byte identifier bound.
 */
export function mintRetainedIdentity(
  idempotencyKey: string,
  turnId: string,
): { sessionId: string; executionId: string } {
  const base = `${encodeURIComponent(idempotencyKey)}:${encodeURIComponent(turnId)}`
  const sessionId = `retained-session:${base}`
  const executionId = `retained-execution:${base}`
  if (executionId.length > 256) {
    throw new RangeError('minted retained identity must not exceed 256 bytes')
  }
  return { sessionId, executionId }
}

/**
 * Dispatch one detached, replayable run and return only after exact durable
 * coordinates are confirmed by the provider and persisted by the caller.
 *
 * The required `onAdmission` hook is awaited twice: with the recovery
 * coordinates after environment creation, and with the verified exact control
 * reference after dispatch. The returned promise resolves only after the
 * dispatched admission is durable, so no caller can observe a successful start
 * whose exact reference a crash would lose.
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
  if (typeof options.onAdmission !== 'function') {
    throw new Error('startRetainedRun requires an awaited onAdmission durability hook')
  }
  const identity =
    options.identity ??
    mintRetainedIdentity(options.environment.idempotencyKey, options.turn.turnId)
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  assertRequestedInteractionCapabilities(
    options.provider.name,
    options.turn.interactions,
    providerCapabilities,
  )
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }

  // Runtime-owned keys in metadata give operators provider-side visibility
  // into which retained coordinates created this environment. Caller metadata
  // is preserved; the runtime keys overwrite same-named caller keys.
  const environment = await options.provider.create({
    ...options.environment,
    metadata: {
      ...options.environment.metadata,
      retainedIdempotencyKey: options.environment.idempotencyKey,
      sessionId: identity.sessionId,
      executionId: identity.executionId,
    },
  })
  let capabilities: AgentEnvironmentCapabilities
  try {
    capabilities = retainedCapabilitiesForEnvironment(
      options.provider.name,
      providerCapabilities,
      environment,
    )
    assertRequestedInteractionCapabilities(
      options.provider.name,
      options.turn.interactions,
      capabilities,
    )
  } catch (error) {
    try {
      await environment.destroy?.()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'retained run environment published invalid capabilities and could not be destroyed',
      )
    }
    throw error
  }
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

  return dispatchRetainedRun({
    provider: options.provider,
    environment,
    environmentIdempotencyKey: options.environment.idempotencyKey,
    turn: options.turn,
    identity,
    onAdmission: options.onAdmission,
    capabilities,
    now: options.now,
  })
}

/**
 * Dispatch a fresh retained session inside an existing provider environment.
 *
 * This operation reuses only the environment. It does not append to a prior
 * harness chat and does not claim native conversation continuity. The caller
 * must use `RetainedRunHandle.continueNative` for a verified same-chat turn.
 *
 * @stable
 */
export async function startRetainedRunInEnvironment(
  options: StartRetainedRunInEnvironmentOptions,
): Promise<RetainedRunHandle> {
  assertStableText(options.environment.id, 'retained environment id')
  assertStableText(options.environment.idempotencyKey, 'environment idempotency key')
  assertStableText(options.turn.turnId, 'turn idempotency key')
  if (options.identity !== undefined) {
    assertStableText(options.identity.sessionId, 'retained session id')
    assertStableText(options.identity.executionId, 'retained execution id')
  }
  if (typeof options.onAdmission !== 'function') {
    throw new Error('startRetainedRunInEnvironment requires an awaited onAdmission durability hook')
  }
  const identity =
    options.identity ??
    mintRetainedIdentity(options.environment.idempotencyKey, options.turn.turnId)
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const environment = await options.provider.get(options.environment.id)
  if (!environment) {
    throw new Error(
      `provider "${options.provider.name}" no longer holds environment "${options.environment.id}"`,
    )
  }
  if (environment.id !== options.environment.id || environment.provider !== options.provider.name) {
    throw new Error('provider reconstructed a different retained environment')
  }
  const capabilities = retainedCapabilitiesForEnvironment(
    options.provider.name,
    providerCapabilities,
    environment,
  )
  assertRequestedInteractionCapabilities(
    options.provider.name,
    options.turn.interactions,
    capabilities,
  )
  if (!environment.dispatch || !environment.session) {
    throw new Error(`provider "${options.provider.name}" does not expose detached session control`)
  }
  await assertRetainedEnvironmentOwnership(
    options.provider,
    environment.id,
    options.environment.idempotencyKey,
  )

  return dispatchRetainedRun({
    provider: options.provider,
    environment,
    environmentIdempotencyKey: options.environment.idempotencyKey,
    turn: options.turn,
    identity,
    onAdmission: options.onAdmission,
    capabilities,
    now: options.now,
  })
}

async function assertRetainedEnvironmentOwnership(
  provider: AgentEnvironmentProvider,
  environmentId: string,
  idempotencyKey: string,
): Promise<void> {
  if (!provider.list) {
    throw new Error(
      `provider "${provider.name}" cannot prove retained environment ownership by metadata`,
    )
  }
  const summaries = await provider.list({
    metadata: { retainedIdempotencyKey: idempotencyKey },
  })
  const matches = summaries.filter(
    (summary) => summary.id === environmentId && summary.provider === provider.name,
  )
  if (matches.length !== 1 || matches[0]?.metadata?.retainedIdempotencyKey !== idempotencyKey) {
    throw new Error(
      `provider "${provider.name}" could not bind environment "${environmentId}" to its retained idempotency key`,
    )
  }
}

interface DispatchRetainedRunOptions {
  readonly provider: AgentEnvironmentProvider
  readonly environment: AgentEnvironment
  readonly environmentIdempotencyKey: string
  readonly turn: StartRetainedRunOptions['turn']
  readonly identity: { readonly sessionId: string; readonly executionId: string }
  readonly onAdmission: RetainedRunAdmissionHook
  readonly capabilities: AgentEnvironmentCapabilities
  readonly now?: () => number
}

async function dispatchRetainedRun(
  options: DispatchRetainedRunOptions,
): Promise<RetainedRunHandle> {
  const { environment, identity } = options
  assertRequestedInteractionCapabilities(
    options.provider.name,
    options.turn.interactions,
    options.capabilities,
  )
  // The environment admission fires only for a dispatch-capable environment.
  await admitDurably(options.onAdmission, {
    phase: 'environment',
    provider: options.provider.name,
    environmentId: environment.id,
    idempotencyKey: options.environmentIdempotencyKey,
    turnId: options.turn.turnId,
    sessionId: identity.sessionId,
    executionId: identity.executionId,
  })

  // Once dispatch begins, its outcome may be unknown to this process. Keep the
  // environment so a retry or reconnect can recover work that may already be live.
  const reference = await environment.dispatch!(
    freshTurnInput(options.turn, {
      turnId: options.turn.turnId,
      detach: true,
      ...identity,
    }),
  )
  // Every post-dispatch binding failure is triageable: the durable
  // environment admission names the requested coordinates, and the error
  // carries the provider's actual answer. The environment is kept.
  let exact: ReturnType<typeof exactSession>
  try {
    if (reference.provider !== undefined && reference.provider !== options.provider.name) {
      throw new Error('provider dispatch returned a session reference for another provider')
    }
    if (reference.id !== identity.sessionId) {
      throw new Error('provider dispatched into another session than the requested identity')
    }
    const controlRef = exactControlRef(reference.controlRef, {
      provider: options.provider.name,
      environmentId: environment.id,
      sessionId: identity.sessionId,
    })
    if (controlRef.executionId !== identity.executionId) {
      throw new Error('provider bound another execution than the requested identity')
    }
    exact = exactSession(environment, controlRef)
  } catch (error) {
    throw new RetainedRunDispatchBindingError(
      {
        provider: options.provider.name,
        environmentId: environment.id,
        sessionId: identity.sessionId,
        executionId: identity.executionId,
      },
      {
        ...(reference.id === undefined ? {} : { id: reference.id }),
        ...(reference.provider === undefined ? {} : { provider: reference.provider }),
        ...(reference.controlRef === undefined ? {} : { controlRef: reference.controlRef }),
      },
      { cause: error },
    )
  }
  await admitDurably(options.onAdmission, {
    phase: 'dispatched',
    controlRef: freezeControlRef(exact.controlRef),
    idempotencyKey: options.environmentIdempotencyKey,
    turnId: options.turn.turnId,
  })
  return createRetainedRunHandle(
    environment,
    exact.session,
    exact.controlRef,
    options.capabilities,
    options.now,
  )
}

/**
 * Await one admission record through the caller's durability hook. A rejection
 * keeps the environment alive — the provider state plus any partial admission
 * record is the recovery path — and surfaces as `RetainedRunAdmissionError` so
 * callers can distinguish a persistence failure from a provider failure.
 */
export async function admitDurably<
  TAdmission extends RetainedRunAdmission | RetainedInteractiveAdmission,
>(onAdmission: (admission: TAdmission) => Promise<void>, admission: TAdmission): Promise<void> {
  const stableAdmission = detachedSnapshot(admission, 'retained run admission')
  try {
    await onAdmission(stableAdmission)
  } catch (error) {
    if (isInteractiveAdmission(stableAdmission)) {
      throw new RetainedInteractiveAdmissionError(stableAdmission, { cause: error })
    }
    throw new RetainedRunAdmissionError(stableAdmission, { cause: error })
  }
}

function isInteractiveAdmission(
  admission: RetainedRunAdmission | RetainedInteractiveAdmission,
): admission is RetainedInteractiveAdmission {
  return admission.phase === 'interactive_environment' || admission.phase === 'interactive_started'
}

/**
 * Rebuild the exact run named by pre-dispatch admission coordinates, or
 * report why the provider cannot prove it.
 *
 * `not_found`: the provider no longer holds the environment, so nothing
 * remains to destroy. `recovered`: the provider self-identified the session
 * with a strict exact reference matching the recorded coordinates.
 * `unverifiable`: the environment exists but the provider cannot
 * self-identify the session — no session accessor, an accessor that throws,
 * a lazy accessor with no stored reference, or a loose reference. That
 * outcome is never destroy-safe: keep the environment, retry
 * `reconnectRetainedRun` with a dispatched admission record, or inspect the
 * environment with provider-native tools. A session that self-identifies
 * with different coordinates throws: something live is not the recorded run.
 *
 * @stable
 */
export async function recoverRetainedRun(
  options: RecoverRetainedRunOptions,
): Promise<RecoverRetainedRunResult> {
  assertStableText(options.environmentId, 'retained environment id')
  assertStableText(options.sessionId, 'retained session id')
  assertStableText(options.executionId, 'retained execution id')
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const environment = await options.provider.get(options.environmentId)
  if (!environment) return { outcome: 'not_found' }
  const capabilities = retainedCapabilitiesForEnvironment(
    options.provider.name,
    providerCapabilities,
    environment,
  )
  if (!environment.session) return { outcome: 'unverifiable', environment }
  let session: AgentSession
  try {
    session = environment.session(options.sessionId)
  } catch {
    return { outcome: 'unverifiable', environment }
  }
  // A lazy accessor returns a session for any id and only echoes a reference
  // the caller supplied, so an absent or loose reference proves nothing about
  // the run either way: the answer is unverifiable, never destroy-safe.
  const parsed = AgentExactRunControlRefSchema.safeParse(session.controlRef)
  if (!parsed.success) return { outcome: 'unverifiable', environment }
  const controlRef = parsed.data
  if (
    controlRef.provider !== options.provider.name ||
    controlRef.environmentId !== options.environmentId ||
    controlRef.sessionId !== options.sessionId ||
    controlRef.executionId !== options.executionId
  ) {
    throw new Error('provider session is bound to other retained run coordinates')
  }
  const exact = exactSession(environment, controlRef)
  return {
    outcome: 'recovered',
    handle: createRetainedRunHandle(
      environment,
      exact.session,
      exact.controlRef,
      capabilities,
      options.now,
    ),
  }
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
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const environment = await options.provider.get(controlRef.environmentId)
  if (!environment) return null
  const capabilities = retainedCapabilitiesForEnvironment(
    options.provider.name,
    providerCapabilities,
    environment,
  )
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
  assertRetainedCapabilityRequirements(provider.name, capabilities)
  return capabilities
}

/**
 * Select the capability document for one concrete environment.
 *
 * A measured environment document is authoritative. An absent document uses
 * the provider document because that provider claims the same guarantee for
 * every environment it creates.
 */
export function retainedCapabilitiesForEnvironment(
  providerName: string,
  providerCapabilities: AgentEnvironmentCapabilities,
  environment: AgentEnvironment,
): AgentEnvironmentCapabilities {
  if (environment.capabilities === undefined) return providerCapabilities
  const measured = AgentEnvironmentCapabilitiesSchema.parse(environment.capabilities)
  assertRetainedCapabilityRequirements(providerName, measured)
  return measured
}

function assertRetainedCapabilityRequirements(
  providerName: string,
  capabilities: AgentEnvironmentCapabilities,
): void {
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
    throw new Error(`provider "${providerName}" cannot control a retry-safe retained run`)
  }
}
