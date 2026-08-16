import type {
  AgentInteractiveSessionRef,
  AgentInteractiveSessionStart,
} from '@tangle-network/agent-interface'
import {
  AgentEnvironmentCapabilitiesSchema,
  AgentInteractiveSessionRefSchema,
  agentInteractiveSessionRefMatchesStart,
  agentInteractiveSessionRunRef,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  exactAgentInteractiveSessionStart,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
} from '@tangle-network/agent-interface/environment-provider'
import { RetainedInteractiveBindingError } from '../errors'
import {
  createRetainedInteractiveRunHandle,
  freezeInteractiveRef,
} from './retained-interactive-handle'
import type {
  ReconnectRetainedInteractiveRunOptions,
  RecoverRetainedInteractiveRunOptions,
  RetainedInteractiveRunHandle,
  StartRetainedInteractiveRunOptions,
} from './retained-interactive-types'
import { assertStableText, awaitAbortable } from './retained-run-binding'
import { admitDurably, mintRetainedIdentity } from './retained-run-start'
import { detachedSnapshot } from './supervise/snapshot'

/** Start one retry-safe native coding-agent TUI without dispatching a headless turn. @stable */
export async function startRetainedInteractiveRun(
  options: StartRetainedInteractiveRunOptions,
): Promise<RetainedInteractiveRunHandle> {
  options.signal?.throwIfAborted()
  assertStableText(options.environment.idempotencyKey, 'environment idempotency key')
  assertStableText(options.interactiveIdempotencyKey, 'interactive idempotency key')
  if (typeof options.onAdmission !== 'function') {
    throw new Error('startRetainedInteractiveRun requires an awaited onAdmission durability hook')
  }
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const profile = agentProfileSchema.parse(options.environment.profile)
  if (profile.harness === undefined) {
    throw new Error('retained interactive runs require AgentProfile.harness')
  }
  const requestedProfileDigest = canonicalAgentProfileDigest(profile)
  const identity = mintRetainedIdentity(
    options.environment.idempotencyKey,
    options.interactiveIdempotencyKey,
  )
  const providerCapabilities = AgentEnvironmentCapabilitiesSchema.parse(
    await awaitAbortable(
      Promise.resolve().then(() => options.provider.capabilities()),
      options.signal,
    ),
  )
  assertInteractiveCapabilities(options.provider.name, providerCapabilities)

  const environment = await awaitAbortable(
    Promise.resolve().then(() =>
      options.provider.create({
        ...options.environment,
        profile,
        signal: options.signal,
        metadata: {
          ...options.environment.metadata,
          retainedIdempotencyKey: options.environment.idempotencyKey,
          interactiveIdempotencyKey: options.interactiveIdempotencyKey,
          requestedProfileDigest,
          sessionId: identity.sessionId,
          executionId: identity.executionId,
        },
      }),
    ),
    options.signal,
  )
  let capabilities: AgentEnvironmentCapabilities
  try {
    assertExactEnvironment(options.provider.name, environment)
    options.signal?.throwIfAborted()
    capabilities = interactiveCapabilitiesForEnvironment(
      options.provider.name,
      providerCapabilities,
      environment,
    )
    assertInteractiveMethods(options.provider.name, environment)
  } catch (error) {
    await destroyUnusedEnvironment(environment, error, options.signal)
    throw error
  }

  const request = interactiveRequest(
    options,
    environment,
    profile,
    requestedProfileDigest,
    identity,
  )
  await admitDurably(options.onAdmission, {
    phase: 'interactive_environment',
    provider: options.provider.name,
    environmentId: environment.id,
    idempotencyKey: options.environment.idempotencyKey,
    interactiveIdempotencyKey: options.interactiveIdempotencyKey,
    request,
  })

  const ref = exactStartedRef(
    request,
    await awaitAbortable(
      Promise.resolve().then(() =>
        environment.startInteractive!(request, {
          signal: options.signal,
        }),
      ),
      options.signal,
    ),
  )
  await admitDurably(options.onAdmission, {
    phase: 'interactive_started',
    idempotencyKey: options.environment.idempotencyKey,
    interactiveIdempotencyKey: options.interactiveIdempotencyKey,
    ref,
  })
  return createRetainedInteractiveRunHandle(environment, ref, capabilities, request)
}

/** Retry one exact start after its provider response may have been lost. @stable */
export async function recoverRetainedInteractiveRun(
  options: RecoverRetainedInteractiveRunOptions,
): Promise<RetainedInteractiveRunHandle | null> {
  options.signal?.throwIfAborted()
  if (typeof options.onAdmission !== 'function') {
    throw new Error('recoverRetainedInteractiveRun requires an awaited onAdmission durability hook')
  }
  const admission = options.admission
  if (admission.provider !== options.provider.name) {
    throw new Error('interactive admission belongs to another provider')
  }
  const request = exactRecoveryRequest(admission)
  const { environment, capabilities } = await reconstructEnvironment(
    options.provider,
    admission.environmentId,
    options.signal,
  )
  if (!environment || !capabilities) return null
  const ref = exactStartedRef(
    request,
    await awaitAbortable(
      Promise.resolve().then(() =>
        environment.startInteractive!(request, {
          signal: options.signal,
        }),
      ),
      options.signal,
    ),
  )
  await admitDurably(options.onAdmission, {
    phase: 'interactive_started',
    idempotencyKey: admission.idempotencyKey,
    interactiveIdempotencyKey: admission.interactiveIdempotencyKey,
    ref,
  })
  return createRetainedInteractiveRunHandle(environment, ref, capabilities, request)
}

function exactRecoveryRequest(
  admission: RecoverRetainedInteractiveRunOptions['admission'],
): AgentInteractiveSessionStart {
  assertStableText(admission.environmentId, 'interactive environment id')
  assertStableText(admission.idempotencyKey, 'environment idempotency key')
  assertStableText(admission.interactiveIdempotencyKey, 'interactive idempotency key')
  const request = exactAgentInteractiveSessionStart(admission.request)
  const identity = mintRetainedIdentity(
    admission.idempotencyKey,
    admission.interactiveIdempotencyKey,
  )
  if (
    request.run.provider !== admission.provider ||
    request.run.environmentId !== admission.environmentId ||
    request.run.sessionId !== identity.sessionId ||
    request.run.executionId !== identity.executionId
  ) {
    throw new Error('interactive admission does not match its recovery coordinates')
  }
  return request
}

/** Rebuild controls for one exact provider-owned coding-agent process. @stable */
export async function reconnectRetainedInteractiveRun(
  options: ReconnectRetainedInteractiveRunOptions,
): Promise<RetainedInteractiveRunHandle | null> {
  options.signal?.throwIfAborted()
  const ref = AgentInteractiveSessionRefSchema.parse(options.ref)
  if (ref.run.provider !== options.provider.name) {
    throw new Error('interactive session reference belongs to another provider')
  }
  const { environment, capabilities } = await reconstructEnvironment(
    options.provider,
    ref.run.environmentId,
    options.signal,
  )
  if (!environment || !capabilities) return null
  const handle = createRetainedInteractiveRunHandle(environment, ref, capabilities)
  await handle.status({ signal: options.signal })
  return handle
}

function interactiveRequest(
  options: StartRetainedInteractiveRunOptions,
  environment: AgentEnvironment,
  profile: StartRetainedInteractiveRunOptions['environment']['profile'],
  requestedProfileDigest: `sha256:${string}`,
  identity: { readonly sessionId: string; readonly executionId: string },
): AgentInteractiveSessionStart {
  const start = {
    profile,
    requestedProfileDigest,
    ...(options.initialPrompt === undefined ? {} : { initialPrompt: options.initialPrompt }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.cols === undefined ? {} : { cols: options.cols }),
    ...(options.rows === undefined ? {} : { rows: options.rows }),
  }
  const run = agentInteractiveSessionRunRef(
    {
      provider: options.provider.name,
      environmentId: environment.id,
      ...identity,
    },
    start,
  )
  return exactAgentInteractiveSessionStart({ run, ...start })
}

async function reconstructEnvironment(
  provider: ReconnectRetainedInteractiveRunOptions['provider'],
  environmentId: string,
  signal?: AbortSignal,
): Promise<{
  environment: AgentEnvironment | null
  capabilities: AgentEnvironmentCapabilities | null
}> {
  if (!provider.get) {
    throw new Error(`provider "${provider.name}" cannot reconstruct an environment by id`)
  }
  const providerCapabilities = AgentEnvironmentCapabilitiesSchema.parse(
    await awaitAbortable(
      Promise.resolve().then(() => provider.capabilities()),
      signal,
    ),
  )
  assertInteractiveCapabilities(provider.name, providerCapabilities)
  const environment = await awaitAbortable(
    Promise.resolve().then(() => provider.get!(environmentId, { signal })),
    signal,
  )
  if (!environment) return { environment: null, capabilities: null }
  assertExactEnvironment(provider.name, environment, environmentId)
  const capabilities = interactiveCapabilitiesForEnvironment(
    provider.name,
    providerCapabilities,
    environment,
  )
  assertInteractiveMethods(provider.name, environment)
  return { environment, capabilities }
}

function exactStartedRef(
  request: AgentInteractiveSessionStart,
  value: AgentInteractiveSessionRef,
): AgentInteractiveSessionRef {
  const stableRequest = detachedSnapshot(request, 'interactive start binding request')
  let ref: AgentInteractiveSessionRef
  try {
    ref = AgentInteractiveSessionRefSchema.parse(value)
  } catch (error) {
    throw new RetainedInteractiveBindingError(stableRequest, {}, { cause: error })
  }
  if (!agentInteractiveSessionRefMatchesStart(request, ref)) {
    throw new RetainedInteractiveBindingError(
      stableRequest,
      detachedSnapshot(
        { ref: detachedSnapshot(ref, 'interactive provider start reference') },
        'interactive provider start result',
      ),
      { cause: new Error('provider started another interactive run than requested') },
    )
  }
  return freezeInteractiveRef(ref)
}

function assertExactEnvironment(
  providerName: string,
  environment: AgentEnvironment,
  environmentId?: string,
): void {
  if (
    environment.provider !== providerName ||
    (environmentId && environment.id !== environmentId)
  ) {
    throw new Error('provider returned another interactive environment')
  }
  assertStableText(environment.id, 'interactive environment id')
}

function interactiveCapabilitiesForEnvironment(
  providerName: string,
  providerCapabilities: AgentEnvironmentCapabilities,
  environment: AgentEnvironment,
): AgentEnvironmentCapabilities {
  const capabilities =
    environment.capabilities === undefined
      ? providerCapabilities
      : AgentEnvironmentCapabilitiesSchema.parse(environment.capabilities)
  assertInteractiveCapabilities(providerName, capabilities)
  return capabilities
}

function assertInteractiveCapabilities(
  providerName: string,
  capabilities: AgentEnvironmentCapabilities,
): void {
  const interactive = capabilities.interactiveAgent
  if (
    !interactive?.start ||
    !interactive.status ||
    !interactive.attach ||
    !interactive.reattach ||
    !interactive.sendPrompt ||
    !interactive.input ||
    !interactive.resize ||
    !interactive.stop
  ) {
    throw new Error(`provider "${providerName}" cannot control an exact interactive agent`)
  }
}

function assertInteractiveMethods(providerName: string, environment: AgentEnvironment): void {
  if (!environment.startInteractive || !environment.interactive) {
    throw new Error(`provider "${providerName}" exposes incomplete interactive agent controls`)
  }
}

async function destroyUnusedEnvironment(
  environment: AgentEnvironment,
  cause: unknown,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await awaitAbortable(
      Promise.resolve().then(() => environment.destroy?.({ signal })),
      signal,
    )
  } catch (cleanupError) {
    throw new AggregateError(
      [cause, cleanupError],
      'interactive environment was invalid and could not be destroyed',
    )
  }
}
