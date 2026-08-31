import type {
  AgentInteractiveSessionRef,
  AgentInteractiveSessionStart,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import {
  AgentEnvironmentCapabilitiesSchema,
  AgentInteractiveSessionRefSchema,
  agentInteractiveSessionRefMatchesStart,
  agentInteractiveSessionRunRef,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
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
import {
  createInteractiveEnvironment,
  destroyInteractiveEnvironment,
  startInteractiveProcess,
} from './retained-interactive-lifecycle'
import type {
  ReconnectRetainedInteractiveRunOptions,
  RecoverRetainedInteractiveRunOptions,
  RetainedInteractiveRunHandle,
  RetainedInteractiveStartMaterial,
  StartRetainedInteractiveRunOptions,
} from './retained-interactive-types'
import { assertStableText, awaitAbortable } from './retained-run-binding'
import { retainedCreateMaterial, retainedEnvironmentMetadata } from './retained-run-intent'
import { admitDurably, mintRetainedIdentity } from './retained-run-start'
import type {
  RetainedInteractiveEnvironmentAdmission,
  RetainedInteractiveIntentAdmission,
} from './retained-run-types'
import { detachedSnapshot } from './supervise/snapshot'
import {
  effectiveWorkspaceCwd,
  normalizeWorkspaceCwd,
  normalizeWorkspaceEnvironment,
} from './workspace-cwd'

/**
 * Start one retry-safe native coding-agent TUI without dispatching a headless turn.
 * The intent admission is durable before provider.create; the environment and
 * process admissions follow only after their exact provider coordinates exist.
 * @stable
 */
export async function startRetainedInteractiveRun(
  options: StartRetainedInteractiveRunOptions,
): Promise<RetainedInteractiveRunHandle> {
  options.signal?.throwIfAborted()
  const startOptions = normalizeRetainedInteractiveStart(options)
  assertStableText(startOptions.environment.idempotencyKey, 'environment idempotency key')
  assertStableText(startOptions.interactiveIdempotencyKey, 'interactive idempotency key')
  if (typeof startOptions.onAdmission !== 'function') {
    throw new Error('startRetainedInteractiveRun requires an awaited onAdmission durability hook')
  }
  if (!startOptions.provider.get) {
    throw new Error(
      `provider "${startOptions.provider.name}" cannot reconstruct an environment by id`,
    )
  }
  const profile = agentProfileSchema.parse(startOptions.environment.profile)
  if (profile.harness === undefined) {
    throw new Error('retained interactive runs require AgentProfile.harness')
  }
  const requestedProfileDigest = canonicalAgentProfileDigest(profile)
  const identity = mintRetainedIdentity(
    startOptions.environment.idempotencyKey,
    startOptions.interactiveIdempotencyKey,
  )
  const intent = interactiveIntent(startOptions, profile, identity)
  if (startOptions.intent === undefined) {
    // This is the only admission that can be written before provider.create.
    // A replay supplies the same record and therefore skips a duplicate write.
    await admitDurably(startOptions.onAdmission, intent)
  } else {
    assertExactInteractiveIntent(startOptions.intent, intent)
  }
  const providerCapabilities = AgentEnvironmentCapabilitiesSchema.parse(
    await awaitAbortable(
      Promise.resolve().then(() => startOptions.provider.capabilities()),
      startOptions.signal,
    ),
  )
  assertInteractiveCapabilities(startOptions.provider.name, providerCapabilities)

  const environment = await createInteractiveEnvironment(
    () =>
      startOptions.provider.create({
        ...startOptions.environment,
        profile,
        signal: startOptions.signal,
        metadata: retainedEnvironmentMetadata(
          startOptions.environment.metadata,
          startOptions.environment.idempotencyKey,
        ),
      }),
    startOptions.signal,
  )
  let capabilities: AgentEnvironmentCapabilities
  try {
    assertExactEnvironment(startOptions.provider.name, environment)
    startOptions.signal?.throwIfAborted()
    capabilities = interactiveCapabilitiesForEnvironment(
      startOptions.provider.name,
      providerCapabilities,
      environment,
    )
    assertInteractiveMethods(startOptions.provider.name, environment)
  } catch (error) {
    await destroyUnusedEnvironment(environment, error)
    throw error
  }

  const request = interactiveRequest(
    startOptions,
    environment,
    profile,
    requestedProfileDigest,
    identity,
  )
  await admitDurably(startOptions.onAdmission, {
    phase: 'interactive_environment',
    provider: startOptions.provider.name,
    environmentId: environment.id,
    idempotencyKey: startOptions.environment.idempotencyKey,
    interactiveIdempotencyKey: startOptions.interactiveIdempotencyKey,
    request,
  })

  const ref = exactStartedRef(
    request,
    await startInteractiveProcess(
      environment,
      () =>
        environment.startInteractive!(request, {
          signal: startOptions.signal,
        }),
      startOptions.signal,
    ),
  )
  await admitDurably(startOptions.onAdmission, {
    phase: 'interactive_started',
    idempotencyKey: startOptions.environment.idempotencyKey,
    interactiveIdempotencyKey: startOptions.interactiveIdempotencyKey,
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
  if (admission.phase === 'interactive_intent') {
    if (options.replay === undefined) {
      throw new Error(
        'recoverRetainedInteractiveRun requires the original start material for an interactive intent',
      )
    }
    return startRetainedInteractiveRun({
      provider: options.provider,
      ...options.replay,
      intent: admission,
      onAdmission: options.onAdmission,
      signal: options.signal,
    })
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
  admission: RetainedInteractiveEnvironmentAdmission,
): AgentInteractiveSessionStart {
  assertStableText(admission.environmentId, 'interactive environment id')
  assertStableText(admission.idempotencyKey, 'environment idempotency key')
  assertStableText(admission.interactiveIdempotencyKey, 'interactive idempotency key')
  const rawRequest =
    typeof admission.request === 'object' && admission.request !== null
      ? (admission.request as Record<string, unknown>)
      : {}
  normalizeWorkspaceCwd(rawRequest.cwd)
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

function normalizeRetainedInteractiveStart(
  options: StartRetainedInteractiveRunOptions,
): StartRetainedInteractiveRunOptions {
  const cwd = effectiveWorkspaceCwd(options.cwd, options.environment.workspace?.cwd)
  return {
    ...options,
    environment: normalizeWorkspaceEnvironment(options.environment),
    ...(cwd === undefined ? {} : { cwd }),
  }
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

function interactiveIntent(
  options: StartRetainedInteractiveRunOptions,
  profile: StartRetainedInteractiveRunOptions['environment']['profile'],
  identity: { readonly sessionId: string; readonly executionId: string },
): RetainedInteractiveIntentAdmission {
  const requestedProfileDigest = canonicalAgentProfileDigest(profile)
  const requestDigest = canonicalCandidateDigest({
    kind: 'retained-interactive-intent.v1',
    provider: options.provider.name,
    idempotencyKey: options.environment.idempotencyKey,
    interactiveIdempotencyKey: options.interactiveIdempotencyKey,
    sessionId: identity.sessionId,
    executionId: identity.executionId,
    requestedProfileDigest,
    create: retainedCreateMaterial(options.environment),
    start: sanitizedStartMaterial(options),
  })
  return {
    phase: 'interactive_intent',
    provider: options.provider.name,
    idempotencyKey: options.environment.idempotencyKey,
    interactiveIdempotencyKey: options.interactiveIdempotencyKey,
    sessionId: identity.sessionId,
    executionId: identity.executionId,
    runId: `interactive-intent-run:${requestDigest.slice('sha256:'.length)}`,
    requestedProfileDigest,
    requestDigest,
  }
}

function sanitizedStartMaterial(
  options: RetainedInteractiveStartMaterial,
): Record<string, unknown> {
  return {
    ...(options.initialPrompt === undefined ? {} : { initialPrompt: options.initialPrompt }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.cols === undefined ? {} : { cols: options.cols }),
    ...(options.rows === undefined ? {} : { rows: options.rows }),
  }
}

function assertExactInteractiveIntent(
  received: RetainedInteractiveIntentAdmission,
  expected: RetainedInteractiveIntentAdmission,
): void {
  const stableReceived = parseInteractiveIntent(received)
  if (canonicalCandidateDigest(stableReceived) !== canonicalCandidateDigest(expected)) {
    throw new Error('interactive intent conflicts with replay material')
  }
}

function parseInteractiveIntent(value: unknown): RetainedInteractiveIntentAdmission {
  const stable = detachedSnapshot(value, 'interactive intent')
  if (stable === null || typeof stable !== 'object' || Array.isArray(stable)) {
    throw new Error('interactive intent is malformed')
  }
  const record = stable as Record<string, unknown>
  const allowed = new Set([
    'phase',
    'provider',
    'idempotencyKey',
    'interactiveIdempotencyKey',
    'sessionId',
    'executionId',
    'runId',
    'requestedProfileDigest',
    'requestDigest',
  ])
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error('interactive intent contains unsupported material')
  }
  if (record.phase !== 'interactive_intent') {
    throw new Error('interactive intent has an invalid phase')
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'phase') continue
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`interactive intent field "${key}" is invalid`)
    }
  }
  assertDigest(record.requestedProfileDigest, 'interactive intent profile digest')
  assertDigest(record.requestDigest, 'interactive intent request digest')
  return stable as RetainedInteractiveIntentAdmission
}

function assertDigest(value: unknown, label: string): asserts value is Sha256Digest {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid`)
  }
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
    !interactive.control ||
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
): Promise<void> {
  try {
    await destroyInteractiveEnvironment(environment)
  } catch (cleanupError) {
    throw new AggregateError(
      [cause, cleanupError],
      'interactive environment was invalid and could not be destroyed',
    )
  }
}
