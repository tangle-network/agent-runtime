import type { ContextTransferRequest, Sha256Digest } from '@tangle-network/agent-interface'
import {
  AgentEnvironmentCapabilitiesSchema,
  AgentEnvironmentGetOptionsSchema,
  AgentExactRunControlRefSchema,
  AgentTurnInputSchema,
  ContextTransferRequestSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  ProxySecretReceiptSchema,
  ProxySecretsSchema,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentGetOptions,
  AgentEnvironmentProvider,
  AgentSession,
  AgentSessionRef,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { mergeProxySecretBindings } from '@tangle-network/agent-interface/environment-provider'
import {
  RetainedInteractiveAdmissionError,
  RetainedRunAdmissionError,
  RetainedRunDispatchBindingError,
  ValidationError,
} from '../errors'
import { assertRequestedInteractionCapabilities } from './interaction-capabilities'
import { assertProxySecretSourceIdentity, createProxySecretBindingAdmission } from './proxy-secret-admission'
import { captureCoordinationProxySecretSourceIdentity, type CoordinationProxySecretSourceIdentity } from './supervise/coordination-credential'
import {
  assertProxySecretCapabilities,
  assertProxySecretInstallation,
  assertProxySecretReceiptLive,
  rejectUnmaterializedProviderEnvironment,
} from './proxy-secret-custody'
import {
  assertProxySecretParentReadback,
  captureProxySecretParents,
  type ProxySecretParents,
  prepareProxySecretParents,
} from './proxy-secret-parents'
import {
  assertRetainedContextTransferCapability,
  assertRetainedContextTransferEnvironment,
  assertRetainedContextTransferIdentity,
  retainedContextTransferReceipt,
} from './retained-context-transfer'
import {
  assertStableText,
  exactControlRef,
  exactSession,
  freezeControlRef,
} from './retained-run-binding'
import { createRetainedRunHandle } from './retained-run-handle'
import {
  retainedCreateMaterial,
  retainedEnvironmentMetadata,
  retainedTurnMaterial,
} from './retained-run-intent'
import type {
  ReconnectRetainedRunOptions,
  RecoverRetainedRunIntentOptions,
  RecoverRetainedRunOptions,
  RecoverRetainedRunResult,
  RetainedInteractiveAdmission,
  RetainedRunAdmission,
  RetainedRunAdmissionHook,
  RetainedRunHandle,
  RetainedRunIntentAdmission,
  RetainedRunStartMaterial,
  StartRetainedRunInEnvironmentOptions,
  StartRetainedRunOptions,
} from './retained-run-types'
import { detachedSnapshot } from './supervise/snapshot'
import { freshTurnInput } from './turn-input'

/** Preserve both authored and Runtime bindings when replacing a retained environment's grants. */
export function retainedProxySecretBindings(environment: CreateAgentEnvironmentInput) {
  const authored =
    typeof environment.profile === 'string' ? undefined : environment.profile.proxySecrets
  if (authored === undefined && environment.proxySecrets === undefined) return undefined
  if (typeof environment.profile === 'string') {
    throw new Error('retained proxy-secret rebinding requires the resolved inline profile')
  }
  return mergeProxySecretBindings(authored, environment.proxySecrets)
}

/** Capture a caller's exact update before capability or ownership reads can yield. */
function captureRetainedProxySecretUpdate(
  options: Pick<AgentEnvironmentGetOptions, 'proxySecrets' | 'proxySecretParents'> & {
    readonly proxySecretSourceIdentity?: CoordinationProxySecretSourceIdentity
  },
) {
  return {
    ...(options.proxySecretSourceIdentity === undefined ? {} : {
      proxySecretSourceIdentity: captureCoordinationProxySecretSourceIdentity(options.proxySecretSourceIdentity),
    }),
    ...(options.proxySecrets === undefined
      ? {}
      : {
          proxySecrets: detachedSnapshot(options.proxySecrets, 'retained provider proxySecrets'),
        }),
    ...(options.proxySecretParents === undefined
      ? {}
      : {
          proxySecretParents: captureProxySecretParents(options.proxySecretParents),
        }),
  }
}

/** Require the maintained owner's side-effect-free lookup; never fall back to resume-capable get. */
export function retainedReadOnlyOptions(options: AgentEnvironmentGetOptions | undefined): AgentEnvironmentGetOptions {
  const parsed = AgentEnvironmentGetOptionsSchema.safeParse({
    readOnly: true,
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(options?.contextTransfer === undefined ? {} : { contextTransfer: options.contextTransfer }),
  })
  if (!parsed.success || !('readOnly' in parsed.data) || parsed.data.readOnly !== true) {
    throw new ValidationError('canonical provider readOnly lookup is required before retained custody discovery')
  }
  return parsed.data
}

/** Admission precedes every lookup or apply that may resume protected provider state. */
async function getRetainedEnvironment(
  provider: AgentEnvironmentProvider,
  id: string,
  options?: AgentEnvironmentGetOptions,
  verifyOwner?: (environment: AgentEnvironment) => Promise<void> | void,
  onAdmission?: RetainedRunAdmissionHook,
  sourceValue?: CoordinationProxySecretSourceIdentity,
): Promise<AgentEnvironment | null> {
  const sourceIdentity = sourceValue === undefined ? undefined
    : captureCoordinationProxySecretSourceIdentity(sourceValue)
  if (options !== undefined) options = { ...options, ...captureRetainedProxySecretUpdate(options) }
  const bindings = options?.proxySecrets
  const parents = prepareProxySecretParents(options?.proxySecretParents, bindings)
  const knownProtected = (bindings?.length ?? 0) > 0
  if (knownProtected && onAdmission === undefined) {
    throw new ValidationError('protected retained provider lookup requires an awaited onAdmission hook')
  }
  const selectedParents = parents ?? captureProxySecretParents({})
  const selectedMaterial = bindings === undefined ? undefined : {
    phase: 'proxy-secrets',
    stage: 'selected',
    provider: provider.name,
    environmentId: id,
    proxySecrets: bindings,
    proxySecretParents: selectedParents,
    ...(sourceIdentity === undefined ? {} : { sourceIdentity }),
  }
  if (knownProtected && selectedMaterial !== undefined && onAdmission !== undefined) {
    await admitDurably(onAdmission, createProxySecretBindingAdmission(selectedMaterial))
  }
  const current = await provider.get!(id, retainedReadOnlyOptions(options))
  if (!current) return null
  if (current.id !== id || current.provider !== provider.name) {
    throw new Error('provider reconstructed a different retained environment')
  }
  if (verifyOwner) await verifyOwner(current)
  const priorParents = assertProxySecretParentReadback(current, undefined, true)
  const protectedState = (current.proxySecretReceipt?.bindings.length ?? 0) > 0
  if (!knownProtected && !protectedState && bindings === undefined) {
    const environment = await provider.get!(id, options)
    if (environment) {
      assertProxySecretReceiptLive(environment)
      assertProxySecretParentReadback(environment, undefined)
    }
    return environment
  }
  if ((knownProtected || protectedState) && onAdmission === undefined) {
    throw new ValidationError('protected retained provider lookup requires an awaited onAdmission hook')
  }
  if (!knownProtected && !protectedState) {
    const environment = await provider.get!(id, options)
    if (environment && bindings !== undefined) {
      assertProxySecretInstallation(environment, bindings, id, 'rebind')
      assertProxySecretParentReadback(environment, parents, true)
    }
    return environment
  }
  const priorReceipt = ProxySecretReceiptSchema.safeParse(current.proxySecretReceipt)
  if (!priorReceipt.success || onAdmission === undefined) {
    throw new ValidationError('retained custody replacement requires a canonical prior receipt and durable admission')
  }
  const nextBindings = bindings ?? priorReceipt.data.bindings.map(({ envName, secretRef, grant }) => ({
    envName, secretRef, ...grant.scope, presentation: grant.presentation,
    placeholderFormat: grant.placeholderFormat,
  }))
  const nextParents = bindings === undefined
    ? prepareProxySecretParents(priorParents, nextBindings)
    : selectedParents
  if (nextParents === undefined) {
    throw new ValidationError('retained custody replacement has no admitted total parent map')
  }
  if (bindings === undefined) assertProxySecretReceiptLive(current)
  if (Object.entries(priorParents ?? {}).some(([envName, pin]) =>
      Object.hasOwn(nextParents, envName) && nextParents[envName] !== pin)) {
    throw new ValidationError('retained custody replacement changes its admitted parent pins')
  }
  if (options?.expectedProxySecretGeneration !== undefined &&
      options.expectedProxySecretGeneration !== priorReceipt.data.generation) {
    throw new ValidationError('retained custody replacement has a stale expected proxy-secret generation')
  }
  const selected = {
    phase: 'proxy-secrets', stage: 'selected', provider: provider.name, environmentId: id,
    proxySecrets: nextBindings, proxySecretParents: nextParents,
    ...(sourceIdentity === undefined ? {} : { sourceIdentity }),
  }
  if (!knownProtected) await admitDurably(onAdmission, createProxySecretBindingAdmission(selected))
  const replacement = {
    ...selected, stage: 'replacement', priorReceipt: priorReceipt.data,
    expectedProxySecretGeneration: priorReceipt.data.generation,
  }
  await admitDurably(onAdmission, createProxySecretBindingAdmission(replacement))
  if (bindings !== undefined) assertProxySecretCapabilities(await provider.capabilities(), bindings)
  const environment = await provider.get!(id, {
    ...options,
    ...(bindings === undefined ? {} : {
      proxySecretParents: nextParents,
      expectedProxySecretGeneration: priorReceipt.data.generation,
      requireInPlace: true,
    }),
  })
  if (!environment) return null
  assertProxySecretInstallation(environment, nextBindings, id, 'rebind')
  if (bindings === undefined) assertProxySecretReceiptLive(environment)
  assertProxySecretParentReadback(environment, nextParents)
  assertProxySecretSourceIdentity(environment.proxySecretReceipt, sourceIdentity)
  const receipt = ProxySecretReceiptSchema.safeParse(environment.proxySecretReceipt)
  if (!receipt.success) throw new ValidationError('retained custody replacement has no canonical installed receipt')
  for (const entry of receipt.data.bindings) {
    const prior = priorReceipt.data.bindings.find(binding =>
      binding.envName === entry.envName && binding.secretRef.key === entry.secretRef.key)
    if (prior !== undefined &&
        canonicalCandidateDigest(prior.grant.identity) !== canonicalCandidateDigest(entry.grant.identity)) {
      throw new ValidationError('retained custody replay changed the source identity of an existing reference')
    }
  }
  await admitDurably(onAdmission, createProxySecretBindingAdmission({
    ...replacement, stage: 'installed', receipt: receipt.data,
  }))
  return environment
}

/**
 * Mint deterministic dispatch coordinates from the two caller-supplied keys.
 * The same `(idempotencyKey, turnId)` pair yields the same coordinates in
 * every process, so a pre-dispatch admission record always names the exact
 * session and execution the dispatch will request. A full SHA-256 digest
 * keeps provider session identifiers bounded and safe for workspace paths.
 */
export function mintRetainedIdentity(
  idempotencyKey: string,
  turnId: string,
): { sessionId: string; executionId: string } {
  const base = `${encodeURIComponent(idempotencyKey)}:${encodeURIComponent(turnId)}`
  const digest = canonicalCandidateDigest({ kind: 'retained-identity.v1', base }).slice(
    'sha256:'.length,
  )
  return {
    sessionId: `retained-session-${digest}`,
    executionId: `retained-execution-${digest}`,
  }
}

/**
 * Dispatch one detached, replayable run and return only after exact durable
 * coordinates are confirmed by the provider and persisted by the caller.
 *
 * The required `onAdmission` hook first records a digest-only intent before
 * creation or receipt-authorized attachment, then records recovery coordinates and the verified exact control
 * reference. The returned promise resolves only after the dispatched admission
 * is durable, so a crash cannot lose a successful start's exact reference.
 *
 * @stable
 */
export async function startRetainedRun(
  options: StartRetainedRunOptions,
): Promise<RetainedRunHandle> {
  options = { ...options, ...captureRetainedProxySecretUpdate(options) }
  assertStableText(options.environment.idempotencyKey, 'environment idempotency key')
  assertStableText(options.turn.turnId, 'turn idempotency key')
  if (typeof options.onAdmission !== 'function') {
    throw new Error('startRetainedRun requires an awaited onAdmission durability hook')
  }
  options = {
    ...options,
    environment: {
      ...options.environment,
      ...(options.environment.proxySecretParents === undefined ? {} : {
        proxySecretParents: captureProxySecretParents(options.environment.proxySecretParents),
      }),
      profile:
        typeof options.environment.profile === 'string'
          ? options.environment.profile
          : detachedSnapshot(options.environment.profile, 'retained provider profile'),
      ...(options.environment.proxySecrets === undefined
        ? {}
        : {
            proxySecrets: detachedSnapshot(
              options.environment.proxySecrets,
              'retained provider proxySecrets',
            ),
          }),
    },
  }
  const contextTransfer = retainedContextTransfer(options.turn.contextTransfer)
  const proxySecrets = retainedProxySecretBindings(options.environment)
  const proxySecretParents = prepareProxySecretParents(
    options.proxySecretParents,
    proxySecrets,
    options.environment.proxySecretParents,
  )
  if (contextTransfer !== undefined && proxySecrets !== undefined) {
    throw new Error('retained context transfer cannot rebind proxy-secret declarations')
  }
  const transferReceipt = retainedContextTransferReceipt(
    options,
    options.provider.name,
    contextTransfer,
  )
  const { sessionId, executionId } =
    options.identity ??
    // Admission coordinates remain authoritative across generator changes.
    options.intent ??
    (transferReceipt === undefined
      ? undefined
      : { sessionId: transferReceipt.sessionId, executionId: transferReceipt.executionId }) ??
    mintRetainedIdentity(options.environment.idempotencyKey, options.turn.turnId)
  const identity = { sessionId, executionId }
  assertStableText(identity.sessionId, 'retained session id')
  assertStableText(identity.executionId, 'retained execution id')
  assertRetainedContextTransferIdentity(transferReceipt, identity)
  AgentTurnInputSchema.parse(
    freshTurnInput(options.turn, {
      turnId: options.turn.turnId,
      detach: true,
      ...identity,
      contextTransfer,
    }),
  )
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const intent = retainedRunIntent(options, identity, contextTransfer)
  if (options.intent === undefined) {
    await admitDurably(options.onAdmission, intent)
  } else {
    assertExactRetainedRunIntent(options.intent, intent)
  }
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  assertProxySecretCapabilities(providerCapabilities, proxySecrets)
  if (transferReceipt !== undefined) assertRetainedContextTransferCapability(providerCapabilities)
  assertRequestedInteractionCapabilities(
    options.provider.name,
    options.turn.interactions,
    providerCapabilities,
  )
  options.environment.signal?.throwIfAborted()
  options.turn.signal?.throwIfAborted()
  const attachmentSignal =
    options.environment.signal === undefined
      ? options.turn.signal
      : options.turn.signal === undefined
        ? options.environment.signal
        : AbortSignal.any([options.environment.signal, options.turn.signal])
  let environment: AgentEnvironment
  let createAdmission: Record<string, unknown> | undefined
  if (transferReceipt !== undefined && contextTransfer !== undefined) {
    const existing = await getRetainedEnvironment(options.provider, transferReceipt.environmentId, {
      contextTransfer,
      proxySecrets: retainedProxySecretBindings(options.environment),
      proxySecretParents,
      ...(attachmentSignal === undefined ? {} : { signal: attachmentSignal }),
    }, undefined, options.onAdmission, options.proxySecretSourceIdentity)
    attachmentSignal?.throwIfAborted()
    if (!existing)
      throw new Error('accepted context transfer environment is unavailable; it cannot be replaced')
    assertRetainedContextTransferEnvironment(existing, contextTransfer, transferReceipt)
    environment = existing
  } else if (options.existingEnvironmentId !== undefined) {
    assertStableText(options.existingEnvironmentId, 'retained environment id')
    const existing = await getRetainedEnvironment(
      options.provider,
      options.existingEnvironmentId,
      {
        proxySecrets: retainedProxySecretBindings(options.environment),
        proxySecretParents,
        ...(attachmentSignal === undefined ? {} : { signal: attachmentSignal }),
      },
      (current) =>
        assertRetainedEnvironmentOwnership(
          options.provider,
          current,
          options.environment.idempotencyKey,
        ),
      options.onAdmission,
      options.proxySecretSourceIdentity,
    )
    if (
      !existing ||
      existing.id !== options.existingEnvironmentId ||
      existing.provider !== options.provider.name
    ) {
      throw new Error('retained provider environment is unavailable or has another identity')
    }
    await assertRetainedEnvironmentOwnership(
      options.provider,
      existing,
      options.environment.idempotencyKey,
    )
    environment = existing
  } else {
    if (proxySecrets !== undefined && proxySecrets.length > 0 && proxySecretParents !== undefined) {
      createAdmission = {
        phase: 'proxy-secrets', stage: 'selected', provider: options.provider.name,
        idempotencyKey: options.environment.idempotencyKey, proxySecrets, proxySecretParents,
        ...(options.proxySecretSourceIdentity === undefined ? {} : {
          sourceIdentity: options.proxySecretSourceIdentity,
        }),
      }
      await admitDurably(options.onAdmission, createProxySecretBindingAdmission(createAdmission))
    }
    environment = await options.provider.create({
      ...options.environment,
      ...(proxySecrets === undefined ? {} : { proxySecretParents }),
      metadata: retainedEnvironmentMetadata(
        options.environment.metadata,
        options.environment.idempotencyKey,
      ),
    })
  }
  let capabilities: AgentEnvironmentCapabilities
  try {
    assertProxySecretInstallation(environment, proxySecrets)
    assertProxySecretSourceIdentity(environment.proxySecretReceipt, options.proxySecretSourceIdentity)
    assertProxySecretParentReadback(
      environment,
      proxySecretParents,
      transferReceipt !== undefined || options.existingEnvironmentId !== undefined,
    )
    capabilities = retainedCapabilitiesForEnvironment(
      options.provider.name,
      providerCapabilities,
      environment,
    )
    if (transferReceipt !== undefined) assertRetainedContextTransferCapability(capabilities)
    assertRequestedInteractionCapabilities(
      options.provider.name,
      options.turn.interactions,
      capabilities,
    )
  } catch (error) {
    return rejectUnmaterializedProviderEnvironment(
      environment,
      error,
      transferReceipt !== undefined || options.existingEnvironmentId !== undefined,
    )
  }
  if (!environment.dispatch || !environment.session) {
    return rejectUnmaterializedProviderEnvironment(
      environment,
      new Error(`provider "${options.provider.name}" does not expose detached session control`),
      transferReceipt !== undefined || options.existingEnvironmentId !== undefined,
    )
  }

  if (createAdmission !== undefined) {
    await admitDurably(options.onAdmission, createProxySecretBindingAdmission({
      ...createAdmission, stage: 'installed', environmentId: environment.id,
      receipt: environment.proxySecretReceipt,
    }))
  }
  return dispatchRetainedRun({
    provider: options.provider,
    environment,
    signal: attachmentSignal,
    environmentIdempotencyKey: options.environment.idempotencyKey,
    proxySecrets,
    proxySecretParents,
    proxySecretSourceIdentity: options.proxySecretSourceIdentity,
    turn: options.turn,
    contextTransfer,
    expectedRunId: transferReceipt?.runId,
    identity,
    onAdmission: options.onAdmission,
    capabilities,
    now: options.now,
    preserveEnvironment:
      transferReceipt !== undefined || options.existingEnvironmentId !== undefined,
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
  options = { ...options, ...captureRetainedProxySecretUpdate(options) }
  if (options.turn.contextTransfer !== undefined) {
    throw new Error(
      'accepted context transfer requires startRetainedRun with its exact profile and receipt',
    )
  }
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
  const contextTransfer = retainedContextTransfer(options.turn.contextTransfer)
  AgentTurnInputSchema.parse(
    freshTurnInput(options.turn, {
      turnId: options.turn.turnId,
      detach: true,
      ...identity,
      contextTransfer,
    }),
  )
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  const environment = await getRetainedEnvironment(
    options.provider,
    options.environment.id,
    {
      proxySecrets: options.proxySecrets,
      proxySecretParents: options.proxySecretParents,
      expectedProxySecretGeneration: options.expectedProxySecretGeneration,
      signal: options.signal,
    },
    (current) =>
      assertRetainedEnvironmentOwnership(
        options.provider,
        current,
        options.environment.idempotencyKey,
      ),
    options.onAdmission,
    options.proxySecretSourceIdentity,
  )
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
    environment,
    options.environment.idempotencyKey,
  )

  return dispatchRetainedRun({
    provider: options.provider,
    environment,
    environmentIdempotencyKey: options.environment.idempotencyKey,
    proxySecrets: options.proxySecrets,
    proxySecretParents: options.proxySecretParents,
    proxySecretSourceIdentity: options.proxySecretSourceIdentity,
    turn: options.turn,
    contextTransfer,
    identity,
    onAdmission: options.onAdmission,
    capabilities,
    now: options.now,
    preserveEnvironment: true,
  })
}

/**
 * Bind an existing environment to the retained key it was created under.
 *
 * The record `provider.get` just returned carries that environment's metadata, and it is the
 * same record a metadata-filtered `list` would match. Reading it costs one request. Listing
 * costs a walk of the caller's whole inventory, and on Tangle Sandbox that walk cannot finish
 * past 2,000 sandboxes: the list route caps `offset` at 1,000 and answers 400. Measured
 * 2026-10-04: 17 of 20 archived Discovery runs hit that 400 (46 times), each on a later turn in
 * an environment that had already done work, and each attempt ended terminally. The listing remains for a provider whose
 * `get` returns no metadata.
 */
async function assertRetainedEnvironmentOwnership(
  provider: AgentEnvironmentProvider,
  environment: AgentEnvironment,
  idempotencyKey: string,
): Promise<void> {
  const unbound = () =>
    new Error(
      `provider "${provider.name}" could not bind environment "${environment.id}" to its retained idempotency key`,
    )
  if (environment.metadata !== undefined) {
    if (environment.metadata.retainedIdempotencyKey !== idempotencyKey) throw unbound()
    return
  }
  if (!provider.list) {
    throw new Error(
      `provider "${provider.name}" cannot prove retained environment ownership by metadata`,
    )
  }
  const summaries = await provider.list({
    metadata: { retainedIdempotencyKey: idempotencyKey },
  })
  const matches = summaries.filter(
    (summary) => summary.id === environment.id && summary.provider === provider.name,
  )
  if (matches.length !== 1 || matches[0]?.metadata?.retainedIdempotencyKey !== idempotencyKey) {
    throw unbound()
  }
}

interface DispatchRetainedRunOptions {
  readonly expectedRunId?: string
  readonly preserveEnvironment?: boolean
  readonly signal?: AbortSignal
  readonly provider: AgentEnvironmentProvider
  readonly environment: AgentEnvironment
  readonly environmentIdempotencyKey: string
  readonly proxySecrets?: AgentEnvironmentGetOptions['proxySecrets']
  readonly proxySecretParents?: ProxySecretParents
  readonly proxySecretSourceIdentity?: CoordinationProxySecretSourceIdentity
  readonly turn: StartRetainedRunOptions['turn']
  readonly contextTransfer?: ContextTransferRequest
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
    ...(options.proxySecretParents === undefined
      ? {}
      : { proxySecretParents: options.proxySecretParents }),
    provider: options.provider.name,
    environmentId: environment.id,
    idempotencyKey: options.environmentIdempotencyKey,
    turnId: options.turn.turnId,
    sessionId: identity.sessionId,
    executionId: identity.executionId,
  })

  // Dispatch failure leaks a paid environment when THIS call provisioned it, and deletes another
  // caller's workspace when it did not. The provider's creation receipt is what separates the two:
  // only `created` is destroyed, and `replayed` or an absent receipt is kept, because an
  // environment whose creation cannot be proven may be held by someone else.
  const destroyIfCreated = (cause: unknown): Promise<never> =>
    rejectUnmaterializedProviderEnvironment(environment, cause, options.preserveEnvironment)

  options.signal?.throwIfAborted()
  options.turn.signal?.throwIfAborted()
  let reference: AgentSessionRef
  try {
    assertProxySecretParentReadback(environment, options.proxySecretParents, true)
    if (options.proxySecrets === undefined) assertProxySecretReceiptLive(environment)
    else assertProxySecretInstallation(environment, options.proxySecrets)
    reference = await environment.dispatch!(
      freshTurnInput(options.turn, {
        turnId: options.turn.turnId,
        detach: true,
        ...identity,
        ...(options.contextTransfer === undefined
          ? {}
          : { contextTransfer: options.contextTransfer }),
      }),
    )
  } catch (error) {
    await destroyIfCreated(error)
    throw error
  }
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
    if (options.expectedRunId !== undefined && controlRef.runId !== options.expectedRunId) {
      throw new Error('provider bound another run than the accepted context transfer receipt')
    }
    exact = exactSession(environment, controlRef)
  } catch (error) {
    const bindingError = new RetainedRunDispatchBindingError(
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
    await destroyIfCreated(bindingError)
    throw bindingError
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
    options.proxySecretParents,
    options.proxySecretSourceIdentity,
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
  return (
    admission.phase === 'interactive_intent' ||
    admission.phase === 'interactive_environment' ||
    admission.phase === 'interactive_started'
  )
}

/**
 * Rebuild the exact run named by a persisted pre-create intent or pre-dispatch
 * admission coordinates, or report why the provider cannot prove it.
 *
 * An intent recovery replays the exact original start material through
 * `startRetainedRun`; a changed replay is rejected before provider creation.
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
export function recoverRetainedRun(
  options: RecoverRetainedRunIntentOptions,
): Promise<RecoverRetainedRunResult>
export function recoverRetainedRun(
  options: RecoverRetainedRunOptions,
): Promise<RecoverRetainedRunResult>
export async function recoverRetainedRun(
  options: RecoverRetainedRunIntentOptions | RecoverRetainedRunOptions,
): Promise<RecoverRetainedRunResult> {
  if ('admission' in options) {
    if (options.admission.provider !== options.provider.name) {
      throw new Error('retained run intent belongs to another provider')
    }
    const handle = await startRetainedRun({
      provider: options.provider,
      ...options.replay,
      intent: options.admission,
      onAdmission: options.onAdmission,
      now: options.now,
    })
    return { outcome: 'recovered', via: 'resumed', handle }
  }
  options = { ...options, ...captureRetainedProxySecretUpdate(options) }
  assertStableText(options.environmentId, 'retained environment id')
  assertStableText(options.sessionId, 'retained session id')
  assertStableText(options.executionId, 'retained execution id')
  const contextTransfer = retainedContextTransfer(options.contextTransfer)
  if (contextTransfer !== undefined && options.proxySecrets !== undefined) {
    throw new Error('retained context transfer cannot rebind proxy-secret declarations')
  }
  const providerCapabilities = await assertRetainedCapabilities(options.provider)
  if (!options.provider.get) {
    throw new Error(`provider "${options.provider.name}" cannot reconstruct an environment by id`)
  }
  // A run that started from an ACCEPTED context transfer repeats the receipt-authorized
  // lookup here: without the request, an adapter requiring receipt authorization answers
  // not_found; without the receipt check, a run the receipt never bound can be accepted.
  const environment =
    contextTransfer === undefined || options.transferReceipt === undefined
      ? await getRetainedEnvironment(
          options.provider,
          options.environmentId,
          {
            proxySecrets: options.proxySecrets,
            proxySecretParents: options.proxySecretParents,
            expectedProxySecretGeneration: options.expectedProxySecretGeneration,
            signal: options.signal,
          },
          (current) => {
            const stored = current.session?.(options.sessionId).controlRef
            const parsed = AgentExactRunControlRefSchema.safeParse(stored)
            if (
              !parsed.success ||
              parsed.data.provider !== options.provider.name ||
              parsed.data.environmentId !== options.environmentId ||
              parsed.data.sessionId !== options.sessionId ||
              parsed.data.executionId !== options.executionId
            )
              throw new Error('provider session is bound to other retained run coordinates')
          },
          options.onAdmission,
          options.proxySecretSourceIdentity,
        )
      : await getRetainedEnvironment(options.provider, options.environmentId, {
          contextTransfer,
          proxySecrets: options.proxySecrets,
          proxySecretParents: options.proxySecretParents,
          expectedProxySecretGeneration: options.expectedProxySecretGeneration,
          signal: options.signal,
        }, undefined, options.onAdmission, options.proxySecretSourceIdentity)
  if (!environment) return { outcome: 'not_found' }
  if (contextTransfer !== undefined && options.transferReceipt !== undefined) {
    assertRetainedContextTransferEnvironment(environment, contextTransfer, options.transferReceipt)
  }
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
    via: 'reattached',
    handle: createRetainedRunHandle(
      environment,
      exact.session,
      exact.controlRef,
      capabilities,
      options.now,
      options.proxySecretParents,
      options.proxySecretSourceIdentity,
    ),
  }
}

/** Check public replay material before reconnecting an already-dispatched execution. */
export function assertRetainedRunReplayMaterial(
  provider: AgentEnvironmentProvider,
  replay: RetainedRunStartMaterial,
  admission: RetainedRunIntentAdmission,
): void {
  const identity = replay.identity ?? admission
  assertStableText(identity.sessionId, 'retained session id')
  assertStableText(identity.executionId, 'retained execution id')
  assertExactRetainedRunIntent(
    admission,
    retainedRunIntent(
      { ...replay, provider },
      identity,
      retainedContextTransfer(replay.turn.contextTransfer),
    ),
  )
}

function retainedRunIntent(
  options: RetainedRunStartMaterial & { readonly provider: AgentEnvironmentProvider },
  identity: { readonly sessionId: string; readonly executionId: string },
  contextTransfer: ContextTransferRequest | undefined,
): RetainedRunIntentAdmission {
  const proxySecretParents = prepareProxySecretParents(
    options.proxySecretParents,
    retainedProxySecretBindings(options.environment),
    options.environment.proxySecretParents,
  )
  const receipt = retainedContextTransferReceipt(options, options.provider.name, contextTransfer)
  assertRetainedContextTransferIdentity(receipt, identity)
  // A named profile is only its name until the provider resolves it; an inline
  // profile has the one AgentProfile identity every other Runtime record uses.
  const { profile } = options.environment
  const requestedProfileDigest =
    typeof profile === 'string'
      ? canonicalCandidateDigest(profile)
      : canonicalAgentProfileDigest(profile)
  const requestDigest = canonicalCandidateDigest({
    kind: 'retained-run-intent.v1',
    provider: options.provider.name,
    idempotencyKey: options.environment.idempotencyKey,
    ...(options.existingEnvironmentId === undefined
      ? {}
      : { existingEnvironmentId: options.existingEnvironmentId }),
    turnId: options.turn.turnId,
    sessionId: identity.sessionId,
    executionId: identity.executionId,
    requestedProfileDigest,
    ...(receipt === undefined
      ? {}
      : {
          contextTransferReceiptDigest: canonicalCandidateDigest({
            ...receipt,
            status: 'accepted',
          }),
        }),
    create: retainedCreateMaterial(options.environment),
    ...(options.proxySecretSourceIdentity === undefined ? {} : {
      proxySecretSourceIdentity: captureCoordinationProxySecretSourceIdentity(options.proxySecretSourceIdentity),
    }),
    ...(proxySecretParents === undefined ? {} : { proxySecretParents }),
    turn: retainedTurnMaterial(options.turn, contextTransfer),
  })
  return {
    phase: 'intent',
    ...(options.proxySecretSourceIdentity === undefined ? {} : {
      proxySecretSourceIdentity: captureCoordinationProxySecretSourceIdentity(options.proxySecretSourceIdentity),
    }),
    ...(options.environment.proxySecrets === undefined ? {} : {
      proxySecrets: ProxySecretsSchema.parse(options.environment.proxySecrets),
    }),
    ...(proxySecretParents === undefined ? {} : { proxySecretParents }),
    provider: options.provider.name,
    idempotencyKey: options.environment.idempotencyKey,
    turnId: options.turn.turnId,
    sessionId: identity.sessionId,
    executionId: identity.executionId,
    runId: `retained-intent-run:${requestDigest.slice('sha256:'.length)}`,
    requestedProfileDigest,
    requestDigest,
  }
}

function retainedContextTransfer(
  value: ContextTransferRequest | undefined,
): ContextTransferRequest | undefined {
  if (value === undefined) return undefined
  const parsed = ContextTransferRequestSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      'retained context transfer request is invalid or uses an incompatible wire contract; preserve the original record and explicitly reconstruct and review an Interface 5 transfer request before retrying',
      { cause: parsed.error },
    )
  }
  return detachedSnapshot(parsed.data, 'retained context transfer request')
}

function assertExactRetainedRunIntent(
  received: RetainedRunIntentAdmission,
  expected: RetainedRunIntentAdmission,
): void {
  const stableReceived = parseRetainedRunIntent(received)
  const { proxySecrets: _snapshot, ...legacyExpected } = expected
  const comparable = stableReceived.proxySecrets === undefined ? legacyExpected : expected
  if (canonicalCandidateDigest(stableReceived) !== canonicalCandidateDigest(comparable)) {
    throw new Error('retained run intent conflicts with replay material')
  }
}

function parseRetainedRunIntent(value: unknown): RetainedRunIntentAdmission {
  const stable = detachedSnapshot(value, 'retained run intent')
  if (stable === null || typeof stable !== 'object' || Array.isArray(stable)) {
    throw new Error('retained run intent is malformed')
  }
  const record = stable as Record<string, unknown>
  const allowed = new Set([
    'phase',
    'provider',
    'idempotencyKey',
    'turnId',
    'sessionId',
    'executionId',
    'runId',
    'requestedProfileDigest',
    'requestDigest',
    'proxySecretParents',
    'proxySecrets',
    'proxySecretSourceIdentity',
  ])
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error('retained run intent contains unsupported material')
  }
  if (record.phase !== 'intent') {
    throw new Error('retained run intent has an invalid phase')
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'phase') continue
    if (key === 'proxySecretSourceIdentity') {
      captureCoordinationProxySecretSourceIdentity(value)
      continue
    }
    if (key === 'proxySecrets') {
      if (!ProxySecretsSchema.safeParse(value).success) throw new Error('retained run intent proxySecrets are invalid')
      continue
    }
    if (key === 'proxySecretParents') {
      captureProxySecretParents(value)
      continue
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`retained run intent field "${key}" is invalid`)
    }
  }
  assertDigest(record.requestedProfileDigest, 'retained run intent profile digest')
  assertDigest(record.requestDigest, 'retained run intent request digest')
  return stable as RetainedRunIntentAdmission
}

function assertDigest(value: unknown, label: string): asserts value is Sha256Digest {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

/** Rebuild a retained-run client without retaining any object from the starter. @stable */
export async function reconnectRetainedRun(
  options: ReconnectRetainedRunOptions,
): Promise<RetainedRunHandle | null> {
  options = { ...options, ...captureRetainedProxySecretUpdate(options) }
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
  const environment = await getRetainedEnvironment(
    options.provider,
    controlRef.environmentId,
    {
      proxySecrets: options.proxySecrets,
      proxySecretParents: options.proxySecretParents,
      expectedProxySecretGeneration: options.expectedProxySecretGeneration,
      signal: options.signal,
    },
    (current) => {
      exactSession(current, controlRef)
    },
    options.onAdmission,
    options.proxySecretSourceIdentity,
  )
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
    options.proxySecretParents,
    options.proxySecretSourceIdentity,
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
