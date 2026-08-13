import { randomUUID } from 'node:crypto'
import {
  agentProfileSchema,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import { detachedSnapshot } from './snapshot'
import type {
  ExecutionBindingReceipt,
  Executor,
  ExecutorExecutionBinding,
  ExecutorMaterialization,
  ProfileMaterializationReceipt,
  ProviderModelAttemptEvidence,
  ProviderModelExecutionEvidence,
  Runtime,
  UnknownMaterializationReason,
} from './types'

type RuntimeOwnedExecutorMaterialization =
  | {
      readonly kind: 'known'
      readonly declaration: ExecutorMaterialization
      readonly binding?: ExecutorExecutionBinding
    }
  | {
      /** A Runtime-owned external executor whose exact launch is known, but whose remote
       * materializer has not yet returned its terminal acknowledgement. This private state lets
       * Runtime validate the planned authority before execution without presenting it as proof
       * that the remote process actually used that plan. */
      readonly kind: 'pending'
      readonly runtime: Runtime
      readonly declaration: ExecutorMaterialization
      readonly binding: ExecutorExecutionBinding
    }
  | { readonly kind: 'deferred'; readonly runtime: Runtime }

interface RuntimeOwnedExecutorMaterializationRef {
  current: RuntimeOwnedExecutorMaterialization
}

const runtimeOwnedExecutorMaterializations = new WeakMap<
  object,
  RuntimeOwnedExecutorMaterializationRef
>()
const runtimeOwnedScopeOwners = new WeakMap<object, Runtime>()
const runtimeOwnedExecutorProviderEvidenceState = new WeakMap<
  object,
  {
    readonly attempts: Array<{
      readonly observations: string[]
      identityConflict?: boolean
      providerDispatch?: 'not_started'
    }>
  }
>()
const runtimeOwnedDriveHarnessProviderEvidenceState = new WeakMap<
  object,
  ProviderModelExecutionEvidence
>()

interface KnownReceiptInput {
  readonly authoredProfileDigest: Sha256Digest
  readonly runtime: Runtime
  readonly declaration: ExecutorMaterialization
}

interface UnknownReceiptInput {
  readonly authoredProfileDigest?: Sha256Digest
  readonly runtime: Runtime
  readonly reason: UnknownMaterializationReason
}

const declarationKeys = new Set([
  'effectiveProfile',
  'backend',
  'model',
  'execution',
  'materializer',
  'plan',
  'platformAttachments',
])

/**
 * Bind a declaration to a runtime-owned executor without putting an attestable method on the
 * public Executor interface. This module is not a package export: arbitrary caller executors stay
 * unknown even if they add a lookalike `materialization()` property.
 */
export function attestRuntimeOwnedExecutor<Out>(
  executor: Executor<Out>,
  declaration: ExecutorMaterialization,
  binding?: ExecutorExecutionBinding,
): Executor<Out> {
  runtimeOwnedExecutorMaterializations.set(executor as object, {
    current: Object.freeze({
      kind: 'known',
      declaration: detachedSnapshot(declaration, 'runtime-owned executor materialization'),
      ...(binding === undefined
        ? {}
        : {
            binding: detachedSnapshot(binding, 'runtime-owned executor execution binding'),
          }),
    }),
  })
  ensureProviderEvidenceState(executor)
  return executor
}

/** Brand an external Runtime executor whose exact remote materialization is provable only after
 * its terminal protocol acknowledgement. The declaration is a planned authority check, never a
 * known receipt; callers must finalize this same object after validating the acknowledgement. */
export function attestRuntimeOwnedPendingExecutor<Out>(
  executor: Executor<Out>,
  runtime: Runtime,
  declaration: ExecutorMaterialization,
  binding: ExecutorExecutionBinding,
): Executor<Out> {
  runtimeOwnedExecutorMaterializations.set(executor as object, {
    current: Object.freeze({
      kind: 'pending',
      runtime,
      declaration: detachedSnapshot(declaration, 'pending executor materialization'),
      binding: detachedSnapshot(binding, 'pending executor execution binding'),
    }),
  })
  return executor
}

/** Replace a private pending brand with terminally acknowledged evidence. A caller-owned executor
 * cannot enter this path because only this module can create the pending WeakMap entry. */
export function finalizeRuntimeOwnedPendingExecutor<Out>(
  executor: Executor<Out>,
  declaration: ExecutorMaterialization,
  binding: ExecutorExecutionBinding,
): Executor<Out> {
  const ref = runtimeOwnedExecutorMaterializations.get(executor as object)
  if (ref?.current.kind !== 'pending' || ref.current.runtime !== executor.runtime) {
    throw new ValidationError(
      'executor materialization: terminal acknowledgement has no matching Runtime-owned pending executor',
    )
  }
  ref.current = Object.freeze({
    kind: 'known',
    declaration: detachedSnapshot(declaration, 'runtime-owned executor materialization'),
    binding: detachedSnapshot(binding, 'runtime-owned executor execution binding'),
  })
  return executor
}

/** Mark a runtime-owned orchestration executor whose exact leaf declaration is published through
 * its private nested Scope before the first backend inference. Arbitrary executors cannot opt in. */
export function attestRuntimeOwnedDeferredExecutor<Out>(
  executor: Executor<Out>,
  runtime: Runtime,
): Executor<Out> {
  runtimeOwnedExecutorMaterializations.set(executor as object, {
    current: Object.freeze({ kind: 'deferred', runtime }),
  })
  return executor
}

/** Preserve the runtime-owned attestation when a trusted wrapper changes result semantics only. */
export function inheritRuntimeOwnedExecutorAttestation<In, Out>(
  source: Executor<In>,
  wrapper: Executor<Out>,
): Executor<Out> {
  const ref = runtimeOwnedExecutorMaterializations.get(source as object)
  if (ref !== undefined) {
    runtimeOwnedExecutorMaterializations.set(wrapper as object, ref)
  }
  const providerState = ensureProviderEvidenceState(source)
  runtimeOwnedExecutorProviderEvidenceState.set(wrapper as object, providerState)
  return wrapper
}

function ensureProviderEvidenceState<Out>(executor: Executor<Out>): {
  readonly attempts: Array<{
    readonly observations: string[]
    identityConflict?: boolean
    providerDispatch?: 'not_started'
  }>
} {
  const existing = runtimeOwnedExecutorProviderEvidenceState.get(executor as object)
  if (existing !== undefined) return existing
  const state = { attempts: [] }
  runtimeOwnedExecutorProviderEvidenceState.set(executor as object, state)
  return state
}

/** Read a declaration only when Runtime itself branded this exact executor object. */
export function runtimeOwnedExecutorMaterialization<Out>(
  executor: Executor<Out>,
): ExecutorMaterialization | undefined {
  const attestation = runtimeOwnedExecutorMaterializations.get(executor as object)?.current
  return attestation?.kind === 'known' ? attestation.declaration : undefined
}

/** Read one attempt binding only from the private brand on this exact executor object. */
export function runtimeOwnedExecutorExecutionBinding<Out>(
  executor: Executor<Out>,
): ExecutorExecutionBinding | undefined {
  const attestation = runtimeOwnedExecutorMaterializations.get(executor as object)?.current
  return attestation?.kind === 'known' ? attestation.binding : undefined
}

/** Read a planned external declaration only for Runtime's private pending brand. This is useful for
 * pre-execution authority checks, but must never be turned into a known durable receipt. */
export function runtimeOwnedPendingExecutorMaterialization<Out>(executor: Executor<Out>):
  | {
      readonly runtime: Runtime
      readonly declaration: ExecutorMaterialization
      readonly binding: ExecutorExecutionBinding
    }
  | undefined {
  const attestation = runtimeOwnedExecutorMaterializations.get(executor as object)?.current
  return attestation?.kind === 'pending'
    ? {
        runtime: attestation.runtime,
        declaration: attestation.declaration,
        binding: attestation.binding,
      }
    : undefined
}

/** Read the expected leaf runtime only for a privately branded deferred orchestration executor. */
export function runtimeOwnedDeferredExecutorRuntime<Out>(
  executor: Executor<Out>,
): Runtime | undefined {
  const attestation = runtimeOwnedExecutorMaterializations.get(executor as object)?.current
  return attestation?.kind === 'deferred' ? attestation.runtime : undefined
}

/** Propagate trust from a built-in driver adapter to the Agent and recursive executor it owns. */
export function attestRuntimeOwnedScopeOwner<T extends object>(owner: T, runtime: Runtime): T {
  runtimeOwnedScopeOwners.set(owner, runtime)
  return owner
}

/** Return a built-in scope owner's expected concrete leaf runtime; caller-owned functions/Agents
 * deliberately have no entry even if they add lookalike fields. */
export function runtimeOwnedScopeOwnerRuntime(owner: object): Runtime | undefined {
  return runtimeOwnedScopeOwners.get(owner)
}

/** Mark one provider inference attempt on a Runtime-owned executor. */
export function recordRuntimeOwnedProviderAttemptStart<Out>(executor: Executor<Out>): void {
  const state = ensureProviderEvidenceState(executor)
  state.attempts.push({ observations: [] })
}

/** Mark the current attempt as rejected before provider dispatch.
 *
 * The caller may use this only after consuming the Router-owned
 * `provider_dispatch: "not_started"` fact. Any other error stays an empty,
 * unknown attempt and must not be upgraded here.
 */
export function recordRuntimeOwnedProviderDispatchNotStarted<Out>(executor: Executor<Out>): void {
  const state = ensureProviderEvidenceState(executor)
  const attempt = state.attempts.at(-1)
  if (attempt === undefined) {
    throw new ValidationError('provider dispatch rejection arrived before an attempt started')
  }
  if (attempt.observations.length > 0 || attempt.identityConflict === true) {
    throw new ValidationError(
      'provider dispatch rejection arrived after provider identity evidence was observed',
    )
  }
  attempt.providerDispatch = 'not_started'
}

/** Record a trusted served model on the current provider attempt. */
export function recordRuntimeOwnedProviderModel<Out>(executor: Executor<Out>, model: string): void {
  const state = runtimeOwnedExecutorProviderEvidenceState.get(executor as object)
  const attempt = state?.attempts.at(-1)
  if (attempt === undefined) {
    throw new ValidationError('provider model observation arrived before an attempt started')
  }
  if (attempt.observations.at(-1) !== model) attempt.observations.push(model)
}

/** Convert process-local provider observations into a frozen, replayable evidence value. */
export function runtimeOwnedExecutorProviderEvidence<Out>(
  executor: Executor<Out>,
): ProviderModelExecutionEvidence | undefined {
  const state = runtimeOwnedExecutorProviderEvidenceState.get(executor as object)
  if (state === undefined || state.attempts.length === 0) return undefined
  const attempts: ReadonlyArray<ProviderModelAttemptEvidence> = Object.freeze(
    state.attempts.map((attempt) =>
      Object.freeze({
        observations: Object.freeze([...attempt.observations]),
        ...(attempt.identityConflict ? { identityConflict: true } : {}),
        ...(attempt.providerDispatch === 'not_started'
          ? { providerDispatch: 'not_started' as const }
          : {}),
      }),
    ),
  )
  const models = Object.freeze([...new Set(attempts.flatMap((attempt) => attempt.observations))])
  const missing = attempts.some(
    (attempt) => attempt.observations.length === 0 && attempt.providerDispatch !== 'not_started',
  )
  const conflict = attempts.some((attempt) => attempt.identityConflict === true)
  const served = attempts.some((attempt) => attempt.observations.length > 0)
  return Object.freeze(
    missing || conflict || !served
      ? {
          status: 'unknown' as const,
          attempts,
          models,
          reason: conflict
            ? ('provider-model-conflict' as const)
            : ('provider-model-missing' as const),
        }
      : { status: 'known' as const, attempts, models },
  )
}

/** Mark the current provider attempt unusable after conflicting served identity metadata. */
export function recordRuntimeOwnedProviderIdentityConflict<Out>(executor: Executor<Out>): void {
  const state = ensureProviderEvidenceState(executor)
  const attempt = state.attempts.at(-1)
  if (attempt === undefined) {
    throw new ValidationError('provider identity conflict arrived before an attempt started')
  }
  attempt.identityConflict = true
}

/** Attach one executor's provider evidence to a Runtime-owned root drive for final projection. */
export function recordRuntimeOwnedDriveHarnessProviderEvidence(
  owner: object,
  evidence: ProviderModelExecutionEvidence | undefined,
): void {
  if (evidence === undefined) return
  const prior = runtimeOwnedDriveHarnessProviderEvidenceState.get(owner)
  if (prior === undefined) {
    runtimeOwnedDriveHarnessProviderEvidenceState.set(owner, evidence)
    return
  }
  const attempts = Object.freeze([...prior.attempts, ...evidence.attempts])
  const models = Object.freeze([...new Set([...prior.models, ...evidence.models])])
  const missing = attempts.some(
    (attempt) => attempt.observations.length === 0 && attempt.providerDispatch !== 'not_started',
  )
  const conflict = attempts.some((attempt) => attempt.identityConflict === true)
  const served = attempts.some((attempt) => attempt.observations.length > 0)
  runtimeOwnedDriveHarnessProviderEvidenceState.set(
    owner,
    Object.freeze(
      missing || conflict || !served
        ? {
            status: 'unknown' as const,
            attempts,
            models,
            reason: conflict
              ? ('provider-model-conflict' as const)
              : ('provider-model-missing' as const),
          }
        : { status: 'known' as const, attempts, models },
    ),
  )
}

/** Read provider evidence recorded by a Runtime-owned root drive. */
export function runtimeOwnedDriveHarnessProviderEvidence(
  owner: object,
): ProviderModelExecutionEvidence | undefined {
  return runtimeOwnedDriveHarnessProviderEvidenceState.get(owner)
}

/** Build one kernel-owned known receipt from a data-only executor declaration. */
export function knownMaterializationReceipt(
  input: KnownReceiptInput,
): ProfileMaterializationReceipt {
  const declaration = detachedSnapshot(input.declaration, 'executor materialization')
  assertExactDeclaration(declaration)
  const effectiveProfile = agentProfileSchema.safeParse(declaration.effectiveProfile)
  if (!effectiveProfile.success) {
    throw new ValidationError('executor materialization: effectiveProfile must be an AgentProfile')
  }
  assertNonEmpty(declaration.backend, 'backend')
  assertNonEmpty(declaration.materializer, 'materializer')
  assertNonEmpty(declaration.execution?.kind, 'execution.kind')
  assertNonEmpty(declaration.execution?.id, 'execution.id')
  assertModel(declaration.model)

  let effectiveProfileDigest: Sha256Digest
  let materializationPlanDigest: Sha256Digest
  let platformAttachmentsDigest: Sha256Digest | undefined
  try {
    effectiveProfileDigest = canonicalAgentProfileDigest(effectiveProfile.data)
    materializationPlanDigest = canonicalCandidateDigest(jsonWireSnapshot(declaration.plan))
    platformAttachmentsDigest =
      declaration.platformAttachments === undefined
        ? undefined
        : canonicalCandidateDigest(jsonWireSnapshot(declaration.platformAttachments))
  } catch (error) {
    throw new ValidationError(
      'executor materialization: profile, plan, and attachments must be finite RFC 8785 JSON',
      { cause: error },
    )
  }

  return Object.freeze({
    status: 'known' as const,
    authoredProfileDigest: input.authoredProfileDigest,
    effectiveProfileDigest,
    materializationPlanDigest,
    ...(platformAttachmentsDigest === undefined ? {} : { platformAttachmentsDigest }),
    runtime: input.runtime,
    backend: declaration.backend,
    model: declaration.model,
    execution: declaration.execution,
    materializer: declaration.materializer,
  })
}

/** Build an explicit unknown receipt without fabricating any executor-owned identity. */
export function unknownMaterializationReceipt(
  input: UnknownReceiptInput,
): ProfileMaterializationReceipt {
  return Object.freeze({
    status: 'unknown' as const,
    ...(input.authoredProfileDigest === undefined
      ? {}
      : { authoredProfileDigest: input.authoredProfileDigest }),
    runtime: input.runtime,
    reason: input.reason,
  })
}

/** Mint a process-unique attempt id before executor construction. */
export function newExecutionAttemptId(nodeId: string): string {
  return `${nodeId}:attempt:${randomUUID()}`
}

/** Build the immutable safe receipt for a full, transient execution binding. */
export function knownExecutionBindingReceipt(
  materialization: ProfileMaterializationReceipt,
  bindingInput: ExecutorExecutionBinding,
): ExecutionBindingReceipt {
  const binding = detachedSnapshot(bindingInput, 'executor execution binding')
  assertNonEmpty(binding.attemptId, 'binding.attemptId')
  assertSafeDescriptor(binding.descriptor)
  let materializationReceiptDigest: Sha256Digest
  let bindingDigest: Sha256Digest
  try {
    materializationReceiptDigest = canonicalCandidateDigest(materialization)
    // Bind the exact JSON document a backend receives. Optional AgentProfile fields are represented
    // as `undefined` in memory but omitted by JSON transport; normalize that one distinction while
    // rejecting every non-finite/non-data value instead of silently coercing it.
    bindingDigest = canonicalCandidateDigest(jsonWireSnapshot(binding.binding))
  } catch (error) {
    throw new ValidationError('executor binding must be finite RFC 8785 JSON', { cause: error })
  }
  return Object.freeze({
    status: 'known' as const,
    attemptId: binding.attemptId,
    materializationReceiptDigest,
    bindingDigest,
    descriptor: binding.descriptor,
  })
}

/** Preserve an attempt boundary even when its caller-owned transport cannot be attested. */
export function unknownExecutionBindingReceipt(
  materialization: ProfileMaterializationReceipt,
  attemptId: string,
  reason: UnknownMaterializationReason,
): ExecutionBindingReceipt {
  assertNonEmpty(attemptId, 'binding.attemptId')
  return Object.freeze({
    status: 'unknown' as const,
    attemptId,
    materializationReceiptDigest: canonicalCandidateDigest(materialization),
    reason,
  })
}

/** Derive an authored-profile digest without turning non-canonical input into a fake identity. */
export function authoredProfileDigest(profile: unknown): Sha256Digest | undefined {
  try {
    return canonicalAgentProfileDigest(agentProfileSchema.parse(profile))
  } catch {
    return undefined
  }
}

function assertExactDeclaration(value: ExecutorMaterialization): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('executor materialization: declaration must be an object')
  }
  const unknown = Object.keys(value).filter((key) => !declarationKeys.has(key))
  if (unknown.length > 0) {
    throw new ValidationError(
      `executor materialization: unknown declaration fields: ${unknown.sort().join(', ')}`,
    )
  }
  if (!Object.hasOwn(value, 'plan')) {
    throw new ValidationError('executor materialization: plan is required')
  }
}

function assertModel(model: ExecutorMaterialization['model']): void {
  if (typeof model !== 'object' || model === null || Array.isArray(model)) {
    throw new ValidationError('executor materialization: model must be a known/unknown identity')
  }
  const keys = Object.keys(model).sort()
  if (model.status === 'known') {
    if (keys.join(',') !== 'id,status') {
      throw new ValidationError('executor materialization: known model accepts only status and id')
    }
    assertNonEmpty(model.id, 'model.id')
    return
  }
  if (model.status === 'unknown') {
    if (keys.join(',') !== 'reason,status') {
      throw new ValidationError(
        'executor materialization: unknown model accepts only status and reason',
      )
    }
    assertNonEmpty(model.reason, 'model.reason')
    return
  }
  throw new ValidationError('executor materialization: model.status must be known or unknown')
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`executor materialization: ${field} must be a non-empty string`)
  }
}

function assertSafeDescriptor(descriptor: ExecutorExecutionBinding['descriptor']): void {
  if (typeof descriptor !== 'object' || descriptor === null || Array.isArray(descriptor)) {
    throw new ValidationError('executor binding: descriptor must be an object')
  }
  for (const [key, value] of Object.entries(descriptor)) {
    if (/(url|uri|token|key|secret|bearer|credential|authorization)/i.test(key)) {
      throw new ValidationError(`executor binding: unsafe descriptor key ${JSON.stringify(key)}`)
    }
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new ValidationError(
        `executor binding: descriptor ${JSON.stringify(key)} must be scalar`,
      )
    }
    if (typeof value === 'string' && (value.includes('://') || value.includes('@'))) {
      throw new ValidationError(
        `executor binding: descriptor ${JSON.stringify(key)} contains transport or credential text`,
      )
    }
  }
}

function jsonWireSnapshot(value: unknown, path = '$'): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`executor binding: ${path} must be finite`)
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) {
        throw new ValidationError(`executor binding: ${path}[${index}] cannot be undefined`)
      }
      return jsonWireSnapshot(item, `${path}[${index}]`)
    })
  }
  if (typeof value !== 'object' || value === null) {
    throw new ValidationError(`executor binding: ${path} must be JSON data`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ValidationError(`executor binding: ${path} must be a plain object`)
  }
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue
    out[key] = jsonWireSnapshot(item, `${path}.${key}`)
  }
  return out
}
